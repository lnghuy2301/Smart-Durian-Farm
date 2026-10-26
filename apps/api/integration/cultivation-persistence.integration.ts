import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIGRATIONS } from '../src/persistence/migrations';
import { HttpException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoClient, ObjectId } from 'mongodb';
import { Pool } from 'pg';
import { AuthModule } from '../src/auth/auth.module';
import { UserAccounts } from '../src/auth/user-accounts';
import { CultivationEventsController } from '../src/cultivation-events/cultivation-events.controller';
import { CultivationRecords } from '../src/cultivation-events/cultivation-records';
import { CreateEventDto } from '../src/cultivation-events/cultivation-events.dto';
import { LOCK_DELAY_MS } from '../src/cultivation-events/cultivation-events.types';
import { eventHash } from '../src/cultivation-events/cultivation-chain';
import { DatabaseCultivationRecords } from '../src/persistence/database-cultivation-records';
import { MongoCultivationStore } from '../src/persistence/mongo-cultivation.store';
import { PostgresZonesRepository } from '../src/persistence/postgres-zones.repository';
import { PostgresAssignmentsRepository } from '../src/persistence/postgres-assignments.repository';
import { taskPersistenceFixture, taskRepositories, taskAuth, taskPgBase, taskMongoUri } from './helpers/task-persistence-fixture';

