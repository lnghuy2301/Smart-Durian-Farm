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
import { FarmsModule } from '../src/farms/farms.module';
import { FarmsService } from '../src/farms/farms.service';
import { FarmRecords } from '../src/farms/farm-records';
import { FarmChangeRequest } from '../src/farms/farms.types';
import { FarmListDto, FarmPageDto, FarmRequestListDto } from '../src/farms/farms.dto';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { PostgresCooperativesRepository } from '../src/persistence/postgres-cooperatives.repository';
import { PostgresUserManagement } from '../src/persistence/postgres-user-management';
import { PostgresFarmsRepository } from '../src/persistence/postgres-farms.repository';
import { MIGRATIONS, runMigrations } from '../src/persistence/migrations';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';
import { inPostgresTransaction } from '../src/persistence/transactions';

const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const config = { mode: 'mock' as const, phoneNumber: '0900000000', password: 'FarmFixturePassword!',
  jwtSecret: 'farm-fixture-secret-at-least-32-bytes', sms: { provider: 'mock' as const },
  admin: { phoneNumber: '0900000001', password: 'FarmAdminFixture!' } };
const details = { area_size: 3, address: 'Vườn kiểm thử tại Đắk Lắk', certificate_number: 'FARM-FIXTURE', longitude: 108.1234567, latitude: 12.7654321 };
const status = (expected: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === expected;

async function application(pool: Pool): Promise<INestApplication> {
  const users = new PostgresUsersRepository(pool), registry = new PostgresCooperativesRepository(pool, users);
  const auth = AuthModule.forMock(config), userModule = UsersModule.forMock(config, auth);
  // Isolated Auth/Users/Farm controllers; no Zone RAM/MQTT/AppModule mix.
  const module = await Test.createTestingModule({ imports: [FarmsModule.forMock(auth, userModule)] })
    .overrideProvider(UserAccounts).useValue(users)
    .overrideProvider(UserManagement).useValue(new PostgresUserManagement(users, registry))
    .overrideProvider(FarmRecords).useValue(new PostgresFarmsRepository(pool, users)).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); return app;
}

