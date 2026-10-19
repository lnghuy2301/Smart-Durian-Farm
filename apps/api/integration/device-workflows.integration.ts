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
import { ZoneRecords } from '../src/zones/zone-records';
import { TreesModule } from '../src/trees/trees.module';
import { TreeRecords } from '../src/trees/tree-records';
import { DevicesModule } from '../src/devices/devices.module';
import { DeviceRecords } from '../src/devices/device-records';
import { DevicesService } from '../src/devices/devices.service';
import { DeviceListDto } from '../src/devices/devices.dto';
import { TestDevice } from '../src/devices/devices.types';
import { FarmPageDto, FarmRequestListDto } from '../src/farms/farms.dto';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { PostgresUserManagement } from '../src/persistence/postgres-user-management';
import { PostgresCooperativesRepository } from '../src/persistence/postgres-cooperatives.repository';
import { PostgresCatalogRepository } from '../src/persistence/postgres-catalog.repository';
import { PostgresFarmsRepository } from '../src/persistence/postgres-farms.repository';
import { PostgresZonesRepository } from '../src/persistence/postgres-zones.repository';
import { PostgresAssignmentsRepository } from '../src/persistence/postgres-assignments.repository';
import { PostgresTreesRepository } from '../src/persistence/postgres-trees.repository';
import { PostgresDevicesRepository } from '../src/persistence/postgres-devices.repository';
import { MIGRATIONS, runMigrations } from '../src/persistence/migrations';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';

const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const config = {
  mode: 'mock' as const,
  phoneNumber: '0900000000',
  password: 'DeviceFixturePassword!',
  jwtSecret: 'device-fixture-secret-at-least-32-bytes',
  sms: { provider: 'mock' as const },
  admin: { phoneNumber: '0900000001', password: 'DeviceAdminFixture!' },
};
const details = { installed_at: '2026-09-01T08:30:00+07:00', cost: 10237500.25 };
const page = new FarmPageDto();
const status = (code: number) => (error: unknown) =>
  error instanceof HttpException && error.getStatus() === code;

