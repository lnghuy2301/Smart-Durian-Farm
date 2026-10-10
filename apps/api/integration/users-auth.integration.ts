import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService } from '../src/auth/auth.service';
import { UserAccounts, publicUser } from '../src/auth/user-accounts';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { runMigrations } from '../src/persistence/migrations';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';

// Endpoints test cố định; không đọc .env, gửi SMS/email/MQTT hoặc sửa demo DB.
const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const config = { mode: 'mock' as const, phoneNumber: '0900000000', password: 'UsersAuthFixturePassword!',
  jwtSecret: 'users-auth-fixture-secret-at-least-32-bytes', sms: { provider: 'mock' as const } };
const status = (value: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === value;

async function authApplication(repository: PostgresUsersRepository): Promise<INestApplication> {
  // Chỉ dựng AuthModule: không khởi động AppModule với domain stores RAM rồi
  // gọi đó là database mode. Override thay alias Auth, không mở pool thứ hai.
  const module = await Test.createTestingModule({ imports: [AuthModule.forMock(config)] })
    .overrideProvider(UserAccounts).useValue(repository).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

test('PostgreSQL Users/Auth adapter, transactions and isolated HTTP restart', async (t) => {
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
    await runMigrations(sql, mongo.db(name));
    const seed = await seedDemo(sql, readSeedConfig({ NODE_ENV: 'test', AUTH_TEST_PHONE: config.phoneNumber, AUTH_TEST_PASSWORD: config.password,
      AUTH_TEST_ADMIN_PHONE: '0900000001', AUTH_TEST_ADMIN_PASSWORD: 'AdminFixturePassword!',
      DEMO_DEVICE_STATION_ID: 'USERS_TEST_ESP32', DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00', DEMO_DEVICE_COST: '10237500' }));
    const repository = new PostgresUsersRepository(sql);
    const passwordHash = await hashPassword('RegisteredFixturePassword!');
    let accountId = '';

    await t.test('seed accounts map persistent token version, UTC, ownership and detached snapshots', async () => {
      const original = (await repository.loadById(seed.primary_farmer_id))!;
      assert.equal(original.tokenVersion, 0);
      assert.equal(original.user.is_owner, true);
      assert.match(original.user.created_at, /Z$/);
      assert.equal((await repository.loadByPhone(config.phoneNumber))!.user.id, original.user.id);
      assert.equal(await repository.loadByPhone('+84900000000'), null, 'login still requires stored phone format');
      original.user.status = 'Locked';
      assert.equal((await repository.loadById(original.user.id))!.user.status, 'Active');
      assert.equal(await repository.loadById('malformed-uuid'), null);
      assert.equal(await repository.loadById(randomUUID()), null);
      assert.equal('password' in publicUser(original.user), false);
      assert.equal('metadata' in publicUser(original.user), false);
    });

    await t.test('registration enforces Farmer Active, verified Manager Pending, normalized nullable email and no public Admin', async () => {
      const farmer = await repository.createRegisteredUser({ user_name: 'Farmer mới', phone_number: '0900000002', gmail: null, passwordHash, role: 'Farmer' });
      accountId = farmer.user.id;
      assert.deepEqual([farmer.user.status, farmer.user.gmail, farmer.user.gmail_verify, farmer.user.is_owner, farmer.tokenVersion], ['Active', null, false, false, 0]);
      await assert.rejects(repository.createRegisteredUser({ user_name: 'Manager', phone_number: '0900000003', gmail: 'manager@example.invalid', passwordHash, role: 'Manager' }), status(400));
      const manager = await repository.createRegisteredUser({ user_name: 'Manager', phone_number: '0900000003', gmail: ' Manager@Example.invalid ', passwordHash, role: 'Manager' }, 'manager@example.invalid');
      assert.equal(manager.user.gmail_verify, true);
      assert.equal(manager.user.status, 'Pending');
      assert.equal((await repository.findByEmail(' MANAGER@example.invalid '))!.user.id, manager.user.id);
      assert.ok((await repository.pendingManagers()).some((user) => user.id === manager.user.id && !('password' in user)));
      await assert.rejects(repository.createRegisteredUser({ user_name: 'Admin', phone_number: '0900000004', gmail: null, passwordHash, role: 'Admin' as 'Farmer' }), status(400));
      await assert.rejects(repository.createRegisteredUser({ user_name: 'Plaintext', phone_number: '0900000004', gmail: null, passwordHash: 'plaintext', role: 'Farmer' }), status(400));
      await assert.rejects(repository.createRegisteredUser({ user_name: 'Wrong proof', phone_number: '0900000004', gmail: 'a@example.invalid', passwordHash, role: 'Farmer' }, 'b@example.invalid'), status(400));
      assert.equal((await sql.query("SELECT count(*) FROM public.users WHERE phone_number='0900000004'")).rows[0].count, '0');
    });

    await t.test('concurrent normalized phone/email duplicates yield one account, metadata and audit without private SQL errors', async () => {
      const results = await Promise.allSettled(['0900000004', '+84900000004', '84900000004'].map((phone_number) =>
        repository.createRegisteredUser({ user_name: 'Unique farmer', phone_number, gmail: null, passwordHash, role: 'Farmer' })));
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      for (const result of results) { if (result.status === 'rejected') {
        assert.ok(status(409)(result.reason));
        assert.ok(!String(result.reason).includes('0900000004'));
      } }
      const winner = results.find((result) => result.status === 'fulfilled');
      assert.ok(winner?.status === 'fulfilled');
      assert.equal((await sql.query("SELECT count(*) FROM technical.audit_events WHERE entity_type='users' AND entity_key=$1", [winner.value.user.id])).rows[0].count, '1');
      await assert.rejects(repository.assertAvailable('84900000002'), status(409));
      const emailResults = await Promise.allSettled(['0900000005', '0900000006'].map((phone_number) =>
        repository.createRegisteredUser({ user_name: 'Email farmer', phone_number, gmail: ' SAME@example.invalid ', passwordHash, role: 'Farmer' })));
      assert.equal(emailResults.filter((result) => result.status === 'fulfilled').length, 1);
      assert.ok(emailResults.some((result) => result.status === 'rejected' && status(409)(result.reason)));
    });

    await t.test('two password resets using same version commit only once and preserve other seed metadata/users', async () => {
      const hashes = await Promise.all(['ConcurrentFirst!', 'ConcurrentSecond!'].map(hashPassword));
      const results = await Promise.all(hashes.map((hash) => repository.replacePassword(seed.primary_farmer_id, 0, hash)));
      assert.deepEqual([...results].sort(), [false, true]);
      const user = (await repository.loadById(seed.primary_farmer_id))!;
      assert.equal(user.tokenVersion, 1);
      assert.equal(user.user.password, hashes[results.indexOf(true)]);
      const metadata = (await sql.query("SELECT data,version FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=$1", [user.user.id])).rows[0];
      assert.equal(metadata.version, '2');
      assert.equal(metadata.data.seed_key, 'durian-demo-v1:primary-farmer');
      assert.equal((await repository.loadById(accountId))!.tokenVersion, 0);
      assert.equal((await sql.query("SELECT count(*) FROM technical.audit_events WHERE entity_type='users' AND entity_key=$1 AND action='PasswordReset'", [user.user.id])).rows[0].count, '1');
      assert.equal(await repository.replacePassword(user.user.id, 0, passwordHash), false);
    });

    await t.test('audit failure rolls back new registration and password/version; no hash, OTP or contact stored in audit', async () => {
      const before = (await repository.loadById(accountId))!;
      await sql.query(`CREATE FUNCTION technical.test_reject_user_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'private-driver-fixture'; END $$;
        CREATE TRIGGER test_reject_user_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW
        WHEN (NEW.entity_type='users') EXECUTE FUNCTION technical.test_reject_user_audit();`);
      try {
        await assert.rejects(repository.replacePassword(accountId, 0, passwordHash), (error: unknown) => status(503)(error) && !String(error).includes('private-driver-fixture'));
        assert.deepEqual(await repository.loadById(accountId), before);
        await assert.rejects(repository.createRegisteredUser({ user_name: 'Rollback', phone_number: '0900000007', gmail: null, passwordHash, role: 'Farmer' }), status(503));
        assert.equal(await repository.loadByPhone('0900000007'), null);
      } finally { await sql.query('DROP TRIGGER test_reject_user_audit ON technical.audit_events; DROP FUNCTION technical.test_reject_user_audit()'); }
      const history = (await sql.query("SELECT payload FROM technical.audit_events WHERE entity_type='users'")).rows;
      for (const row of history) {
        assert.ok(!JSON.stringify(row).includes('scrypt$'));
        assert.deepEqual(Object.keys(row.payload).sort(), row.payload.role ? ['role', 'status'] : ['token_version']);
      }
    });

    await t.test('missing, invalid and overflowing revocation metadata fail closed; Locked accounts cannot reset', async () => {
      const saved = (await sql.query("SELECT data FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=$1", [accountId])).rows[0].data;
      await sql.query("DELETE FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=$1", [accountId]);
      await assert.rejects(repository.loadById(accountId), status(503));
      await assert.rejects(repository.replacePassword(accountId, 0, passwordHash), status(503));
      await sql.query("INSERT INTO technical.entity_metadata(entity_type,entity_key,version,data) VALUES ('users',$1,1,$2)", [accountId, JSON.stringify(saved)]);
      for (const broken of [{}, { token_version: '0' }, { token_version: -1 }, { token_version: 9007199254740992 }]) {
        await sql.query("UPDATE technical.entity_metadata SET data=$2 WHERE entity_type='users' AND entity_key=$1", [accountId, JSON.stringify(broken)]);
        await assert.rejects(repository.loadById(accountId), status(503));
        await assert.rejects(repository.replacePassword(accountId, 0, passwordHash), status(503));
      }
      await sql.query("UPDATE technical.entity_metadata SET data=$2 WHERE entity_type='users' AND entity_key=$1", [accountId, JSON.stringify(saved)]);
      const originalHash = (await repository.loadById(accountId))!.user.password;
      await sql.query("UPDATE public.users SET password='corrupt-fixture-hash' WHERE id=$1", [accountId]);
      await assert.rejects(repository.loadById(accountId), status(503));
      await sql.query('UPDATE public.users SET password=$1 WHERE id=$2', [originalHash, accountId]);
      await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [accountId]);
      assert.equal(await repository.replacePassword(accountId, 0, passwordHash), false);
      await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [accountId]);
    });

    await t.test('persistent statuses deny Pending/Reject login, Locked login and inactive JWTs', async () => {
      const app = await authApplication(repository);
      try {
        const auth = app.get(AuthService);
        for (const state of ['Pending', 'Reject', 'Locked']) {
          await sql.query('UPDATE public.users SET status=$1 WHERE id=$2', [state, accountId]);
          await assert.rejects(auth.login('0900000002', 'RegisteredFixturePassword!'), status(state === 'Locked' ? 401 : 403));
          const token = await app.get(JwtService).signAsync({ sub: accountId, version: 0 });
          await assert.rejects(auth.authenticate(token), status(401));
        }
        await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [accountId]);
      } finally { await app.close(); }
    });

    await t.test('Auth HTTP restart retains password/JWT revocation/verified email; unfinished OTP is discarded', async () => {
      let app = await authApplication(repository);
      let freshPool: Pool | undefined;
      const phone = '0900000002';
      const post = async (path: string, body: object) => fetch(`${await app.getUrl()}/api/auth/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const me = async (token: string) => fetch(`${await app.getUrl()}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      try {
        const login = await post('login', { phone_number: phone, password: 'RegisteredFixturePassword!' });
        assert.equal(login.status, 200);
        const first = await login.json() as { access_token: string; user: Record<string, unknown> };
        assert.equal(first.user.password, undefined);
        assert.equal(first.user.tokenVersion, undefined);
        assert.equal((await me(first.access_token)).status, 200);
        await post('forgot-password', { phone_number: phone });
        const code = app.get(AuthService).testSms(phone).messages[0].otp;
        const reset = { phone_number: phone, otp: code, new_password: 'PersistentResetFixture!' };
        const attempts = await Promise.all([post('reset-password', reset), post('reset-password', reset)]);
        assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 400]);
        assert.equal((await me(first.access_token)).status, 401);
        const changed = await post('login', { phone_number: phone, password: reset.new_password });
        assert.equal(changed.status, 200);
        const second = await changed.json() as { access_token: string };
        // OTP của user khác chưa hoàn tất, provider và service mới không giữ proof.
        await post('forgot-password', { phone_number: config.phoneNumber });
        const abandoned = app.get(AuthService).testSms(config.phoneNumber).messages[0].otp;
        await app.close();
        freshPool = new Pool({ connectionString: `${postgresBase}/${name}`, connectionTimeoutMillis: 5000 });
        app = await authApplication(new PostgresUsersRepository(freshPool));
        assert.equal((await me(first.access_token)).status, 401);
        assert.equal((await me(second.access_token)).status, 200);
        assert.equal((await post('login', { phone_number: phone, password: 'RegisteredFixturePassword!' })).status, 401);
        assert.equal((await post('login', { phone_number: phone, password: reset.new_password })).status, 200);
        assert.equal((await post('reset-password', { phone_number: config.phoneNumber, otp: abandoned, new_password: 'AbandonedFixture!' })).status, 400);
        assert.equal((await new PostgresUsersRepository(freshPool).findByEmail('manager@example.invalid'))!.user.gmail_verify, true);
        const invalidSubject = await app.get(JwtService).signAsync({ sub: 'invalid-uuid', version: 0 });
        assert.equal((await me(invalidSubject)).status, 401);
      } finally { await app.close(); await freshPool?.end(); }
    });

    await t.test('database unavailable fails 503 without RAM fallback or leaking driver credentials', async () => {
      const closed = new Pool({ connectionString: `${postgresBase}/${name}` });
      await closed.end();
      const offline = new PostgresUsersRepository(closed);
      await assert.rejects(offline.loadByPhone(config.phoneNumber), (error: unknown) => {
        assert.ok(status(503)(error));
        assert.ok(!String(error).includes('persistence_test'));
        return true;
      });
      assert.equal(await verifyPassword('RegisteredFixturePassword!', passwordHash), true);
    });
  } finally {
    await pool?.end();
    if (created && /^sdf_persistence_test_[0-9a-f]{32}$/.test(name)) {
      await mongo.db(name).dropDatabase();
      await admin.query(`DROP DATABASE "${name}"`);
    }
    await mongo.close();
    await admin.end();
  }
});
