import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskPersistenceFixture, taskAuth } from './helpers/task-persistence-fixture';
import { createDatabaseBackup } from '../src/persistence/backup';
import { refreshOperationalData } from '../src/persistence/operational-data-refresh';
import { CONTENT_REPLACEMENTS, OPERATIONAL_STATIONS } from '../src/persistence/operational-data-profile';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';

test('operational content refresh preserves identity, history and trigger guards', async (t) => {
  const f = await taskPersistenceFixture();
  try {
    const db = f.mongo.db(f.name);
    // Reproduce a legacy database, without depending on new seed defaults.
    for (const item of CONTENT_REPLACEMENTS) {
      const id = (await f.pool.query("SELECT entity_key FROM technical.entity_metadata WHERE entity_type=$1 AND data->>'seed_key'=$2", [item.table, `durian-demo-v1:${item.key}`])).rows[0].entity_key;
      const entries = Object.entries(item.before);
      await f.pool.query(`UPDATE public.${item.table} SET ${entries.map(([field], i) => `${field}=$${i + 2}`).join(',')} WHERE id=$1`, [id, ...entries.map(([, value]) => value)]);
    }
    const zone = (await f.pool.query("SELECT entity_key FROM technical.entity_metadata WHERE data->>'seed_key'='durian-demo-v1:zone-5'")).rows[0].entity_key;
    await f.pool.query("UPDATE public.zones SET zone_name='Khu trồng mới do người dùng đặt' WHERE id=$1", [zone]);
    await f.pool.query(`UPDATE technical.entity_metadata SET data=jsonb_set(data,'{zone_snapshot,zone_name}',to_jsonb('Khu 3 — dữ liệu mẫu'::text))
      WHERE entity_type='users_zones' AND data->>'seed_key' LIKE 'durian-demo-v1:assignment-%'`);
    const before = await createDatabaseBackup(f.pool, f.mongo, db);
    const usersBefore = (await f.pool.query('SELECT id,phone_number,gmail,gmail_verify,password,role,status,is_owner FROM public.users ORDER BY id')).rows;
    await t.test('preview does not mutate data; custom labels are preserved', async () => {
      const plan = await refreshOperationalData(f.pool, before);
      assert(plan.changed_records > 15); assert.equal(plan.simulated_station_ids_changed, 2);
      assert.equal(plan.removed_unused_manager, true); assert.equal(plan.preserved_custom_fields, 1);
      assert.equal(plan.assignment_snapshot_labels, 2);
      assert.equal((await createDatabaseBackup(f.pool, f.mongo, db)).data_sha256, before.data_sha256);
    });
    await t.test('active runtime and a stale backup are refused before writes', async () => {
      const engine = await f.engine();
      await assert.rejects(refreshOperationalData(f.pool, before, false), /STOP_API/);
      await engine.service.onModuleDestroy();
      // Runtime initialization owns Mongo state only; PG archive remains exact.
      await f.pool.query("UPDATE public.zones SET zone_name='Changed after backup' WHERE id=$1", [zone]);
      await assert.rejects(refreshOperationalData(f.pool, before, false), /NOT_CURRENT_SOURCE/);
      await f.pool.query("UPDATE public.zones SET zone_name='Khu trồng mới do người dùng đặt' WHERE id=$1", [zone]);
    });
    await t.test('a station collision rolls back both data and temporary trigger alteration', async () => {
      const duplicate = (await f.pool.query(`INSERT INTO public.devices(zone_id,station_id,installed_at,cost,status)
        SELECT zone_id,$1,installed_at,cost,status FROM public.devices WHERE station_id='TASK_FIXTURE_ONLY' RETURNING id`, [OPERATIONAL_STATIONS[0]])).rows[0].id;
      const snapshot = await createDatabaseBackup(f.pool, f.mongo, db);
      await assert.rejects(refreshOperationalData(f.pool, snapshot, false), { code: '23505' });
      assert.equal((await createDatabaseBackup(f.pool, f.mongo, db)).data_sha256, snapshot.data_sha256);
      assert.equal((await f.pool.query("SELECT tgenabled FROM pg_trigger WHERE tgname='device_identity'")).rows[0].tgenabled, 'O');
      await f.pool.query('DELETE FROM public.devices WHERE id=$1', [duplicate]);
    });
    const current = await createDatabaseBackup(f.pool, f.mongo, db);
    await t.test('apply changes generated labels/stations only, leaving credentials, roles and Mongo history intact', async () => {
      const result = await refreshOperationalData(f.pool, current, false);
      assert.equal(result.simulated_station_ids_changed, 2); assert.equal(result.removed_unused_manager, true);
      const stations = (await f.pool.query('SELECT station_id FROM public.devices ORDER BY station_id')).rows.map((row) => row.station_id);
      assert(stations.includes('TASK_FIXTURE_ONLY'));
      for (const station of OPERATIONAL_STATIONS) assert(stations.includes(station));
      const afterUsers = (await f.pool.query('SELECT id,phone_number,gmail,gmail_verify,password,role,status,is_owner FROM public.users ORDER BY id')).rows;
      assert.deepEqual(afterUsers, usersBefore.filter((user) => user.gmail !== 'manager.demo@example.invalid'));
      assert.equal((await f.pool.query('SELECT zone_name FROM public.zones WHERE id=$1', [zone])).rows[0].zone_name, 'Khu trồng mới do người dùng đặt');
      const after = await createDatabaseBackup(f.pool, f.mongo, db);
      assert.deepEqual(after.mongo, current.mongo);
      for (const name of ['public.trees', 'public.users_zones', 'public.tree_harvests', 'technical.workflow_requests']) {
        assert.deepEqual(after.postgres.find((table) => table.name === name), current.postgres.find((table) => table.name === name));
      }
      await assert.rejects(f.pool.query("UPDATE public.devices SET station_id='FORBIDDEN' WHERE station_id=$1", [OPERATIONAL_STATIONS[0]]), { code: '23514' });
    });
    await t.test('rerun is idempotent and does not create audits for unchanged content', async () => {
      const stable = await createDatabaseBackup(f.pool, f.mongo, db);
      const result = await refreshOperationalData(f.pool, stable, false);
      assert.equal(result.changed_records, 0); assert.equal(result.removed_unused_manager, false);
      assert.equal((await createDatabaseBackup(f.pool, f.mongo, db)).data_sha256, stable.data_sha256);
    });
    await t.test('operational seed rerun keeps station IDs and does not recreate the fake Manager', async () => {
      const config = readSeedConfig({ NODE_ENV: 'test', AUTH_TEST_PHONE: taskAuth.phoneNumber, AUTH_TEST_PASSWORD: taskAuth.password,
        AUTH_TEST_ADMIN_PHONE: taskAuth.admin.phoneNumber, AUTH_TEST_ADMIN_PASSWORD: taskAuth.admin.password,
        DEMO_DEVICE_STATION_ID: 'TASK_FIXTURE_ONLY', DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00', DEMO_DEVICE_COST: '100' });
      await seedDemo(f.pool, config, new Date(), false, OPERATIONAL_STATIONS);
      assert.equal((await f.pool.query("SELECT count(*)::int AS count FROM public.users WHERE gmail='manager.demo@example.invalid'")).rows[0].count, 0);
      assert.equal((await f.pool.query('SELECT count(*)::int AS count FROM public.devices WHERE station_id=ANY($1::text[])', [[...OPERATIONAL_STATIONS]])).rows[0].count, 2);
    });
  } finally { await f.close(); }
});
