import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { MongoClient, ObjectId } from 'mongodb';
import { Pool } from 'pg';
import { ActuatorTask } from '../src/actuator-tasks/actuator-tasks.types';
import { ACTUATOR_TASK_LIMIT } from '../src/actuator-tasks/actuator-tasks.service';
import { MongoActuatorTaskStore, TaskJournal } from '../src/persistence/mongo-actuator-task.store';
import { DatabaseActuatorTaskRecords } from '../src/persistence/database-actuator-task-records';
import { taskPersistenceFixture, taskRepositories, taskHttpApplication, TaskTransport, readyState, taskAuth, taskPgBase, taskMongoUri } from './helpers/task-persistence-fixture';

const page = { limit: 100, offset: 0 };
const status = (code: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === code;
async function until(condition: () => boolean | Promise<boolean>) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await condition()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail('Timed out waiting for persisted control transition');
}
async function acknowledge(service: DatabaseActuatorTaskRecords, transport: TaskTransport, index = transport.sent.length - 1) {
  const packet = transport.sent[index].wire;
  assert.equal(await service.receiveAck(wireDevices.get(service)!, packet.targets[0].taskId, packet.taskingParameters.action), null);
}
// Read the committed wire→Device correlation without inventing a REST ACK API.
const wireDevices = new WeakMap<DatabaseActuatorTaskRecords, string>();
async function finish(service: DatabaseActuatorTaskRecords, transport: TaskTransport, start: number, count: number) {
  for (let index = start; index < start + count; index++) {
    await until(() => transport.sent.length > index);
    await acknowledge(service, transport, index);
  }
}
function confirmed(task: ActuatorTask) {
  task.sent_at = task.created_at; task.status = 'Confirmed'; task.confirmed_at = task.created_at;
  for (const step of task.response_payload.steps) {
    step.sent_at = task.created_at; step.ack_received_at = task.created_at; step.status = 'Acknowledged';
    step.ack = { taskId: step.task_id, status: 'ACK', action: step.action };
  }
}
class PausingTaskStore extends MongoActuatorTaskStore {
  pause?: { entered: () => void; barrier: Promise<void> };
  override async change<T>(owner: string, work: (journal: TaskJournal) => T, release = false): Promise<T> {
    const pause = this.pause; this.pause = undefined;
    const result = await super.change(owner, work, release);
    if (pause) { pause.entered(); await pause.barrier; }
    return result;
  }
}

