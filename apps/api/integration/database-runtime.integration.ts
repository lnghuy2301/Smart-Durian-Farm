import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { readEnvironment } from '../src/config/environment';
import { MqttTransport, TransportHandlers } from '../src/mqtt/mqtt.transport';
import { MockUserStore } from '../src/auth/mock-user.store';
import { UserAccounts } from '../src/auth/user-accounts';
import { DeviceRecords } from '../src/devices/device-records';
import { DatabaseService } from '../src/database/database.service';
import { CultivationRecords } from '../src/cultivation-events/cultivation-records';
import { ActuatorTaskRecords } from '../src/actuator-tasks/actuator-task-records';
import { RUNTIME_REPOSITORIES } from '../src/persistence/runtime-repositories';
import { taskPersistenceFixture, taskAuth, taskPgBase, readyState } from './helpers/task-persistence-fixture';

class RuntimeTransport extends MqttTransport {
  handlers?: TransportHandlers;
  starts = 0;
  sent: { topic: string; wire: { targets: { taskId: number; taskingCapabilityId: number }[]; taskingParameters: { action: 0 | 1 } } }[] = [];
  start(handlers: TransportHandlers) { ++this.starts; this.handlers = handlers; handlers.state(readyState); }
  async stop() { this.handlers?.state({ ...readyState, connected: false, subscribed: false }); }
  async publish(topic: string, payload: string) { this.sent.push({ topic, wire: JSON.parse(payload) }); return { status: 'TransportAccepted' as const }; }
  message(station: string, body: unknown, retained = false) { this.handlers!.message(`publish/station/${station}`, Buffer.from(JSON.stringify(body)), retained); }
}
async function until(work: () => boolean | Promise<boolean>) {
  const until = Date.now() + 10000;
  while (Date.now() < until) { if (await work()) return; await new Promise((resolve) => setTimeout(resolve, 15)); }
  assert.fail('Timed out waiting for database runtime transition');
}
test('full database AppModule uses shared PostgreSQL/Mongo ports for HTTP, MQTT, QR and restart', async (t) => {
  const f = await taskPersistenceFixture();
  const config = readEnvironment({ NODE_ENV: 'test', BUSINESS_STORAGE: 'database', DATABASE_URL: `${taskPgBase}/${f.name}`,
    MONGODB_URI: `mongodb://127.0.0.1:27028/${f.name}?replicaSet=rs-test&directConnection=true`, AUTH_MODE: 'mock',
    AUTH_TEST_PHONE: taskAuth.phoneNumber, AUTH_TEST_PASSWORD: taskAuth.password, AUTH_TEST_ADMIN_PHONE: taskAuth.admin.phoneNumber,
    AUTH_TEST_ADMIN_PASSWORD: taskAuth.admin.password, JWT_SECRET: taskAuth.jwtSecret, MQTT_ENABLED: 'true', MQTT_BROKER_HOST: '127.0.0.1',
    MQTT_BROKER_PORT: '1883', TRACE_PUBLIC_BASE_URL: 'http://localhost:5173' });
  let app: INestApplication | undefined, transport = new RuntimeTransport(), origin = '', token = '';
  const start = async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.register(config)] }).overrideProvider(MqttTransport).useValue(transport).compile();
    app = module.createNestApplication({ logger: false }); configureApplication(app, config); await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
  };
  const request = (path: string, method = 'GET', body?: unknown, authorized = true) => fetch(`${origin}/api/${path}`, {
    method, headers: { ...(authorized ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const login = async () => {
    const response = await request('auth/login', 'POST', { phone_number: taskAuth.phoneNumber, password: taskAuth.password }, false);
    assert.equal(response.status, 200); token = (await response.json() as { access_token: string }).access_token;
  };
  const device = (await f.pool.query<{ id: string; zone_id: string; station_id: string }>("SELECT id,zone_id,station_id FROM public.devices WHERE station_id='TASK_FIXTURE_ONLY'")).rows[0];
  try {
    await start(); await login();
    await t.test('startup constructs shared ports, excludes RAM stores and serves persistent metadata', async () => {
      assert.equal(transport.starts, 1);
      assert.throws(() => app!.get(MockUserStore));
      const repositories = app!.get(RUNTIME_REPOSITORIES);
      assert.equal(app!.get(UserAccounts), repositories.users); assert.equal(app!.get(DeviceRecords), repositories.devices);
      assert.equal(app!.get(ActuatorTaskRecords), repositories.tasks); assert.equal(app!.get(CultivationRecords), repositories.cultivation);
      assert.equal((await request('health/ready')).status, 200);
      assert.equal((await request(`devices/${device.id}`)).status, 200);
      const response = await request(`sensors?device_id=${device.id}`); assert.equal(response.status, 200);
      assert.equal((await response.json() as { total: number }).total, 6);
      assert.equal((await app!.get(DatabaseService).postgres.query('SELECT current_database() AS name')).rows[0].name, f.name);
    });
    await t.test('MQTT six streams persist to Mongo, HTTP reads same data and malformed/retained packets do not refresh presence', async () => {
      const units = ['C', '%', '%rH', 'C', 'H+', 'µS/cm'];
      transport.message(device.station_id, { stationId: device.station_id, sensorRecords: units.map((unit, index) => ({ dataStreamId: 301 + index, result: `${index + 1.5} ${unit}` })) });
      await until(async () => await f.mongo.db(f.name).collection('IOT_TELEMETRIES').countDocuments({ device_id: device.id }) === 6);
      const response = await request(`telemetry/devices/${device.id}/latest`);
      assert.equal(response.status, 200); const body = await response.json() as { total: number; storage: { mode: string }; items: { unit: string; measured_at: string; received_at: string }[] };
      assert.equal(body.total, 6); assert.equal(body.storage.mode, 'MongoDB'); assert.deepEqual(body.items.map((item) => item.unit).sort(), [...units].sort());
      assert(body.items.every((item) => Date.parse(item.measured_at) <= Date.parse(item.received_at)));
      const seen = (await f.devices.getRecord(device.id)).last_seen_at;
      transport.message(device.station_id, { stationId: device.station_id, sensorRecords: [] }, true);
      transport.message(device.station_id, { stationId: 'MISMATCH', sensorRecords: [] });
      await until(async () => { const r = await request(`mqtt/devices/${device.id}/messages`); const body = await r.json() as { items: { kind: string }[] }; return body.items.filter((item) => item.kind === 'Rejected').length >= 1; });
      assert.equal((await f.devices.getRecord(device.id)).last_seen_at, seen);
    });
    await t.test('real HTTP command and receiver ACK share durable journal; receipt confirms Stop without claiming physical Off', async () => {
      const response = await request(`actuator-tasks/devices/${device.id}/commands`, 'POST', { operation: 'Stop' }); assert.equal(response.status, 202);
      const { task } = await response.json() as { task: { _id: string } };
      for (let index = 0; index < 3; index++) {
        await until(() => transport.sent.length > index);
        const sent = transport.sent[index]; assert.equal(sent.topic, `subscribe/station/${device.station_id}`);
        assert.equal(sent.wire.targets[0].taskingCapabilityId, [2, 3, 4][index]);
        transport.message(device.station_id, { taskId: sent.wire.targets[0].taskId, status: 'ACK', action: 0 });
      }
      await until(async () => (await app!.get(ActuatorTaskRecords).get((await f.users.loadByPhone(taskAuth.phoneNumber))!.user.id, task._id)).status === 'Confirmed');
      const state = await (await request(`actuator-tasks/devices/${device.id}/state`)).json() as { acknowledged_mode: string; physical_state: string };
      assert.equal(state.acknowledged_mode, 'Off'); assert.equal(state.physical_state, 'Unknown');
    });
    let journalId = '', treeCode = '';
    await t.test('Cultivation HTTP writes Mongo and public QR uses shared Locked lineage whitelist', async () => {
      const tree = (await f.pool.query<{ id: string; tree_code: string }>('SELECT id,tree_code FROM public.trees WHERE zone_id=$1 ORDER BY id LIMIT 1', [device.zone_id])).rows[0];
      treeCode = tree.tree_code;
      const response = await request('cultivation-events', 'POST', { target_type: 'Tree', target_id: tree.id, action_type: 'Watering', details: { duration_minutes: 5, note: 'PRIVATE-NOTE' } });
      assert.equal(response.status, 201); journalId = (await response.json() as { _id: string })._id;
      assert.equal(await f.mongo.db(f.name).collection('CULTIVATION_EVENTS').countDocuments(), 1);
      const trace = await request(`traceability/trees/${treeCode}`, 'GET', undefined, false); assert.equal(trace.status, 200);
      const publicTree = await trace.json() as { tree: object };
      assert.deepEqual(Object.keys(publicTree.tree).sort(), ['plant_date', 'status', 'tree_code', 'variety']);
      assert(!JSON.stringify(publicTree).includes('password'));
      const before = await (await request(`traceability/trees/${treeCode}/cultivation`, 'GET', undefined, false)).json() as { total: number }; assert.equal(before.total, 0);
      const svg = await request(`traceability/trees/${treeCode}/qr.svg`, 'GET', undefined, false); assert.equal(svg.status, 200); assert((await svg.text()).includes('<svg'));
    });
    await t.test('new app/pool/client retains journal/readings/accounts and resets control mode without publishing at boot', async () => {
      await app!.close(); app = undefined; transport = new RuntimeTransport(); await start(); await login();
      assert.equal(transport.sent.length, 0);
      assert.equal((await request(`cultivation-events/${journalId}`)).status, 200);
      const readings = await (await request(`telemetry/devices/${device.id}/latest`)).json() as { total: number }; assert.equal(readings.total, 6);
      const state = await (await request(`actuator-tasks/devices/${device.id}/state`)).json() as { acknowledged_mode: string; reset_required: boolean };
      assert.equal(state.acknowledged_mode, 'Unknown'); assert.equal(state.reset_required, true);
      assert.equal((await request(`traceability/trees/${treeCode}`, 'GET', undefined, false)).status, 200);
    });
    await t.test('missing migration aborts provider construction before any transport starts or journal is initialized', async () => {
      const row = (await f.pool.query("DELETE FROM technical.schema_migrations WHERE id='014_cultivation_ledger' RETURNING *")).rows[0];
      const stopped = new RuntimeTransport();
      try {
        await assert.rejects(Test.createTestingModule({ imports: [AppModule.register(config)] })
          .overrideProvider(DatabaseService).useValue({ postgres: f.pool, mongo: f.mongo })
          .overrideProvider(MqttTransport).useValue(stopped).compile(), /db:status\/db:migrate/);
        assert.equal(stopped.starts, 0); assert.equal(stopped.sent.length, 0);
      } finally { await f.pool.query('INSERT INTO technical.schema_migrations(id,store,checksum,applied_at) VALUES ($1,$2,$3,$4)', [row.id, row.store, row.checksum, row.applied_at]); }
    });
    await t.test('wrong Mongo database cannot be initialized implicitly despite an Applied PostgreSQL ledger', async () => {
      const empty = new MongoClient(`mongodb://127.0.0.1:27028/${f.name}_x?replicaSet=rs-test&directConnection=true`, { serverSelectionTimeoutMS: 5000 });
      const stopped = new RuntimeTransport();
      try {
        await assert.rejects(Test.createTestingModule({ imports: [AppModule.register(config)] })
          .overrideProvider(DatabaseService).useValue({ postgres: f.pool, mongo: empty })
          .overrideProvider(MqttTransport).useValue(stopped).compile(), /db:status\/db:migrate/);
        assert.equal(stopped.starts, 0); assert.equal((await empty.db().listCollections().toArray()).length, 0);
      } finally { await empty.close(); }
    });
    await t.test('separate Node process crash and restart retain API data and accept the existing valid JWT', async () => {
      await app!.close(); app = undefined;
      const childConfig = { ...config, mqtt: { ...config.mqtt!, enabled: false } };
      const boot = async () => {
        const script = `require('reflect-metadata'); let data=''; process.stdin.on('data',c=>data+=c); process.stdin.on('end',async()=>{try{const {createApplication}=require(${JSON.stringify(resolve(__dirname, '../src/application.js'))});const app=await createApplication(JSON.parse(data),false);await app.listen(0,'127.0.0.1');process.stdout.write('READY:'+await app.getUrl()+'\\n');}catch{process.stderr.write('CHILD_STARTUP_FAILED');process.exitCode=1;}});`;
        // Pass only fixture config through stdin. The child does not import
        // main/dotenv or inherit a live provider configuration from root.env.
        const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        child.stdin.end(JSON.stringify(childConfig));
        const endpoint = await new Promise<string>((accept, reject) => {
          const timer = setTimeout(() => { child.kill(); reject(new Error('Fixture child startup timed out')); }, 20000);
          let text = '';
          child.stdout.on('data', (chunk) => { text += chunk.toString(); const found = /^READY:(http:\/\/127\.0\.0\.1:\d+)$/m.exec(text); if (found) { clearTimeout(timer); accept(found[1]); } });
          child.once('error', () => { clearTimeout(timer); reject(new Error('Fixture child spawn failed')); });
          child.once('exit', () => { clearTimeout(timer); reject(new Error('Fixture child exited before startup')); });
        });
        return { child, endpoint };
      };
      const first = await boot();
      try {
        const response = await fetch(`${first.endpoint}/api/cultivation-events/${journalId}`, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(response.status, 200); assert.equal((await response.json() as { _id: string })._id, journalId);
      } finally { const ended = once(first.child, 'exit'); first.child.kill(); await ended; }
      const next = await boot();
      try {
        const response = await fetch(`${next.endpoint}/api/cultivation-events/${journalId}`, { headers: { authorization: `Bearer ${token}` } }); assert.equal(response.status, 200);
        const readings = await fetch(`${next.endpoint}/api/telemetry/devices/${device.id}/latest`, { headers: { authorization: `Bearer ${token}` } });
        assert.equal((await readings.json() as { total: number }).total, 6);
        assert.equal((await fetch(`${next.endpoint}/api/traceability/trees/${treeCode}`)).status, 200);
      } finally { const ended = once(next.child, 'exit'); next.child.kill(); await ended; }
    });
  } finally { if (app) await app.close(); await f.close(); }
});