async function application(pool: Pool): Promise<INestApplication> {
  const users = new PostgresUsersRepository(pool),
    farms = new PostgresFarmsRepository(pool, users),
    catalogs = new PostgresCatalogRepository(pool, users),
    registry = new PostgresCooperativesRepository(pool, users);
  const zones = new PostgresZonesRepository(pool, users, farms, catalogs),
    trees = new PostgresTreesRepository(pool, users, farms, zones),
    auth = AuthModule.forMock(config),
    userModule = UsersModule.forMock(config, auth),
    farmModule = FarmsModule.forMock(auth, userModule),
    zoneModule = ZonesModule.forMock(auth, farmModule, StandardsModule.forMock(auth)),
    treeModule = TreesModule.forMock(auth, farmModule, zoneModule);
  const module = await Test.createTestingModule({
    imports: [DevicesModule.forMock(auth, farmModule, zoneModule, treeModule)],
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
    .useValue(zones)
    .overrideProvider(TreeRecords)
    .useValue(trees)
    .overrideProvider(DeviceRecords)
    .useValue(new PostgresDevicesRepository(pool, users, farms, zones, trees))
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

test('PostgreSQL Device metadata preserves immutable hardware identity, presence, approvals and scoped access', async (t) => {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`,
    adminPool = new Pool({
      connectionString: `${postgresBase}/sdf_persistence_test`,
      connectionTimeoutMillis: 5000,
    }),
    mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  let pool: Pool | undefined,
    created = false;
  try {
    await adminPool.query(`CREATE DATABASE "${name}"`);
    created = true;
    pool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 10, connectionTimeoutMillis: 5000 });
    const sql = pool;
    await mongo.connect();
    await t.test(
      'migration011 rejects duplicate Pending targets atomically without modifying records or earlier checksums',
      async () => {
        await runMigrations(sql, mongo.db(name), MIGRATIONS.slice(0, 10));
        const user = (
          await sql.query(
            `INSERT INTO public.users(user_name,phone_number,password,role,status) VALUES ('Migration fixture','0900000087','unused-fixture','Farmer','Active') RETURNING id`,
          )
        ).rows[0].id;
        const rows = await sql.query(
          `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at) VALUES ('devices','Update','Pending',$1,$2,'{}',now()),('devices','Update','Pending',upper($1),$2,'{}',now()) RETURNING id`,
          [randomUUID(), user],
        );
        await assert.rejects(
          runMigrations(sql, mongo.db(name)),
          (error: unknown) => (error as { code: string }).code === '23505',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count,
          '10',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.workflow_requests')).rows[0].count,
          '2',
        );
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[1].id]);
        assert.deepEqual(await runMigrations(sql, mongo.db(name)), ['011_device_workflow', '012_sensor_workflow']);
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[0].id]);
        await sql.query('DELETE FROM public.users WHERE id=$1', [user]);
      },
    );
    await seedDemo(
      sql,
      readSeedConfig({
        NODE_ENV: 'test',
        AUTH_TEST_PHONE: config.phoneNumber,
        AUTH_TEST_PASSWORD: config.password,
        AUTH_TEST_ADMIN_PHONE: config.admin.phoneNumber,
        AUTH_TEST_ADMIN_PASSWORD: config.admin.password,
        DEMO_DEVICE_STATION_ID: 'DEVICE_TEST_ESP32',
        DEMO_DEVICE_INSTALLED_AT: details.installed_at,
        DEMO_DEVICE_COST: '10237500',
      }),
    );
    const users = new PostgresUsersRepository(sql),
      farms = new PostgresFarmsRepository(sql, users),
      catalogs = new PostgresCatalogRepository(sql, users),
      zones = new PostgresZonesRepository(sql, users, farms, catalogs),
      trees = new PostgresTreesRepository(sql, users, farms, zones),
      devices = new PostgresDevicesRepository(sql, users, farms, zones, trees),
      assignments = new PostgresAssignmentsRepository(sql, users, farms, zones),
      registry = new PostgresCooperativesRepository(sql, users);
    const admin = (await users.loadByPhone(config.admin.phoneNumber))!.user.id,
      hash = (await users.loadById(admin))!.user.password;
    const standard = await catalogs.standards.create(admin, {
      code: 'DEVICE-STD',
      name: 'VietGAP fixture',
      description: '',
      certifying_body: 'Fixture',
    });
    let n = 10;
    const farmer = async () => {
      const phone = `0900000${String(n++).padStart(3, '0')}`,
        u = await users.createRegisteredUser({
          user_name: 'Farmer fixture',
          phone_number: phone,
          gmail: null,
          passwordHash: hash,
          role: 'Farmer',
        });
      return { id: u.user.id, phone };
    };
    const fixture = async () => {
      const owner = await farmer(),
        worker = await farmer(),
        r = await farms.createRequest(owner.id, {
          area_size: 1,
          address: 'Vườn Đắk Lắk',
          certificate_number: 'DEVICE-FIXTURE',
          longitude: 108,
          latitude: 12,
        }),
        farm = (await farms.approve(admin, r.id)).farm_id!,
        zone = await zones.create(owner.id, {
          farm_id: farm,
          standard_id: standard.id,
          zone_name: 'Khu tưới',
          area_size: 0.3,
          longitude: 108,
          latitude: 12,
        });
      return {
        owner,
        worker,
        farm,
        zone,
        input: { zone_id: zone.id, station_id: `ESP32_${randomUUID()}`, ...details },
      };
    };
    const meta = async (type: string, id: string) =>
      (
        await sql.query(
          'SELECT version,data FROM technical.entity_metadata WHERE entity_type=$1 AND entity_key=$2',
          [type, id],
        )
      ).rows[0];

    await t.test(
      'owner creates required installation and distinct UUID/station, retains status on cost PATCH and appends history',
      async () => {
        const f = await fixture(),
          device = await devices.create(f.owner.id, f.input);
        assert.deepEqual(
          Object.keys(device).sort(),
          ['id', 'zone_id', 'station_id', 'installed_at', 'cost', 'status', 'last_seen_at'].sort(),
        );
        assert.equal(device.station_id, f.input.station_id);
        assert.notEqual(device.id, device.station_id);
        assert.equal(device.installed_at, '2026-09-01T01:30:00.000Z');
        assert.equal(device.cost, 10237500.25);
        assert.equal(device.last_seen_at, null);
        assert.equal(device.status, 'Active');
        await devices.update(f.owner.id, device.id, { status: 'Maintenance' });
        const after = await devices.update(f.owner.id, device.id, { cost: 0 });
        assert.equal(after.status, 'Maintenance');
        assert.equal(after.cost, 0);
        const history = await devices.history(admin, device.id, page);
        assert.equal(history.total, 3);
        assert.deepEqual(history.items[0].after, device);
        assert.deepEqual(history.items[2].before, { ...device, status: 'Maintenance' });
        assert.deepEqual(history.items[2].after, after);
        assert.equal(history.items[2].version, 3);
        assert.equal((await meta('devices', device.id)).version, '3');
      },
    );

    await t.test(
      'station uniqueness is exact case and global, remains reserved while Inactive; identity has database triggers',
      async () => {
        const f = await fixture(),
          other = await fixture(),
          device = await devices.create(f.owner.id, { ...f.input, station_id: 'ExactCase' });
        await devices.update(f.owner.id, device.id, { status: 'Inactive' });
        await assert.rejects(
          devices.create(other.owner.id, { ...other.input, station_id: 'ExactCase' }),
          status(409),
        );
        await assert.rejects(
          devices.createRequest(admin, { ...other.input, station_id: 'ExactCase' }),
          status(409),
        );
        const lower = await devices.create(other.owner.id, { ...other.input, station_id: 'exactcase' });
        assert.equal((await devices.getRecordByStationId('ExactCase')).id, device.id);
        assert.equal((await devices.getByStationId(admin, 'exactcase')).id, lower.id);
        await assert.rejects(devices.getRecordByStationId('EXACTCASE'), status(404));
        for (const [column, value] of [
          ['station_id', 'CHANGED'],
          ['zone_id', other.zone.id],
          ['id', randomUUID()],
        ]) {
          await assert.rejects(
            sql.query(`UPDATE public.devices SET ${column}=$2 WHERE id=$1`, [device.id, value]),
          );
        }
        assert.equal((await devices.getRecord(device.id)).station_id, 'ExactCase');
      },
    );

    await t.test(
      'Farmer requires current Accepted assignment for reads, never metadata writes; End removes Device history access',
      async () => {
        const f = await fixture(),
          device = await devices.create(f.owner.id, f.input);
        await assert.rejects(devices.get(f.worker.id, device.id), status(404));
        const request = await assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id });
        await assert.rejects(devices.get(f.worker.id, device.id), status(404));
        const accepted = await assignments.approve(f.worker.id, request.id);
        assert.equal((await devices.get(f.worker.id, device.id)).id, device.id);
        await assert.rejects(devices.update(f.worker.id, device.id, { cost: 1 }), status(403));
        await assert.rejects(devices.update(admin, device.id, { cost: 1 }), status(403));
        await assert.rejects(
          devices.createRequest(f.owner.id, { ...f.input, station_id: 'OWNER_PROPOSAL' }),
          status(403),
        );
        await assignments.end(f.owner.id, accepted.assignment_id!);
        await assert.rejects(devices.history(f.worker.id, device.id, page), status(404));
        assert.equal((await devices.list(f.worker.id, new DeviceListDto())).total, 0);
      },
    );

    await t.test(
      'Manager sees Devices only in current cooperative and cannot approve or write metadata',
      async () => {
        const f = await fixture(),
          device = await devices.create(f.owner.id, f.input),
          gmail = `device-manager${n}@example.invalid`,
          phone = `0900000${String(n++).padStart(3, '0')}`;
        const m = await users.createRegisteredUser(
          { user_name: 'Manager fixture', phone_number: phone, gmail, passwordHash: hash, role: 'Manager' },
          gmail,
        );
        const c = await registry.approve(admin, m.user.id, {
          cooperative: {
            cooperative_name: 'HTX fixture',
            director: 'Ban quản trị',
            certificate_number: `DEVICE-HTX-${n}`,
            address: 'Đắk Lắk',
            contact_number: phone,
          },
        });
        const manager = m.user;
        await assert.rejects(devices.get(manager.id, device.id), status(404));
        const join = await farms.joinRequest(f.owner.id, f.farm, c.cooperative.id);
        await farms.approve(admin, join.id);
        await farms.approve(manager.id, join.id);
        assert.equal((await devices.get(manager.id, device.id)).id, device.id);
        await assert.rejects(devices.update(manager.id, device.id, { cost: 2 }), status(403));
        const r = await devices.updateRequest(admin, device.id, { cost: 2 });
        await assert.rejects(devices.approve(manager.id, r.id), status(403));
        const leave = await farms.leaveRequest(f.owner.id, f.farm);
        await farms.approve(admin, leave.id);
        await assert.rejects(devices.get(manager.id, device.id), status(404));
        await devices.reject(f.owner.id, r.id);
      },
    );

    await t.test(
      'Admin proposals are isolated, owner approves once, stale and revoked proposers cannot apply, owner can reject',
      async () => {
        const f = await fixture(),
          create = await devices.createRequest(admin, f.input);
        assert.equal(create.device_id, null);
        await assert.rejects(devices.getRecordByStationId(f.input.station_id), status(404));
        await assert.rejects(devices.getRequest(f.worker.id, create.id), status(404));
        const result = await devices.approve(f.owner.id, create.id),
          device = await devices.getRecord(result.device_id!);
        assert.equal(result.status, 'Accepted');
        assert.equal(result.resolved_by, f.owner.id);
        await assert.rejects(devices.approve(f.owner.id, create.id), status(409));
        const r = await devices.updateRequest(admin, device.id, { cost: device.cost + 1 });
        assert.equal((await devices.getRecord(device.id)).cost, device.cost);
        await devices.update(f.owner.id, device.id, { cost: 3 });
        await assert.rejects(devices.approve(f.owner.id, r.id), status(409));
        assert.equal((await devices.getRequest(admin, r.id)).status, 'Pending');
        await devices.reject(f.owner.id, r.id, 'Nhập lại');
        for (const patch of ["status='Locked'", "role='Farmer'"]) {
          const p = await devices.updateRequest(admin, device.id, { cost: 4 });
          await sql.query(`UPDATE public.users SET ${patch} WHERE id=$1`, [admin]);
          try {
            await assert.rejects(
              devices.approve(f.owner.id, p.id),
              patch.startsWith('status') ? status(403) : status(409),
            );
          } finally {
            await sql.query("UPDATE public.users SET status='Active',role='Admin' WHERE id=$1", [admin]);
          }
          assert.equal((await devices.getRequest(admin, p.id)).status, 'Pending');
          await devices.reject(f.owner.id, p.id);
        }
        const applied = await devices.updateRequest(admin, device.id, { cost: 5 });
        await devices.approve(f.owner.id, applied.id);
        const last = (await devices.history(f.owner.id, device.id, page)).items.at(-1)!;
        assert.equal(last.actor_id, f.owner.id);
        assert.equal(last.proposed_by, admin);
        assert.equal(last.request_id, applied.id);
        assert.equal((await meta('device_requests', applied.id)).version, '2');
      },
    );

    await t.test(
      'competing Pending updates and approvals serialize; pending Create does not reserve hardware identity',
      async () => {
        const f = await fixture(),
          other = await fixture(),
          device = await devices.create(f.owner.id, f.input);
        const requests = await Promise.allSettled([
          devices.updateRequest(admin, device.id, { cost: 1 }),
          devices.updateRequest(admin, device.id, { cost: 2 }),
        ]);
        assert.equal(requests.filter((x) => x.status === 'fulfilled').length, 1);
        const r = requests.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<
          Awaited<ReturnType<typeof devices.updateRequest>>
        >;
        const approvals = await Promise.allSettled([
          devices.approve(f.owner.id, r.value.id),
          devices.approve(f.owner.id, r.value.id),
        ]);
        assert.equal(approvals.filter((x) => x.status === 'fulfilled').length, 1);
        assert.equal((await devices.history(admin, device.id, page)).total, 2);
        const input = { ...f.input, station_id: 'PENDING_SAME_STATION' },
          p = await devices.createRequest(admin, input);
        await devices.create(other.owner.id, { ...other.input, station_id: input.station_id });
        await assert.rejects(devices.approve(f.owner.id, p.id), status(409));
        assert.equal((await devices.getRequest(admin, p.id)).status, 'Pending');
        await devices.reject(f.owner.id, p.id);
        const race = await Promise.allSettled([
          devices.create(f.owner.id, { ...f.input, station_id: 'RACING_STATION' }),
          devices.create(other.owner.id, { ...other.input, station_id: 'RACING_STATION' }),
        ]);
        assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1);
        assert.ok(race.some((x) => x.status === 'rejected' && status(409)(x.reason)));
      },
    );

    await t.test(
      'UUID collision has bounded retries and does not overwrite another station or leak partial histories',
      async () => {
        const f = await fixture(),
          existing = await devices.create(f.owner.id, f.input);
        let calls = 0;
        const retry = new PostgresDevicesRepository(sql, users, farms, zones, trees, undefined, () =>
          ++calls < 3 ? existing.id : randomUUID(),
        );
        const created = await retry.create(f.owner.id, { ...f.input, station_id: 'COLLISION_RETRY' });
        assert.equal(calls, 3);
        assert.notEqual(created.id, existing.id);
        const exhausted = new PostgresDevicesRepository(
          sql,
          users,
          farms,
          zones,
          trees,
          undefined,
          () => existing.id,
        );
        await assert.rejects(
          exhausted.create(f.owner.id, { ...f.input, station_id: 'COLLISION_EXHAUSTED' }),
          status(409),
        );
        await assert.rejects(devices.getRecordByStationId('COLLISION_EXHAUSTED'), status(404));
        assert.deepEqual(await devices.getRecord(existing.id), existing);
      },
    );

    await t.test(
      'last_seen_at is monotonic, cannot stale proposals, survives concurrent writes and never changes version/status/history',
      async () => {
        const f = await fixture(),
          device = await devices.create(f.owner.id, f.input),
          request = await devices.updateRequest(admin, device.id, { status: 'Inactive' });
        await Promise.all([
          devices.recordSeen(device.id, '2026-10-17T10:00:00Z'),
          devices.recordSeen(device.id, '2026-10-17T09:00:00Z'),
        ]);
        assert.equal((await meta('devices', device.id)).version, '1');
        assert.equal((await devices.history(admin, device.id, page)).total, 1);
        await assert.rejects(devices.recordSeen(device.id, 'invalid'), status(400));
        await devices.approve(f.owner.id, request.id);
        const seen = await devices.getRecord(device.id);
        assert.equal(seen.status, 'Inactive');
        assert.equal(seen.last_seen_at, '2026-10-17T10:00:00.000Z');
        await Promise.all([
          devices.update(f.owner.id, device.id, { cost: 2 }),
          devices.recordSeen(device.id, '2026-10-17T11:00:00Z'),
        ]);
        const after = await devices.getRecord(device.id);
        assert.equal(after.cost, 2);
        assert.equal(after.status, 'Inactive');
        assert.equal(after.last_seen_at, '2026-10-17T11:00:00.000Z');
        assert.equal((await meta('devices', device.id)).version, '3');
        assert.equal((await devices.history(admin, device.id, page)).total, 3);
      },
    );

    await t.test(
      'affected Trees come from the same Zone including Dead/Removed and never another Zone',
      async () => {
        const f = await fixture(),
          other = await fixture(),
          device = await devices.create(f.owner.id, f.input);
        const treeInput = {
          zone_id: f.zone.id,
          variety: 'Ri6',
          plant_date: '2024-05-01T00:00:00Z',
          longitude: 108,
          latitude: 12,
        };
        const a = await trees.create(f.owner.id, { ...treeInput, status: 'Dead' }),
          b = await trees.create(f.owner.id, { ...treeInput, status: 'Removed' });
        await trees.create(other.owner.id, { ...treeInput, zone_id: other.zone.id });
        assert.deepEqual(
          (await devices.affectedTrees(f.owner.id, device.id, page)).items.map((t) => t.id).sort(),
          [a.id, b.id].sort(),
        );
        await assert.rejects(devices.affectedTrees(other.owner.id, device.id, page), status(404));
      },
    );

    await t.test(
      'audit error rolls back device, version, accepted request and history in the same transaction',
      async () => {
        const f = await fixture(),
          device = await devices.create(f.owner.id, f.input),
          r = await devices.updateRequest(admin, device.id, { cost: 1 });
        await sql.query(
          `CREATE FUNCTION technical.fail_device_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='devices' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_device_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW EXECUTE FUNCTION technical.fail_device_audit()`,
        );
        try {
          await assert.rejects(devices.approve(f.owner.id, r.id), status(503));
          await assert.rejects(
            devices.create(f.owner.id, { ...f.input, station_id: 'ROLLED_BACK' }),
            status(503),
          );
        } finally {
          await sql.query(
            'DROP TRIGGER fail_device_audit ON technical.audit_events; DROP FUNCTION technical.fail_device_audit()',
          );
        }
        assert.deepEqual(await devices.getRecord(device.id), device);
        assert.equal((await devices.getRequest(admin, r.id)).status, 'Pending');
        assert.equal((await meta('devices', device.id)).version, '1');
        assert.equal((await devices.history(admin, device.id, page)).total, 1);
        await assert.rejects(devices.getRecordByStationId('ROLLED_BACK'), status(404));
        await devices.approve(f.owner.id, r.id);
      },
    );

    await t.test(
      'trusted methods validate DTOs, canonicalize UUID and bound paging, literal search never becomes SQL wildcard',
      async () => {
        const f = await fixture(),
          device = await devices.create(f.owner.id, { ...f.input, station_id: 'Search_Station' });
        for (const input of [
          { cost: null },
          { cost: -1 },
          { cost: 1.234 },
          { status: 'Online' },
          { last_seen_at: '2026-10-17T00:00:00Z' },
          { station_id: 'changed' },
          { zone_id: f.zone.id },
          { installed_at: '2026-02-30T00:00:00Z' },
          { installed_at: '2026-10-17' },
          {},
        ]) {
          await assert.rejects(devices.update(f.owner.id, device.id, input as never), status(400));
        }
        for (const input of [
          { installed_at: null },
          { cost: null },
          { station_id: 'a/b' },
          { station_id: 'a#' },
          { status: 'Offline' },
          { auth_token: 'x' },
        ]) {
          await assert.rejects(devices.create(f.owner.id, { ...f.input, ...input } as never), status(400));
        }
        assert.equal((await devices.get(f.owner.id, device.id.toUpperCase())).id, device.id);
        assert.equal((await devices.list(f.owner.id, { ...new DeviceListDto(), q: 'search_' })).total, 1);
        assert.equal((await devices.list(f.owner.id, { ...new DeviceListDto(), q: '%' })).total, 0);
        const out = await devices.list(f.owner.id, { ...new DeviceListDto(), offset: 100 });
        assert.equal(out.total, 1);
        assert.equal(out.items.length, 0);
        await assert.rejects(devices.list(f.owner.id, { ...new DeviceListDto(), limit: 1001 }), status(400));
        const r = await devices.updateRequest(admin, device.id, { cost: 0 });
        const requests = await devices.listRequests(f.owner.id, { ...new FarmRequestListDto(), offset: 100 });
        assert.equal(requests.total, 1);
        assert.equal(requests.items.length, 0);
        await devices.reject(f.owner.id, r.id);
      },
    );

    await t.test(
      'missing or unsafe metadata, malformed workflow/snapshot and corrupt append-only audit fail closed without fallback',
      async () => {
        const f = await fixture(),
          device = await devices.create(f.owner.id, f.input);
        for (const version of ['0', '9007199254740992']) {
          await sql.query(
            "UPDATE technical.entity_metadata SET version=$2 WHERE entity_type='devices' AND entity_key=$1",
            [device.id, version],
          );
          await assert.rejects(devices.getRecord(device.id), status(503));
        }
        await sql.query(
          'UPDATE technical.entity_metadata SET version=1,data=\'{"seed_key":"preserved-fixture"}\' WHERE entity_type=\'devices\' AND entity_key=$1',
          [device.id],
        );
        await devices.update(f.owner.id, device.id, { cost: 1 });
        assert.equal((await meta('devices', device.id)).data.seed_key, 'preserved-fixture');
        const r = await devices.updateRequest(admin, device.id, { cost: 2 });
        await sql.query(
          "UPDATE technical.entity_metadata SET version=0 WHERE entity_type='device_requests' AND entity_key=$1",
          [r.id],
        );
        await assert.rejects(devices.approve(f.owner.id, r.id), status(503));
        await sql.query(
          "UPDATE technical.entity_metadata SET version=1 WHERE entity_type='device_requests' AND entity_key=$1",
          [r.id],
        );
        const saved = (await sql.query('SELECT payload FROM technical.workflow_requests WHERE id=$1', [r.id]))
          .rows[0].payload;
        await sql.query(
          "UPDATE technical.workflow_requests SET payload=jsonb_set(payload,'{device_snapshot,station_id}','null') WHERE id=$1",
          [r.id],
        );
        await assert.rejects(devices.getRequest(admin, r.id), status(503));
        await sql.query('UPDATE technical.workflow_requests SET payload=$2 WHERE id=$1', [
          r.id,
          JSON.stringify(saved),
        ]);
        await devices.reject(f.owner.id, r.id);
        const history = (await devices.history(admin, device.id, page)).items.at(-1)!;
        await assert.rejects(
          sql.query("UPDATE technical.audit_events SET payload='{}' WHERE id=$1", [history.id]),
        );
        await sql.query(
          "INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ('devices',$1,$2,'DeviceUpdated',now(),$3)",
          [
            device.id,
            f.owner.id,
            JSON.stringify({
              proposed_by: null,
              request_id: null,
              version: 3,
              before: device,
              after: { ...device, station_id: 'ALTERED' },
            }),
          ],
        );
        await assert.rejects(devices.history(admin, device.id, page), status(503));
        await sql.query(
          "DELETE FROM technical.entity_metadata WHERE entity_type='devices' AND entity_key=$1",
          [device.id],
        );
        await assert.rejects(devices.getRecord(device.id), status(503));
        await assert.rejects(devices.recordSeen(device.id, '2026-10-17T10:00:00Z'), status(503));
        assert.equal(
          (await sql.query('SELECT last_seen_at FROM public.devices WHERE id=$1', [device.id])).rows[0]
            .last_seen_at,
          null,
        );
      },
    );

    await t.test(
      'owner revocation while waiting on user lock is rechecked before any metadata mutation',
      async () => {
        const f = await fixture(),
          device = await devices.create(f.owner.id, f.input),
          waitingPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 1,
            application_name: 'device-owner-revocation',
            connectionTimeoutMillis: 5000,
          }),
          blocker = await sql.connect();
        let done: Promise<PromiseSettledResult<unknown>> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.owner.id]);
          const writer = new PostgresDevicesRepository(
            waitingPool,
            new PostgresUsersRepository(waitingPool),
            farms,
            zones,
            trees,
          );
          done = writer.update(f.owner.id, device.id, { cost: 0 }).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason) => ({ status: 'rejected' as const, reason }),
          );
          let blocked = false;
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            blocked = Boolean(
              (
                await sql.query(
                  "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='device-owner-revocation' AND wait_event_type='Lock'",
                  [name],
                )
              ).rowCount,
            );
            if (blocked) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(blocked, true);
          await blocker.query('COMMIT');
          const result = await done;
          assert.ok(result.status === 'rejected' && status(403)(result.reason));
          assert.deepEqual(await devices.getRecord(device.id), device);
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await done;
          await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [f.owner.id]);
          await waitingPool.end();
        }
      },
    );

    await t.test(
      'fresh HTTP app/pool preserves pending approval, station lookup, seen time and history; unused RAM has no Device',
      async () => {
        const f = await fixture(),
          device = await devices.create(f.owner.id, f.input),
          r = await devices.updateRequest(admin, device.id, { cost: 1 });
        await devices.recordSeen(device.id, '2026-10-17T10:00:00Z');
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
          assert.equal((await http('devices')).status, 401);
          const token = await login(f.owner.phone);
          assert.equal(
            (await http(`devices/${device.id}`, 'PATCH', { last_seen_at: null }, token)).status,
            400,
          );
          await app.close();
          freshPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 5,
            connectionTimeoutMillis: 5000,
          });
          app = await application(freshPool);
          assert.throws(() => app.get(DevicesService).getRecord(device.id), status(404));
          const owner = await login(f.owner.phone);
          assert.equal((await http(`device-requests/${r.id}`, 'GET', undefined, owner)).status, 200);
          assert.equal((await http(`device-requests/${r.id}/approve`, 'PATCH', {}, owner)).status, 200);
          await app.close();
          app = await application(freshPool);
          const restored = await http(
              `devices/by-station/${device.station_id}`,
              'GET',
              undefined,
              await login(f.owner.phone),
            ),
            value = (await restored.json()) as TestDevice;
          assert.equal(value.id, device.id);
          assert.equal(value.cost, 1);
          assert.equal(value.last_seen_at, '2026-10-17T10:00:00.000Z');
          const history = await http(
            `devices/${device.id}/history`,
            'GET',
            undefined,
            await login(config.admin.phoneNumber),
          );
          assert.equal(((await history.json()) as { total: number }).total, 2);
          assert.equal(
            (await http(`devices/${device.id}`, 'DELETE', undefined, await login(f.owner.phone))).status,
            404,
          );
        } finally {
          await app.close();
          await freshPool?.end();
        }
      },
    );
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