test('Mongo actuator journal, durable IDs and PostgreSQL control authority', async (t) => {
  const f = await taskPersistenceFixture();
  const controller = async (timeout = 10000) => {
    const setup = await f.deviceFixture(), execution = await f.engine(new TaskTransport(), timeout);
    wireDevices.set(execution.service, setup.device.id);
    return { ...setup, ...execution };
  };
  const off = async (c: Awaited<ReturnType<typeof controller>>) => {
    const begin = c.transport.sent.length, result = await c.service.command(c.owner.id, c.device.id, 'Stop');
    await finish(c.service, c.transport, begin, 3);
    assert.equal((await c.service.get(c.owner.id, result.task._id)).status, 'Confirmed');
    return result.task;
  };
  try {
    await t.test('Unknown Start commits Reset and numeric IDs before publishing, then valve ON before pump ON', async () => {
      const c = await controller();
      try {
        const result = await c.service.command(c.owner.id, c.device.id, 'Watering');
        assert.equal(result.task.status, 'Pending'); assert.equal(result.task.sent_at, null);
        const resetId = result.task.response_payload.reset_task_id!;
        assert.ok(resetId);
        await until(() => c.transport.sent.length === 1);
        const persisted = await c.service.get(c.owner.id, resetId);
        assert.equal(persisted.response_payload.steps[0].status, 'WaitingAck');
        const bson = await f.mongo.db(f.name).collection('ACTUATOR_TASKS').findOne({ _id: new ObjectId(resetId) });
        assert(bson!.created_at instanceof Date);
        assert(bson!.response_payload.parent_task_id instanceof ObjectId);
        assert(bson!.response_payload.steps[0].sent_at instanceof Date);
        await finish(c.service, c.transport, 0, 5);
        assert.deepEqual(c.transport.sent.map(({ wire }) => [wire.targets[0].taskingCapabilityId, wire.taskingParameters.action]), [[2, 0], [3, 0], [4, 0], [3, 1], [2, 1]]);
        const done = await c.service.get(c.owner.id, result.task._id);
        assert.equal(done.status, 'Confirmed'); assert.equal(done.confirmed_at, done.response_payload.steps[1].ack_received_at);
        assert.equal((await c.service.state(c.owner.id, c.device.id)).physical_state, 'Unknown');
        assert.equal((await c.service.list(c.owner.id, c.device.id, page)).storage.mode, 'MongoDB');
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('simultaneous Start commands accept one, busy conflicts and Stop preempts a pending publish callback', async () => {
      const c = await controller();
      try {
        c.transport.hold = true;
        const attempts = await Promise.allSettled([c.service.command(c.owner.id, c.device.id, 'Watering'), c.service.command(c.owner.id, c.device.id, 'Spraying')]);
        assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
        assert.equal(attempts.filter((result) => result.status === 'rejected' && status(409)(result.reason)).length, 1);
        await until(() => c.transport.sent.length === 1);
        const old = c.transport.sent[0].wire;
        c.transport.hold = false;
        const stopped = await c.service.command(c.owner.id, c.device.id, 'Stop');
        await assert.rejects(c.service.command(c.owner.id, c.device.id, 'Stop'), status(409));
        await finish(c.service, c.transport, 1, 3);
        c.transport.deferred[0].resolve();
        assert.equal(await c.service.receiveAck(c.device.id, old.targets[0].taskId, 0), 'ACK_NOT_WAITING');
        assert.equal((await c.service.get(c.owner.id, stopped.task._id)).status, 'Confirmed');
        assert(c.transport.sent.every(({ wire }) => wire.taskingParameters.action === 0));
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('wrong Device/action, duplicate and old IDs do not advance; receipt precedes publish callback safely', async () => {
      const c = await controller();
      try {
        c.transport.hold = true;
        const result = await c.service.command(c.owner.id, c.device.id, 'Stop');
        await until(() => c.transport.sent.length === 1);
        const wire = c.transport.sent[0].wire, id = wire.targets[0].taskId;
        assert.equal(await c.service.receiveAck(randomUUID(), id, 0), 'ACK_DEVICE_MISMATCH');
        assert.equal(await c.service.receiveAck(c.device.id, id, 1), 'ACK_ACTION_MISMATCH');
        assert.equal(await c.service.receiveAck(c.device.id, id + 10000, 0), 'ACK_NOT_WAITING');
        assert.equal(await c.service.receiveAck(c.device.id, id, 0), null);
        let task = await c.service.get(c.owner.id, result.task._id);
        assert.equal(task.status, 'Pending'); assert.equal(task.response_payload.steps[0].status, 'WaitingAck');
        assert.ok(task.response_payload.steps[0].ack_received_at);
        assert.equal(await c.service.receiveAck(c.device.id, id, 0), 'ACK_DUPLICATE');
        c.transport.hold = false; c.transport.deferred[0].resolve();
        await finish(c.service, c.transport, 1, 2);
        task = await c.service.get(c.owner.id, result.task._id);
        assert.equal(task.status, 'Confirmed');
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('partial ON timeout persists Failed Start and separate RecoveryStop; late ON ACK never restores mode', async () => {
      const c = await controller();
      try {
        await off(c);
        const start = c.transport.sent.length, result = await c.service.command(c.owner.id, c.device.id, 'Watering');
        await finish(c.service, c.transport, start, 1);
        await until(() => c.transport.sent.length === start + 2);
        const pending = await c.service.get(c.owner.id, result.task._id), step = pending.response_payload.steps[1];
        assert.equal(await c.service.receiveAck(c.device.id, step.task_id, 1, Date.parse(step.sent_at!) + 10000), 'ACK_EXPIRED');
        const failed = await c.service.get(c.owner.id, result.task._id), recovery = failed.response_payload.recovery_task_id!;
        assert.equal(failed.error_message, 'ACK_TIMEOUT'); assert.equal(failed.status, 'Failed');
        await finish(c.service, c.transport, start + 2, 3);
        assert.equal((await c.service.get(c.owner.id, recovery)).status, 'Confirmed');
        assert.equal(await c.service.receiveAck(c.device.id, step.task_id, 1), 'ACK_NOT_WAITING');
        assert.equal((await c.service.state(c.owner.id, c.device.id)).acknowledged_mode, 'Off');
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('real per-step timer fails pump OFF without publishing valve closes or ON', async () => {
      const c = await controller(1000);
      try {
        const result = await c.service.command(c.owner.id, c.device.id, 'Watering');
        await until(async () => (await c.service.get(c.owner.id, result.task._id)).status === 'Failed');
        assert.equal(c.transport.sent.length, 1);
        assert.equal((await c.service.get(c.owner.id, result.task._id)).error_message, 'RESET_FAILED');
        assert.equal((await c.service.state(c.owner.id, c.device.id)).acknowledged_mode, 'Unknown');
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('fast ON receipt plus failed publish never confirms and still creates OFF recovery', async () => {
      const c = await controller();
      try {
        await off(c); c.transport.hold = true;
        const begin = c.transport.sent.length, result = await c.service.command(c.owner.id, c.device.id, 'Spraying');
        await until(() => c.transport.sent.length === begin + 1);
        await acknowledge(c.service, c.transport, begin);
        c.transport.hold = false; c.transport.deferred[0].reject();
        await until(async () => (await c.service.get(c.owner.id, result.task._id)).status === 'Failed');
        const failed = await c.service.get(c.owner.id, result.task._id);
        assert.equal(failed.error_message, 'MQTT_PUBLISH_FAILED'); assert.equal(failed.confirmed_at, null);
        await finish(c.service, c.transport, begin + 1, 3);
        assert.equal((await c.service.get(c.owner.id, failed.response_payload.recovery_task_id!)).status, 'Confirmed');
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('disconnect invalidates mode and pending epoch; reconnect sends no old ON and a new Start resets again', async () => {
      const c = await controller();
      try {
        const result = await c.service.command(c.owner.id, c.device.id, 'Watering');
        await until(() => c.transport.sent.length === 1);
        await c.service.brokerChanged({ ...readyState, connected: false, subscribed: false });
        await c.service.brokerChanged(readyState);
        const oldCount = c.transport.sent.length;
        assert.equal((await c.service.get(c.owner.id, result.task._id)).status, 'Failed');
        await new Promise((resolve) => setTimeout(resolve, 30)); assert.equal(c.transport.sent.length, oldCount);
        const next = await c.service.command(c.owner.id, c.device.id, 'Spraying');
        assert.ok(next.task.response_payload.reset_task_id);
        await finish(c.service, c.transport, oldCount, 5);
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('Inactive Device and relays block ON but do not prevent explicit Stop', async () => {
      const c = await controller();
      try {
        await f.devices.update(c.owner.id, c.device.id, { status: 'Maintenance' });
        await f.actuators.update(c.owner.id, c.relays[0].id, { status: 'Inactive' });
        await assert.rejects(c.service.command(c.owner.id, c.device.id, 'Watering'), status(409));
        await off(c); assert(c.transport.sent.every(({ wire }) => wire.taskingParameters.action === 0));
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('actor assignment and metadata are rechecked before each ON; revoked actor cannot block recovery OFF', async () => {
      const c = await controller();
      try {
        const invitation = await f.assignments.createRequest(c.owner.id, c.zone.id, { user_id: c.worker.id });
        const assigned = await f.assignments.approve(c.worker.id, invitation.id);
        await off(c);
        const begin = c.transport.sent.length, result = await c.service.command(c.worker.id, c.device.id, 'Watering');
        await until(() => c.transport.sent.length === begin + 1);
        await f.assignments.end(c.owner.id, assigned.assignment_id!);
        await acknowledge(c.service, c.transport, begin);
        await until(async () => (await c.service.get(c.owner.id, result.task._id)).status === 'Failed');
        const failed = await c.service.get(c.owner.id, result.task._id);
        assert.equal(failed.error_message, 'CONTEXT_UNAVAILABLE');
        await finish(c.service, c.transport, begin + 1, 3);
        assert(!c.transport.sent.slice(begin).some(({ wire }) => wire.targets[0].taskingCapabilityId === 2 && wire.taskingParameters.action === 1));
        await assert.rejects(c.service.get(c.worker.id, result.task._id), status(404));
        await assert.rejects(c.service.state(c.worker.id, c.device.id), status(404));
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('Manager/Admin are read-only and current assignee history is filtered before total and pagination', async () => {
      const c = await controller();
      try {
        const older = await off(c);
        const email = `${randomUUID()}@example.com`;
        const manager = (await f.users.createRegisteredUser({ user_name: 'Task manager', phone_number: '0900099990', gmail: email, passwordHash: f.hash, role: 'Manager' }, email)).user;
        const approved = await f.registry.approve(f.admin, manager.id, { cooperative: { cooperative_name: 'Task HTX', director: 'Director', certificate_number: 'TASK-HTX', address: 'Fixture', contact_number: '0900099990' } });
        const cooperative = approved.cooperative;
        let join = await f.farms.joinRequest(c.owner.id, c.farm, cooperative.id);
        for (const signer of join.required_approvals.filter((entry) => !entry.approved_at)) join = await f.farms.approve(signer.role === 'Admin' ? f.admin : manager.id, join.id);
        assert.equal((await c.service.list(manager.id, c.device.id, page)).total, 1);
        await assert.rejects(c.service.command(manager.id, c.device.id, 'Stop'), status(403));
        await assert.rejects(c.service.command(f.admin, c.device.id, 'Stop'), status(403));
        await assert.rejects(c.service.list(c.worker.id, c.device.id, page), status(404));
        const invitation = await f.assignments.createRequest(c.owner.id, c.zone.id, { user_id: c.worker.id });
        await f.assignments.approve(c.worker.id, invitation.id);
        assert.equal((await c.service.list(c.worker.id, c.device.id, page)).total, 0);
        await assert.rejects(c.service.get(c.worker.id, older._id), status(404));
        const begin = c.transport.sent.length;
        const now = await c.service.command(c.worker.id, c.device.id, 'Stop');
        await finish(c.service, c.transport, begin, 3);
        const own = await c.service.list(c.worker.id, c.device.id, { limit: 1, offset: 0, status: 'Confirmed' });
        assert.equal(own.total, 1); assert.equal(own.items[0]._id, now.task._id);
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('only one runtime holds the PostgreSQL session lock; restart preserves history and advances durable IDs', async () => {
      const c = await controller();
      let destroyed = false;
      try {
        const first = await off(c), maximum = Math.max(first.command_id, ...first.targets.map((entry) => entry.task_id));
        const other = new DatabaseActuatorTaskRecords({ ackTimeoutMs: 10000 }, new TaskTransport(), f.access, f.store);
        await assert.rejects(other.initialize(), status(503));
        const pending = await c.service.command(c.owner.id, c.device.id, 'Watering');
        await until(() => c.transport.sent.length >= 4);
        await c.service.onModuleDestroy(); destroyed = true;
        const freshPool = new Pool({ connectionString: `${taskPgBase}/${f.name}`, max: 5, connectionTimeoutMillis: 5000 });
        const freshMongo = new MongoClient(taskMongoUri, { serverSelectionTimeoutMS: 5000 });
        await freshMongo.connect();
        const transport = new TaskTransport();
        const service = new DatabaseActuatorTaskRecords({ ackTimeoutMs: 10000 }, transport, taskRepositories(freshPool).access, new MongoActuatorTaskStore(freshMongo, freshMongo.db(f.name)));
        try {
          await service.initialize(); await service.brokerChanged(readyState); wireDevices.set(service, c.device.id);
          assert.equal((await service.get(c.owner.id, first._id)).status, 'Confirmed');
          assert.equal((await service.get(c.owner.id, pending.task._id)).error_message, 'BACKEND_SHUTDOWN');
          assert.equal((await service.state(c.owner.id, c.device.id)).acknowledged_mode, 'Unknown');
          assert.equal(transport.sent.length, 0, 'Startup never publishes ON or replays Pending');
          const result = await service.command(c.owner.id, c.device.id, 'Watering');
          assert(result.task.command_id > maximum); assert.ok(result.task.response_payload.reset_task_id);
          assert.equal(await service.receiveAck(c.device.id, first.targets[0].task_id, 0), 'ACK_NOT_WAITING');
          await finish(service, transport, 0, 5);
        } finally { await service.onModuleDestroy(); await freshPool.end(); await freshMongo.close(); }
      } finally { if (!destroyed) await c.service.onModuleDestroy(); }
    });
    await t.test('journal restart repairs interrupted Pending receipts atomically without changing already Confirmed tasks', async () => {
      const device = (await f.deviceFixture()).device.id, old = randomUUID(), next = randomUUID();
      await f.store.initialize(old);
      const pending = await f.store.change(old, (journal) => {
        journal.room(2);
        const complete = journal.create(device, 'Stop', [2, 3, 4], 0, new Date().toISOString()); confirmed(complete);
        const waiting = journal.create(device, 'Stop', [2, 3, 4], 0, new Date().toISOString());
        waiting.sent_at = waiting.created_at; waiting.response_payload.steps[0].sent_at = waiting.created_at;
        waiting.response_payload.steps[0].status = 'WaitingAck';
        return { complete, waiting };
      });
      await f.store.initialize(next);
      const records = await f.store.read();
      assert.deepEqual(records.find((entry) => entry._id === pending.complete._id), pending.complete);
      assert.equal(records.find((entry) => entry._id === pending.waiting._id)!.error_message, 'BACKEND_SHUTDOWN');
      await assert.rejects(f.store.change(old, () => {}), status(503));
      await f.store.release(next);
    });
    await t.test('a slow publish on one Device does not block another Device or reuse numeric IDs', async () => {
      const first = await f.deviceFixture(), second = await f.deviceFixture(), c = await f.engine();
      try {
        c.transport.hold = true;
        const a = await c.service.command(first.owner.id, first.device.id, 'Stop');
        await until(() => c.transport.sent.length === 1);
        c.transport.hold = false;
        const b = await c.service.command(second.owner.id, second.device.id, 'Stop');
        wireDevices.set(c.service, second.device.id);
        await finish(c.service, c.transport, 1, 3);
        assert.equal((await c.service.get(second.owner.id, b.task._id)).status, 'Confirmed');
        assert.equal((await c.service.get(first.owner.id, a.task._id)).status, 'Pending');
        c.transport.deferred[0].resolve(); wireDevices.set(c.service, first.device.id);
        await acknowledge(c.service, c.transport, 0); await finish(c.service, c.transport, 4, 2);
        const ids = c.transport.sent.map(({ wire }) => wire.targets[0].taskId);
        assert.equal(new Set(ids).size, 6);
      } finally { await c.service.onModuleDestroy(); }
    });
    await t.test('disconnect while a Mongo commit is returning fences the old ON epoch even after reconnect', async () => {
      const fixture = await f.deviceFixture(), transport = new TaskTransport();
      const store = new PausingTaskStore(f.mongo, f.mongo.db(f.name));
      const service = new DatabaseActuatorTaskRecords({ ackTimeoutMs: 10000 }, transport, f.access, store);
      await service.initialize(); await service.brokerChanged(readyState); wireDevices.set(service, fixture.device.id);
      let unblock = () => {};
      try {
        await service.command(fixture.owner.id, fixture.device.id, 'Stop'); await finish(service, transport, 0, 3);
        let entered = () => {};
        const committed = new Promise<void>((resolve) => { entered = resolve; });
        const barrier = new Promise<void>((resolve) => { unblock = resolve; });
        store.pause = { entered, barrier };
        const pending = service.command(fixture.owner.id, fixture.device.id, 'Watering');
        await committed;
        await service.brokerChanged({ ...readyState, connected: false, subscribed: false });
        await service.brokerChanged(readyState); unblock();
        const result = await pending;
        await until(async () => (await service.get(fixture.owner.id, result.task._id)).status === 'Failed');
        await finish(service, transport, 3, 3);
        assert(transport.sent.every(({ wire }) => wire.taskingParameters.action === 0));
        assert.equal((await service.get(fixture.owner.id, result.task._id)).error_message, 'MQTT_DISCONNECTED');
      } finally { unblock(); await service.onModuleDestroy(); }
    });
    await t.test('loss of the PostgreSQL owner session disables old callbacks and allows a fresh fenced runtime', async () => {
      const c = await controller();
      let successor: DatabaseActuatorTaskRecords | undefined;
      try {
        c.transport.hold = true;
        const result = await c.service.command(c.owner.id, c.device.id, 'Watering');
        await until(() => c.transport.sent.length === 1);
        const holder = await f.pool.query<{ pid: number }>("SELECT pid FROM pg_stat_activity WHERE datname=$1 AND state='idle' AND query LIKE 'SELECT pg_try_advisory_lock%'", [f.name]);
        assert.equal(holder.rowCount, 1);
        await f.pool.query('SELECT pg_terminate_backend($1)', [holder.rows[0].pid]);
        await until(async () => !(await c.service.state(c.owner.id, c.device.id)).broker_ready);
        await assert.rejects(c.service.command(c.owner.id, c.device.id, 'Stop'), status(503));
        const fresh = await f.engine(); successor = fresh.service;
        assert.equal((await successor.get(c.owner.id, result.task._id)).error_message, 'BACKEND_SHUTDOWN');
        c.transport.deferred[0].resolve();
        assert.equal(await c.service.receiveAck(c.device.id, c.transport.sent[0].wire.targets[0].taskId, 0), 'ACK_NOT_WAITING');
        assert.equal(c.transport.sent.length, 1); assert.equal(fresh.transport.sent.length, 0);
      } finally {
        if (successor) { await assert.rejects(c.service.onModuleDestroy(), status(503)); await successor.onModuleDestroy(); }
        else await c.service.onModuleDestroy();
      }
    });
    await t.test('Mongo loss during ACK fails closed, preserves durable intent and restart does not replay it', async () => {
      const fixture = await f.deviceFixture(), transport = new TaskTransport();
      const client = new MongoClient(taskMongoUri, { serverSelectionTimeoutMS: 100 }); await client.connect();
      const service = new DatabaseActuatorTaskRecords({ ackTimeoutMs: 10000 }, transport, f.access, new MongoActuatorTaskStore(client, client.db(f.name)));
      await service.initialize(); await service.brokerChanged(readyState);
      let destroyed = false;
      try {
        const result = await service.command(fixture.owner.id, fixture.device.id, 'Stop');
        await until(() => transport.sent.length === 1);
        await client.close();
        await assert.rejects(service.receiveAck(fixture.device.id, transport.sent[0].wire.targets[0].taskId, 0), status(503));
        await assert.rejects(service.state(fixture.owner.id, fixture.device.id), status(503));
        await assert.rejects(service.command(fixture.owner.id, fixture.device.id, 'Watering'), status(503));
        assert.equal(transport.sent.length, 1);
        await assert.rejects(service.onModuleDestroy(), status(503)); destroyed = true;
        const fresh = await f.engine();
        try {
          assert.equal((await fresh.service.get(fixture.owner.id, result.task._id)).error_message, 'BACKEND_SHUTDOWN');
          assert.equal(fresh.transport.sent.length, 0);
          assert.equal((await fresh.service.state(fixture.owner.id, fixture.device.id)).acknowledged_mode, 'Unknown');
        } finally { await fresh.service.onModuleDestroy(); }
      } finally { if (!destroyed) await service.onModuleDestroy().catch(() => {}); await client.close(); }
    });
    await t.test('Mongo loss before command cannot publish or return cached known mode', async () => {
      const fixture = await f.deviceFixture(), client = new MongoClient(taskMongoUri, { serverSelectionTimeoutMS: 100 }); await client.connect();
      const transport = new TaskTransport(), service = new DatabaseActuatorTaskRecords({ ackTimeoutMs: 10000 }, transport, f.access, new MongoActuatorTaskStore(client, client.db(f.name)));
      await service.initialize(); await service.brokerChanged(readyState); wireDevices.set(service, fixture.device.id);
      try {
        await service.command(fixture.owner.id, fixture.device.id, 'Stop'); await finish(service, transport, 0, 3);
        assert.equal((await service.state(fixture.owner.id, fixture.device.id)).acknowledged_mode, 'Off');
        await client.close();
        await assert.rejects(service.command(fixture.owner.id, fixture.device.id, 'Watering'), status(503));
        await assert.rejects(service.state(fixture.owner.id, fixture.device.id), status(503));
        assert.equal(transport.sent.length, 3);
      } finally { await service.onModuleDestroy().catch(() => {}); await client.close(); }
    });
    await t.test('concurrent allocator writes never reuse IDs and callback failure rolls back records, order and counter', async () => {
      const owner = randomUUID(), device = (await f.deviceFixture()).device.id;
      await f.store.initialize(owner);
      const tasks = await Promise.all(Array.from({ length: 12 }, () => f.store.change(owner, (journal) => {
        journal.room(1); const task = journal.create(device, 'Stop', [2, 3, 4], 0, new Date().toISOString()); confirmed(task); return task;
      })));
      const ids = tasks.flatMap((task) => [task.command_id, ...task.targets.map((target) => target.task_id)]);
      assert.equal(new Set(ids).size, ids.length);
      const before = await f.store.read(), state = await f.mongo.db(f.name).collection('PERSISTENCE_STATE').findOne({ kind: 'TaskIdAllocator', key: 'global' });
      await assert.rejects(f.store.change(owner, (journal) => { journal.create(device, 'Stop', [2, 3, 4], 0, new Date().toISOString()); throw new Error('rollback fixture'); }), status(503));
      assert.deepEqual(await f.store.read(), before);
      assert.deepEqual(await f.mongo.db(f.name).collection('PERSISTENCE_STATE').findOne({ _id: state!._id }), state);
      await f.store.release(owner);
    });
    await t.test('HTTP async port uses persisted journal with fresh app/pool/client and preserves paths, body and statuses', async () => {
      const fixture = await f.deviceFixture(), transport = new TaskTransport();
      const { app, service } = await taskHttpApplication(f.pool, f.mongo, f.name, transport);
      wireDevices.set(service, fixture.device.id);
      const origin = await app.getUrl();
      const login = async () => {
        const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone_number: fixture.owner.phone, password: taskAuth.admin.password }) });
        assert.equal(response.status, 200); return (await response.json() as { access_token: string }).access_token;
      };
      let taskId = '';
      try {
        const token = await login(), path = `${origin}/api/actuator-tasks/devices/${fixture.device.id}`;
        const bad = await fetch(`${path}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ operation: 'Stop', confirmed_at: new Date().toISOString() }) });
        assert.equal(bad.status, 400);
        const response = await fetch(`${path}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ operation: 'Stop' }) });
        assert.equal(response.status, 202, response.status === 202 ? undefined : await response.text());
        const result = await response.json() as { task: ActuatorTask; status_url: string };
        taskId = result.task._id;
        await finish(service, transport, 0, 3);
        const read = await fetch(`${origin}${result.status_url}`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(read.status, 200); assert.equal((await read.json() as ActuatorTask).status, 'Confirmed');
        const history = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal((await history.json() as { storage: { mode: string } }).storage.mode, 'MongoDB');
      } finally { await app.close(); }
      const freshPool = new Pool({ connectionString: `${taskPgBase}/${f.name}`, max: 5, connectionTimeoutMillis: 5000 });
      const freshMongo = new MongoClient(taskMongoUri, { serverSelectionTimeoutMS: 5000 });
      await freshMongo.connect();
      const freshTransport = new TaskTransport();
      let freshApp: Awaited<ReturnType<typeof taskHttpApplication>> | undefined;
      try {
        freshApp = await taskHttpApplication(freshPool, freshMongo, f.name, freshTransport);
        const freshOrigin = await freshApp.app.getUrl();
        const loggedIn = await fetch(`${freshOrigin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone_number: fixture.owner.phone, password: taskAuth.admin.password }) });
        assert.equal(loggedIn.status, 200);
        const token = (await loggedIn.json() as { access_token: string }).access_token;
        const headers = { Authorization: `Bearer ${token}` };
        const history = await fetch(`${freshOrigin}/api/actuator-tasks/${taskId}`, { headers });
        assert.equal(history.status, 200); assert.equal((await history.json() as ActuatorTask).status, 'Confirmed');
        const state = await fetch(`${freshOrigin}/api/actuator-tasks/devices/${fixture.device.id.toUpperCase()}/state`, { headers });
        const body = await state.json() as { device_id: string; acknowledged_mode: string; physical_state: string };
        assert.equal(state.status, 200); assert.equal(body.device_id, fixture.device.id);
        assert.equal(body.acknowledged_mode, 'Unknown'); assert.equal(body.physical_state, 'Unknown');
        assert.equal(freshTransport.sent.length, 0);
      } finally { await freshApp?.app.close(); await freshPool.end(); await freshMongo.close(); }
    });
    await t.test('5000-record retention uses committed insertion order, protects Pending and retains numeric counter after eviction', async () => {
      // Only this random fixture DB; no running engine or demo data.
      await f.mongo.db(f.name).collection('ACTUATOR_TASKS').deleteMany({});
      await f.mongo.db(f.name).collection('PERSISTENCE_STATE').deleteMany({ kind: 'TaskIdAllocator' });
      const owner = randomUUID(), device = (await f.deviceFixture()).device.id;
      await f.store.initialize(owner);
      const ids = await f.store.change(owner, (journal) => {
        const ids = [];
        for (let i = 0; i < ACTUATOR_TASK_LIMIT; i++) {
          const task = journal.create(device, 'Stop', [2, 3, 4], 0, new Date(Date.UTC(2030, 0, 1) - i * 1000).toISOString());
          journal.tasks.delete(task._id); task._id = (BigInt(ACTUATOR_TASK_LIMIT - i)).toString(16).padStart(24, '0'); journal.tasks.set(task._id, task);
          if (i !== 0) confirmed(task); ids.push(task._id);
        }
        return ids;
      });
      const result = await f.store.change(owner, (journal) => { journal.room(1); const task = journal.create(device, 'Stop', [2, 3, 4], 0, new Date().toISOString()); confirmed(task); return task; });
      const records = await f.store.read();
      assert.equal(records.length, ACTUATOR_TASK_LIMIT); assert(records.some((task) => task._id === ids[0]));
      assert(!records.some((task) => task._id === ids[1])); assert.equal(records.at(-1)!._id, result._id);
      assert(result.command_id > ACTUATOR_TASK_LIMIT * 4);
      await f.store.release(owner);
    });
    await t.test('all-Pending capacity refuses creation atomically; corrupted allocator and exhausted numeric space fail closed', async () => {
      await f.mongo.db(f.name).collection('ACTUATOR_TASKS').deleteMany({});
      await f.mongo.db(f.name).collection('PERSISTENCE_STATE').deleteMany({ kind: 'TaskIdAllocator' });
      const owner = randomUUID(), device = (await f.deviceFixture()).device.id;
      await f.store.initialize(owner);
      await f.store.change(owner, (journal) => { for (let i = 0; i < ACTUATOR_TASK_LIMIT; i++) journal.create(device, 'Stop', [2, 3, 4], 0, new Date().toISOString()); });
      await assert.rejects(f.store.change(owner, (journal) => { journal.room(1); journal.create(device, 'Stop', [2, 3, 4], 0, new Date().toISOString()); }), status(429));
      assert.equal((await f.store.read()).length, ACTUATOR_TASK_LIMIT);
      await f.store.release(owner);
      await f.mongo.db(f.name).collection('ACTUATOR_TASKS').deleteMany({});
      await f.mongo.db(f.name).collection('PERSISTENCE_STATE').deleteMany({ kind: 'TaskIdAllocator' });
      await f.store.initialize(owner);
      await f.mongo.db(f.name).collection('PERSISTENCE_STATE').updateOne({ kind: 'TaskIdAllocator' }, { $set: { 'payload.next_id': Number.MAX_SAFE_INTEGER } });
      await assert.rejects(f.store.change(owner, (journal) => journal.create(device, 'Stop', [2, 3, 4], 0, new Date().toISOString())), status(503));
      assert.equal((await f.store.read()).length, 0);
      await f.mongo.db(f.name).collection('PERSISTENCE_STATE').updateOne({ kind: 'TaskIdAllocator' }, { $set: { 'payload.retained_ids': [new ObjectId()] } });
      await assert.rejects(f.store.read(), status(503));
    });
    await t.test('unavailable Mongo cannot publish or fall back to a process-local journal', async () => {
      const fixture = await f.deviceFixture(), unavailable = new MongoClient('mongodb://127.0.0.1:1/?directConnection=true', { serverSelectionTimeoutMS: 100 });
      const transport = new TaskTransport(), service = new DatabaseActuatorTaskRecords({ ackTimeoutMs: 10000 }, transport, f.access, new MongoActuatorTaskStore(unavailable, unavailable.db('fixture'), 100));
      try { await assert.rejects(service.initialize(), status(503)); assert.equal(transport.sent.length, 0); }
      finally { await service.onModuleDestroy(); await unavailable.close(); }
      assert.ok(fixture.device.id);
    });
  } finally { await f.close(); }
});
