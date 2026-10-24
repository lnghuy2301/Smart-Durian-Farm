import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule } from '../src/auth/auth.module';
import { AccountController, AccountService } from '../src/users/account.controller';
import { EmailSender } from '../src/users/email/email.sender';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { configureApplication } from '../src/application';
import { readEnvironment } from '../src/config/environment';
import { DatabaseCultivationRecords } from '../src/persistence/database-cultivation-records';
import { MongoCultivationStore } from '../src/persistence/mongo-cultivation.store';
import { LOCK_DELAY_MS } from '../src/cultivation-events/cultivation-events.types';
import { projectCultivation } from '../src/traceability/cultivation-projection';
import { createDatabaseBackup, restoreIntoEmptyDatabase, sealBackup, verifyBackup } from '../src/persistence/backup';
import { runMigrations } from '../src/persistence/migrations';
import { expandMaterialCatalog } from '../src/persistence/material-catalog-expansion';
import { taskPersistenceFixture, taskAuth, taskPgBase } from './helpers/task-persistence-fixture';

@Module({}) class AccountFixtureModule {}
test('PDF business changes persist profiles, normalized doses, private Other and legacy backups', async (t) => {
  const f = await taskPersistenceFixture();
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  const codes = new Map<string, string>();
  async function createApp() {
    const persistence = { module: AccountFixtureModule, providers: [{ provide: PostgresUsersRepository, useValue: f.users }], exports: [PostgresUsersRepository] };
    const module = await Test.createTestingModule({ imports: [AuthModule.forDatabase(taskAuth, persistence)], controllers: [AccountController],
      providers: [AccountService, { provide: EmailSender, useValue: { async sendVerification(email: string, otp: string) { codes.set(email, otp); } } }] }).compile();
    const result = module.createNestApplication({ logger: false });
    configureApplication(result, readEnvironment({ NODE_ENV: 'test', AUTH_MODE: 'mock', AUTH_TEST_PHONE: taskAuth.phoneNumber, AUTH_TEST_PASSWORD: taskAuth.password,
      JWT_SECRET: taskAuth.jwtSecret, DATABASE_URL: `${taskPgBase}/${f.name}`, MONGODB_URI: `mongodb://127.0.0.1:27028/${f.name}?replicaSet=rs-test&directConnection=true` }));
    await result.listen(0, '127.0.0.1'); return result;
  }
  const http = async (path: string, method = 'GET', body?: object, token?: string) => fetch(`${await app!.getUrl()}/api/${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async (phone: string, password: string) => {
    const response = await http('auth/login', 'POST', { phone_number: phone, password }); assert.equal(response.status, 200);
    return (await response.json() as { access_token: string }).access_token;
  };
  try {
    const baseline = await createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name));
    await t.test('backup from revision014 restores its archived schema then upgrades without changing old values', async () => {
      const legacy = structuredClone(baseline);
      legacy.migrations = legacy.migrations.slice(0, 14);
      const material = legacy.postgres.find((table) => table.name === 'public.agricultural_materials')!;
      const retained = material.columns.filter((column) => !['default_dosage_value', 'dosage_basis'].includes(column));
      material.rows = material.rows.map((row) => { const parsed = JSON.parse(row); return JSON.stringify(Object.fromEntries(retained.map((key) => [key, parsed[key]]))); }).sort();
      material.columns = retained;
      const archive = verifyBackup(sealBackup(legacy));
      const name = `sdf_restore_${randomUUID().replaceAll('-', '')}`;
      let target: Pool | undefined;
      await f.pool.query(`CREATE DATABASE "${name}"`);
      try {
        target = new Pool({ connectionString: `${taskPgBase}/${name}` });
        await restoreIntoEmptyDatabase(target, f.mongo, f.mongo.db(name), archive);
        assert.equal((await createDatabaseBackup(target, f.mongo, f.mongo.db(name))).data_sha256, archive.data_sha256);
        assert.deepEqual(await runMigrations(target, f.mongo.db(name)), ['015_cultivation_other', '016_material_dosage']);
        assert.equal((await target.query('SELECT count(*)::int AS count FROM public.agricultural_materials WHERE default_dosage_value IS NOT NULL')).rows[0].count, 0);
      } finally { await target?.end(); await f.mongo.db(name).dropDatabase(); await f.pool.query(`DROP DATABASE "${name}"`); }
    });
    app = await createApp();
    const primary = (await f.users.loadByPhone(taskAuth.phoneNumber))!;
    let token = await login('+84900000000', taskAuth.password);
    await t.test('PG profile changes use the shared user authority and survive fresh app construction', async () => {
      const renamed = await http('account/profile', 'PATCH', { user_name: 'Nguyễn Văn Hòa' }, token); assert.equal(renamed.status, 200);
      assert.equal((await f.users.loadById(primary.user.id))!.user.user_name, 'Nguyễn Văn Hòa');
      assert.equal((await f.users.loadById(primary.user.id))!.tokenVersion, primary.tokenVersion);
      const issued = await http('account/email/request', 'POST', { gmail: 'verified@pdf.invalid' }, token); assert.equal(issued.status, 202);
      const proof = await issued.json();
      assert.equal((await f.users.loadById(primary.user.id))!.user.gmail, null);
      const verified = await http('account/email/verify', 'POST', { verification_id: proof.verification_id, otp: codes.get('verified@pdf.invalid') }, token);
      assert.equal(verified.status, 200);
      await app!.close(); app = await createApp();
      const profile = await http('account/profile', 'GET', undefined, token);
      assert.equal(profile.status, 200); const user = await profile.json(); assert.equal(user.gmail, 'verified@pdf.invalid'); assert.equal(user.gmail_verify, true);
    });
    await t.test('email commit rechecks the original address under row lock instead of accepting a stale proof context', async () => {
      const current = (await f.users.loadById(primary.user.id))!;
      const input = { expectedEmail: current.user.gmail, expectedPhone: current.user.phone_number };
      const results = await Promise.all([
        f.users.updateProfile(primary.user.id, current.tokenVersion, { ...input, verifiedEmail: 'first-context@pdf.invalid' }),
        f.users.updateProfile(primary.user.id, current.tokenVersion, { ...input, verifiedEmail: 'second-context@pdf.invalid' }),
      ]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.notEqual((await f.users.loadById(primary.user.id))!.user.gmail, current.user.gmail);
    });
    await t.test('concurrent email proofs cannot attach the same email to two database accounts', async () => {
      const other = await f.farmer(), otherToken = await login(other.phone, taskAuth.admin.password);
      const issue = async (jwt: string) => { const response = await http('account/email/request', 'POST', { gmail: 'unique@pdf.invalid' }, jwt); assert.equal(response.status, 202); return { ...(await response.json()), otp: codes.get('unique@pdf.invalid') }; };
      const one = await issue(token), two = await issue(otherToken);
      const responses = await Promise.all([http('account/email/verify', 'POST', { verification_id: one.verification_id, otp: one.otp }, token), http('account/email/verify', 'POST', { verification_id: two.verification_id, otp: two.otp }, otherToken)]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      assert.equal((await f.pool.query("SELECT count(*)::int AS count FROM public.users WHERE gmail='unique@pdf.invalid'")).rows[0].count, 1);
    });
    await t.test('PG password change accepts an alias, requires its own OTP and revokes persisted JWT versions', async () => {
      assert.equal((await http('account/password/request', 'POST', { current_password: taskAuth.password }, token)).status, 202);
      const auth = app!.get((await import('../src/auth/auth.service')).AuthService);
      const otp = auth.testSms(taskAuth.phoneNumber).messages[0].otp;
      assert.equal((await http('account/password/confirm', 'POST', { current_password: taskAuth.password, otp, new_password: 'PdfPersistentNew123!' }, token)).status, 200);
      assert.equal((await http('auth/refresh', 'POST', {}, token)).status, 401);
      token = await login('+84900000000', 'PdfPersistentNew123!');
    });
    let now = Date.now();
    const store = new MongoCultivationStore(f.mongo, f.mongo.db(f.name), () => now);
    const cultivation = new DatabaseCultivationRecords(f.pool, f.users, f.farms, f.zones, f.trees, f.assignments, f.catalogs, store, () => now);
    const device = (await f.pool.query("SELECT id,zone_id FROM public.devices WHERE station_id='TASK_FIXTURE_ONLY'")).rows[0];
    const oldMaterial = (await f.catalogs.materials.list(f.admin, { limit: 100, offset: 0, status: 'Active' })).items[0];
    const original = await cultivation.create(primary.user.id, { target_type: 'Zone', target_id: device.zone_id, action_type: 'Fertilizing', details: { materials: [{ material_id: oldMaterial.id, quantity: 1 }] } });
    now += LOCK_DELAY_MS; await store.lockDue();
    const locked = await cultivation.get(primary.user.id, original._id);
    await t.test('catalog expansion normalizes only initialization rows, is idempotent and preserves Locked snapshots/hashes', async () => {
      const before = await createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name));
      const result = await expandMaterialCatalog(f.pool); assert.equal(result.inserted, 12); assert.equal(result.normalized, 5);
      const after = await createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name));
      assert.deepEqual(after.mongo, before.mongo);
      for (const table of before.postgres.filter((table) => !['public.agricultural_materials', 'technical.entity_metadata', 'technical.audit_events'].includes(table.name))) assert.deepEqual(after.postgres.find((entry) => entry.name === table.name), table);
      assert.deepEqual(await cultivation.get(primary.user.id, original._id), locked);
      assert.equal((await cultivation.verify(primary.user.id, device.zone_id)).valid, true);
      // Lazy verification reads may advance the Mongo ledger. Measure the
      // rerun boundary after those checks, not before them.
      const stable = (await createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name))).data_sha256;
      assert.equal((await expandMaterialCatalog(f.pool)).inserted, 0);
      assert.equal((await createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name))).data_sha256, stable);
    });
    await t.test('numeric doses enforce database pairs and new snapshots preserve normalized values after catalog edits', async () => {
      const material = await f.catalogs.materials.create(f.admin, { name: 'Vật tư có liều số', material_type: 'Fertilizer', default_dosage_value: 2.5, dosage_basis: 'cây/lần', unit: 'kg', quarantine_days: 0 });
      await assert.rejects(f.pool.query('UPDATE public.agricultural_materials SET dosage_basis=NULL WHERE id=$1', [material.id]));
      const event = await cultivation.create(primary.user.id, { target_type: 'Zone', target_id: device.zone_id, action_type: 'Fertilizing', details: { materials: [{ material_id: material.id, quantity: 1 }] } });
      assert.equal(event.details.materials![0].default_dosage_value, 2.5);
      await f.catalogs.materials.update(f.admin, material.id, { default_dosage_value: 3 });
      assert.equal((await cultivation.get(primary.user.id, event._id)).details.materials![0].default_dosage_value, 2.5);
    });
    await t.test('Other persists, locks and corrects with original authority while public QR hides both free text fields', async () => {
      const event = await cultivation.create(primary.user.id, { target_type: 'Zone', target_id: device.zone_id, action_type: 'Other', details: { activity_name: 'PRIVATE-ACTIVITY', note: 'PRIVATE-NOTE' } });
      now += LOCK_DELAY_MS; await store.lockDue();
      const read = await cultivation.get(primary.user.id, event._id); assert.equal(read.status, 'Locked');
      const publicRecords = projectCultivation([read], randomUUID(), device.zone_id, 'Khu vực', () => 'TREE-CODE');
      assert(!JSON.stringify(publicRecords).includes('PRIVATE-'));
      assert.equal(publicRecords[0].action_type, 'Other');
      await cultivation.correct(primary.user.id, event._id, { target_type: 'Zone', target_id: device.zone_id, action_type: 'Other', details: { activity_name: 'Tên đính chính' }, correction_reason: 'Sửa tên' });
      assert.equal((await cultivation.get(primary.user.id, event._id)).hash, read.hash);
      assert.equal((await cultivation.verify(primary.user.id, device.zone_id)).valid, true);
    });
  } finally { await app?.close(); await f.close(); }
});