test('PostgreSQL Farm workflow, durable signatures/history and transaction scopes', async (t) => {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString: `${postgresBase}/sdf_persistence_test`, connectionTimeoutMillis: 5000 });
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  let pool: Pool | undefined, created = false;
  try {
    await adminPool.query(`CREATE DATABASE "${name}"`); created = true;
    pool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 10, connectionTimeoutMillis: 5000 });
    const sql = pool; await mongo.connect();
    await t.test('migration005 rejects duplicate Pending targets without changing earlier schemas/history', async () => {
      await runMigrations(sql, mongo.db(name), MIGRATIONS.slice(0, 4));
      const user = (await sql.query(`INSERT INTO public.users(user_name,phone_number,password,role,status)
        VALUES ('Migration fixture','0900000087','fixture-not-used-for-login','Farmer','Active') RETURNING id`)).rows[0].id;
      const rows = await sql.query(`INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at)
        VALUES ('farms','Update','Pending',$1,$2,'{}',now()),('farms','Leave','Pending',upper($1),$2,'{}',now()) RETURNING id`, [randomUUID(), user]);
      await assert.rejects(runMigrations(sql, mongo.db(name)), (error: unknown) => (error as { code: string }).code === '23505');
      assert.equal((await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count, '4');
      assert.equal((await sql.query('SELECT count(*) FROM technical.workflow_requests')).rows[0].count, '2');
      await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[1].id]);
      assert.deepEqual(await runMigrations(sql, mongo.db(name)), ['005_farm_workflow', '006_sensor_types', '007_zone_workflow']);
      await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[0].id]);
      await sql.query('DELETE FROM public.users WHERE id=$1', [user]);
    });
    const seed = await seedDemo(sql, readSeedConfig({ NODE_ENV: 'test', AUTH_TEST_PHONE: config.phoneNumber, AUTH_TEST_PASSWORD: config.password,
      AUTH_TEST_ADMIN_PHONE: config.admin.phoneNumber, AUTH_TEST_ADMIN_PASSWORD: config.admin.password,
      DEMO_DEVICE_STATION_ID: 'FARM_TEST_ESP32', DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00', DEMO_DEVICE_COST: '10237500' }));
    const users = new PostgresUsersRepository(sql);
    let now = new Date('2026-10-11T02:00:00.000Z');
    const farms = new PostgresFarmsRepository(sql, users, () => now), registry = new PostgresCooperativesRepository(sql, users, () => now);
    const admin = (await users.loadByPhone(config.admin.phoneNumber))!.user.id;
    const hash = (await users.loadById(admin))!.user.password;
    const admin2 = (await sql.query(`INSERT INTO public.users(user_name,phone_number,password,role,status)
      VALUES ('Second Admin fixture','0900000099',$1,'Admin','Active') RETURNING id`, [hash])).rows[0].id as string;
    await sql.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('users',$1,'{"token_version":0}')`, [admin2]);
    let n = 10;
    const farmer = async () => {
      const index = n++, phone = `09000000${index}`;
      const user = await users.createRegisteredUser({ user_name: 'Farmer fixture', phone_number: phone, gmail: null, passwordHash: hash, role: 'Farmer' });
      return { id: user.user.id, phone };
    };
    const cooperative = async () => {
      const index = n++, gmail = `manager${index}@example.invalid`, phone = `09000000${index}`;
      const user = await users.createRegisteredUser({ user_name: 'Manager fixture', phone_number: phone, gmail, passwordHash: hash, role: 'Manager' }, gmail);
      const approved = await registry.approve(admin, user.user.id, { cooperative: { cooperative_name: 'HTX fixture', director: 'Ban quản trị', certificate_number: `COOP-${index}`, address: 'Đắk Lắk', contact_number: phone } });
      return { id: approved.cooperative.id, manager: user.user.id, phone };
    };
    const fixture = async () => {
      const owner = await farmer(), request = await farms.createRequest(owner.id, details);
      const accepted = await farms.approve(admin, request.id);
      return { owner, id: accepted.farm_id!, request: accepted };
    };
    const meta = async (table: string, id: string) => (await sql.query('SELECT version,data FROM technical.entity_metadata WHERE entity_type=$1 AND entity_key=$2', [table, id])).rows[0];
    const pending = async (id: string) => { const r = await farms.getRequest(admin, id); assert.equal(r.status, 'Pending'); return r; };

    await t.test('Create waits for opposite signature, updates is_owner atomically without revoking JWT, and rejects self/repeat', async () => {
      const owner = await farmer(), before = await meta('users', owner.id);
      const request = await farms.createRequest(owner.id, details);
      assert.equal(request.farm_id, null); assert.equal((await users.loadById(owner.id))!.user.is_owner, false);
      await assert.rejects(farms.approve(owner.id, request.id), status(403));
      await assert.rejects(farms.reject(owner.id, request.id), status(403));
      const accepted = await farms.approve(admin, request.id);
      assert.equal(accepted.status, 'Accepted'); assert.ok(accepted.farm_id);
      const farm = await farms.get(owner.id, accepted.farm_id!);
      assert.equal(farm.cooperative_id, null); assert.equal(farm.join_cooperative_date, null); assert.equal(farm.area_size, 3);
      const account = (await users.loadById(owner.id))!;
      assert.equal(account.user.is_owner, true); assert.equal(account.tokenVersion, 0);
      assert.equal(Number((await meta('users', owner.id)).version), Number(before.version) + 1);
      await assert.rejects(farms.approve(admin2, request.id), status(409));
      const duplicate = await farms.createRequest(owner.id, details);
      assert.notEqual((await farms.approve(admin2, duplicate.id)).farm_id, accepted.farm_id, 'Farm certificates are not UNIQUE');
    });

    await t.test('Admin Create requires explicit Active Farmer and owner signature; decimals stay JSON numbers', async () => {
      const owner = await farmer();
      await assert.rejects(farms.createRequest(admin, details), status(400));
      await assert.rejects(farms.createRequest(seed.primary_farmer_id, { ...details, owner_id: owner.id }), status(403));
      const r = await farms.createRequest(admin, { ...details, owner_id: owner.id, area_size: 0.001, longitude: 180, latitude: -90 });
      await assert.rejects(farms.approve(admin2, r.id), status(403));
      const accepted = await farms.approve(owner.id, r.id), farm = await farms.get(owner.id, accepted.farm_id!);
      assert.equal(farm.area_size, 0.001); assert.equal(farm.longitude, 180); assert.equal(farm.latitude, -90);
      assert.deepEqual(Object.keys(farm).sort(), ['id','owner_id','cooperative_id','area_size','address','certificate_number','join_cooperative_date','longitude','latitude'].sort());
    });

    await t.test('Pending proposals race for one slot, rejection releases it and keeps official data/version', async () => {
      const f = await fixture(), before = await farms.get(admin, f.id), version = await meta('farms', f.id);
      const attempts = await Promise.allSettled([farms.updateRequest(f.owner.id, f.id, { address: 'Farmer proposal' }), farms.updateRequest(admin, f.id, { address: 'Admin proposal' })]);
      assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
      assert.ok(attempts.some((r) => r.status === 'rejected' && status(409)(r.reason)));
      const request = (attempts.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<FarmChangeRequest>).value;
      assert.deepEqual(await farms.get(admin, f.id), before);
      const rejected = await farms.reject(request.proposed_role === 'Admin' ? f.owner.id : admin, request.id, 'Không đồng ý');
      assert.equal(rejected.status, 'Rejected'); assert.equal(rejected.rejection_reason, 'Không đồng ý');
      assert.deepEqual(await farms.get(admin, f.id), before); assert.deepEqual(await meta('farms', f.id), version);
      const next = await farms.updateRequest(f.owner.id, f.id, { address: '  Địa chỉ được duyệt  ' });
      await farms.approve(admin, next.id);
      assert.equal((await farms.get(f.owner.id, f.id)).address, 'Địa chỉ được duyệt');
      assert.equal((await farms.get(f.owner.id, f.id)).area_size, before.area_size);
    });

    await t.test('Farmer Join concurrent Admin/Manager signatures both succeed and membership applies exactly once', async () => {
      const f = await fixture(), c = await cooperative();
      const r = await farms.joinRequest(f.owner.id, f.id, c.id);
      await assert.rejects(farms.get(c.manager, f.id), status(404));
      assert.equal((await farms.getRequest(c.manager, r.id)).farm_snapshot!.id, f.id);
      const results = await Promise.all([farms.approve(admin, r.id), farms.approve(c.manager, r.id)]);
      assert.deepEqual(results.map((item) => item.status).sort(), ['Accepted', 'Pending']);
      const official = await farms.get(c.manager, f.id);
      assert.equal(official.cooperative_id, c.id); assert.equal(official.join_cooperative_date, now.toISOString());
      assert.equal((await sql.query("SELECT count(*) FROM technical.audit_events WHERE entity_type='farms' AND entity_key=$1 AND action='FarmJoinApplied'", [f.id])).rows[0].count, '1');
      await assert.rejects(farms.approve(c.manager, r.id), status(409));
      await assert.rejects(farms.joinRequest(f.owner.id, f.id, c.id), status(409));
    });

    await t.test('Admin Join needs owner and pinned Manager; other Farmers/Managers cannot read or decide', async () => {
      const f = await fixture(), c = await cooperative(), other = await cooperative();
      const r = await farms.joinRequest(admin, f.id, c.id);
      await assert.rejects(farms.approve(admin, r.id), status(403));
      await assert.rejects(farms.approve(other.manager, r.id), status(403));
      await assert.rejects(farms.getRequest(other.manager, r.id), status(404));
      await assert.rejects(farms.getRequest(seed.primary_farmer_id, r.id), status(404));
      assert.equal((await farms.approve(c.manager, r.id)).status, 'Pending');
      assert.equal((await farms.get(admin, f.id)).cooperative_id, null);
      assert.equal((await farms.approve(f.owner.id, r.id)).status, 'Accepted');
      await assert.rejects(farms.updateRequest(c.manager, f.id, { address: 'Forbidden' }), status(403));
      await assert.rejects(farms.updateRequest(seed.primary_farmer_id, f.id, { address: 'Forbidden' }), status(403));
    });

    await t.test('Leave only needs counterpart, preserves Locked Manager notification once and removes live read scope', async () => {
      const f = await fixture(), c = await cooperative();
      const join = await farms.joinRequest(f.owner.id, f.id, c.id); await farms.approve(admin, join.id); await farms.approve(c.manager, join.id);
      const leave = await farms.leaveRequest(f.owner.id, f.id);
      await assert.rejects(farms.approve(c.manager, leave.id), status(403));
      await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [c.manager]);
      try {
        assert.equal((await farms.approve(admin, leave.id)).status, 'Accepted');
        assert.equal((await farms.get(f.owner.id, f.id)).cooperative_id, null);
        assert.equal((await farms.get(f.owner.id, f.id)).join_cooperative_date, null);
        await assert.rejects(farms.approve(admin2, leave.id), status(409));
        await assert.rejects(farms.listNotifications(c.manager, new FarmPageDto()), status(403));
      } finally { await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [c.manager]); }
      const list = await farms.listNotifications(c.manager, new FarmPageDto());
      assert.equal(list.total, 1); assert.equal(list.items[0].request_id, leave.id);
      assert.equal((await meta('farms', f.id)).version, '3');
      await assert.rejects(farms.get(c.manager, f.id), status(404));
      assert.equal((await farms.getRequest(c.manager, join.id)).status, 'Accepted');
      await assert.rejects(farms.listNotifications(admin, new FarmPageDto()), status(403));
      await assert.rejects(farms.leaveRequest(f.owner.id, f.id), status(409));
    });

    await t.test('owner/proposer revocation leaves Pending signatures unchanged, then can continue after restore', async () => {
      const f = await fixture(), r = await farms.updateRequest(admin, f.id, { address: 'Needs owner' });
      await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [admin]);
      try { await assert.rejects(farms.approve(f.owner.id, r.id), status(409)); }
      finally { await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [admin]); }
      assert.equal((await pending(r.id)).required_approvals[0].approved_by, null);
      await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.owner.id]);
      try { await assert.rejects(farms.approve(f.owner.id, r.id), status(403)); }
      finally { await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [f.owner.id]); }
      assert.equal((await farms.approve(f.owner.id, r.id)).status, 'Accepted');
    });

    await t.test('final signature rechecks earlier approver and current Manager; failed final never writes its signature', async () => {
      const f = await fixture(), c = await cooperative(), r = await farms.joinRequest(f.owner.id, f.id, c.id);
      await farms.approve(admin, r.id);
      await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [admin]);
      try { await assert.rejects(farms.approve(c.manager, r.id), status(409)); }
      finally { await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [admin]); }
      assert.equal((await pending(r.id)).required_approvals[1].approved_by, null);
      await sql.query('UPDATE public.cooperatives SET manager_id=NULL WHERE id=$1', [c.id]);
      try {
        await assert.rejects(farms.approve(c.manager, r.id), status(403));
        await assert.rejects(farms.getRequest(c.manager, r.id), status(404));
      } finally { await sql.query('UPDATE public.cooperatives SET manager_id=$2 WHERE id=$1', [c.id, c.manager]); }
      assert.equal((await farms.approve(c.manager, r.id)).status, 'Accepted');
    });

    await t.test('stale version blocks approval but unsigned reviewer may reject and release slot', async () => {
      const f = await fixture(), r = await farms.updateRequest(f.owner.id, f.id, { address: 'Stale proposal' });
      await sql.query('UPDATE public.farms SET address=$2 WHERE id=$1', [f.id, 'External fixture edit']);
      await sql.query("UPDATE technical.entity_metadata SET version=version+1 WHERE entity_type='farms' AND entity_key=$1", [f.id]);
      await assert.rejects(farms.approve(admin, r.id), status(409));
      assert.equal((await pending(r.id)).required_approvals[0].approved_by, null);
      assert.equal((await farms.reject(admin, r.id)).status, 'Rejected');
      assert.equal((await farms.get(admin, f.id)).address, 'External fixture edit');
    });

    const activeStandard = (await sql.query("SELECT id FROM public.farming_standards WHERE status='Active' ORDER BY id LIMIT 1")).rows[0].id as string;
    const addZone = (farmId: string, area: number) => inPostgresTransaction(sql, async (client) => {
      await client.query('SELECT id FROM public.farms WHERE id=$1 FOR UPDATE', [farmId]);
      await client.query(`INSERT INTO public.zones(farm_id,standard_id,zone_name,area_size,longitude,latitude)
        VALUES ($1,$2,'Zone area fixture',$3,108,12)`, [farmId, activeStandard, area]);
    });
    await t.test('area shrink sums live Zones after Farm lock and rolls back approval on insufficient area', async () => {
      const f = await fixture(); await addZone(f.id, 1.2); await addZone(f.id, 1.8);
      const r = await farms.updateRequest(f.owner.id, f.id, { area_size: 2 });
      await assert.rejects(farms.approve(admin, r.id), status(409));
      assert.equal((await farms.get(admin, f.id)).area_size, 3);
      assert.equal((await pending(r.id)).required_approvals[0].approved_by, null);
      await farms.reject(admin, r.id);
      const next = await farms.updateRequest(f.owner.id, f.id, { area_size: 3.5 }); await farms.approve(admin, next.id);
      assert.equal((await farms.get(admin, f.id)).area_size, 3.5);
    });

    await t.test('Zone insertion racing shrink cannot commit total area above Farm', async () => {
      const f = await fixture(); await addZone(f.id, 1.5);
      const r = await farms.updateRequest(f.owner.id, f.id, { area_size: 2 });
      const results = await Promise.allSettled([farms.approve(admin, r.id), addZone(f.id, 1)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const values = (await sql.query('SELECT f.area_size::text AS area,(SELECT sum(z.area_size)::text FROM public.zones z WHERE z.farm_id=f.id) AS used FROM public.farms f WHERE id=$1', [f.id])).rows[0];
      assert.ok(Number(values.used) <= Number(values.area));
      const state = await farms.getRequest(admin, r.id);
      assert.equal(state.status, results[0].status === 'fulfilled' ? 'Accepted' : 'Pending');
    });

    await t.test('audit failure rolls back new Farm/is_owner/signatures and Leave data/notification', async () => {
      const owner = await farmer(), create = await farms.createRequest(owner.id, details), f = await fixture(), c = await cooperative();
      const join = await farms.joinRequest(f.owner.id, f.id, c.id); await farms.approve(admin, join.id); await farms.approve(c.manager, join.id);
      const leave = await farms.leaveRequest(f.owner.id, f.id), before = await farms.get(admin, f.id);
      const count = (await sql.query('SELECT count(*) FROM public.farms')).rows[0].count;
      await sql.query(`CREATE FUNCTION technical.fail_farm_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'private farm audit details'; END $$;
        CREATE TRIGGER fail_farm_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW
        WHEN (NEW.entity_type IN ('farms','farm_requests') OR NEW.action='FarmOwnershipGranted') EXECUTE FUNCTION technical.fail_farm_audit();`);
      try {
        await assert.rejects(farms.createRequest(owner.id, details), status(503));
        await assert.rejects(farms.approve(admin, create.id), (error: unknown) => status(503)(error) && !String(error).includes('private farm'));
        assert.equal((await users.loadById(owner.id))!.user.is_owner, false); assert.equal((await pending(create.id)).farm_id, null);
        assert.equal((await sql.query('SELECT count(*) FROM public.farms')).rows[0].count, count);
        await assert.rejects(farms.approve(admin, leave.id), status(503));
        assert.deepEqual(await farms.get(admin, f.id), before);
        assert.equal((await pending(leave.id)).required_approvals[0].approved_by, null);
        assert.equal((await farms.listNotifications(c.manager, new FarmPageDto())).total, 0);
      } finally { await sql.query('DROP TRIGGER fail_farm_audit ON technical.audit_events; DROP FUNCTION technical.fail_farm_audit()'); }
      assert.equal((await farms.approve(admin, leave.id)).status, 'Accepted');
    });

    await t.test('DTO/precision/whitelist/null, UUID casing and empty/no-change proposals are enforced outside HTTP', async () => {
      const f = await fixture();
      for (const input of [{ area_size: 0 }, { area_size: 1.2345 }, { latitude: 90.0000001 }, { longitude: '108' }, { address: null }, { owner_id: f.owner.id }, { status: 'Accepted' }]) {
        await assert.rejects(farms.updateRequest(f.owner.id, f.id, input as never), status(400));
      }
      await assert.rejects(farms.updateRequest(f.owner.id, f.id, {}), status(400));
      await assert.rejects(farms.updateRequest(f.owner.id, f.id, { address: details.address }), status(400));
      await assert.rejects(farms.createRequest(f.owner.id, null as never), status(400));
      await assert.rejects(farms.list(admin, Object.assign(new FarmListDto(), { limit: 101 })), status(400));
      await assert.rejects(farms.get(admin, 'invalid'), status(400));
      const r = await farms.updateRequest(f.owner.id.toUpperCase(), f.id.toUpperCase(), { address: 'Canonical UUID' });
      await farms.approve(admin.toUpperCase(), r.id.toUpperCase());
      assert.equal((await meta('farms', f.id)).version, '2'); assert.equal(await meta('farms', f.id.toUpperCase()), undefined);
      const unicode = await farms.updateRequest(f.owner.id, f.id, { address: 'Unicode rejection' });
      const reason = '🌱'.repeat(500);
      await farms.reject(admin, unicode.id, reason);
      assert.equal((await farms.getRequest(admin, unicode.id)).rejection_reason, reason);
    });

    await t.test('scoped pages search literal text, keep total beyond last page and do not expose live references', async () => {
      const f = await fixture(), c = await cooperative();
      const r = await farms.updateRequest(f.owner.id, f.id, { address: "VƯỜN 100%_O'Brien" }); await farms.approve(admin, r.id);
      const page = await farms.list(f.owner.id, Object.assign(new FarmListDto(), { q: "%_o'bRIEN", offset: 500 }));
      assert.equal(page.total, 1); assert.deepEqual(page.items, []);
      assert.equal((await farms.list(c.manager, new FarmListDto())).total, 0);
      await assert.rejects(farms.get(seed.primary_farmer_id, f.id), status(404));
      const snapshot = await farms.getRequest(admin, r.id); snapshot.farm_snapshot!.address = 'Caller mutation';
      assert.equal((await farms.getRequest(admin, r.id)).farm_snapshot!.address, details.address);
      const filtered = await farms.listRequests(f.owner.id, Object.assign(new FarmRequestListDto(), { status: 'Accepted', limit: 1, offset: 500 }));
      assert.equal(filtered.total, 2); assert.deepEqual(filtered.items, []);
    });

    await t.test('fresh HTTP app/pool retain first Join signature, completed Farm/User state and notifications', async () => {
      const f = await fixture(), c = await cooperative(), r = await farms.joinRequest(f.owner.id, f.id, c.id);
      await farms.approve(admin, r.id);
      let app = await application(sql), freshPool: Pool | undefined;
      const http = async (path: string, method = 'GET', body?: object, token?: string) => fetch(`${await app.getUrl()}/api/${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const login = async (phone: string) => {
        const response = await http('auth/login', 'POST', { phone_number: phone, password: config.admin.password }); assert.equal(response.status, 200);
        return (await response.json() as { access_token: string }).access_token;
      };
      try {
        const adminToken = await login(config.admin.phoneNumber);
        assert.equal((await http('farms')).status, 401);
        assert.equal((await http(`farms/${f.id}/update-requests`, 'POST', { status: 'Accepted' }, adminToken)).status, 400);
        assert.equal((await http(`farm-requests/${r.id}/approve`, 'PATCH', { approved_by: admin }, adminToken)).status, 400);
        assert.equal((await http('farms/not-uuid', 'GET', undefined, adminToken)).status, 400);
        await app.close(); freshPool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 5, connectionTimeoutMillis: 5000 });
        app = await application(freshPool);
        assert.throws(() => app.get(FarmsService).getRecord(f.id), status(404), 'unused memory store is empty');
        const managerToken = await login(c.phone), ownerToken = await login(f.owner.phone);
        const pendingResponse = await http(`farm-requests/${r.id}`, 'GET', undefined, managerToken);
        const restored = await pendingResponse.json() as FarmChangeRequest;
        assert.equal(restored.status, 'Pending'); assert.equal(restored.required_approvals[0].approved_by, admin);
        assert.equal((await http(`farm-requests/${r.id}/approve`, 'PATCH', {}, managerToken)).status, 200);
        assert.equal((await http(`farms/${f.id}`, 'GET', undefined, managerToken)).status, 200);
        const leaveResponse = await http(`farms/${f.id}/leave-requests`, 'POST', {}, ownerToken);
        assert.equal(leaveResponse.status, 201); const leave = await leaveResponse.json() as FarmChangeRequest;
        assert.equal((await http(`farm-requests/${leave.id}/approve`, 'PATCH', {}, await login(config.admin.phoneNumber))).status, 200);
        await app.close(); app = await application(freshPool);
        const notification = await http('farm-notifications', 'GET', undefined, await login(c.phone));
        assert.equal((await notification.json() as { total: number }).total, 1);
        assert.equal((await http(`farms/${f.id}`, 'GET', undefined, await login(c.phone))).status, 404);
      } finally { await app.close(); await freshPool?.end(); }
    });

    await t.test('waiting approval rechecks revoked actor and competing Admins apply only once after restore', async () => {
      const f = await fixture(), r = await farms.updateRequest(f.owner.id, f.id, { address: 'Approved once' });
      const waitingPool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 1, application_name: 'farm-revocation-fixture', connectionTimeoutMillis: 5000 });
      const blocker = await sql.connect();
      let done: Promise<PromiseSettledResult<unknown>> | undefined;
      try {
        await blocker.query('BEGIN'); await blocker.query("UPDATE public.users SET status='Locked' WHERE id=$1", [admin2]);
        const waiter = new PostgresFarmsRepository(waitingPool, new PostgresUsersRepository(waitingPool));
        done = waiter.approve(admin2, r.id).then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }));
        const deadline = Date.now() + 5000;
        let blocked = false;
        while (Date.now() < deadline) {
          blocked = Boolean((await sql.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='farm-revocation-fixture' AND wait_event_type='Lock'", [name])).rowCount);
          if (blocked) { break; } await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(blocked, true); await blocker.query('COMMIT');
        const result = await done; assert.ok(result.status === 'rejected' && status(403)(result.reason));
        assert.equal((await pending(r.id)).required_approvals[0].approved_by, null);
      } finally {
        await blocker.query('ROLLBACK'); blocker.release(); await done;
        await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [admin2]); await waitingPool.end();
      }
      const decisions = await Promise.allSettled([farms.approve(admin, r.id), farms.approve(admin2, r.id)]);
      assert.equal(decisions.filter((result) => result.status === 'fulfilled').length, 1);
      assert.ok(decisions.some((result) => result.status === 'rejected' && status(409)(result.reason)));
      assert.equal((await farms.get(admin, f.id)).address, 'Approved once');
      assert.equal((await meta('farms', f.id)).version, '2');
    });

    await t.test('unsafe version and malformed persisted request fail closed without changing official data/signatures', async () => {
      const f = await fixture(), before = await farms.get(admin, f.id), version = await meta('farms', f.id);
      await sql.query("UPDATE technical.entity_metadata SET version=9007199254740991 WHERE entity_type='farms' AND entity_key=$1", [f.id]);
      const r = await farms.updateRequest(f.owner.id, f.id, { address: 'Overflow proposal' });
      await assert.rejects(farms.approve(admin, r.id), status(503));
      assert.deepEqual(await farms.get(admin, f.id), before); assert.equal((await pending(r.id)).required_approvals[0].approved_by, null);
      await sql.query("UPDATE technical.entity_metadata SET version=$2 WHERE entity_type='farms' AND entity_key=$1", [f.id, version.version]);
      await farms.reject(admin, r.id);
      const next = await farms.updateRequest(f.owner.id, f.id, { address: 'Valid proposal' });
      const payload = (await sql.query('SELECT payload FROM technical.workflow_requests WHERE id=$1', [next.id])).rows[0].payload;
      await sql.query("UPDATE technical.workflow_requests SET payload=jsonb_set(payload,'{proposed_changes}','{\"owner_id\":\"invalid\"}') WHERE id=$1", [next.id]);
      try {
        await assert.rejects(farms.getRequest(admin, next.id), status(503)); await assert.rejects(farms.approve(admin, next.id), status(503));
        assert.deepEqual(await farms.get(admin, f.id), before);
      } finally { await sql.query('UPDATE technical.workflow_requests SET payload=$2 WHERE id=$1', [next.id, JSON.stringify(payload)]); }
    });

    await t.test('historical rejected Join blocks unmanaged cooperative cleanup after Farm remains independent', async () => {
      const f = await fixture(), c = await cooperative(), r = await farms.joinRequest(f.owner.id, f.id, c.id);
      await farms.reject(admin, r.id);
      await sql.query('UPDATE public.cooperatives SET manager_id=NULL WHERE id=$1', [c.id]);
      now = new Date('2026-11-15T02:00:00.000Z');
      const sweep = await registry.sweep(admin);
      assert.ok(sweep.blocked >= 1); assert.equal((await registry.get(admin, c.id)).cooperative.id, c.id);
      assert.equal((await farms.get(admin, f.id)).cooperative_id, null);
      assert.equal((await farms.getRequest(admin, r.id)).status, 'Rejected');
      now = new Date('2026-10-11T02:00:00.000Z');
    });
  } finally {
    await pool?.end();
    if (created && /^sdf_persistence_test_[0-9a-f]{32}$/.test(name)) { await mongo.db(name).dropDatabase(); await adminPool.query(`DROP DATABASE "${name}"`); }
    await mongo.close(); await adminPool.end();
  }
});
