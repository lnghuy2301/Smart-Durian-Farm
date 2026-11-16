import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { test } from 'node:test';
import { BSON, ObjectId } from 'mongodb';
import { Pool } from 'pg';
import { BackupError, createDatabaseBackup, restoreIntoEmptyDatabase, sealBackup, verifyBackup } from '../src/persistence/backup';
import { backupCommand } from '../src/persistence/backup-cli';
import { demoReadiness } from '../src/persistence/demo-readiness';
import { DatabaseCultivationRecords } from '../src/persistence/database-cultivation-records';
import { MongoCultivationStore } from '../src/persistence/mongo-cultivation.store';
import { LOCK_DELAY_MS } from '../src/cultivation-events/cultivation-events.types';
import { DatabaseTelemetryRecords } from '../src/persistence/database-telemetry-records';
import { MongoTelemetryStore } from '../src/persistence/mongo-telemetry.store';
import { PostgresSensorsRepository } from '../src/persistence/postgres-sensors.repository';
import { PostgresHarvestsRepository } from '../src/persistence/postgres-harvests.repository';
import { taskPersistenceFixture, taskAuth, taskPgBase, taskMongoUri } from './helpers/task-persistence-fixture';

test('offline backup and new-database restore preserve both stores without altering demo databases', async (t) => {
  const f = await taskPersistenceFixture();
  const name = `sdf_restore_${randomUUID().replaceAll('-', '')}`;
  let target: Pool | undefined, created = false;
  try {
    const owner = (await f.users.loadByPhone(taskAuth.phoneNumber))!.user.id;
    const device = (await f.pool.query("SELECT * FROM public.devices WHERE station_id='TASK_FIXTURE_ONLY'")).rows[0];
    const zone = await f.zones.get(owner, device.zone_id);
    const sensors = new PostgresSensorsRepository(f.pool, f.users, f.farms, f.zones, f.devices);
    const telemetry = new DatabaseTelemetryRecords(f.pool, f.users, f.farms, f.zones, f.devices, sensors, f.assignments, new MongoTelemetryStore(f.mongo, f.mongo.db(f.name)));
    await telemetry.record(device.id, [{ dataStreamId: '303', value: 4.4, receivedUnit: '%rH', rawResult: '4.40 %rH' }], new Date().toISOString());
    let now = Date.now();
    const store = new MongoCultivationStore(f.mongo, f.mongo.db(f.name), () => now);
    const cultivation = new DatabaseCultivationRecords(f.pool, f.users, f.farms, f.zones, f.trees, f.assignments, f.catalogs, store, () => now);
    const event = await cultivation.create(owner, { target_type: 'Zone', target_id: zone.id, action_type: 'Watering', details: { duration_minutes: 12 } });
    now += LOCK_DELAY_MS; await store.lockDue();
    const locked = await f.mongo.db(f.name).collection('CULTIVATION_EVENTS').findOne({ _id: new ObjectId(event._id) });
    assert.equal(locked!.status, 'Locked');
    const tree = (await f.pool.query('SELECT id FROM public.trees WHERE zone_id=$1 LIMIT 1', [zone.id])).rows[0];
    const harvests = new PostgresHarvestsRepository(f.pool, f.users, f.farms, f.zones, f.trees, f.assignments);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const harvest = await harvests.create(owner, { tree_id: tree.id, harvest_date: date, season_name: 'Backup test', batch_code: 'BACKUP-BATCH', fruit_count: 8, total_weight_kg: 24.12 });
    await harvests.submit(owner, harvest.id);
    await f.farms.updateRequest(owner, zone.farm_id, { address: 'Pending backup proposal' });
    await f.pool.query("INSERT INTO technical.notifications(id,recipient_id,dedup_key,type,created_at,payload) VALUES($1,NULL,$2,'BackupFixture','2026-09-01T01:30:00.123456Z','{}')", [randomUUID(), randomUUID()]);

    const execution = await f.engine();
    await t.test('active controller lease refuses backup instead of producing a live inconsistent archive', async () => {
      await assert.rejects(createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name)), (error) => error instanceof BackupError && error.message === 'BACKUP_STOP_API_AND_MIGRATIONS_FIRST');
    });
    const pending = await execution.service.command(owner, device.id, 'Watering');
    await execution.service.onModuleDestroy();
    const archive = await createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name));
    await t.test('demo audit reports metadata/account gaps without exposing identity or manufacturing a verified Manager', async () => {
      const result = await demoReadiness(f.pool, { AUTH_TEST_PHONE: taskAuth.phoneNumber, AUTH_TEST_ADMIN_PHONE: taskAuth.admin.phoneNumber,
        DEMO_DEVICE_STATION_ID: 'TASK_FIXTURE_ONLY' });
      assert.equal(result.primary_farmer_ready, true); assert.equal(result.primary_admin_ready, true);
      assert.equal(result.hardware_owned_by_primary, true); assert.equal(!!result.hardware_manager_ready, false);
      assert.deepEqual(result.sensor_streams_needing_metadata_review, []);
      const text = JSON.stringify(result);
      for (const value of [taskAuth.phoneNumber, taskAuth.password, taskAuth.admin.phoneNumber, owner, device.id]) assert(!text.includes(value));
      assert.equal((await createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name))).data_sha256, archive.data_sha256);
    });
    await t.test('snapshot contains all17 PG data tables and7 Mongo collections with microsecond/BSON fidelity', async () => {
      assert.equal(archive.postgres.length, 17); assert.equal(archive.mongo.length, 7);
      assert(archive.postgres.find((table) => table.name === 'technical.notifications')!.rows.some((row) => row.includes('.123456')));
      const events = archive.mongo.find((collection) => collection.name === 'CULTIVATION_EVENTS')!;
      assert(events.documents.some((row) => row.includes(locked!.hash as string)));
      const tasks = archive.mongo.find((collection) => collection.name === 'ACTUATOR_TASKS')!;
      assert(tasks.documents.some((row) => row.includes(pending.task._id)));
      assert.equal(verifyBackup(JSON.parse(JSON.stringify(archive))).data_sha256, archive.data_sha256);
    });
    await t.test('changed data, unknown tables and wrong source revision are rejected before restore', async () => {
      const changed = structuredClone(archive), row = JSON.parse(changed.postgres[0].rows[0]);
      row.user_name = 'Changed backup fixture'; changed.postgres[0].rows[0] = JSON.stringify(row);
      assert.throws(() => verifyBackup(changed), /CHECKSUM/);
      const renamed = structuredClone(archive); renamed.postgres[0].name = 'public.users;DROP TABLE public.users';
      assert.throws(() => verifyBackup(sealBackup(renamed)), /INVALID_BACKUP_TABLES/);
      const revision = structuredClone(archive); revision.migrations[0].checksum = '0'.repeat(64);
      assert.throws(() => verifyBackup(sealBackup(revision)), /SOURCE_REVISION_MISMATCH/);
      await assert.rejects(restoreIntoEmptyDatabase(f.pool, f.mongo, f.mongo.db(f.name), archive), /REQUIRES_NEW_MATCHING_DATABASES/);
    });
    await f.pool.query(`CREATE DATABASE "${name}"`); created = true;
    target = new Pool({ connectionString: `${taskPgBase}/${name}`, connectionTimeoutMillis: 5000 });
    const destination = f.mongo.db(name);
    await t.test('restore replays migrations and preserves all business/context/history/allocator data exactly', async () => {
      await restoreIntoEmptyDatabase(target!, f.mongo, destination, archive);
      assert.equal((await createDatabaseBackup(target!, f.mongo, destination)).data_sha256, archive.data_sha256);
      assert.equal((await target!.query('SELECT status FROM public.tree_harvests WHERE id=$1', [harvest.id])).rows[0].status, 'Confirmed');
      assert.equal((await target!.query('SELECT updated_at FROM public.tree_harvests WHERE id=$1', [harvest.id])).rows[0].updated_at, null);
      const restored = await destination.collection('CULTIVATION_EVENTS').findOne({ _id: new ObjectId(event._id) });
      assert.equal(restored!.hash, locked!.hash); assert.equal(restored!.previous_hash, locked!.previous_hash);
      assert(restored!.created_at instanceof Date);
      const rows = await destination.collection('IOT_TELEMETRIES').findOne({ device_id: device.id });
      assert.equal(rows!.unit, '%rH'); assert(rows!._id instanceof ObjectId);
      assert.equal(BSON.EJSON.stringify(restored, { relaxed: false }), BSON.EJSON.stringify(locked, { relaxed: false }));
    });
    await t.test('nonempty restore target is refused without overwriting either store', async () => {
      await assert.rejects(restoreIntoEmptyDatabase(target!, f.mongo, destination, archive), /RESTORE_TARGET_NOT_EMPTY/);
      assert.equal((await createDatabaseBackup(target!, f.mongo, destination)).data_sha256, archive.data_sha256);
      assert.equal((await createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name))).data_sha256, archive.data_sha256);
    });
    await t.test('CLI creates a local file, verifies it and cleans only its disposable restore-check databases', async () => {
      const log = console.log, output: string[] = [];
      let filename: string | undefined;
      console.log = (message: string) => { output.push(message); };
      try {
        const url = new URL(taskMongoUri); url.pathname = `/${f.name}`;
        await backupCommand('create', '', { DATABASE_URL: `${taskPgBase}/${f.name}`, MONGODB_URI: url.toString() });
        filename = JSON.parse(output[0]).file;
        assert(filename);
        assert.equal(verifyBackup(JSON.parse(readFileSync(filename, 'utf8'))).data_sha256, archive.data_sha256);
        await backupCommand('verify', filename, {});
        await backupCommand('restore-check', filename, {});
        const restored = output.map((line) => JSON.parse(line)).find((line) => line.restored);
        assert(restored?.temporary);
        assert.equal((await f.pool.query('SELECT 1 FROM pg_database WHERE datname=$1', [restored.database])).rowCount, 0);
        assert.equal((await f.mongo.db(restored.database).listCollections().toArray()).length, 0);
      } finally { console.log = log; if (filename) unlinkSync(filename); }
    });
  } finally {
    await target?.end();
    if (created && /^sdf_restore_[0-9a-f]{32}$/.test(name)) { await f.mongo.db(name).dropDatabase(); await f.pool.query(`DROP DATABASE "${name}"`); }
    await f.close();
  }
});
