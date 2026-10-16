import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { HttpException, INestApplication, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import { AuthModule } from '../src/auth/auth.module';
import { UserAccounts } from '../src/auth/user-accounts';
import { OtpProvider, OtpProof } from '../src/auth/sms/otp.provider';
import { UsersModule } from '../src/users/users.module';
import { UserManagement } from '../src/users/user-management';
import { EmailSender } from '../src/users/email/email.sender';
import { hashPassword } from '../src/auth/password';
import { CooperativesModule } from '../src/cooperatives/cooperatives.module';
import { CooperativesService } from '../src/cooperatives/cooperatives.service';
import { CooperativeRecords } from '../src/cooperatives/cooperative-records';
import { COOPERATIVE_OTP_PROVIDER } from '../src/cooperatives/cooperative-otp.provider';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { PostgresCooperativesRepository } from '../src/persistence/postgres-cooperatives.repository';
import { PostgresUserManagement } from '../src/persistence/postgres-user-management';
import { PostgresCooperativeRecords } from '../src/persistence/postgres-cooperative-records';
import { MIGRATIONS, runMigrations } from '../src/persistence/migrations';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';

const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const config = { mode: 'mock' as const, phoneNumber: '0900000000', password: 'WorkflowFixturePassword!',
  jwtSecret: 'workflow-fixture-secret-at-least-32-bytes', sms: { provider: 'mock' as const },
  admin: { phoneNumber: '0900000001', password: 'WorkflowAdminFixture!' } };
const page = { limit: 100, offset: 0 }, DAY = 86400000;
const status = (value: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === value;
const input = (certificate_number: string) => ({ cooperative_name: 'HTX workflow fixture', director: 'Ban quản trị', certificate_number,
  address: 'Địa chỉ gốc', contact_number: '0900000009' });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

async function application(pool: Pool) {
  const users = new PostgresUsersRepository(pool), registry = new PostgresCooperativesRepository(pool, users);
  const records = new PostgresCooperativeRecords(pool, registry), mails: { to: string; code: string }[] = [];
  const auth = AuthModule.forMock(config), userModule = UsersModule.forMock(config, auth);
  const module = await Test.createTestingModule({ imports: [CooperativesModule.forRecords(config, auth, userModule,
    { provide: CooperativeRecords, useValue: records })] })
    .overrideProvider(UserAccounts).useValue(users)
    .overrideProvider(UserManagement).useValue(new PostgresUserManagement(users, registry))
    .overrideProvider(EmailSender).useValue({ async sendVerification(to: string, code: string) { mails.push({ to, code }); } }).compile();
  const app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const service = app.get(CooperativesService), sms = app.get<OtpProvider>(COOPERATIVE_OTP_PROVIDER);
  const http = async (path: string, method = 'GET', body?: object, token?: string) => fetch(`${await app.getUrl()}/api/${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const login = async (phone: string, password: string) => {
    const response = await http('auth/login', 'POST', { phone_number: phone, password }); assert.equal(response.status, 200);
    return (await response.json() as { access_token: string }).access_token;
  };
  return { app, service, sms, records, registry, users, mails, http, login };
}

test('Cooperative email→SMS workflows persist atomically across isolated HTTP application restarts', async (t) => {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString: `${postgresBase}/sdf_persistence_test`, connectionTimeoutMillis: 5000 });
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  let pool: Pool | undefined, created = false;
  const apps = new Set<INestApplication>();
  try {
    await adminPool.query(`CREATE DATABASE "${name}"`); created = true;
    pool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 8, connectionTimeoutMillis: 5000 });
    const sql = pool; await mongo.connect();
    await t.test('migration004 refuses duplicate active Manager slots and leaves existing rows/ledger unchanged', async () => {
      await runMigrations(sql, mongo.db(name), MIGRATIONS.slice(0, 3));
      const repo = new PostgresUsersRepository(sql);
      const user = await repo.createRegisteredUser({ role: 'Farmer', user_name: 'Migration fixture', phone_number: '0900000088', gmail: null, passwordHash: await hashPassword(config.password) });
      const rows = await sql.query(`INSERT INTO technical.workflow_requests(module,action,status,requested_by,payload,created_at)
        VALUES ('cooperatives','ManagerUpdate','EmailPending',$1,'{}',now()),('cooperatives','ManagerUpdate','EmailPending',$1,'{}',now()) RETURNING id`, [user.user.id]);
      await assert.rejects(runMigrations(sql, mongo.db(name)), (error: unknown) => (error as { code: string }).code === '23505');
      assert.equal((await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count, '3');
      assert.equal((await sql.query('SELECT count(*) FROM technical.workflow_requests')).rows[0].count, '2');
      await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[1].id]);
      assert.deepEqual(await runMigrations(sql, mongo.db(name)), ['004_cooperative_workflow', '005_farm_workflow', '006_sensor_types', '007_zone_workflow', '008_assignment_workflow', '009_tree_workflow']);
      await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[0].id]);
    });
    await seedDemo(sql, readSeedConfig({ NODE_ENV: 'test', AUTH_TEST_PHONE: config.phoneNumber, AUTH_TEST_PASSWORD: config.password,
      AUTH_TEST_ADMIN_PHONE: config.admin.phoneNumber, AUTH_TEST_ADMIN_PASSWORD: config.admin.password,
      DEMO_DEVICE_STATION_ID: 'WORKFLOW_TEST_ESP32', DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00', DEMO_DEVICE_COST: '10237500' }));
    const adminId = (await new PostgresUsersRepository(sql).loadByPhone(config.admin.phoneNumber))!.user.id;
    const hash = await hashPassword(config.password);
    let sequence = 10;
    const fixture = async () => {
      const f = await application(sql); apps.add(f.app); const n = sequence++;
      const phone = `09000000${n}`, gmail = `workflow-${n}@example.invalid`;
      const manager = await f.users.createRegisteredUser({ user_name: 'Workflow Manager', phone_number: phone, gmail, passwordHash: hash, role: 'Manager' }, gmail);
      const approved = await f.registry.approve(adminId, manager.user.id, { cooperative: input(`WF-${n}`) });
      const request = async (address = 'Địa chỉ đề xuất') => f.service.createUpdateRequest(manager.user.id, approved.cooperative.id, { address });
      const email = async (address?: string) => { const r = await request(address); await f.service.verifyEmail(manager.user.id, r.id, f.mails.at(-1)!.code); return r; };
      const sms = async (address?: string) => { const r = await email(address); await f.service.sendSms(manager.user.id, r.id); return { r, code: f.sms.messages(phone)[0].otp }; };
      const close = async () => { await f.app.close(); apps.delete(f.app); };
      return { ...f, managerId: manager.user.id, coopId: approved.cooperative.id, phone, gmail, request, email, send: sms, close };
    };
    await t.test('real HTTP requires both proofs, scopes requests and commits HTX/version/request/audit together', async () => {
      const f = await fixture();
      try {
        const jwt = await f.login(f.phone, config.password), adminJwt = await f.login(config.admin.phoneNumber, config.admin.password);
        const before = await f.records.get(f.managerId, f.coopId);
        const response = await f.http(`cooperatives/${f.coopId}/update-requests`, 'POST', { address: 'Địa chỉ mới', contact_number: '0900000077' }, jwt);
        assert.equal(response.status, 201); const r = await response.json() as { id: string; status: string };
        assert.equal(r.status, 'EmailPending'); assert.equal(f.mails.at(-1)!.to, f.gmail);
        assert.equal((await f.http(`cooperative-update-requests/${r.id}/sms/send`, 'POST', {}, jwt)).status, 409);
        assert.equal((await f.http(`cooperative-update-requests/${r.id}/email/verify`, 'POST', { otp: f.mails.at(-1)!.code }, adminJwt)).status, 403);
        assert.equal((await f.http(`cooperative-update-requests/${r.id}/email/verify`, 'POST', { otp: f.mails.at(-1)!.code }, jwt)).status, 201);
        assert.equal((await f.http(`cooperative-update-requests/${r.id}/sms/send`, 'POST', {}, jwt)).status, 201);
        assert.equal(f.sms.messages(f.phone)[0].phone_number, f.phone);
        const code = f.sms.messages(f.phone)[0].otp;
        const accepted = await f.http(`cooperative-update-requests/${r.id}/sms/verify`, 'POST', { otp: code }, jwt);
        assert.equal(accepted.status, 201);
        const after = await f.records.get(f.managerId, f.coopId); assert.equal(after.version, before.version + 1); assert.equal(after.cooperative.address, 'Địa chỉ mới');
        assert.equal(after.cooperative.certificate_number, before.cooperative.certificate_number);
        assert.equal((await f.service.getRequest(adminId, r.id)).status, 'Accepted');
        const stored = await sql.query('SELECT payload FROM technical.workflow_requests WHERE id=$1', [r.id]);
        const serialized = JSON.stringify(stored.rows[0].payload);
        assert.equal(/emailDigest|emailSalt|smsProof|password|otp/i.test(serialized), false);
        assert.equal(serialized.includes(f.phone) || serialized.includes(f.gmail), false);
        const publicResponse = await f.http(`cooperative-update-requests/${r.id}`, 'GET', undefined, jwt);
        assert.equal(/session_id|revision|token_version|cooperativeVersion|emailDigest|smsProof/.test(await publicResponse.text()), false);
        await assert.rejects(f.service.verifySms(f.managerId, r.id, code), status(409));
        assert.equal((await sql.query("SELECT count(*) FROM technical.audit_events WHERE action='CooperativeUpdateAccepted' AND entity_key=$1", [f.coopId])).rows[0].count, '1');
      } finally { await f.close(); }
    });
    await t.test('simultaneous creation has one active request; provider waits cannot duplicate/check/cancel it', async () => {
      const f = await fixture();
      try {
        const results = await Promise.allSettled([f.request('First'), f.request('Second')]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult; assert.ok(status(409)(failed.reason));
        const r = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>).value;
        await f.service.verifyEmail(f.managerId, r.id, f.mails.at(-1)!.code); await f.service.sendSms(f.managerId, r.id);
        const started = deferred(), release = deferred(), original = f.sms.verify.bind(f.sms);
        t.mock.method(f.sms, 'verify', async (proof: OtpProof, code: string) => { started.resolve(); await release.promise; return original(proof, code); });
        const code = f.sms.messages(f.phone)[0].otp, first = f.service.verifySms(f.managerId, r.id, code); await started.promise;
        await assert.rejects(f.service.verifySms(f.managerId, r.id, code), status(409));
        await assert.rejects(f.service.cancel(f.managerId, r.id), status(409));
        release.resolve(); await first;
      } finally { await f.close(); }
    });
    await t.test('Admin edit while Verify awaits wins; no stale Manager write is applied', async () => {
      const f = await fixture();
      try {
        const { r, code } = await f.send(); const original = f.sms.verify.bind(f.sms);
        t.mock.method(f.sms, 'verify', async (proof: OtpProof, otp: string) => { const matches = await original(proof, otp); await f.service.update(adminId, f.coopId, { address: 'Admin thắng' }); return matches; });
        await assert.rejects(f.service.verifySms(f.managerId, r.id, code), status(409));
        assert.equal((await f.records.get(adminId, f.coopId)).cooperative.address, 'Admin thắng');
        assert.equal((await f.service.getRequest(adminId, r.id)).status, 'Failed');
      } finally { await f.close(); }
    });
    await t.test('account token revocation during Verify rejects the old proof context', async () => {
      const f = await fixture();
      try {
        const { r, code } = await f.send(), original = f.sms.verify.bind(f.sms);
        t.mock.method(f.sms, 'verify', async (proof: OtpProof, otp: string) => {
          const matches = await original(proof, otp), snapshot = await f.users.loadById(f.managerId);
          assert.equal(await f.users.replacePassword(f.managerId, snapshot!.tokenVersion, hash), true); return matches;
        });
        await assert.rejects(f.service.verifySms(f.managerId, r.id, code), status(409));
        assert.equal((await f.records.get(adminId, f.coopId)).cooperative.address, input('').address);
        assert.equal((await f.service.getRequest(adminId, r.id)).status, 'Failed');
      } finally { await f.close(); }
    });
    await t.test('audit failure rolls back HTX/metadata/Accepted; failed proof cannot be replayed', async () => {
      const f = await fixture();
      try {
        const { r, code } = await f.send(), before = await f.records.get(adminId, f.coopId);
        await sql.query(`CREATE FUNCTION technical.fail_workflow_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.action='CooperativeUpdateAccepted' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER workflow_audit_failure BEFORE INSERT ON technical.audit_events FOR EACH ROW EXECUTE FUNCTION technical.fail_workflow_audit()`);
        await assert.rejects(f.service.verifySms(f.managerId, r.id, code), status(503));
        assert.deepEqual(await f.records.get(adminId, f.coopId), before);
        assert.equal((await f.service.getRequest(adminId, r.id)).status, 'Failed');
        await assert.rejects(f.service.verifySms(f.managerId, r.id, code), status(409));
      } finally {
        await sql.query('DROP TRIGGER IF EXISTS workflow_audit_failure ON technical.audit_events; DROP FUNCTION IF EXISTS technical.fail_workflow_audit()'); await f.close();
      }
    });
    await t.test('unknown response after a successful commit never changes Accepted to Failed or replays proof', async () => {
      const f = await fixture();
      try {
        const { r, code } = await f.send(), original = f.records.saveRequest.bind(f.records);
        t.mock.method(f.records, 'saveRequest', async (...args: Parameters<typeof original>) => {
          const result = await original(...args); if (args[1].status === 'Accepted') { throw new ServiceUnavailableException('Fixture: commit response lost'); } return result;
        });
        await assert.rejects(f.service.verifySms(f.managerId, r.id, code), status(503));
        assert.equal((await f.service.getRequest(adminId, r.id)).status, 'Accepted');
        assert.equal((await f.records.get(adminId, f.coopId)).cooperative.address, 'Địa chỉ đề xuất');
        await assert.rejects(f.service.verifySms(f.managerId, r.id, code), status(409));
      } finally { await f.close(); }
    });
    await t.test('lost response after an intermediate commit closes the session without waiting for its deadline', async () => {
      const f = await fixture();
      try {
        const { r, code } = await f.send(), original = f.records.saveRequest.bind(f.records);
        t.mock.method(f.records, 'saveRequest', async (...args: Parameters<typeof original>) => {
          const result = await original(...args); if (args[1].status === 'SmsChecking') { throw new ServiceUnavailableException('Fixture: intermediate response lost'); } return result;
        });
        await assert.rejects(f.service.verifySms(f.managerId, r.id, code), status(503));
        assert.equal((await f.service.getRequest(adminId, r.id)).status, 'Failed');
        assert.equal((await f.records.get(adminId, f.coopId)).cooperative.address, input('').address);
        await assert.rejects(f.service.verifySms(f.managerId, r.id, code), status(409));
        const next = await f.request('Có thể tạo phiên mới'); await f.service.cancel(f.managerId, next.id);
      } finally { await f.close(); }
    });
    await t.test('delayed cleanup of a failed request cannot clear SMS from a newer request on the same account', async () => {
      const f = await fixture();
      try {
        const sender = f.app.get(EmailSender), send = sender.sendVerification.bind(sender);
        let firstEmail = true;
        t.mock.method(sender, 'sendVerification', async (...args: Parameters<typeof send>) => {
          if (firstEmail) { firstEmail = false; throw new ServiceUnavailableException('Fixture email failure'); } return send(...args);
        });
        const failedSaved = deferred(), release = deferred(), save = f.records.saveRequest.bind(f.records);
        let firstFailure = true;
        t.mock.method(f.records, 'saveRequest', async (...args: Parameters<typeof save>) => {
          const result = await save(...args);
          if (args[1].status === 'Failed' && firstFailure) { firstFailure = false; failedSaved.resolve(); await release.promise; }
          return result;
        });
        const failed = assert.rejects(f.request('Lỗi email'), status(503)); await failedSaved.promise;
        const next = await f.send('Phiên mới'); release.resolve(); await failed;
        assert.equal(f.sms.messages(f.phone)[0].otp, next.code);
        await f.service.verifySms(f.managerId, next.r.id, next.code);
        assert.equal((await f.records.get(adminId, f.coopId)).cooperative.address, 'Phiên mới');
      } finally { await f.close(); }
    });
    await t.test('fresh application/pool retains Accepted and unfinished proposal contents; unfinished OTP becomes Expired', async () => {
      const f = await fixture(); let freshPool: Pool | undefined;
      try {
        const accepted = await f.send('Đã duyệt'); await f.service.verifySms(f.managerId, accepted.r.id, accepted.code);
        const abandoned = await f.send('Chưa áp dụng'); const token = await f.login(f.phone, config.password);
        await f.close();
        freshPool = new Pool({ connectionString: `${postgresBase}/${name}`, connectionTimeoutMillis: 5000 });
        const fresh = await application(freshPool); apps.add(fresh.app);
        try {
          assert.equal((await fresh.service.getRequest(adminId, accepted.r.id)).status, 'Accepted');
          const expired = await fresh.service.getRequest(f.managerId, abandoned.r.id);
          assert.equal(expired.status, 'Expired'); assert.equal(expired.proposed_changes.address, 'Chưa áp dụng');
          assert.equal((await fresh.records.get(f.managerId, f.coopId)).cooperative.address, 'Đã duyệt');
          assert.equal((await fresh.http(`cooperative-update-requests/${abandoned.r.id}/sms/verify`, 'POST', { otp: abandoned.code }, token)).status, 409);
          assert.equal((await fresh.http(`cooperative-update-requests/${accepted.r.id}`, 'GET', undefined, token)).status, 200);
          const next = await fresh.service.createUpdateRequest(f.managerId, f.coopId, { address: 'Sau restart' });
          await fresh.service.verifyEmail(f.managerId, next.id, fresh.mails.at(-1)!.code); await fresh.service.sendSms(f.managerId, next.id);
          await fresh.service.verifySms(f.managerId, next.id, fresh.sms.messages(f.phone)[0].otp);
          assert.equal((await fresh.records.get(adminId, f.coopId)).cooperative.address, 'Sau restart');
        } finally { await fresh.app.close(); apps.delete(fresh.app); }
      } finally { if (apps.has(f.app)) { await f.close(); } await freshPool?.end(); }
    });
    await t.test('timeout is rechecked after waiting for row locks, before SMS provider or mutation', async (context) => {
      let now = Date.now(); context.mock.method(Date, 'now', () => now);
      const f = await fixture(), blocker = await sql.connect();
      try {
        const { r, code } = await f.send(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM public.cooperatives WHERE id=$1 FOR UPDATE', [f.coopId]);
        const checking = f.service.verifySms(f.managerId, r.id, code);
        const rejected = assert.rejects(checking, status(409));
        // Wait until the transaction is genuinely blocked instead of using a
        // short machine-dependent sleep. This database is our random fixture.
        let waiting = false;
        for (let i = 0; i < 100 && !waiting; i++) {
          waiting = (await sql.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND pid<>pg_backend_pid()) AS waiting", [name])).rows[0].waiting;
          if (!waiting) { await new Promise<void>((done) => setTimeout(done, 10)); }
        }
        assert.equal(waiting, true); now += 5 * 60000; await blocker.query('COMMIT'); await rejected;
        assert.equal((await f.records.get(adminId, f.coopId)).cooperative.address, input('').address);
      } finally { await blocker.query('ROLLBACK'); blocker.release(); await f.close(); }
    });
    await t.test('scheduler bootstrap preserves warning snapshots, blocks historical references and expires stale sessions', async () => {
      const users = new PostgresUsersRepository(sql), registry = new PostgresCooperativesRepository(sql, users);
      const remove = await registry.create(adminId, input('REMOVE-WF')), blocked = await registry.create(adminId, input('BLOCK-WF'));
      const old = new Date(Date.now() - 30 * DAY).toISOString();
      await sql.query("UPDATE technical.entity_metadata SET data=jsonb_set(data,'{created_at}',$2::jsonb) WHERE entity_type='cooperatives' AND entity_key=ANY($1::text[])", [[remove.id, blocked.id], JSON.stringify(old)]);
      await sql.query(`INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at,resolved_at)
        VALUES ('farms','Join','Rejected','fixture',$1,$2,now(),now())`, [adminId, JSON.stringify({ farm_snapshot: { cooperative_id: blocked.id } })]);
      const f = await application(sql); apps.add(f.app);
      try {
        await assert.rejects(f.records.get(adminId, remove.id), status(404)); assert.ok(await f.records.get(adminId, blocked.id));
        const before = await f.service.listNotifications(adminId, page); await f.service.sweep();
        assert.equal((await f.service.listNotifications(adminId, page)).total, before.total);
        assert.ok(before.items.some((n) => n.type === 'CooperativeDeleted' && n.cooperative_id === remove.id));
        assert.ok(before.items.some((n) => n.type === 'DeletionBlocked' && n.cooperative_id === blocked.id));
        const farmerId = (await f.users.loadByPhone(config.phoneNumber))!.user.id;
        await assert.rejects(f.service.listNotifications(farmerId, page), status(403));
      } finally { await f.app.close(); apps.delete(f.app); }
    });
    await t.test('malformed workflow metadata fails safely without falling back or exposing private JSON', async () => {
      const f = await fixture();
      try {
        const r = await f.request(), payload = (await sql.query('SELECT payload FROM technical.workflow_requests WHERE id=$1', [r.id])).rows[0].payload;
        await sql.query("UPDATE technical.workflow_requests SET payload=jsonb_set(payload,'{revision}','-1') WHERE id=$1", [r.id]);
        await assert.rejects(f.records.getRequest(adminId, r.id), (error: unknown) => status(503)(error) && !JSON.stringify(error).includes(f.gmail));
        await sql.query('UPDATE technical.workflow_requests SET payload=$2 WHERE id=$1', [r.id, JSON.stringify(payload)]);
        await f.service.cancel(f.managerId, r.id);
      } finally { await f.close(); }
    });
  } finally {
    for (const app of apps) { await app.close(); }
    await pool?.end(); await mongo.close();
    if (created) {
      await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
      await adminPool.query(`DROP DATABASE "${name}"`);
      const cleanup = new MongoClient(mongoUri); try { await cleanup.connect(); await cleanup.db(name).dropDatabase(); } finally { await cleanup.close(); }
    }
    await adminPool.end();
  }
});
