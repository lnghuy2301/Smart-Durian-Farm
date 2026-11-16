import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskPersistenceFixture, taskAuth } from './helpers/task-persistence-fixture';
import { createDatabaseBackup } from '../src/persistence/backup';
import { seedOfflineTelemetry } from '../src/persistence/demo-telemetry';
import { MongoTelemetryStore } from '../src/persistence/mongo-telemetry.store';
import { DatabaseTelemetryRecords } from '../src/persistence/database-telemetry-records';
import { PostgresSensorsRepository } from '../src/persistence/postgres-sensors.repository';
import { prepareOfflineSensors } from '../src/persistence/demo-sensor-preparation';

test('offline telemetry import is isolated, durable and refuses existing data', async (t) => {
  const f = await taskPersistenceFixture();
  try {
    const db = f.mongo.db(f.name);
    await t.test('legacy simulated sensors are completed through owner repositories; rerun preserves custom settings', async () => {
      const id = (await f.pool.query("SELECT id FROM public.devices WHERE station_id='SIM_DEMO_001'")).rows[0].id;
      await f.pool.query("DELETE FROM technical.entity_metadata WHERE entity_type='sensors' AND entity_key IN (SELECT id::text FROM public.sensors WHERE device_id=$1 AND data_stream_id IN ('304','305','306'))", [id]);
      await f.pool.query("DELETE FROM public.sensors WHERE device_id=$1 AND data_stream_id IN ('304','305','306')", [id]);
      await f.pool.query("UPDATE public.sensors SET unit='%' WHERE device_id=$1 AND data_stream_id='303'", [id]);
      const ready = await prepareOfflineSensors(f.pool);
      assert.equal(ready.created_sensors, 3); assert.equal(ready.updated_sensor_units, 1);
      const stable = await createDatabaseBackup(f.pool, f.mongo, db);
      assert.deepEqual(await prepareOfflineSensors(f.pool), { created_sensors: 0, updated_sensor_units: 0, real_device_changes: 0 });
      assert.equal((await createDatabaseBackup(f.pool, f.mongo, db)).data_sha256, stable.data_sha256);
      await f.pool.query("UPDATE public.sensors SET unit='custom' WHERE device_id=$1 AND data_stream_id='303'", [id]);
      await assert.rejects(prepareOfflineSensors(f.pool), /CUSTOM_SENSOR_CONFIGURATION/);
      await f.pool.query("UPDATE public.sensors SET unit='%rH' WHERE device_id=$1 AND data_stream_id='303'", [id]);
    });
    const before = await createDatabaseBackup(f.pool, f.mongo, db);
    const engine = await f.engine();
    await t.test('running controller blocks the offline import without writing', async () => {
      await assert.rejects(seedOfflineTelemetry(f.pool, f.mongo, db), /STOP_API_AND_MIGRATIONS/);
      assert.equal(await db.collection('IOT_TELEMETRIES').countDocuments(), 0);
    });
    await engine.service.onModuleDestroy();
    const sims = (await f.pool.query("SELECT id FROM public.devices WHERE station_id LIKE 'SIM_DEMO_%' ORDER BY station_id")).rows;
    const first = sims[0].id;
    await t.test('reusing a synthetic station without seed provenance is rejected', async () => {
      await f.pool.query("UPDATE technical.entity_metadata SET data=jsonb_set(data,'{seed_origin}','\"HardwareReal\"') WHERE entity_type='devices' AND entity_key=$1", [first]);
      await assert.rejects(seedOfflineTelemetry(f.pool, f.mongo, db), /SIMULATED_METADATA_REQUIRED/);
      await f.pool.query("UPDATE technical.entity_metadata SET data=jsonb_set(data,'{seed_origin}','\"Simulated\"') WHERE entity_type='devices' AND entity_key=$1", [first]);
      assert.equal(await db.collection('IOT_TELEMETRIES').countDocuments(), 0);
    });
    await t.test('racing imports allow only one1440-reading batch, preserving SQL data and other Mongo domains', async () => {
      const attempts = await Promise.allSettled([seedOfflineTelemetry(f.pool, f.mongo, db), seedOfflineTelemetry(f.pool, f.mongo, db)]);
      assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1);
      const rows = await new MongoTelemetryStore(f.mongo, db).newestFirst();
      assert.equal(rows.length, 1440);
      assert(rows.every((row) => sims.some((sim) => sim.id === row.device_id)));
      const after = await createDatabaseBackup(f.pool, f.mongo, db);
      // Engine shutdown may create its own persistent lease/counter state, so
      // compare the complete SQL snapshot and the domain collections separately.
      assert.deepEqual(after.postgres, before.postgres);
      for (const name of ['ACTUATOR_TASKS', 'CULTIVATION_EVENTS']) {
        assert.deepEqual(after.mongo.find((c) => c.name === name), before.mongo.find((c) => c.name === name));
      }
    });
    await t.test('repeat import refuses without duplicate/eviction and a fresh store reads the same FIFO', async () => {
      const beforeRetry = await createDatabaseBackup(f.pool, f.mongo, db);
      await assert.rejects(seedOfflineTelemetry(f.pool, f.mongo, db), /unused journal/);
      assert.equal((await createDatabaseBackup(f.pool, f.mongo, db)).data_sha256, beforeRetry.data_sha256);
      assert.equal((await new MongoTelemetryStore(f.mongo, db).newestFirst()).length, 1440);
    });
    await t.test('normal permission-aware reads show samples and live ingestion remains distinct', async () => {
      const owner = (await f.users.loadByPhone(taskAuth.phoneNumber))!.user.id;
      const sensors = new PostgresSensorsRepository(f.pool, f.users, f.farms, f.zones, f.devices);
      const readings = new DatabaseTelemetryRecords(f.pool, f.users, f.farms, f.zones, f.devices, sensors,
        f.assignments, new MongoTelemetryStore(f.mongo, db));
      assert.equal((await readings.latest(owner, first, { limit: 100, offset: 0 })).total, 6);
      assert.equal((await readings.history(owner, first, { limit: 100, offset: 0 })).total, 720);
      const real = (await f.pool.query("SELECT id FROM public.devices WHERE station_id='TASK_FIXTURE_ONLY'")).rows[0].id;
      assert.equal((await readings.latest(owner, real, { limit: 100, offset: 0 })).total, 0);
      await readings.record(real, [{ dataStreamId: '301', value: 29.5, receivedUnit: 'C', rawResult: '29.5 C' }], new Date().toISOString());
      assert.equal((await readings.latest(owner, real, { limit: 100, offset: 0 })).items[0].value, 29.5);
      assert.equal((await readings.history(owner, first, { limit: 100, offset: 0 })).total, 720);
      await assert.rejects(seedOfflineTelemetry(f.pool, f.mongo, db), /unused journal/);
      assert.equal(await db.collection('IOT_TELEMETRIES').countDocuments(), 1441);
    });
  } finally { await f.close(); }
});
