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
import { FarmRecords } from '../src/farms/farm-records';
import { StandardsModule } from '../src/standards/standards.module';
import { StandardRecords } from '../src/catalog/catalog-records';
import { ZonesModule } from '../src/zones/zones.module';
import { ZonesService } from '../src/zones/zones.service';
import { ZoneRecords } from '../src/zones/zone-records';
import { ZoneListDto } from '../src/zones/zones.dto';
import { ZoneChangeRequest } from '../src/zones/zones.types';
import { FarmRequestListDto } from '../src/farms/farms.dto';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { PostgresUserManagement } from '../src/persistence/postgres-user-management';
import { PostgresCooperativesRepository } from '../src/persistence/postgres-cooperatives.repository';
import { PostgresCatalogRepository } from '../src/persistence/postgres-catalog.repository';
import { PostgresFarmsRepository } from '../src/persistence/postgres-farms.repository';
import { PostgresZonesRepository } from '../src/persistence/postgres-zones.repository';
import { MIGRATIONS, runMigrations } from '../src/persistence/migrations';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';

const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const config = {
  mode: 'mock' as const,
  phoneNumber: '0900000000',
  password: 'ZoneFixturePassword!',
  jwtSecret: 'zone-fixture-secret-at-least-32-bytes',
  sms: { provider: 'mock' as const },
  admin: { phoneNumber: '0900000001', password: 'ZoneAdminFixture!' },
};
const farmDetails = {
  area_size: 1,
  address: 'Vườn Đắk Lắk',
  certificate_number: 'ZONE-FIXTURE',
  longitude: 108,
  latitude: 12,
};
const status = (expected: number) => (error: unknown) =>
  error instanceof HttpException && error.getStatus() === expected;