const page = { limit: 100, offset: 0 };
const status = (code: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === code;
test('Cultivation Mongo atomic context, deadlines, corrections and Zone chain', async (t) => {
  const f = await taskPersistenceFixture();
  let now = Date.now();
  const make = (pool = f.pool, mongo = f.mongo) => {
    const r = taskRepositories(pool), date = () => new Date(now), clock = () => now;
    const zones = new PostgresZonesRepository(pool, r.users, r.farms, r.catalogs, date);
    const assignments = new PostgresAssignmentsRepository(pool, r.users, r.farms, zones, date);
    const store = new MongoCultivationStore(mongo, mongo.db(f.name), clock);
    const service = new DatabaseCultivationRecords(pool, r.users, r.farms, zones, r.trees, assignments, r.catalogs, store, clock);
    return { ...r, zones, assignments, store, service };
  };
  const r = make();
  const setup = async () => {
    const c = await f.deviceFixture();
    const tree = async () => f.trees.create(c.owner.id, { zone_id: c.zone.id, variety: 'Ri6', plant_date: '2024-05-01T01:00:00Z', longitude: 106, latitude: 10 });
    return { ...c, tree: await tree(), otherTree: await tree() };
  };
  const water = (target: string, tree = false): CreateEventDto => ({ target_id: target, target_type: tree ? 'Tree' : 'Zone', action_type: 'Watering', details: { duration_minutes: 12.5, water_volume_l: 50, note: 'Nhật ký mẫu' } });
  const assign = async (c: Awaited<ReturnType<typeof setup>>, end = now + 3600000) => {
    const invite = await r.assignments.createRequest(c.owner.id, c.zone.id, { user_id: c.worker.id, end_date: new Date(end).toISOString() });
    return r.assignments.approve(c.worker.id, invite.id);
  };
  const lock = async () => { now += LOCK_DELAY_MS; await r.store.lockDue(); };
  try {
    await t.test('migration014 supports durable ledger without changing foundation schema; empty bootstrap is concurrent-safe', async () => {
      await Promise.all([r.store.lockDue(), make().store.lockDue()]);
      const rows = await f.pool.query('SELECT id FROM technical.schema_migrations ORDER BY id');
      assert(rows.rows.some((row) => row.id === '014_cultivation_ledger'));
      assert.equal(rows.rows.at(-1).id, MIGRATIONS.at(-1)!.id);
      assert.equal(await f.mongo.db(f.name).collection('PERSISTENCE_STATE').countDocuments({ kind: 'CultivationLedger' }), 1);
    });
    await t.test('owner creates directly; BSON IDs/dates and private original context round-trip exactly', async () => {
      const c = await setup(), event = await r.service.create(c.owner.id, water(c.tree.id, true));
      const row = await f.mongo.db(f.name).collection('CULTIVATION_EVENTS').findOne({ _id: new ObjectId(event._id) });
      assert(row!._id instanceof ObjectId); assert(row!.created_at instanceof Date); assert(row!.lock_at instanceof Date);
      assert.equal(event.locked_at, null); assert.equal(event.hash, null); assert.equal(Date.parse(event.lock_at) - Date.parse(event.created_at), LOCK_DELAY_MS);
      const context = await f.mongo.db(f.name).collection('PERSISTENCE_STATE').findOne({ kind: 'CultivationContext', key: event._id });
      assert(context!.payload.root_id instanceof ObjectId); assert.equal(context!.payload.assignment_id, null);
      assert.equal(context!.payload.original_created_at.toISOString(), event.created_at);
      assert.deepEqual(await make().service.get(c.owner.id, event._id), event);
    });
    await t.test('Pending edits preserve deadline, allow target/action changes in same Zone and snapshot active material warnings', async () => {
      const c = await setup(), event = await r.service.create(c.owner.id, water(c.zone.id));
      const material = await f.catalogs.materials.create(f.admin, { name: 'Phân hữu cơ', material_type: 'Fertilizer', unit: 'kg', default_dosage: '2 kg/cây', quarantine_days: 0 });
      const revised = await r.service.update(c.owner.id, event._id, { target_type: 'Tree', target_id: c.tree.id, action_type: 'Fertilizing', details: { materials: [{ material_id: material.id, quantity: 2 }] } });
      assert.equal(revised.lock_at, event.lock_at); assert.equal(revised.created_at, event.created_at);
      assert.deepEqual(revised.details.warnings, [{ code: 'MATERIAL_OUTSIDE_STANDARD', material_id: material.id }]);
      await f.catalogs.materials.update(f.admin, material.id, { name: 'Tên mới', status: 'Inactive' });
      assert.equal((await r.service.get(c.owner.id, event._id)).details.materials![0].name, 'Phân hữu cơ');
      await assert.rejects(r.service.update(c.owner.id, event._id, { details: { materials: [{ material_id: material.id, quantity: 2 }] } }), status(400));
      const elsewhere = await setup();
      await assert.rejects(r.service.update(c.owner.id, event._id, { target_id: elsewhere.tree.id }), status(400));
      await assert.rejects(r.service.update(c.owner.id, event._id, { action_type: 'Watering' }), status(400));
    });
    await t.test('only author mutates; rejected fields do not alter data; Pending delete removes context atomically', async () => {
      const c = await setup(); await assign(c);
      const event = await r.service.create(c.worker.id, water(c.zone.id));
      await assert.rejects(r.service.update(c.owner.id, event._id, { details: { duration_minutes: 20 } }), status(403));
      await assert.rejects(r.service.create(f.admin, water(c.zone.id)), status(403));
      await assert.rejects(r.service.create(c.owner.id, { ...water(c.zone.id), farmer_id: c.worker.id } as CreateEventDto), status(400));
      const before = await r.service.get(c.worker.id, event._id);
      await assert.rejects(r.service.update(c.worker.id, event._id, {}), status(400));
      assert.deepEqual(await r.service.get(c.worker.id, event._id), before);
      await r.service.remove(c.worker.id, event._id);
      assert.equal(await f.mongo.db(f.name).collection('PERSISTENCE_STATE').countDocuments({ kind: 'CultivationContext', key: event._id }), 0);
      await assert.rejects(r.service.get(c.worker.id, event._id), status(404));
    });
    await t.test('deadline boundary locks and hashes in deterministic order; Locked cannot edit/delete', async () => {
      const c = await setup(), a = await r.service.create(c.owner.id, water(c.tree.id, true)), b = await r.service.create(c.owner.id, water(c.zone.id));
      now += LOCK_DELAY_MS;
      assert.equal((await r.service.verify(c.owner.id, c.zone.id)).locked_events, 2, 'verify also catches up overdue Pending events');
      const events = (await r.service.list(c.owner.id, { ...page, zone_id: c.zone.id })).items.reverse();
      assert.deepEqual(events.map((event) => event._id), [a._id, b._id].sort());
      assert.equal(events[0].previous_hash, null); assert.equal(events[1].previous_hash, events[0].hash);
      for (const event of events) assert.equal(event.hash, eventHash(event));
      assert.equal((await r.service.verify(c.owner.id, c.zone.id)).valid, true);
      await assert.rejects(r.service.remove(c.owner.id, a._id), status(409));
      await assert.rejects(r.service.update(c.owner.id, a._id, { details: { duration_minutes: 1 } }), status(409));
    });
    await t.test('two concurrent corrections cannot branch; original remains immutable and full target-change history survives', async () => {
      const c = await setup(), root = await r.service.create(c.owner.id, water(c.tree.id, true)); await lock();
      const original = await r.service.get(c.owner.id, root._id);
      const body = { ...water(c.otherTree.id, true), correction_reason: 'Đúng cây thực tế' };
      const results = await Promise.allSettled([r.service.correct(c.owner.id, root._id, body), make().service.correct(c.owner.id, root._id, body)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.deepEqual(await r.service.get(c.owner.id, root._id), original);
      assert.equal((await r.service.lockedForTrace(c.zone.id)).length, 1);
      await lock();
      const lineage = await r.service.corrections(c.owner.id, root._id, page);
      assert.equal(lineage.total, 2); assert.equal(lineage.items[1].target_id, c.otherTree.id);
      assert.equal((await r.service.lockedForTrace(c.zone.id)).length, 2);
      await assert.rejects(r.service.correct(c.owner.id, root._id, body), status(409));
      assert.equal((await r.service.verify(c.owner.id, c.zone.id)).valid, true);
    });
    await t.test('current worker sees entire Zone; ended worker retains authored history but not full chain or new journals', async () => {
      const c = await setup(); const assignment = await assign(c, now + 3600000);
      const owner = await r.service.create(c.owner.id, water(c.zone.id)), own = await r.service.create(c.worker.id, water(c.tree.id, true));
      assert.equal((await r.service.list(c.worker.id, { ...page, zone_id: c.zone.id })).total, 2);
      now += 3600000; await r.store.lockDue();
      assert.equal((await r.service.list(c.worker.id, { ...page, zone_id: c.zone.id })).total, 1);
      await assert.rejects(r.service.get(c.worker.id, owner._id), status(404));
      await assert.rejects(r.service.verify(c.worker.id, c.zone.id), status(404));
      await assert.rejects(r.service.create(c.worker.id, water(c.zone.id)), status(403));
      const correction = await r.service.correct(c.worker.id, own._id, { ...water(c.zone.id), correction_reason: 'Trong hạn gốc' });
      const context = await f.mongo.db(f.name).collection('PERSISTENCE_STATE').findOne({ kind: 'CultivationContext', key: correction._id });
      assert.equal(context!.payload.assignment_id, assignment.assignment_id);
      now += 15 * 86400000; await r.store.lockDue();
      await assign(c, now + 3600000);
      await assert.rejects(r.service.correct(c.worker.id, correction._id, { ...water(c.zone.id), correction_reason: 'Không được gia hạn' }), status(403));
      assert.equal((await r.service.list(c.worker.id, page, true)).items.some((event) => event._id === own._id), true);
    });
    await t.test('fresh HTTP app and fresh clients retain data, catch up deadlines and enforce JWT/DTO scope', async () => {
      const c = await setup(), root = await r.service.create(c.owner.id, water(c.tree.id, true));
      now += LOCK_DELAY_MS;
      const pool = new Pool({ connectionString: `${taskPgBase}/${f.name}`, connectionTimeoutMillis: 5000 });
      const mongo = new MongoClient(taskMongoUri, { serverSelectionTimeoutMS: 5000 }); await mongo.connect();
      const fresh = make(pool, mongo);
      const module = await Test.createTestingModule({ imports: [AuthModule.forMock(taskAuth)], controllers: [CultivationEventsController],
        providers: [{ provide: CultivationRecords, useValue: fresh.service }] }).overrideProvider(UserAccounts).useValue(fresh.users).compile();
      const app = module.createNestApplication({ logger: false });
      app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
      try {
        await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
        const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone_number: c.owner.phone, password: taskAuth.admin.password }) });
        // Fixture Farmers deliberately reuse the Admin fixture password hash.
        assert.equal(login.status, 200); const token = (await login.json() as { access_token: string }).access_token;
        assert.equal((await fetch(`${base}/api/cultivation-events/${root._id}`)).status, 401);
        const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
        const response = await fetch(`${base}/api/cultivation-events/${root._id}`, { headers });
        assert.equal(response.status, 200); const event = await response.json() as { status: string; hash: string };
        assert.equal(event.status, 'Locked'); assert.equal(event.hash, (await r.service.get(c.owner.id, root._id)).hash);
        assert.equal((await fetch(`${base}/api/cultivation-events?limit=101`, { headers })).status, 400);
        assert.equal((await fetch(`${base}/api/cultivation-events/${root._id}`, { method: 'DELETE', headers })).status, 409);
      } finally { await app.close(); await mongo.close(); await pool.end(); }
    });
    await t.test('rejected transaction rolls back event, private context, head and revision together', async () => {
      const c = await setup(), event = await r.service.create(c.owner.id, water(c.zone.id));
      const state = f.mongo.db(f.name).collection('PERSISTENCE_STATE');
      const before = await state.findOne({ kind: 'CultivationLedger' });
      await assert.rejects(r.store.change((journal) => { journal.remove(event._id); throw new Error('trusted fixture rollback'); }), status(503));
      assert.deepEqual(await state.findOne({ kind: 'CultivationLedger' }), before);
      assert.equal((await r.service.get(c.owner.id, event._id))._id, event._id);
    });
    await t.test('hash tampering is reported by scoped verification and rejected by normal reads/writes', async () => {
      const c = await setup(), event = await r.service.create(c.owner.id, water(c.zone.id)); await lock();
      const events = f.mongo.db(f.name).collection('CULTIVATION_EVENTS');
      const saved = await events.findOne({ _id: new ObjectId(event._id) });
      await events.updateOne({ _id: saved!._id }, { $set: { 'details.duration_minutes': 999 } });
      try {
        const verified = await r.service.verify(c.owner.id, c.zone.id);
        assert.equal(verified.valid, false); assert.equal(verified.failure?.code, 'HASH_MISMATCH');
        await assert.rejects(r.service.get(c.owner.id, event._id), status(503));
        await assert.rejects(r.service.create(c.owner.id, water(c.zone.id)), status(503));
      } finally { await events.replaceOne({ _id: saved!._id }, saved!); }
    });
    await t.test('missing original context/ledger fails closed without rebuilding or returning RAM data', async () => {
      const c = await setup(), event = await r.service.create(c.owner.id, water(c.zone.id));
      const state = f.mongo.db(f.name).collection<{ _id: string; [key: string]: unknown }>('PERSISTENCE_STATE');
      const saved = await state.findOne({ kind: 'CultivationContext', key: event._id });
      await state.deleteOne({ _id: saved!._id });
      try { await assert.rejects(r.service.get(c.owner.id, event._id), status(503)); }
      finally { await state.insertOne(saved!); }
      const ledger = await state.findOne({ kind: 'CultivationLedger' }); await state.deleteOne({ _id: ledger!._id });
      try { await assert.rejects(r.service.list(c.owner.id, page), status(503)); }
      finally { await state.insertOne(ledger!); }
    });
    await t.test('Mongo unavailable is sanitized and never falls back to RAM', async () => {
      const broken = new MongoClient('mongodb://127.0.0.1:1/?directConnection=true', { serverSelectionTimeoutMS: 100 });
      try { await assert.rejects(make(f.pool, broken).service.list(f.admin, page), (error: unknown) => status(503)(error) && !String(error).includes('127.0.0.1')); }
      finally { await broken.close(); }
    });
    await t.test('cross-Zone writers share one atomic ledger without losing inserts or context', async () => {
      const a = await setup(), b = await setup();
      const events = await Promise.all([r.service.create(a.owner.id, water(a.zone.id)), make().service.create(b.owner.id, water(b.zone.id))]);
      assert.equal((await r.service.get(a.owner.id, events[0]._id)).target_id, a.zone.id);
      assert.equal((await make().service.get(b.owner.id, events[1]._id)).target_id, b.zone.id);
      await assert.rejects(r.service.get(a.owner.id, events[1]._id), status(404));
    });
    await t.test('capacity10000 spans multiple cursor chunks, never evicts history and rejects overflow atomically', async () => {
      const isolated = await taskPersistenceFixture();
      try {
        const c = await isolated.deviceFixture(), store = new MongoCultivationStore(isolated.mongo, isolated.mongo.db(isolated.name), () => now);
        const details = { standard_snapshot: { standard_id: c.zone.standard_id, code: 'CAP', name: 'Capacity fixture' }, note: null, warnings: [], duration_minutes: 1, water_volume_l: null };
        const add = (journal: Parameters<Parameters<MongoCultivationStore['change']>[0]>[0]) => {
          const id = new ObjectId().toHexString();
          return journal.add({ _id: id, farmer_id: c.owner.id, target_id: c.zone.id, target_type: 'Zone', action_type: 'Watering', details,
            status: 'Pending', is_correction: false, reference_event_id: null, root_event_id: null, correction_reason: null,
            created_at: new Date(now).toISOString(), lock_at: new Date(now + LOCK_DELAY_MS).toISOString(), locked_at: null, previous_hash: null, hash: null },
          { zone_id: c.zone.id, farm_id: c.farm, author_id: c.owner.id, assignment_id: null, original_created_at: new Date(now).toISOString(), root_id: id });
        };
        await store.change((journal) => { for (let index = 0; index < 10000; index++) add(journal); });
        assert.equal(await store.read((journal) => journal.list().length), 10000);
        const before = await isolated.mongo.db(isolated.name).collection('PERSISTENCE_STATE').findOne({ kind: 'CultivationLedger' });
        await assert.rejects(store.change(add), status(429));
        assert.deepEqual(await isolated.mongo.db(isolated.name).collection('PERSISTENCE_STATE').findOne({ kind: 'CultivationLedger' }), before);
        now += LOCK_DELAY_MS; await store.lockDue();
        assert.equal(await store.read((journal) => journal.verify(c.zone.id).locked_events), 10000);
        assert.equal(await store.read((journal) => journal.verify(c.zone.id).valid), true);
        await assert.rejects(store.change(add), status(429));
      } finally { await isolated.close(); }
    });
  } finally { await f.close(); }
});
