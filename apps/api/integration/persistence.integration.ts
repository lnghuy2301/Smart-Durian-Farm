import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient, ObjectId, Long } from 'mongodb';
import { Pool } from 'pg';
import { MIGRATIONS, runMigrations, migrationStatus } from '../src/persistence/migrations';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';
import { inPostgresTransaction, lockFarm, lockHarvestBatches } from '../src/persistence/transactions';
import { hashPassword } from '../src/auth/password';
import { toMongoRecord, fromMongoRecord } from '../src/persistence/mappers';

// Không đọc .env; endpoints/credentials chỉ thuộc Compose test cô lập.
const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', AUTH_TEST_PHONE: '0900000000', AUTH_TEST_PASSWORD: 'FixtureFarmerPassword!',
  AUTH_TEST_ADMIN_PHONE: '0900000001', AUTH_TEST_ADMIN_PASSWORD: 'FixtureAdminPassword!',
  DEMO_DEVICE_STATION_ID: 'TEST_ESP32_001', DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00', DEMO_DEVICE_COST: '10237500' };

test('persistence foundation on isolated PostgreSQL17/Mongo8', async (t) => {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: `${postgresBase}/sdf_persistence_test`, connectionTimeoutMillis: 5000 });
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  let pool: Pool | undefined;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    pool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 6, connectionTimeoutMillis: 5000 });
    const sql = pool;
    await mongo.connect();
    const db = mongo.db(name);
    await t.test('fresh migrations create exactly13 business tables and rerun is empty', async () => {
      const migrations = await Promise.all([runMigrations(sql, db), runMigrations(sql, db)]);
      assert.deepEqual(migrations.flat(), MIGRATIONS.map((migration) => migration.id));
      assert.equal(migrations.filter((result) => result.length === 0).length, 1);
      assert.deepEqual(await runMigrations(sql, db), []);
      assert.ok((await migrationStatus(sql)).every((row) => row.state === 'Applied'));
      assert.equal((await sql.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].count, '13');
      assert.equal((await sql.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='technical' AND table_type='BASE TABLE'")).rows[0].count, '5');
      const collections = (await db.listCollections().toArray()).map((collection) => collection.name).sort();
      assert.deepEqual(collections, ['ACTUATOR_TASKS', 'CULTIVATION_EVENTS', 'IOT_TELEMETRIES', 'PERSISTENCE_STATE']);
    });
    await t.test('checksum changes and unknown applied migrations fail before new writes', async () => {
      const altered = MIGRATIONS.map((migration, index) => index ? migration : { ...migration, source: `${migration.source}\n-- changed` });
      await assert.rejects(runMigrations(sql, db, altered), /history mismatch/);
      await assert.rejects(runMigrations(sql, db, MIGRATIONS.slice(0, 1)), /history mismatch/);
      assert.equal((await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count, '2');
    });
    await t.test('a failed SQL migration rolls back DDL and releases migration lock', async () => {
      const broken = { id: '003_test_rollback', store: 'postgres' as const, source: 'fixture', apply: async (client: import('pg').PoolClient) => {
        await client.query('CREATE TABLE public.failed_fixture(id integer)');
        throw new Error('Intentional fixture rollback');
      } };
      await assert.rejects(runMigrations(sql, db, [...MIGRATIONS, broken]), /fixture rollback/);
      assert.equal((await sql.query("SELECT to_regclass('public.failed_fixture') AS name")).rows[0].name, null);
      assert.deepEqual(await runMigrations(sql, db), []);
    });
    const config = readSeedConfig(env);
    const seed = await seedDemo(sql, config, new Date('2026-10-10T02:00:00.000Z'));
    await t.test('demo has coherent real/synthetic bundles,54 trees, pending Manager and no invented IoT', async () => {
      for (const [table, count] of Object.entries({ users: 4, farms: 3, zones: 6, trees: 54, devices: 3, sensors: 9, actuators: 9, cooperatives: 1, users_zones: 2 })) {
        assert.equal(Number((await sql.query(`SELECT count(*) FROM public.${table}`)).rows[0].count), count);
      }
      const device = (await sql.query('SELECT * FROM public.devices WHERE id=$1', [seed.real_device_id])).rows[0];
      assert.equal(device.station_id, 'TEST_ESP32_001');
      assert.equal(device.last_seen_at, null);
      assert.equal(device.installed_at.toISOString(), '2026-09-01T01:30:00.000Z');
      assert.equal(device.cost, '10237500.00');
      assert.equal((await sql.query("SELECT count(*) FROM public.trees WHERE tree_code<>'DRN-' || id::text")).rows[0].count, '0');
      assert.deepEqual((await sql.query('SELECT data_stream_id,sensor_type,unit FROM public.sensors WHERE device_id=$1 ORDER BY data_stream_id', [device.id])).rows,
        [{ data_stream_id: '301', sensor_type: 'air_temperature', unit: 'C' }, { data_stream_id: '302', sensor_type: 'air_humidity', unit: '%' }, { data_stream_id: '303', sensor_type: 'soil_moisture', unit: '%' }]);
      assert.deepEqual((await sql.query('SELECT capability_id,purpose FROM public.actuators WHERE device_id=$1 ORDER BY capability_id', [device.id])).rows,
        [{ capability_id: '2', purpose: 'shared' }, { capability_id: '3', purpose: 'watering' }, { capability_id: '4', purpose: 'spraying' }]);
      assert.deepEqual((await sql.query("SELECT status,gmail_verify FROM public.users WHERE role='Manager'")).rows[0], { status: 'Pending', gmail_verify: false });
      for (const collection of ['IOT_TELEMETRIES', 'ACTUATOR_TASKS', 'CULTIVATION_EVENTS']) { assert.equal(await db.collection(collection).countDocuments(), 0); }
    });
    await t.test('rerun preserves IDs, changed password/status and metadata token version', async () => {
      const changedHash = await hashPassword('ChangedFixturePassword!');
      await sql.query("UPDATE public.users SET password=$1,status='Locked' WHERE id=$2", [changedHash, seed.primary_farmer_id]);
      await sql.query("UPDATE technical.entity_metadata SET data=data || '{\"token_version\":7}'::jsonb WHERE entity_type='users' AND entity_key=$1", [seed.primary_farmer_id]);
      await sql.query('UPDATE public.devices SET cost=11111234 WHERE id=$1', [seed.real_device_id]);
      const rerun = await seedDemo(sql, config, new Date('2026-10-11T02:00:00.000Z'));
      assert.equal(rerun.inserted, 0);
      assert.equal(rerun.real_device_id, seed.real_device_id);
      assert.equal(rerun.primary_farmer_id, seed.primary_farmer_id);
      const user = (await sql.query('SELECT password,status FROM public.users WHERE id=$1', [seed.primary_farmer_id])).rows[0];
      assert.equal(user.password, changedHash);
      assert.equal(user.status, 'Locked');
      assert.equal((await sql.query('SELECT cost FROM public.devices WHERE id=$1', [seed.real_device_id])).rows[0].cost, '11111234.00');
      assert.equal((await sql.query("SELECT data->>'token_version' AS v FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=$1", [seed.primary_farmer_id])).rows[0].v, '7');
      await assert.rejects(seedDemo(sql, { ...config, farmer: { ...config.farmer, phone: '0900000099' } }), /identity changed/);
      assert.equal((await sql.query('SELECT count(*) FROM public.users')).rows[0].count, '4');
    });
    const zones = (await sql.query('SELECT * FROM public.zones ORDER BY zone_name')).rows;
    const primaryZone = zones.find((zone) => zone.id === seed.real_zone_id)!;
    await t.test('phone normalization, composite unique and immutable identities are enforced', async () => {
      await assert.rejects(sql.query('INSERT INTO public.users(user_name,phone_number,password,role,status) VALUES ($1,$2,$3,$4,$5)', ['Duplicate', '+84900000000', 'fixture', 'Farmer', 'Active']), { code: '23505' });
      await assert.rejects(sql.query('UPDATE public.devices SET station_id=$1 WHERE id=$2', ['CHANGED', seed.real_device_id]), { code: '23514' });
      await assert.rejects(sql.query("UPDATE public.sensors SET sensor_type='soil_moisture' WHERE device_id=$1 AND data_stream_id='301'", [seed.real_device_id]), { code: '23514' });
      await assert.rejects(sql.query("UPDATE public.actuators SET purpose='spraying' WHERE device_id=$1 AND capability_id=2", [seed.real_device_id]), { code: '23514' });
      await assert.rejects(sql.query("INSERT INTO public.sensors(device_id,name,sensor_type,data_stream_id,unit,status) VALUES ($1,'duplicate','air_temperature','301','C','Active')", [seed.real_device_id]), { code: '23505' });
      await assert.rejects(sql.query("UPDATE public.sensors SET min_threshold=1,max_threshold=NULL WHERE device_id=$1 AND data_stream_id='301'", [seed.real_device_id]), { code: '23514' });
      await sql.query("UPDATE public.sensors SET unit='oC' WHERE device_id=$1 AND data_stream_id='301'", [seed.real_device_id]);
      await assert.rejects(sql.query('UPDATE public.actuators SET capability_id=9007199254740992 WHERE device_id=$1', [seed.real_device_id]), { code: '23514' });
    });
    await t.test('seed refuses removed links instead of restoring or partially writing', async () => {
      const link = (await sql.query('SELECT * FROM public.standard_materials LIMIT 1')).rows[0];
      await sql.query('DELETE FROM public.standard_materials WHERE standard_id=$1 AND material_id=$2', [link.standard_id, link.material_id]);
      await assert.rejects(seedDemo(sql, config), /linked material conflict/);
      assert.equal((await sql.query('SELECT count(*) FROM public.standard_materials')).rows[0].count, '3');
      await sql.query('INSERT INTO public.standard_materials VALUES ($1,$2)', [link.standard_id, link.material_id]);
      await assert.rejects(seedDemo(sql, { ...config, device: { ...config.device, stationId: 'OTHER_STATION' } }), /immutable conflict/);
      assert.equal((await sql.query('SELECT station_id FROM public.devices WHERE id=$1', [seed.real_device_id])).rows[0].station_id, 'TEST_ESP32_001');
    });
    await t.test('area locks serialize competing writes and reject farm shrink below zones', async () => {
      const write = () => inPostgresTransaction(sql, async (client) => {
        await lockFarm(client, primaryZone.farm_id);
        return client.query(`INSERT INTO public.zones(farm_id,standard_id,zone_name,area_size,longitude,latitude) VALUES ($1,$2,'Race fixture',0.08,108,12) RETURNING id`, [primaryZone.farm_id, primaryZone.standard_id]);
      });
      const results = await Promise.allSettled([write(), write()]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
      await assert.rejects(sql.query('UPDATE public.farms SET area_size=1.0 WHERE id=$1', [primaryZone.farm_id]), { code: '23514' });
    });
    await t.test('assignment exclusion uses [start,end) allowing adjacent but rejecting overlap', async () => {
      const zone = zones.at(-1)!;
      await sql.query('INSERT INTO public.users_zones(user_id,zone_id,start_date,end_date) VALUES ($1,$2,$3,$4)', [seed.primary_farmer_id, zone.id, '2027-01-01Z', '2027-02-01Z']);
      await sql.query('INSERT INTO public.users_zones(user_id,zone_id,start_date,end_date) VALUES ($1,$2,$3,$4)', [seed.primary_farmer_id, zone.id, '2027-02-01Z', '2027-03-01Z']);
      await assert.rejects(sql.query('INSERT INTO public.users_zones(user_id,zone_id,start_date,end_date) VALUES ($1,$2,$3,$4)', [seed.primary_farmer_id, zone.id, '2027-01-15Z', '2027-02-02Z']), { code: '23P01' });
    });
    await t.test('batch accepts multiple trees, rejects different zone/day and duplicate tree/day', async () => {
      const trees = (await sql.query('SELECT id FROM public.trees WHERE zone_id=$1 LIMIT 3', [primaryZone.id])).rows;
      const insert = (tree: string, batch: string, day: string) => inPostgresTransaction(sql, async (client) => {
        await lockHarvestBatches(client, [batch]);
        await client.query(`INSERT INTO public.tree_harvests(tree_id,created_by,season_name,harvest_date,fruit_count,total_weight_kg,batch_code,status) VALUES ($1,$2,'Demo', $3,10,25,$4,'Draft')`, [tree, seed.primary_farmer_id, day, batch]);
      });
      await Promise.all([insert(trees[0].id, 'BATCH-TEST', '2026-10-05'), insert(trees[1].id, 'BATCH-TEST', '2026-10-05')]);
      assert.equal((await sql.query("SELECT count(*) FROM public.tree_harvests WHERE batch_code='BATCH-TEST'")).rows[0].count, '2');
      await assert.rejects(insert(trees[2].id, 'BATCH-TEST', '2026-10-06'), { code: '23514' });
      await assert.rejects(insert(trees[0].id, 'BATCH-OTHER', '2026-10-05'), { code: '23505' });
      const outsideTree = (await sql.query('SELECT id FROM public.trees WHERE zone_id<>$1 LIMIT 1', [primaryZone.id])).rows[0].id;
      await assert.rejects(insert(outsideTree, 'BATCH-TEST', '2026-10-05'), { code: '23514' });
      await insert(trees[0].id, 'BATCH-OTHER', '2026-10-06');
    });
    await t.test('business record, metadata and approval proposal roll back together', async () => {
      const harvest = (await sql.query('SELECT * FROM public.tree_harvests LIMIT 1')).rows[0];
      await assert.rejects(inPostgresTransaction(sql, async (client) => {
        await client.query("UPDATE public.tree_harvests SET status='Pending' WHERE id=$1", [harvest.id]);
        await client.query("INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('tree_harvests',$1,'{\"everConfirmed\":true}')", [harvest.id]);
        await client.query("INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at) VALUES ('Harvest','Correct','Pending',$1,$2,'{\"fruit_count\":99}',now())", [harvest.id, seed.primary_farmer_id]);
        throw new Error('fixture failure');
      }), /fixture failure/);
      assert.equal((await sql.query('SELECT status FROM public.tree_harvests WHERE id=$1', [harvest.id])).rows[0].status, 'Draft');
      assert.equal((await sql.query('SELECT count(*) FROM technical.workflow_requests')).rows[0].count, '0');
    });
    await t.test('audit history is append-only', async () => {
      await assert.rejects(sql.query("UPDATE technical.audit_events SET action='Changed'"), { code: '23514' });
      await assert.rejects(sql.query('DELETE FROM technical.audit_events'), { code: '23514' });
    });
    await t.test('Mongo validators reject incomplete readings and task command IDs are unique', async () => {
      await assert.rejects(db.collection('IOT_TELEMETRIES').insertOne({ device_id: seed.real_device_id }), { code: 121 });
      await db.collection('IOT_TELEMETRIES').insertOne({ device_id: seed.real_device_id, data_stream_id: '301', measured_at: new Date(), received_at: new Date(), value: 26.5, unit: 'raw-C' });
      const task = { device_id: seed.real_device_id, command_id: Long.fromNumber(123), targets: [{ task_id: Long.fromNumber(124), tasking_capability_id: Long.fromNumber(2) }],
        tasking_parameters: { actionType: 'control', action: 0 }, status: 'Pending', created_at: new Date(), sent_at: null, confirmed_at: null, error_message: null, response_payload: {} };
      await db.collection('ACTUATOR_TASKS').insertOne(task);
      await assert.rejects(db.collection('ACTUATOR_TASKS').insertOne({ ...task, _id: new ObjectId() }), { code: 11000 });
    });
    await t.test('Mongo transaction rolls back event/context together; Date and ObjectId mapping roundtrip', async () => {
      const event = { _id: new ObjectId().toHexString(), farmer_id: seed.primary_farmer_id, target_id: primaryZone.id, target_type: 'Zone', action_type: 'Watering',
        details: {}, status: 'Pending', is_correction: false, reference_event_id: null, root_event_id: null, correction_reason: null,
        created_at: '2026-10-10T01:00:00.000Z', locked_at: null, lock_at: '2026-10-10T01:15:00.000Z', previous_hash: null, hash: null };
      const ids = ['_id', 'reference_event_id', 'root_event_id'];
      const dates = ['created_at', 'locked_at', 'lock_at'];
      const stored = toMongoRecord(event, ids, dates);
      const session = mongo.startSession();
      try {
        await assert.rejects(session.withTransaction(async () => {
          await db.collection('CULTIVATION_EVENTS').insertOne(stored, { session });
          await db.collection<{ _id: string; kind: string; key: string; payload: Record<string, unknown> }>('PERSISTENCE_STATE')
            .insertOne({ _id: `context:${event._id}`, kind: 'CultivationContext', key: event._id,
              payload: { zone_id: primaryZone.id, farm_id: primaryZone.farm_id, author_id: seed.primary_farmer_id,
                assignment_id: null, original_created_at: new Date(event.created_at), root_id: new ObjectId(event._id) } }, { session });
          throw new Error('Mongo fixture rollback');
        }), /fixture rollback/);
      } finally { await session.endSession(); }
      assert.equal(await db.collection('CULTIVATION_EVENTS').countDocuments(), 0);
      assert.equal(await db.collection('PERSISTENCE_STATE').countDocuments(), 0);
      await db.collection('CULTIVATION_EVENTS').insertOne(stored);
      const loaded = await db.collection('CULTIVATION_EVENTS').findOne({ _id: new ObjectId(event._id) });
      assert.deepEqual(fromMongoRecord(loaded!, ids, dates), event);
    });
    await t.test('new client after backend-like restart retains users, bundles and migration ledger', async () => {
      const freshPool = new Pool({ connectionString: `${postgresBase}/${name}` });
      const freshMongo = new MongoClient(mongoUri);
      try {
        assert.equal((await freshPool.query('SELECT count(*) FROM public.devices')).rows[0].count, '3');
        assert.equal((await freshPool.query('SELECT status FROM public.users WHERE id=$1', [seed.primary_farmer_id])).rows[0].status, 'Locked');
        assert.deepEqual(await runMigrations(freshPool, freshMongo.db(name)), []);
      } finally { await freshPool.end(); await freshMongo.close(); }
    });
  } finally {
    await pool?.end();
    // Chỉ xóa database tên ngẫu nhiên tạo ở endpoints test, không có reset demo.
    if (created && /^sdf_persistence_test_[0-9a-f]{32}$/.test(name)) {
      await mongo.db(name).dropDatabase().catch(() => undefined);
      await admin.query(`DROP DATABASE "${name}"`);
    }
    await mongo.close();
    await admin.end();
  }
});