// Controllers chia sẻ một pool và các repositories; không dựng AppModule
// trộn PG Zone với consumers assignments/tree/MQTT còn RAM.
async function application(pool: Pool): Promise<INestApplication> {
  const users = new PostgresUsersRepository(pool),
    farms = new PostgresFarmsRepository(pool, users);
  const catalogs = new PostgresCatalogRepository(pool, users),
    registry = new PostgresCooperativesRepository(pool, users);
  const auth = AuthModule.forMock(config),
    userModule = UsersModule.forMock(config, auth);
  const module = await Test.createTestingModule({
    imports: [
      ZonesModule.forMock(auth, FarmsModule.forMock(auth, userModule), StandardsModule.forMock(auth)),
    ],
  })
    .overrideProvider(UserAccounts)
    .useValue(users)
    .overrideProvider(UserManagement)
    .useValue(new PostgresUserManagement(users, registry))
    .overrideProvider(FarmRecords)
    .useValue(farms)
    .overrideProvider(StandardRecords)
    .useValue(catalogs.standards)
    .overrideProvider(ZoneRecords)
    .useValue(new PostgresZonesRepository(pool, users, farms, catalogs))
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

test('PostgreSQL Zones persist official data, proposals and scope with parent Farm serialization', async (t) => {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({
    connectionString: `${postgresBase}/sdf_persistence_test`,
    connectionTimeoutMillis: 5000,
  });
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  let pool: Pool | undefined,
    created = false;
  try {
    await adminPool.query(`CREATE DATABASE "${name}"`);
    created = true;
    pool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 10, connectionTimeoutMillis: 5000 });
    const sql = pool;
    await mongo.connect();
    await t.test(
      'migration007 refuses duplicate Pending targets including UUID case, retaining both proposals',
      async () => {
        await runMigrations(sql, mongo.db(name), MIGRATIONS.slice(0, 6));
        const user = (
          await sql.query(`INSERT INTO public.users(user_name,phone_number,password,role,status)
        VALUES ('Migration fixture','0900000087','fixture-unused','Farmer','Active') RETURNING id`)
        ).rows[0].id;
        const rows = await sql.query(
          `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at)
        VALUES ('zones','Update','Pending',$1,$2,'{}',now()),('zones','Update','Pending',upper($1),$2,'{}',now()) RETURNING id`,
          [randomUUID(), user],
        );
        await assert.rejects(
          runMigrations(sql, mongo.db(name)),
          (error: unknown) => (error as { code: string }).code === '23505',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count,
          '6',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.workflow_requests')).rows[0].count,
          '2',
        );
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[1].id]);
        assert.deepEqual(await runMigrations(sql, mongo.db(name)), ['007_zone_workflow', '008_assignment_workflow', '009_tree_workflow', '010_harvest_workflow', '011_device_workflow']);
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[0].id]);
        await sql.query('DELETE FROM public.users WHERE id=$1', [user]);
      },
    );
    const seed = await seedDemo(
      sql,
      readSeedConfig({
        NODE_ENV: 'test',
        AUTH_TEST_PHONE: config.phoneNumber,
        AUTH_TEST_PASSWORD: config.password,
        AUTH_TEST_ADMIN_PHONE: config.admin.phoneNumber,
        AUTH_TEST_ADMIN_PASSWORD: config.admin.password,
        DEMO_DEVICE_STATION_ID: 'ZONE_TEST_ESP32',
        DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00',
        DEMO_DEVICE_COST: '10237500',
      }),
    );
    const users = new PostgresUsersRepository(sql);
    let now = new Date('2026-10-14T02:00:00.000Z');
    const farms = new PostgresFarmsRepository(sql, users, () => now),
      catalogs = new PostgresCatalogRepository(sql, users, () => now);
    const zones = new PostgresZonesRepository(sql, users, farms, catalogs, () => now),
      registry = new PostgresCooperativesRepository(sql, users, () => now);
    const admin = (await users.loadByPhone(config.admin.phoneNumber))!.user.id;
    const hash = (await users.loadById(admin))!.user.password;
    const admin2 = (
      await sql.query(
        `INSERT INTO public.users(user_name,phone_number,password,role,status)
      VALUES ('Second Admin','0900000099',$1,'Admin','Active') RETURNING id`,
        [hash],
      )
    ).rows[0].id as string;
    await sql.query(
      `INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('users',$1,'{"token_version":0}')`,
      [admin2],
    );
    let next = 10;
    const farmer = async () => {
      const phone = `09000000${next++}`;
      const account = await users.createRegisteredUser({
        user_name: 'Farmer fixture',
        phone_number: phone,
        gmail: null,
        passwordHash: hash,
        role: 'Farmer',
      });
      return { id: account.user.id, phone };
    };
    const cooperative = async () => {
      const index = next++,
        phone = `09000000${index}`,
        gmail = `manager${index}@example.invalid`;
      const account = await users.createRegisteredUser(
        { user_name: 'Manager fixture', phone_number: phone, gmail, passwordHash: hash, role: 'Manager' },
        gmail,
      );
      const result = await registry.approve(admin, account.user.id, {
        cooperative: {
          cooperative_name: 'HTX thử nghiệm',
          director: 'Ban quản trị',
          certificate_number: `ZONE-COOP-${index}`,
          address: 'Đắk Lắk',
          contact_number: phone,
        },
      });
      return { manager: account.user.id, id: result.cooperative.id, phone };
    };
    const standard = await catalogs.standards.create(admin, {
      code: 'ZONE-STD',
      name: 'VietGAP fixture',
      description: '',
      certifying_body: 'Fixture',
    });
    const fixture = async (area = 1) => {
      const owner = await farmer(),
        request = await farms.createRequest(owner.id, { ...farmDetails, area_size: area });
      const farm = (await farms.approve(admin, request.id)).farm_id!;
      const input = {
        farm_id: farm,
        standard_id: standard.id,
        zone_name: 'Khu sầu riêng',
        area_size: 0.3,
        longitude: 108.1234567,
        latitude: 12.7654321,
      };
      return { owner, farm, input };
    };
    const metadata = async (type: string, id: string) =>
      (
        await sql.query(
          'SELECT version,data FROM technical.entity_metadata WHERE entity_type=$1 AND entity_key=$2',
          [type, id],
        )
      ).rows[0];

    await t.test(
      'owner writes directly, Admin only proposes and owner reviews each proposal once',
      async () => {
        const f = await fixture(),
          other = await farmer();
        await assert.rejects(zones.create(admin, f.input), status(403));
        await assert.rejects(zones.create(other.id, f.input), status(403));
        await assert.rejects(zones.createRequest(f.owner.id, f.input), status(403));
        const zone = await zones.create(f.owner.id, f.input);
        assert.equal(zone.area_size, 0.3);
        assert.equal(zone.longitude, f.input.longitude);
        assert.deepEqual(
          Object.keys(zone).sort(),
          ['id', 'farm_id', 'standard_id', 'zone_name', 'area_size', 'longitude', 'latitude'].sort(),
        );
        const r = await zones.updateRequest(admin, zone.id, { zone_name: 'Khu được đề xuất' });
        assert.deepEqual(await zones.get(f.owner.id, zone.id), zone);
        await assert.rejects(zones.approve(admin2, r.id), status(403));
        await assert.rejects(zones.approve(other.id, r.id), status(403));
        const accepted = await zones.approve(f.owner.id, r.id);
        assert.equal(accepted.resolved_by, f.owner.id);
        assert.equal(accepted.resolved_at, now.toISOString());
        assert.equal((await zones.get(admin, zone.id)).zone_name, 'Khu được đề xuất');
        assert.equal((await metadata('zones', zone.id)).version, '2');
        await assert.rejects(zones.approve(f.owner.id, r.id), status(409));
        const created = await zones.createRequest(admin2, { ...f.input, area_size: 0.1 });
        assert.equal(created.zone_id, null);
        const done = await zones.approve(f.owner.id, created.id);
        assert.equal(done.status, 'Accepted');
        assert.ok(done.zone_id);
        assert.equal((await zones.getRequest(admin, done.id)).zone_id, done.zone_id);
      },
    );

    await t.test(
      'one Pending update slot, concurrent owner edits make proposal stale, rejection releases slot',
      async () => {
        const f = await fixture(),
          zone = await zones.create(f.owner.id, f.input);
        const attempts = await Promise.allSettled([
          zones.updateRequest(admin, zone.id, { zone_name: 'A' }),
          zones.updateRequest(admin2, zone.id, { zone_name: 'B' }),
        ]);
        assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
        assert.ok(attempts.some((r) => r.status === 'rejected' && status(409)(r.reason)));
        const r = (
          attempts.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<ZoneChangeRequest>
        ).value;
        await zones.update(f.owner.id, zone.id, { zone_name: 'Chủ tự sửa' });
        await assert.rejects(zones.approve(f.owner.id, r.id), status(409));
        const rejected = await zones.reject(f.owner.id, r.id, '🌱'.repeat(500));
        assert.equal(rejected.rejection_reason, '🌱'.repeat(500));
        assert.equal((await zones.get(admin, zone.id)).zone_name, 'Chủ tự sửa');
        assert.equal((await zones.updateRequest(admin, zone.id, { zone_name: 'Mới' })).status, 'Pending');
      },
    );

    await t.test(
      'Pending Create does not reserve area; approval rechecks capacity and exact 0.001 units',
      async () => {
        const f = await fixture(0.1);
        const a = await zones.createRequest(admin, { ...f.input, area_size: 0.06 });
        const b = await zones.createRequest(admin, { ...f.input, area_size: 0.06 });
        await zones.approve(f.owner.id, a.id);
        await assert.rejects(zones.approve(f.owner.id, b.id), status(409));
        assert.equal((await zones.getRequest(admin, b.id)).status, 'Pending');
        await zones.create(f.owner.id, { ...f.input, area_size: 0.039 });
        await zones.create(f.owner.id, { ...f.input, area_size: 0.001 });
        await assert.rejects(zones.create(f.owner.id, { ...f.input, area_size: 0.001 }), status(409));
      },
    );

    await t.test(
      'concurrent Zone inserts and accepted Farm shrink share parent lock and never overbook',
      async () => {
        const f = await fixture(0.1);
        const inserts = await Promise.allSettled([
          zones.create(f.owner.id, { ...f.input, area_size: 0.06 }),
          zones.create(f.owner.id, { ...f.input, area_size: 0.06 }),
        ]);
        assert.equal(inserts.filter((r) => r.status === 'fulfilled').length, 1);
        assert.ok(inserts.some((r) => r.status === 'rejected' && status(409)(r.reason)));
        const shrink = await farms.updateRequest(f.owner.id, f.farm, { area_size: 0.06 });
        const racing = await Promise.allSettled([
          farms.approve(admin, shrink.id),
          zones.create(f.owner.id, { ...f.input, area_size: 0.03 }),
        ]);
        assert.equal(racing.filter((r) => r.status === 'fulfilled').length, 1);
        assert.ok(racing.some((r) => r.status === 'rejected' && status(409)(r.reason)));
        const budget = await sql.query(
          'SELECT f.area_size,COALESCE(sum(z.area_size),0) AS used FROM public.farms f LEFT JOIN public.zones z ON z.farm_id=f.id WHERE f.id=$1 GROUP BY f.id',
          [f.farm],
        );
        assert.ok(Number(budget.rows[0].used) <= Number(budget.rows[0].area_size));
      },
    );

    await t.test(
      'Inactive standards remain on old links, but newly attached standards recheck at approval',
      async () => {
        const f = await fixture();
        const local = await catalogs.standards.create(admin, {
          code: 'INACTIVE-ZONE',
          name: 'Legacy standard',
          description: '',
          certifying_body: 'Fixture',
        });
        const zone = await zones.create(f.owner.id, { ...f.input, standard_id: local.id });
        const create = await zones.createRequest(admin, { ...f.input, standard_id: local.id });
        await catalogs.standards.update(admin, local.id, { status: 'Inactive' });
        await assert.rejects(zones.approve(f.owner.id, create.id), status(409));
        assert.equal(
          (await zones.update(f.owner.id, zone.id, { zone_name: 'Giữ tiêu chuẩn cũ' })).standard_id,
          local.id,
        );
        await assert.rejects(zones.create(f.owner.id, { ...f.input, standard_id: local.id }), status(409));
        await assert.rejects(zones.update(f.owner.id, zone.id, { standard_id: randomUUID() }), status(404));
      },
    );

    await t.test(
      'Manager sees only current cooperative Zones; Join and Leave immediately update read scope',
      async () => {
        const f = await fixture(),
          c = await cooperative(),
          c2 = await cooperative();
        const zone = await zones.create(f.owner.id, f.input);
        await assert.rejects(zones.get(c.manager, zone.id), status(404));
        const join = await farms.joinRequest(f.owner.id, f.farm, c.id);
        await farms.approve(admin, join.id);
        await farms.approve(c.manager, join.id);
        assert.equal((await zones.get(c.manager, zone.id)).id, zone.id);
        await assert.rejects(zones.get(c2.manager, zone.id), status(404));
        await assert.rejects(zones.update(c.manager, zone.id, { zone_name: 'Denied' }), status(403));
        await assert.rejects(
          zones.getRequest(
            c.manager,
            (await zones.updateRequest(admin, zone.id, { zone_name: 'Proposal' })).id,
          ),
          status(404),
        );
        const leave = await farms.leaveRequest(f.owner.id, f.farm);
        await farms.approve(admin, leave.id);
        await assert.rejects(zones.get(c.manager, zone.id), status(404));
      },
    );

    await t.test(
      'only Accepted assignment within [start,end) grants Zone read, never Farm read or write',
      async () => {
        const f = await fixture(),
          worker = await farmer(),
          zone = await zones.create(f.owner.id, f.input);
        const start = now.toISOString(),
          end = new Date(now.getTime() + 60000).toISOString();
        const assignment = (
          await sql.query(
            'INSERT INTO public.users_zones(user_id,zone_id,start_date,end_date) VALUES ($1,$2,$3,$4) RETURNING id',
            [worker.id, zone.id, start, end],
          )
        ).rows[0].id;
        await assert.rejects(zones.get(worker.id, zone.id), status(404));
        const accepted = { accepted_at: start, zone_snapshot: zone };
        await sql.query(
          "INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('users_zones',$1,$2)",
          [assignment, JSON.stringify(accepted)],
        );
        assert.equal((await zones.get(worker.id, zone.id)).id, zone.id);
        assert.equal((await zones.list(worker.id, new ZoneListDto())).total, 1);
        await assert.rejects(farms.get(worker.id, f.farm), status(404));
        await assert.rejects(zones.update(worker.id, zone.id, { zone_name: 'Denied' }), status(403));
        await sql.query(
          "UPDATE technical.entity_metadata SET data=jsonb_set(data,'{zone_snapshot,id}',to_jsonb($2::text)) WHERE entity_type='users_zones' AND entity_key=$1",
          [assignment, randomUUID()],
        );
        await assert.rejects(zones.get(worker.id, zone.id), status(404));
        await sql.query(
          "UPDATE technical.entity_metadata SET data=$2 WHERE entity_type='users_zones' AND entity_key=$1",
          [assignment, JSON.stringify(accepted)],
        );
        now = new Date(end);
        await assert.rejects(zones.get(worker.id, zone.id), status(404));
        now = new Date(start);
      },
    );

    await t.test(
      'review rechecks Admin active status; rejection can clear stale or revoked proposals',
      async () => {
        const f = await fixture(),
          zone = await zones.create(f.owner.id, f.input);
        const r = await zones.updateRequest(admin2, zone.id, { zone_name: 'Revoked proposer' });
        await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [admin2]);
        try {
          await assert.rejects(zones.approve(f.owner.id, r.id), status(403));
          assert.equal((await zones.getRequest(admin, r.id)).status, 'Pending');
          assert.equal((await zones.reject(f.owner.id, r.id)).status, 'Rejected');
        } finally {
          await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [admin2]);
        }
        await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.owner.id]);
        try {
          await assert.rejects(zones.get(f.owner.id, zone.id), status(403));
        } finally {
          await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [f.owner.id]);
        }
      },
    );

    await t.test('audit failure rolls back Zone, request, version and approval together', async () => {
      const f = await fixture(),
        zone = await zones.create(f.owner.id, f.input);
      const r = await zones.updateRequest(admin, zone.id, { zone_name: 'Rollback' });
      const before = await metadata('zones', zone.id),
        requestBefore = await metadata('zone_requests', r.id);
      await sql.query(`CREATE FUNCTION technical.fail_zone_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.entity_type='zones' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_zone_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW EXECUTE FUNCTION technical.fail_zone_audit()`);
      try {
        await assert.rejects(zones.approve(f.owner.id, r.id), status(503));
        await assert.rejects(zones.create(f.owner.id, f.input), status(503));
        assert.deepEqual(await zones.get(admin, zone.id), zone);
        assert.equal((await zones.list(f.owner.id, new ZoneListDto())).total, 1);
        assert.equal((await zones.getRequest(admin, r.id)).status, 'Pending');
        assert.deepEqual(await metadata('zones', zone.id), before);
        assert.deepEqual(await metadata('zone_requests', r.id), requestBefore);
      } finally {
        await sql.query(
          'DROP TRIGGER fail_zone_audit ON technical.audit_events; DROP FUNCTION technical.fail_zone_audit()',
        );
      }
      await zones.approve(f.owner.id, r.id);
      assert.equal(
        (
          await sql.query(
            "SELECT count(*) FROM technical.audit_events WHERE entity_type='zones' AND entity_key=$1 AND action='ZoneUpdated'",
            [zone.id],
          )
        ).rows[0].count,
        '1',
      );
    });

    await t.test(
      'strict DTOs, decimals, canonical UUIDs and no-op rejection apply outside controllers too',
      async () => {
        const f = await fixture(),
          zone = await zones.create(f.owner.id, f.input);
        for (const invalid of [
          { area_size: 0 },
          { area_size: 0.0001 },
          { longitude: 1.12345678 },
          { latitude: 91 },
          { standard_id: null },
          { farm_id: f.farm },
          { status: 'Accepted' },
        ]) {
          await assert.rejects(zones.update(f.owner.id, zone.id, invalid as never), status(400));
        }
        await assert.rejects(zones.update(f.owner.id, zone.id, {}), status(400));
        await assert.rejects(zones.updateRequest(admin, zone.id, { zone_name: zone.zone_name }), status(400));
        await assert.rejects(zones.create(f.owner.id, null as never), status(400));
        await assert.rejects(
          zones.list(admin, Object.assign(new ZoneListDto(), { limit: 101 })),
          status(400),
        );
        const canonical = await zones.update(f.owner.id.toUpperCase(), zone.id.toUpperCase(), {
          standard_id: standard.id.toUpperCase(),
          zone_name: 'Canonical',
        });
        assert.equal(canonical.standard_id, standard.id);
        assert.equal(await metadata('zones', zone.id.toUpperCase()), undefined);
      },
    );

    await t.test(
      'scoped pages use literal search and retain totals beyond last page, snapshots cannot mutate persisted state',
      async () => {
        const f = await fixture(),
          other = await farmer(),
          zone = await zones.create(f.owner.id, { ...f.input, zone_name: "KHU 100%_O'Brien" });
        const page = await zones.list(
          f.owner.id,
          Object.assign(new ZoneListDto(), { q: "%_o'BRIEN", offset: 500 }),
        );
        assert.equal(page.total, 1);
        assert.deepEqual(page.items, []);
        assert.equal((await zones.list(other.id, new ZoneListDto())).total, 0);
        await assert.rejects(zones.get(other.id, zone.id), status(404));
        const r = await zones.updateRequest(admin, zone.id, { zone_name: 'Snapshot proposal' });
        r.zone_snapshot!.zone_name = 'Caller mutation';
        assert.equal((await zones.getRequest(admin, r.id)).zone_snapshot!.zone_name, zone.zone_name);
        const filtered = await zones.listRequests(
          f.owner.id,
          Object.assign(new FarmRequestListDto(), { status: 'Pending', offset: 500 }),
        );
        assert.equal(filtered.total, 1);
        assert.deepEqual(filtered.items, []);
        assert.equal((await zones.listRequests(other.id, new FarmRequestListDto())).total, 0);
      },
    );

    await t.test(
      'missing/unsafe metadata and malformed request fail closed and leave official data unchanged',
      async () => {
        const f = await fixture(),
          zone = await zones.create(f.owner.id, f.input);
        await sql.query(
          "UPDATE technical.entity_metadata SET version=9007199254740991 WHERE entity_type='zones' AND entity_key=$1",
          [zone.id],
        );
        await assert.rejects(zones.update(f.owner.id, zone.id, { zone_name: 'Overflow' }), status(503));
        assert.deepEqual(await zones.get(admin, zone.id), zone);
        await sql.query(
          "UPDATE technical.entity_metadata SET version=1 WHERE entity_type='zones' AND entity_key=$1",
          [zone.id],
        );
        const r = await zones.updateRequest(admin, zone.id, { zone_name: 'Malformed proposal' });
        const payload = (
          await sql.query('SELECT payload FROM technical.workflow_requests WHERE id=$1', [r.id])
        ).rows[0].payload;
        await sql.query(
          'UPDATE technical.workflow_requests SET payload=jsonb_set(payload,\'{proposed_changes}\',\'{"farm_id":"invalid"}\') WHERE id=$1',
          [r.id],
        );
        try {
          await assert.rejects(zones.getRequest(admin, r.id), status(503));
          await assert.rejects(zones.approve(f.owner.id, r.id), status(503));
          assert.deepEqual(await zones.get(admin, zone.id), zone);
        } finally {
          await sql.query('UPDATE technical.workflow_requests SET payload=$2 WHERE id=$1', [
            r.id,
            JSON.stringify(payload),
          ]);
        }
        await sql.query("DELETE FROM technical.entity_metadata WHERE entity_type='zones' AND entity_key=$1", [
          zone.id,
        ]);
        await assert.rejects(zones.get(admin, zone.id), status(503));
        await sql.query("INSERT INTO technical.entity_metadata(entity_type,entity_key) VALUES ('zones',$1)", [
          zone.id,
        ]);
      },
    );

    await t.test('waiting Zone writer rechecks revoked owner after user lock is released', async () => {
      const f = await fixture(),
        zone = await zones.create(f.owner.id, f.input);
      const waitingPool = new Pool({
        connectionString: `${postgresBase}/${name}`,
        max: 1,
        application_name: 'zone-owner-revocation',
        connectionTimeoutMillis: 5000,
      });
      const blocker = await sql.connect();
      let done: Promise<PromiseSettledResult<unknown>> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.owner.id]);
        const writer = new PostgresZonesRepository(
          waitingPool,
          new PostgresUsersRepository(waitingPool),
          farms,
          catalogs,
        );
        done = writer.update(f.owner.id, zone.id, { zone_name: 'Revoked owner write' }).then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason) => ({ status: 'rejected' as const, reason }),
        );
        const deadline = Date.now() + 5000;
        let blocked = false;
        while (Date.now() < deadline) {
          blocked = Boolean(
            (
              await sql.query(
                "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='zone-owner-revocation' AND wait_event_type='Lock'",
                [name],
              )
            ).rowCount,
          );
          if (blocked) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(blocked, true);
        await blocker.query('COMMIT');
        const result = await done;
        assert.ok(result.status === 'rejected' && status(403)(result.reason));
        assert.deepEqual(await zones.get(admin, zone.id), zone);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await done;
        await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [f.owner.id]);
        await waitingPool.end();
      }
    });

    await t.test(
      'standard share lock sees concurrent deactivation before a new attachment commits',
      async () => {
        const f = await fixture();
        const local = await catalogs.standards.create(admin, {
          code: 'ZONE-LOCK',
          name: 'Concurrent standard',
          description: '',
          certifying_body: 'Fixture',
        });
        const waitingPool = new Pool({
          connectionString: `${postgresBase}/${name}`,
          max: 1,
          application_name: 'zone-standard-recheck',
          connectionTimeoutMillis: 5000,
        });
        const blocker = await sql.connect();
        let done: Promise<PromiseSettledResult<unknown>> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query("UPDATE public.farming_standards SET status='Inactive' WHERE id=$1", [
            local.id,
          ]);
          const writer = new PostgresZonesRepository(
            waitingPool,
            new PostgresUsersRepository(waitingPool),
            farms,
            catalogs,
          );
          done = writer.create(f.owner.id, { ...f.input, standard_id: local.id }).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason) => ({ status: 'rejected' as const, reason }),
          );
          const deadline = Date.now() + 5000;
          let blocked = false;
          while (Date.now() < deadline) {
            blocked = Boolean(
              (
                await sql.query(
                  "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='zone-standard-recheck' AND wait_event_type='Lock'",
                  [name],
                )
              ).rowCount,
            );
            if (blocked) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(blocked, true);
          await blocker.query('COMMIT');
          const result = await done;
          assert.ok(result.status === 'rejected' && status(409)(result.reason));
          assert.equal((await zones.list(f.owner.id, new ZoneListDto())).total, 0);
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await done;
          await waitingPool.end();
        }
      },
    );

    await t.test(
      'competing approvals apply proposal once, increasing Zone and request versions only once',
      async () => {
        const f = await fixture(),
          zone = await zones.create(f.owner.id, f.input);
        const r = await zones.updateRequest(admin, zone.id, { zone_name: 'Accepted once' });
        const results = await Promise.allSettled([
          zones.approve(f.owner.id, r.id),
          zones.approve(f.owner.id, r.id),
        ]);
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        assert.ok(results.some((result) => result.status === 'rejected' && status(409)(result.reason)));
        assert.equal((await metadata('zones', zone.id)).version, '2');
        assert.equal((await metadata('zone_requests', r.id)).version, '2');
      },
    );

    await t.test(
      'fresh HTTP app and pool restore Zone plus pending/accepted proposal history, without memory store hydration',
      async () => {
        const f = await fixture(),
          zone = await zones.create(f.owner.id, f.input);
        const r = await zones.updateRequest(admin, zone.id, { zone_name: 'Restored proposal' });
        let app = await application(sql),
          freshPool: Pool | undefined;
        const http = async (path: string, method = 'GET', body?: object, token?: string) =>
          fetch(`${await app.getUrl()}/api/${path}`, {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        const login = async (phone: string) => {
          const response = await http('auth/login', 'POST', {
            phone_number: phone,
            password: config.admin.password,
          });
          assert.equal(response.status, 200);
          return ((await response.json()) as { access_token: string }).access_token;
        };
        try {
          assert.equal((await http('zones')).status, 401);
          const token = await login(f.owner.phone);
          assert.equal((await http(`zones/${zone.id}`, 'PATCH', { farm_id: f.farm }, token)).status, 400);
          await app.close();
          freshPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 5,
            connectionTimeoutMillis: 5000,
          });
          app = await application(freshPool);
          assert.throws(() => app.get(ZonesService).getRecord(zone.id), status(404));
          const ownerToken = await login(f.owner.phone);
          assert.equal((await http(`zones/${zone.id}`, 'GET', undefined, ownerToken)).status, 200);
          const pending = await http(`zone-requests/${r.id}`, 'GET', undefined, ownerToken);
          assert.equal(((await pending.json()) as ZoneChangeRequest).status, 'Pending');
          assert.equal((await http(`zone-requests/${r.id}/approve`, 'PATCH', {}, ownerToken)).status, 200);
          await app.close();
          app = await application(freshPool);
          const restored = await http(`zones/${zone.id}`, 'GET', undefined, await login(f.owner.phone));
          assert.equal(((await restored.json()) as { zone_name: string }).zone_name, 'Restored proposal');
          const history = await http(
            `zone-requests/${r.id}`,
            'GET',
            undefined,
            await login(config.admin.phoneNumber),
          );
          assert.equal(((await history.json()) as ZoneChangeRequest).status, 'Accepted');
        } finally {
          await app.close();
          await freshPool?.end();
        }
      },
    );

    assert.ok(seed.primary_farmer_id);
  } finally {
    await pool?.end();
    if (created && /^sdf_persistence_test_[0-9a-f]{32}$/.test(name)) {
      await mongo.db(name).dropDatabase();
      await adminPool.query(`DROP DATABASE "${name}"`);
    }
    await mongo.close();
    await adminPool.end();
  }
});
