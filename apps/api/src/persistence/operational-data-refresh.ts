import { Pool, PoolClient } from 'pg';
import { BACKUP_TABLES, DatabaseBackup, verifyBackup } from './backup';
import { CONTENT_REPLACEMENTS, SENSOR_NAMES, OPERATIONAL_STATIONS, OPERATIONAL_ZONES } from './operational-data-profile';

export class OperationalDataError extends Error {}
interface Change { table: string; id: string; before: Record<string, unknown>; after: Record<string, unknown> }
function requireCondition(value: unknown, code: string): asserts value { if (!value) throw new OperationalDataError(code); }

// A one-time content maintenance tool, not a new HTTP privilege or approval
// path. Only allowlisted initialization labels and the two explicitly approved
// synthetic station IDs may change; other identities, roles, verification,
// passwords, token versions and business state are excluded.
export async function refreshOperationalData(pool: Pool, input: DatabaseBackup, dryRun = true) {
  const archive = verifyBackup(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='30s'");
    for (const key of ['smart-durian:migrations', 'smart-durian:actuator-runtime']) {
      const result = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [key]);
      requireCondition(result.rows[0].locked, 'OPERATIONAL_STOP_API_AND_MIGRATIONS_FIRST');
    }
    await client.query(`LOCK TABLE ${[...BACKUP_TABLES, 'technical.schema_migrations'].join(',')} IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    // Require the exact freshly backed-up source before touching any row. JSON
    // remains SQL text so timestamp/numeric precision cannot hide a difference.
    for (const table of archive.postgres) {
      const current = (await client.query(`SELECT row_to_json(t)::text AS row FROM ${table.name} t`)).rows.map((row) => row.row as string).sort();
      requireCondition(JSON.stringify(current) === JSON.stringify(table.rows), 'OPERATIONAL_BACKUP_IS_NOT_CURRENT_SOURCE');
    }
    const seeded = (await client.query("SELECT entity_type,entity_key,data FROM technical.entity_metadata WHERE data->>'seed_key' LIKE 'durian-demo-v1:%' ORDER BY entity_type,entity_key")).rows;
    const adminMeta = seeded.find((row) => row.entity_type === 'users' && row.data.seed_key === 'durian-demo-v1:admin');
    requireCondition(adminMeta, 'OPERATIONAL_PRIMARY_ADMIN_REQUIRED');
    const admin = (await client.query("SELECT id FROM public.users WHERE id=$1 AND role='Admin' AND status='Active'", [adminMeta.entity_key])).rows[0];
    requireCondition(admin, 'OPERATIONAL_PRIMARY_ADMIN_REQUIRED');
    const changes: Change[] = [];
    const assignmentLabels: { id: string; before: string; after: string }[] = [];
    let preservedCustomFields = 0;
    for (let i = 1; i <= 2; i++) {
      const meta = seeded.find((row) => row.entity_type === 'devices' && row.data.seed_key === `durian-demo-v1:device-sim-${i}`);
      if (!meta) continue;
      const device = (await client.query('SELECT id,station_id FROM public.devices WHERE id=$1', [meta.entity_key])).rows[0];
      requireCondition(device && meta.data.seed_origin === 'Simulated', 'OPERATIONAL_SIMULATED_PROVENANCE_REQUIRED');
      if (device.station_id === `SIM_DEMO_00${i}`) {
        changes.push({ table: 'devices', id: device.id, before: { station_id: device.station_id }, after: { station_id: OPERATIONAL_STATIONS[i - 1] } });
      } else requireCondition(device.station_id === OPERATIONAL_STATIONS[i - 1], 'OPERATIONAL_UNEXPECTED_STATION_ID');
    }
    for (const replacement of CONTENT_REPLACEMENTS) {
      const meta = seeded.find((row) => row.entity_type === replacement.table && row.data.seed_key === `durian-demo-v1:${replacement.key}`);
      if (!meta) continue;
      const row = (await client.query(`SELECT * FROM public.${replacement.table} WHERE id=$1`, [meta.entity_key])).rows[0];
      requireCondition(row, 'OPERATIONAL_BROKEN_SEED_REFERENCE');
      const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
      for (const [field, old] of Object.entries(replacement.before)) {
        if (row[field] === old) { before[field] = old; after[field] = replacement.after[field]; }
        else if (row[field] !== replacement.after[field]) preservedCustomFields++;
      }
      if (Object.keys(after).length) changes.push({ table: replacement.table, id: row.id, before, after });
    }
    // Accepted seed assignments display a private snapshot label. Refresh only
    // that generated label, not assignment dates, acceptance, IDs or rights.
    // Never rewrite real workflow snapshots, locked logs or old audit entries.
    for (const meta of seeded.filter((row) => row.entity_type === 'users_zones')) {
      const snapshot = meta.data.zone_snapshot;
      if (!snapshot || typeof snapshot.zone_name !== 'string') continue;
      const zoneMeta = seeded.find((row) => row.entity_type === 'zones' && row.entity_key === snapshot.id);
      const zoneIndex = zoneMeta ? Number(zoneMeta.data.seed_key.split('zone-')[1]) : NaN;
      if (Number.isInteger(zoneIndex) && zoneIndex >= 0 && zoneIndex < OPERATIONAL_ZONES.length) {
        const old = zoneIndex === 0 ? 'Khu A — trạm ESP32 thật' : `Khu ${zoneIndex + 1} — dữ liệu mẫu`;
        if (snapshot.zone_name === old) assignmentLabels.push({ id: meta.entity_key, before: old, after: OPERATIONAL_ZONES[zoneIndex] });
      }
    }
    const deviceIds = seeded.filter((row) => row.entity_type === 'devices').map((row) => row.entity_key);
    if (deviceIds.length) {
      const rows = (await client.query('SELECT id,name,data_stream_id FROM public.sensors WHERE device_id=ANY($1::uuid[])', [deviceIds])).rows;
      const types = ['air_temperature', 'air_humidity', 'soil_moisture', 'soil_temperature', 'soil_ph', 'soil_ec'];
      for (const row of rows) {
        const i = Number(row.data_stream_id) - 301;
        if (i >= 0 && i < 6 && row.name === `Demo ${types[i]}`) changes.push({ table: 'sensors', id: row.id, before: { name: row.name }, after: { name: SENSOR_NAMES[i] } });
      }
    }
    // The old placeholder Manager is removable only when entirely untouched
    // and absent from ALL archived references (including Mongo/history JSON).
    const placeholder = seeded.find((row) => row.entity_type === 'users' && row.data.seed_key === 'durian-demo-v1:sample-manager');
    let removePlaceholder: string | undefined;
    if (placeholder) {
      const user = (await client.query('SELECT * FROM public.users WHERE id=$1', [placeholder.entity_key])).rows[0];
      const untouched = user && user.role === 'Manager' && user.status === 'Pending' && !user.gmail_verify && user.gmail === 'manager.demo@example.invalid' && user.phone_number === '0990000012' && user.user_name === 'Manager chờ duyệt (mẫu)';
      if (untouched) {
        const referenced = archive.postgres.some((table) => table.rows.some((text) => {
          const row = JSON.parse(text);
          if (table.name === 'public.users' && row.id === user.id) return false;
          if (table.name === 'technical.entity_metadata' && row.entity_type === 'users' && row.entity_key === user.id) return false;
          return text.includes(user.id);
        })) || archive.mongo.some((collection) => collection.documents.some((row) => row.includes(user.id)));
        if (!referenced) removePlaceholder = user.id;
      }
    }
    // Reuse the existing primary contact, never invent a deliverable phone/email.
    const contact = (await client.query(`SELECT u.phone_number FROM public.users u JOIN technical.entity_metadata m ON m.entity_type='users' AND m.entity_key=u.id::text WHERE m.data->>'seed_key'='durian-demo-v1:primary-farmer'`)).rows[0];
    const cooperative = seeded.find((row) => row.entity_type === 'cooperatives' && row.data.seed_key === 'durian-demo-v1:cooperative-unmanaged');
    if (contact && cooperative) {
      const row = (await client.query('SELECT contact_number FROM public.cooperatives WHERE id=$1', [cooperative.entity_key])).rows[0];
      if (row?.contact_number === '0990000012') {
        const current = changes.find((change) => change.table === 'cooperatives' && change.id === cooperative.entity_key);
        const change: Change = current ?? { table: 'cooperatives', id: cooperative.entity_key, before: {}, after: {} };
        change.before.contact_number = row.contact_number; change.after.contact_number = contact.phone_number;
        if (!current) changes.push(change);
      }
    }
    if (!dryRun) {
      // User-approved, one-time exception ONLY for the two synthetic stations.
      // PostgreSQL DDL is transactional: a failure rolls this trigger alteration
      // back as well. No ALL-trigger disabling or session_replication_role.
      // SHARE ROW EXCLUSIVE maintenance locks are already held on every table.
      const stationChanges = changes.some((change) => change.table === 'devices');
      if (stationChanges) await client.query('ALTER TABLE public.devices DISABLE TRIGGER device_identity');
      for (const change of changes) await saveLabelChange(client, change, admin.id);
      if (stationChanges) await client.query('ALTER TABLE public.devices ENABLE TRIGGER device_identity');
      for (const label of assignmentLabels) {
        const updated = await client.query(`UPDATE technical.entity_metadata SET version=version+1,
          data=jsonb_set(data,'{zone_snapshot,zone_name}',to_jsonb($2::text)) WHERE entity_type='users_zones' AND entity_key=$1
          AND version BETWEEN 1 AND 9007199254740990 RETURNING version`, [label.id, label.after]);
        requireCondition(updated.rowCount === 1, 'OPERATIONAL_VERSION_EXHAUSTED');
        await client.query(`INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload)
          VALUES ('users_zones',$1,$2,'InitializationContextLabelRefreshed',now(),$3)`,
          [label.id, admin.id, JSON.stringify({ source: 'GeneratedOperationalProfile', before: { zone_name: label.before }, after: { zone_name: label.after } })]);
      }
      if (removePlaceholder) {
        await client.query("DELETE FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=$1", [removePlaceholder]);
        await client.query('DELETE FROM public.users WHERE id=$1', [removePlaceholder]);
        await client.query(`INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ('users',$1,$2,'UnusedInitializationAccountRemoved',now(),$3)`,
          [removePlaceholder, admin.id, JSON.stringify({ source: 'GeneratedOperationalProfile', profile: 'operational-content-v1' })]);
      }
    }
    await client.query('COMMIT');
    return { dry_run: dryRun, changed_records: changes.length + assignmentLabels.length, assignment_snapshot_labels: assignmentLabels.length, removed_unused_manager: !!removePlaceholder,
      preserved_custom_fields: preservedCustomFields, changes_by_table: changes.reduce<Record<string, number>>((result, change) => { result[change.table] = (result[change.table] ?? 0) + 1; return result; }, {}),
      simulated_station_ids_changed: changes.filter((change) => change.table === 'devices').length,
      real_station_id_changed: false, account_credentials_changed: false, mongo_changed: false };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

async function saveLabelChange(client: PoolClient, change: Change, actor: string) {
  // Tables/columns are literals from the internal profile, never CLI input.
  const entries = Object.entries(change.after);
  await client.query(`UPDATE public.${change.table} SET ${entries.map(([field], i) => `${field}=$${i + 2}`).join(',')} WHERE id=$1`, [change.id, ...entries.map(([, value]) => value)]);
  const version = await client.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,version,data) VALUES ($1,$2,1,$3)
    ON CONFLICT(entity_type,entity_key) DO UPDATE SET version=technical.entity_metadata.version+1,
    data=technical.entity_metadata.data||EXCLUDED.data WHERE technical.entity_metadata.version BETWEEN 1 AND 9007199254740990 RETURNING version`,
  [change.table, change.id, JSON.stringify({ content_profile: 'operational-content-v1', content_origin: 'GeneratedInitialization' })]);
  requireCondition(version.rowCount === 1, 'OPERATIONAL_VERSION_EXHAUSTED');
  await client.query(`INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ($1,$2,$3,'InitializationContentRefreshed',now(),$4)`,
    [change.table, change.id, actor, JSON.stringify({ source: 'GeneratedOperationalProfile', before: change.before, after: change.after })]);
}
