import { createHash } from 'node:crypto';
import { BSON, Db, MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { MIGRATIONS, migrationChecksum, runMigrations } from './migrations';
import { mongoDefinitionsForRevision } from './mongo-revisions';

// Fixed allowlist/dependency order. Archive input never supplies SQL identifiers.
export const BACKUP_TABLES = [
  'public.users', 'public.cooperatives', 'public.farming_standards', 'public.agricultural_materials',
  'public.standard_materials', 'public.farms', 'public.zones', 'public.users_zones', 'public.trees',
  'public.devices', 'public.sensors', 'public.actuators', 'public.tree_harvests',
  'technical.entity_metadata', 'technical.workflow_requests', 'technical.audit_events', 'technical.notifications',
] as const;
const migrations = (count = MIGRATIONS.length) => MIGRATIONS.slice(0, count).map((item) => ({ id: item.id, store: item.store, checksum: migrationChecksum(item.source) }));
function knownMigrationPrefix(value: unknown): value is ReturnType<typeof migrations> {
  // Backup v1 first shipped at migration014. Recognize only complete known
  // prefixes with unchanged checksums, never unknown/gapped/newer schemas.
  return Array.isArray(value) && value.length >= 14 && value.length <= MIGRATIONS.length && JSON.stringify(value) === JSON.stringify(migrations(value.length));
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function assert(value: unknown, code: string): asserts value { if (!value) throw new BackupError(code); }
export class BackupError extends Error {}
interface TableBackup { name: string; columns: string[]; rows: string[] }
interface CollectionBackup { name: string; documents: string[] }
export interface DatabaseBackup {
  format: 'smart-durian-backup-v1'; created_at: string; migrations: ReturnType<typeof migrations>;
  postgres: TableBackup[]; mongo: CollectionBackup[]; data_sha256: string; sha256: string;
}
export function sealBackup(input: Omit<DatabaseBackup, 'sha256' | 'data_sha256'>): DatabaseBackup {
  const payload = { format: input.format, created_at: input.created_at, migrations: input.migrations, postgres: input.postgres, mongo: input.mongo,
    data_sha256: hash({ migrations: input.migrations, postgres: input.postgres, mongo: input.mongo }) };
  return { ...payload, sha256: hash(payload) };
}
export function verifyBackup(input: unknown): DatabaseBackup {
  assert(input && typeof input === 'object', 'INVALID_BACKUP');
  const archive = input as DatabaseBackup;
  assert(Object.keys(archive).sort().join(',') === 'created_at,data_sha256,format,migrations,mongo,postgres,sha256', 'INVALID_BACKUP_FIELDS');
  assert(archive.format === 'smart-durian-backup-v1' && typeof archive.created_at === 'string'
    && Number.isFinite(Date.parse(archive.created_at)), 'INVALID_BACKUP_VERSION');
  assert(knownMigrationPrefix(archive.migrations), 'BACKUP_SOURCE_REVISION_MISMATCH');
  assert(Array.isArray(archive.postgres) && JSON.stringify(archive.postgres.map((table) => table.name)) === JSON.stringify(BACKUP_TABLES), 'INVALID_BACKUP_TABLES');
  assert(Array.isArray(archive.mongo) && JSON.stringify(archive.mongo.map((collection) => collection.name)) === JSON.stringify(mongoDefinitionsForRevision(archive.migrations.length).map((collection) => collection.name)), 'INVALID_BACKUP_COLLECTIONS');
  for (const table of archive.postgres) {
    assert(Array.isArray(table.columns) && table.columns.length > 0 && new Set(table.columns).size === table.columns.length
      && table.columns.every((column) => typeof column === 'string' && /^[a-z_]+$/.test(column)) && Array.isArray(table.rows), 'INVALID_BACKUP_COLUMNS');
    for (const row of table.rows) {
      assert(typeof row === 'string', 'INVALID_BACKUP_ROW');
      let value: unknown; try { value = JSON.parse(row); } catch { throw new BackupError('INVALID_BACKUP_ROW'); }
      assert(value && typeof value === 'object' && !Array.isArray(value)
        && JSON.stringify(Object.keys(value)) === JSON.stringify(table.columns), 'INVALID_BACKUP_ROW_COLUMNS');
    }
  }
  for (const collection of archive.mongo) {
    assert(Array.isArray(collection.documents) && collection.documents.every((row) => typeof row === 'string'), 'INVALID_BACKUP_DOCUMENTS');
    for (const row of collection.documents) {
      let document: unknown;
      try { document = BSON.EJSON.parse(row, { relaxed: false }); } catch { throw new BackupError('INVALID_BACKUP_DOCUMENT'); }
      assert(document && typeof document === 'object' && !Array.isArray(document) && Object.hasOwn(document, '_id'), 'INVALID_BACKUP_DOCUMENT');
    }
  }
  const materialColumns = archive.postgres.find((table) => table.name === 'public.agricultural_materials')!.columns;
  const hasStructuredDose = archive.migrations.some((migration) => migration.id === '016_material_dosage');
  assert(['default_dosage_value', 'dosage_basis'].every((column) => materialColumns.includes(column) === hasStructuredDose), 'BACKUP_SCHEMA_REVISION_MISMATCH');
  const { sha256, ...payload } = archive;
  assert(sha256 === hash(payload), 'BACKUP_CHECKSUM_MISMATCH');
  assert(archive.data_sha256 === hash({ migrations: archive.migrations, postgres: archive.postgres, mongo: archive.mongo }), 'BACKUP_DATA_CHECKSUM_MISMATCH');
  return archive;
}

export async function createDatabaseBackup(pool: Pool, mongo: MongoClient, db: Db): Promise<DatabaseBackup> {
  const client = await pool.connect(), session = mongo.startSession();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='30s'; SET LOCAL timezone='UTC'");
    // Refuse an active server, and prevent it or migration/seed from starting
    // while the snapshot is taken. No Nest/Auth/MQTT provider is constructed.
    for (const key of ['smart-durian:migrations', 'smart-durian:actuator-runtime']) {
      const result = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [key]);
      assert(result.rows[0].locked, 'BACKUP_STOP_API_AND_MIGRATIONS_FIRST');
    }
    await client.query(`LOCK TABLE ${[...BACKUP_TABLES, 'technical.schema_migrations'].join(',')} IN SHARE MODE NOWAIT`);
    const ledger = await client.query('SELECT id,store,checksum FROM technical.schema_migrations ORDER BY id');
    assert(knownMigrationPrefix(ledger.rows), 'BACKUP_SOURCE_REVISION_MISMATCH');
    const definitions = mongoDefinitionsForRevision(ledger.rows.length);
    const tables = await client.query("SELECT schemaname||'.'||tablename AS name FROM pg_tables WHERE schemaname IN ('public','technical') ORDER BY name");
    assert(JSON.stringify(tables.rows.map((row) => row.name)) === JSON.stringify([...BACKUP_TABLES, 'technical.schema_migrations'].sort()), 'BACKUP_UNMANAGED_TABLES');
    const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).sort();
    assert(JSON.stringify(collections) === JSON.stringify(definitions.map((item) => item.name).sort()), 'BACKUP_UNMANAGED_COLLECTIONS');
    const postgres: TableBackup[] = [];
    for (const name of BACKUP_TABLES) {
      const [schema, table] = name.split('.');
      const columns = (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', [schema, table])).rows.map((row) => row.column_name);
      // Keep SQL JSON as text: timestamps retain microseconds, numeric retains
      // decimal scale, and bigint never passes through a lossy JS Number.
      const rows = (await client.query(`SELECT row_to_json(t)::text AS row FROM ${name} t`)).rows.map((row) => row.row as string).sort();
      postgres.push({ name, columns, rows });
    }
    const documents = await session.withTransaction(async () => {
      const result: CollectionBackup[] = [];
      for (const collection of definitions) {
        const rows = await db.collection(collection.name).find({}, { session, promoteValues: false, batchSize: 100 }).toArray();
        result.push({ name: collection.name, documents: rows.map((row) => BSON.EJSON.stringify(row, { relaxed: false })).sort() });
      }
      return result;
    }, { readConcern: { level: 'snapshot' }, maxCommitTimeMS: 10000 });
    assert(documents, 'BACKUP_MONGO_SNAPSHOT_FAILED');
    // PG writes remain blocked until the Mongo snapshot has completed: both
    // captured stores coexist at a point during this bounded maintenance window.
    await client.query('COMMIT');
    return verifyBackup(sealBackup({ format: 'smart-durian-backup-v1', created_at: new Date().toISOString(), migrations: migrations(ledger.rows.length), postgres, mongo: documents }));
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { await session.endSession(); client.release(); }
}

export async function restoreIntoEmptyDatabase(pool: Pool, mongo: MongoClient, db: Db, input: unknown): Promise<void> {
  const archive = verifyBackup(input);
  const target = (await pool.query('SELECT current_database() AS name')).rows[0].name;
  assert(/^sdf_restore_[0-9a-f]{32}$/.test(target) && db.databaseName === target, 'RESTORE_REQUIRES_NEW_MATCHING_DATABASES');
  const tables = await pool.query("SELECT 1 FROM pg_tables WHERE schemaname IN ('public','technical')");
  assert(tables.rowCount === 0 && (await db.listCollections({}, { nameOnly: true }).toArray()).length === 0, 'RESTORE_TARGET_NOT_EMPTY');
  // Restore the archived schema first, preserving column order and hash. An
  // explicit later db:migrate upgrades it for the latest runtime.
  await runMigrations(pool, db, MIGRATIONS.slice(0, archive.migrations.length));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of archive.postgres) {
      const [schema, name] = table.name.split('.');
      const columns = (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', [schema, name])).rows.map((row) => row.column_name);
      assert(JSON.stringify(columns) === JSON.stringify(table.columns), 'RESTORE_SCHEMA_MISMATCH');
      for (let offset = 0; offset < table.rows.length; offset += 100) {
        await client.query(`INSERT INTO ${table.name} SELECT (json_populate_record(NULL::${table.name}, value::json)).* FROM unnest($1::text[]) AS value`, [table.rows.slice(offset, offset + 100)]);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  const session = mongo.startSession();
  try {
    await session.withTransaction(async () => {
      for (const collection of archive.mongo) {
        for (let offset = 0; offset < collection.documents.length; offset += 100) {
          const rows = collection.documents.slice(offset, offset + 100).map((row) => BSON.EJSON.parse(row, { relaxed: false }));
          await db.collection(collection.name).insertMany(rows, { session });
        }
      }
    }, { writeConcern: { w: 'majority' }, maxCommitTimeMS: 10000 });
  } finally { await session.endSession(); }
  // No claim of cross-store rollback: failures leave only a disposable new DB.
  // Compare all business + technical data before reporting restore success.
  assert((await createDatabaseBackup(pool, mongo, db)).data_sha256 === archive.data_sha256, 'RESTORE_DATA_MISMATCH');
}
