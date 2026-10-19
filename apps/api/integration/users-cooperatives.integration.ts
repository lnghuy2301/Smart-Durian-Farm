import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import { AuthModule } from '../src/auth/auth.module';
import { UserAccounts } from '../src/auth/user-accounts';
import { UsersModule } from '../src/users/users.module';
import { UserManagement } from '../src/users/user-management';
import { EmailSender } from '../src/users/email/email.sender';
import { hashPassword } from '../src/auth/password';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { PostgresCooperativesRepository } from '../src/persistence/postgres-cooperatives.repository';
import { PostgresUserManagement } from '../src/persistence/postgres-user-management';
import { MIGRATIONS, runMigrations } from '../src/persistence/migrations';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';

const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const config = { mode: 'mock' as const, phoneNumber: '0900000000', password: 'CooperativesFixturePassword!',
  jwtSecret: 'cooperatives-fixture-secret-at-least-32-bytes', sms: { provider: 'mock' as const },
  admin: { phoneNumber: '0900000001', password: 'AdminCooperativeFixture!' } };
const status = (value: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === value;
const input = (certificate_number: string) => ({ cooperative_name: 'HTX kiểm thử', director: 'Ban quản trị', certificate_number,
  address: 'Đắk Lắk (fixture)', contact_number: '0900000001' });
const DAY = 86400000;

async function application(users: PostgresUsersRepository, management: PostgresUserManagement, mails: Map<string, string>): Promise<INestApplication> {
  const auth = AuthModule.forMock(config);
  const module = await Test.createTestingModule({ imports: [UsersModule.forMock(config, auth)] })
    .overrideProvider(UserAccounts).useValue(users)
    .overrideProvider(UserManagement).useValue(management)
    .overrideProvider(EmailSender).useValue({ async sendVerification(to: string, code: string) { mails.set(to, code); } }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); return app;
}

test('Users/email and Cooperative registry persist with real PostgreSQL transactions', async (t) => {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString: `${postgresBase}/sdf_persistence_test`, connectionTimeoutMillis: 5000 });
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  let pool: Pool | undefined, created = false;
  try {
    await adminPool.query(`CREATE DATABASE "${name}"`); created = true;
    pool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 8, connectionTimeoutMillis: 5000 });
    const sql = pool; await mongo.connect();
    await t.test('new certificate migration rejects existing duplicates without altering earlier schemas or deleting rows', async () => {
      await runMigrations(sql, mongo.db(name), MIGRATIONS.slice(0, 2));
      const rows = await sql.query(`INSERT INTO public.cooperatives(cooperative_name,director,certificate_number,address,contact_number)
        VALUES ('Fixture A','A','DUPLICATE','Fixture','0900000001'),('Fixture B','B','DUPLICATE','Fixture','0900000001') RETURNING id`);
      await assert.rejects(runMigrations(sql, mongo.db(name)), (error: unknown) => (error as { code: string }).code === '23505');
      assert.equal((await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count, '2');
      assert.equal((await sql.query('SELECT count(*) FROM public.cooperatives')).rows[0].count, '2');
      // Remove only our duplicate fixture in this randomly named test database.
      await sql.query('DELETE FROM public.cooperatives WHERE id=$1', [rows.rows[1].id]);
      assert.deepEqual(await runMigrations(sql, mongo.db(name)), ['003_cooperative_certificate', '004_cooperative_workflow', '005_farm_workflow', '006_sensor_types', '007_zone_workflow', '008_assignment_workflow', '009_tree_workflow', '010_harvest_workflow', '011_device_workflow', '012_sensor_workflow', '013_actuator_workflow']);
      await sql.query('DELETE FROM public.cooperatives WHERE id=$1', [rows.rows[0].id]);
    });
    const seed = await seedDemo(sql, readSeedConfig({ NODE_ENV: 'test', AUTH_TEST_PHONE: config.phoneNumber, AUTH_TEST_PASSWORD: config.password,
      AUTH_TEST_ADMIN_PHONE: config.admin.phoneNumber, AUTH_TEST_ADMIN_PASSWORD: config.admin.password,
      DEMO_DEVICE_STATION_ID: 'COOP_TEST_ESP32', DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00', DEMO_DEVICE_COST: '10237500' }));
    const users = new PostgresUsersRepository(sql);
    let now = new Date();
    const coops = new PostgresCooperativesRepository(sql, users, () => now);
    const management = new PostgresUserManagement(users, coops);
    const adminId = (await users.loadByPhone(config.admin.phoneNumber))!.user.id;
    const adminHash = (await users.loadById(adminId))!.user.password;
    const admin2 = (await sql.query(`INSERT INTO public.users(user_name,phone_number,password,role,status)
      VALUES ('Second Admin fixture','0900000099',$1,'Admin','Active') RETURNING id`, [adminHash])).rows[0].id as string;
    await sql.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('users',$1,'{"token_version":0}')`, [admin2]);
    const passwordHash = await hashPassword('ManagerFixturePassword!');
    let counter = 10;
    const manager = async (verified = true) => {
      const n = counter++, phone = `09000000${n}`, email = `manager${n}@example.invalid`;
      if (!verified) { return (await sql.query(`INSERT INTO public.users(user_name,phone_number,gmail,password,role,status)
        VALUES ('Unverified fixture',$1,$2,$3,'Manager','Pending') RETURNING id`, [phone, email, passwordHash])).rows[0].id as string; }
      return (await users.createRegisteredUser({ user_name: 'Manager fixture', phone_number: phone, gmail: email, passwordHash, role: 'Manager' }, email)).user.id;
    };

    await t.test('Admin registry CRUD keeps metadata created_at/version and certificate uniqueness; Farmer reads only', async () => {
      const coop = await coops.create(adminId, input('REGISTRY-1'));
      const original = await coops.get(adminId, coop.id);
      assert.equal(original.version, 1); assert.equal(coop.manager_id, null);
      await coops.update(adminId, coop.id, { address: 'Cái Bè (fixture)' });
      const updated = await coops.get(seed.primary_farmer_id, coop.id);
      assert.equal(updated.createdAt, original.createdAt); assert.equal(updated.version, 2);
      await assert.rejects(coops.update(seed.primary_farmer_id, coop.id, { address: 'Unauthorized' }), status(403));
      await assert.rejects(coops.update(adminId, coop.id, { manager_id: randomUUID() } as unknown as { address: string }), status(400));
      await assert.rejects(coops.update(adminId, coop.id, { address: updated.cooperative.address }), status(400));
      await assert.rejects(coops.create(adminId, input('REGISTRY-1')), status(409));
      assert.equal((await coops.get(adminId, coop.id)).version, 2);
    });

    await t.test('approval enforces Admin/Pending/verified email, activates and links atomically, and preserves created_at', async () => {
      const id = await manager(), coop = await coops.create(adminId, input('ASSIGN-1'));
      const createdAt = (await coops.get(adminId, coop.id)).createdAt;
      await assert.rejects(coops.approve(seed.primary_farmer_id, id, { cooperative_id: coop.id }), status(403));
      const approval = await coops.approve(adminId, id, { cooperative_id: coop.id });
      assert.equal(approval.user.status, 'Active'); assert.equal(approval.cooperative.manager_id, id);
      assert.equal((await users.loadById(id))!.tokenVersion, 1);
      assert.equal((await coops.get(id, coop.id)).createdAt, createdAt);
      assert.equal((await coops.list(id)).length, 1);
      const other = await coops.create(adminId, input('OTHER-1'));
      await assert.rejects(coops.get(id, other.id), status(404));
      await assert.rejects(coops.approve(adminId, id, { cooperative: input('DUP-MANAGER') }), status(409));
      await assert.rejects(coops.approve(adminId, await manager(), { cooperative_id: coop.id }), status(409));
      const unverified = await manager(false);
      await sql.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('users',$1,'{"token_version":0}')`, [unverified]);
      await assert.rejects(coops.approve(adminId, unverified, { cooperative: input('NO-VERIFY') }), status(409));
      assert.equal((await users.loadById(unverified))!.user.status, 'Pending');
    });

    await t.test('distinct Admins racing for same HTX or same Manager cannot overwrite existing manager', async () => {
      const coop = await coops.create(adminId, input('RACE-COOP'));
      const first = await manager(), second = await manager();
      const results = await Promise.allSettled([coops.approve(adminId, first, { cooperative_id: coop.id }), coops.approve(admin2, second, { cooperative_id: coop.id })]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.ok(results.some((result) => result.status === 'rejected' && status(409)(result.reason)));
      const assigned = (await coops.get(adminId, coop.id)).cooperative.manager_id!;
      assert.equal((await users.loadById(assigned))!.user.status, 'Active');
      assert.equal((await users.loadById(assigned === first ? second : first))!.user.status, 'Pending');
      const same = await manager();
      const sameResults = await Promise.allSettled([coops.approve(adminId, same, { cooperative: input('SAME-1') }), coops.approve(admin2, same, { cooperative: input('SAME-2') })]);
      assert.equal(sameResults.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal((await sql.query('SELECT count(*) FROM public.cooperatives WHERE manager_id=$1', [same])).rows[0].count, '1');
    });

    await t.test('approve/reject race resolves Manager once and concurrent duplicate certificate rolls back loser', async () => {
      const id = await manager();
      const results = await Promise.allSettled([coops.approve(adminId, id, { cooperative: input('REVIEW-RACE') }), coops.reject(admin2, id)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const state = (await users.loadById(id))!;
      assert.ok(['Active', 'Reject'].includes(state.user.status)); assert.equal(state.tokenVersion, 1);
      assert.equal((await sql.query('SELECT count(*) FROM public.cooperatives WHERE manager_id=$1', [id])).rows[0].count, state.user.status === 'Active' ? '1' : '0');
      const first = await manager(), second = await manager();
      const duplicate = await Promise.allSettled([coops.approve(adminId, first, { cooperative: input('CERT-RACE') }), coops.approve(admin2, second, { cooperative: input('CERT-RACE') })]);
      assert.equal(duplicate.filter((result) => result.status === 'fulfilled').length, 1);
      assert.ok(duplicate.some((result) => result.status === 'rejected' && status(409)(result.reason)));
      assert.deepEqual([(await users.loadById(first))!.user.status, (await users.loadById(second))!.user.status].sort(), ['Active', 'Pending']);
    });

    await t.test('audit failure rolls back User status/version, new or attached HTX and registry metadata', async () => {
      const id = await manager(), coop = await coops.create(adminId, input('AUDIT-EXISTING'));
      const original = await coops.get(adminId, coop.id);
      await sql.query(`CREATE FUNCTION technical.fail_manager_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'private audit fixture'; END $$;
        CREATE TRIGGER fail_manager_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW
        WHEN (NEW.action='ManagerApproved' OR NEW.action='ManagerRejected') EXECUTE FUNCTION technical.fail_manager_audit();`);
      try {
        await assert.rejects(coops.approve(adminId, id, { cooperative_id: coop.id }), status(503));
        assert.deepEqual(await coops.get(adminId, coop.id), original);
        await assert.rejects(coops.approve(adminId, id, { cooperative: input('AUDIT-NEW') }), status(503));
        await assert.rejects(coops.reject(adminId, id), status(503));
        assert.equal((await users.loadById(id))!.user.status, 'Pending'); assert.equal((await users.loadById(id))!.tokenVersion, 0);
        assert.equal((await sql.query("SELECT count(*) FROM public.cooperatives WHERE certificate_number='AUDIT-NEW'")).rows[0].count, '0');
      } finally { await sql.query('DROP TRIGGER fail_manager_audit ON technical.audit_events; DROP FUNCTION technical.fail_manager_audit()'); }
    });

    await t.test('HTTP real Users/email services register, approve and retain records/proofs correctly across fresh instances', async () => {
      let app = await application(users, management, new Map());
      let freshPool: Pool | undefined;
      const mails = new Map<string, string>();
      await app.close(); app = await application(users, management, mails);
      const http = async (path: string, method = 'POST', body?: object, token?: string) => fetch(`${await app.getUrl()}/api/${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const proof = async (phone: string, gmail: string) => {
        const issued = await http('auth/registration/email/request', 'POST', { phone_number: phone, gmail });
        assert.equal(issued.status, 202);
        const { verification_id } = await issued.json() as { verification_id: string };
        const verified = await http('auth/registration/email/verify', 'POST', { phone_number: phone, gmail, verification_id, otp: mails.get(gmail) });
        assert.equal(verified.status, 200); return (await verified.json() as { email_verification_token: string }).email_verification_token;
      };
      try {
        const adminLogin = await http('auth/login', 'POST', { phone_number: config.admin.phoneNumber, password: config.admin.password });
        assert.equal(adminLogin.status, 200); const adminToken = (await adminLogin.json() as { access_token: string }).access_token;
        const token = await proof('0900000070', 'httpmanager@example.invalid');
        const registration = { phone_number: '0900000070', user_name: 'HTTP Manager', gmail: 'httpmanager@example.invalid', role: 'Manager', password: 'HttpManagerFixture!', email_verification_token: token };
        const attempts = await Promise.all([http('auth/register', 'POST', registration), http('auth/register', 'POST', registration)]);
        assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 400]);
        const registered = await attempts.find((response) => response.status === 201)!.json() as { user: { id: string; status: string; password?: string } };
        assert.equal(registered.user.status, 'Pending'); assert.equal(registered.user.password, undefined);
        assert.equal((await http('auth/login', 'POST', { phone_number: registration.phone_number, password: registration.password })).status, 403);
        const reviewed = await http(`users/${registered.user.id}/approve`, 'PATCH', { cooperative: input('HTTP-COOP') }, adminToken);
        assert.equal(reviewed.status, 200); const approved = await reviewed.json() as { cooperative: { id: string } };
        assert.equal((await http('auth/login', 'POST', { phone_number: registration.phone_number, password: registration.password })).status, 200);
        const abandoned = await proof('0900000071', 'abandoned@example.invalid');
        await app.close(); freshPool = new Pool({ connectionString: `${postgresBase}/${name}`, connectionTimeoutMillis: 5000 });
        const freshUsers = new PostgresUsersRepository(freshPool);
        const freshCoops = new PostgresCooperativesRepository(freshPool, freshUsers);
        app = await application(freshUsers, new PostgresUserManagement(freshUsers, freshCoops), new Map());
        assert.equal((await http('auth/login', 'POST', { phone_number: registration.phone_number, password: registration.password })).status, 200);
        assert.equal((await freshUsers.loadById(registered.user.id))!.user.gmail_verify, true);
        assert.equal((await freshCoops.get(registered.user.id, approved.cooperative.id)).cooperative.manager_id, registered.user.id);
        assert.equal((await http('auth/register', 'POST', { ...registration, phone_number: '0900000071', gmail: 'abandoned@example.invalid', email_verification_token: abandoned })).status, 400);
        const directory = await http('users/cooperatives', 'GET', undefined, adminToken);
        assert.equal(directory.status, 200); assert.ok(!JSON.stringify(await directory.json()).includes('token_version'));
      } finally { await app.close(); await freshPool?.end(); }
    });

    await t.test('lifecycle preserves original deadlines through fresh repository, warns once and deletes atomically on day30', async () => {
      now = new Date('2026-01-01T00:00:00.000Z');
      const coop = await coops.create(adminId, input('DEADLINE'));
      now = new Date(now.getTime() + 7 * DAY - 1); await coops.sweep(adminId);
      assert.equal((await coops.notifications(adminId)).filter((item) => item.cooperative_id === coop.id).length, 0);
      now = new Date(now.getTime() + 1); await Promise.all([coops.sweep(adminId), coops.sweep(admin2)]);
      assert.equal((await coops.notifications(adminId)).filter((item) => item.cooperative_id === coop.id).length, 1);
      const fresh = new PostgresCooperativesRepository(sql, new PostgresUsersRepository(sql), () => now);
      assert.equal((await fresh.get(adminId, coop.id)).createdAt, '2026-01-01T00:00:00.000Z');
      now = new Date('2026-01-31T00:00:00.000Z'); await fresh.sweep(adminId);
      await assert.rejects(fresh.get(adminId, coop.id), status(404));
      const notifications = (await fresh.notifications(adminId)).filter((item) => item.cooperative_id === coop.id);
      assert.deepEqual(notifications.map((item) => item.type).sort(), ['CooperativeDeleted', 'ManagerMissing']);
      assert.equal(notifications[0].manager_deadline, '2026-01-31T00:00:00.000Z');
      await fresh.sweep(adminId); assert.equal((await fresh.notifications(adminId)).filter((item) => item.cooperative_id === coop.id).length, 2);
    });

    await t.test('Farm, terminal workflow snapshots and notifications block deletion without repeated alerts', async () => {
      now = new Date('2026-02-01T00:00:00.000Z');
      const farmCoop = await coops.create(adminId, input('FARM-BLOCKED'));
      const requestCoop = await coops.create(adminId, input('REQUEST-BLOCKED'));
      const noticeCoop = await coops.create(adminId, input('NOTICE-BLOCKED'));
      const farm = (await sql.query('SELECT id FROM public.farms WHERE owner_id=$1 LIMIT 1', [seed.primary_farmer_id])).rows[0].id;
      await sql.query('UPDATE public.farms SET cooperative_id=$1,join_cooperative_date=$2 WHERE id=$3', [farmCoop.id, now, farm]);
      await sql.query(`INSERT INTO technical.workflow_requests(module,action,status,requested_by,created_at,payload)
        VALUES ('farms','Leave','Accepted',$1,$2,$3)`, [seed.primary_farmer_id, now, JSON.stringify({ farm_snapshot: { cooperative_id: requestCoop.id } })]);
      await sql.query(`INSERT INTO technical.notifications(dedup_key,type,created_at,payload) VALUES ('fixture-farm-notice','FarmLeave',$1,$2)`,
        [now, JSON.stringify({ cooperative_id: noticeCoop.id })]);
      now = new Date('2026-03-03T00:00:00.000Z'); await coops.sweep(adminId); await coops.sweep(admin2);
      for (const coop of [farmCoop, requestCoop, noticeCoop]) {
        assert.equal((await coops.get(adminId, coop.id)).cooperative.manager_id, null);
        assert.deepEqual((await coops.notifications(adminId)).filter((item) => item.cooperative_id === coop.id).map((item) => item.type).sort(), ['DeletionBlocked', 'ManagerMissing']);
      }
      await assert.rejects(coops.notifications(seed.primary_farmer_id), status(403));
    });

    await t.test('lifecycle racing approval cannot leave an Active Manager without cooperative', async () => {
      now = new Date('2026-04-01T00:00:00.000Z'); const coop = await coops.create(adminId, input('LIFECYCLE-RACE'));
      const id = await manager(); now = new Date('2026-05-01T00:00:00.000Z');
      const results = await Promise.allSettled([coops.approve(adminId, id, { cooperative_id: coop.id }), coops.sweep(admin2)]);
      const account = (await users.loadById(id))!;
      if (account.user.status === 'Active') { assert.equal((await coops.get(adminId, coop.id)).cooperative.manager_id, id); }
      else { assert.equal(account.user.status, 'Pending'); await assert.rejects(coops.get(adminId, coop.id), status(404)); }
      assert.ok(results.some((result) => result.status === 'fulfilled'));
    });
  } finally {
    await pool?.end();
    if (created && /^sdf_persistence_test_[0-9a-f]{32}$/.test(name)) { await mongo.db(name).dropDatabase(); await adminPool.query(`DROP DATABASE "${name}"`); }
    await mongo.close(); await adminPool.end();
  }
});
