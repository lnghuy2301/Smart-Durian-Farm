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
import { ActuatorsModule } from '../src/actuators/actuators.module';
import { ActuatorRecords } from '../src/actuators/actuator-records';
import { ActuatorsService } from '../src/actuators/actuators.service';
import { ActuatorListDto, MAX_CAPABILITY_ID } from '../src/actuators/actuators.dto';
import { TestActuator, ACTUATOR_PURPOSES } from '../src/actuators/actuators.types';
import { PostgresActuatorsRepository } from '../src/persistence/postgres-actuators.repository';
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
    devices = new PostgresDevicesRepository(pool, users, farms, zones, trees),
    auth = AuthModule.forMock(config),
    userModule = UsersModule.forMock(config, auth),
    farmModule = FarmsModule.forMock(auth, userModule),
    zoneModule = ZonesModule.forMock(auth, farmModule, StandardsModule.forMock(auth)),
    treeModule = TreesModule.forMock(auth, farmModule, zoneModule);
  const module = await Test.createTestingModule({
    imports: [
      ActuatorsModule.forMock(
        auth,
        farmModule,
        zoneModule,
        DevicesModule.forMock(auth, farmModule, zoneModule, treeModule),
      ),
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
    .useValue(zones)
    .overrideProvider(TreeRecords)
    .useValue(trees)
    .overrideProvider(DeviceRecords)
    .useValue(devices)
    .overrideProvider(ActuatorRecords)
    .useValue(new PostgresActuatorsRepository(pool, users, farms, zones, devices))
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

test('PostgreSQL Actuators preserve Device-local numeric capability identity, fixed purpose and approval history', async (t) => {
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
      'migration013 rejects duplicate Pending targets atomically without modifying records or earlier checksums',
      async () => {
        await runMigrations(sql, mongo.db(name), MIGRATIONS.slice(0, 12));
        const user = (
          await sql.query(
            `INSERT INTO public.users(user_name,phone_number,password,role,status) VALUES ('Migration fixture','0900000087','unused-fixture','Farmer','Active') RETURNING id`,
          )
        ).rows[0].id;
        const rows = await sql.query(
          `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at) VALUES ('actuators','Update','Pending',$1,$2,'{}',now()),('actuators','Update','Pending',upper($1),$2,'{}',now()) RETURNING id`,
          [randomUUID(), user],
        );
        await assert.rejects(
          runMigrations(sql, mongo.db(name)),
          (error: unknown) => (error as { code: string }).code === '23505',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count,
          '12',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.workflow_requests')).rows[0].count,
          '2',
        );
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[1].id]);
        assert.deepEqual(await runMigrations(sql, mongo.db(name)), ['013_actuator_workflow']);
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
      actuators = new PostgresActuatorsRepository(sql, users, farms, zones, devices),
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
        device: await devices.create(owner.id, {
          zone_id: zone.id,
          station_id: `ESP32_${randomUUID()}`,
          ...details,
        }),
      };
    };
    const actuatorFixture = async () => {
      const f = await fixture();
      return {
        ...f,
        input: {
          device_id: f.device.id,
          name: 'Bơm chung',
          purpose: 'shared' as const,
          capability_id: 2,
        },
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
      'current Accepted worker reads metadata/history but cannot write; End removes Actuator access',
      async () => {
        const f = await actuatorFixture(),
          actuator = await actuators.create(f.owner.id, f.input);
        await assert.rejects(actuators.get(f.worker.id, actuator.id), status(404));
        const r = await assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id });
        await assert.rejects(actuators.getByCapability(f.worker.id, f.device.id, 2), status(404));
        const a = await assignments.approve(f.worker.id, r.id);
        assert.equal((await actuators.history(f.worker.id, actuator.id, page)).total, 1);
        await assert.rejects(actuators.update(f.worker.id, actuator.id, { name: 'Worker' }), status(403));
        await assert.rejects(actuators.update(admin, actuator.id, { name: 'Admin direct' }), status(403));
        await assert.rejects(
          actuators.createRequest(f.owner.id, { ...f.input, capability_id: 3 }),
          status(403),
        );
        await assignments.end(f.owner.id, a.assignment_id!);
        await assert.rejects(actuators.history(f.worker.id, actuator.id, page), status(404));
        assert.equal((await actuators.list(f.worker.id, new ActuatorListDto())).total, 0);
      },
    );
    await t.test(
      'Manager scope follows current Farm membership and cannot view proposals or change metadata',
      async () => {
        const f = await actuatorFixture(),
          actuator = await actuators.create(f.owner.id, f.input),
          phone = `0900000${String(n++).padStart(3, '0')}`,
          gmail = `actuator-manager${n}@example.invalid`;
        const account = await users.createRegisteredUser(
          { user_name: 'Manager fixture', phone_number: phone, gmail, passwordHash: hash, role: 'Manager' },
          gmail,
        );
        const c = await registry.approve(admin, account.user.id, {
          cooperative: {
            cooperative_name: 'HTX cảm biến',
            director: 'Ban quản trị',
            certificate_number: `ACTUATOR-HTX-${n}`,
            address: 'Đắk Lắk',
            contact_number: phone,
          },
        });
        await assert.rejects(actuators.get(account.user.id, actuator.id), status(404));
        const join = await farms.joinRequest(f.owner.id, f.farm, c.cooperative.id);
        await farms.approve(admin, join.id);
        await farms.approve(account.user.id, join.id);
        assert.equal((await actuators.get(account.user.id, actuator.id)).id, actuator.id);
        const r = await actuators.updateRequest(admin, actuator.id, { name: 'Đề xuất' });
        await assert.rejects(actuators.getRequest(account.user.id, r.id), status(404));
        await assert.rejects(actuators.approve(account.user.id, r.id), status(403));
        await assert.rejects(
          actuators.update(account.user.id, actuator.id, { name: 'Manager' }),
          status(403),
        );
        const leave = await farms.leaveRequest(f.owner.id, f.farm);
        await farms.approve(admin, leave.id);
        await assert.rejects(actuators.history(account.user.id, actuator.id, page), status(404));
        await actuators.reject(f.owner.id, r.id);
      },
    );
    await t.test(
      'same-pair concurrent creates and Pending approvals serialize, same capability across Devices remains allowed',
      async () => {
        const f = await actuatorFixture();
        const creates = await Promise.allSettled([
          actuators.create(f.owner.id, f.input),
          actuators.create(f.owner.id, f.input),
        ]);
        assert.equal(creates.filter((x) => x.status === 'fulfilled').length, 1);
        assert.ok(creates.some((x) => x.status === 'rejected' && status(409)(x.reason)));
        const actuator = await actuators.getRecordByCapability(f.device.id, 2);
        const updates = await Promise.allSettled([
          actuators.updateRequest(admin, actuator.id, { name: 'A' }),
          actuators.updateRequest(admin, actuator.id, { name: 'B' }),
        ]);
        assert.equal(updates.filter((x) => x.status === 'fulfilled').length, 1);
        const p = updates.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<
          Awaited<ReturnType<typeof actuators.updateRequest>>
        >;
        const approvals = await Promise.allSettled([
          actuators.approve(f.owner.id, p.value.id),
          actuators.approve(f.owner.id, p.value.id),
        ]);
        assert.equal(approvals.filter((x) => x.status === 'fulfilled').length, 1);
        assert.equal((await actuators.history(admin, actuator.id, page)).total, 2);
        const pending = await actuators.createRequest(admin, { ...f.input, capability_id: 3 });
        await actuators.create(f.owner.id, { ...f.input, capability_id: 3 });
        await assert.rejects(actuators.approve(f.owner.id, pending.id), status(409));
        await actuators.reject(f.owner.id, pending.id);
        const other = await actuatorFixture();
        assert.equal((await actuators.create(other.owner.id, other.input)).capability_id, 2);
      },
    );
    await t.test(
      'UUID collision is bounded without rewriting an existing actuator or leaving partial history',
      async () => {
        const f = await actuatorFixture(),
          actuator = await actuators.create(f.owner.id, f.input);
        let calls = 0;
        const retry = new PostgresActuatorsRepository(sql, users, farms, zones, devices, undefined, () =>
          ++calls < 3 ? actuator.id : randomUUID(),
        );
        const created = await retry.create(f.owner.id, { ...f.input, capability_id: 3 });
        assert.equal(calls, 3);
        assert.notEqual(created.id, actuator.id);
        const exhausted = new PostgresActuatorsRepository(
          sql,
          users,
          farms,
          zones,
          devices,
          undefined,
          () => actuator.id,
        );
        await assert.rejects(exhausted.create(f.owner.id, { ...f.input, capability_id: 4 }), status(409));
        await assert.rejects(actuators.getRecordByCapability(f.device.id, 4), status(404));
        assert.deepEqual(await actuators.getRecord(actuator.id), actuator);
      },
    );
    await t.test(
      'audit failure rolls back official record, version, history and request terminal atomically',
      async () => {
        const f = await actuatorFixture(),
          actuator = await actuators.create(f.owner.id, f.input),
          r = await actuators.updateRequest(admin, actuator.id, { name: 'Apply' });
        await sql.query(
          `CREATE FUNCTION technical.fail_actuator_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='actuators' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_actuator_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW EXECUTE FUNCTION technical.fail_actuator_audit()`,
        );
        try {
          await assert.rejects(actuators.approve(f.owner.id, r.id), status(503));
          await assert.rejects(actuators.create(f.owner.id, { ...f.input, capability_id: 3 }), status(503));
        } finally {
          await sql.query(
            'DROP TRIGGER fail_actuator_audit ON technical.audit_events; DROP FUNCTION technical.fail_actuator_audit()',
          );
        }
        assert.deepEqual(await actuators.getRecord(actuator.id), actuator);
        assert.equal((await meta('actuators', actuator.id)).version, '1');
        assert.equal((await actuators.getRequest(admin, r.id)).status, 'Pending');
        assert.equal((await actuators.history(admin, actuator.id, page)).total, 1);
        await assert.rejects(actuators.getRecordByCapability(f.device.id, 3), status(404));
        await actuators.approve(f.owner.id, r.id);
      },
    );
    await t.test(
      'owner revocation while the writer waits on a lock is rechecked before Actuator mutation',
      async () => {
        const f = await actuatorFixture(),
          actuator = await actuators.create(f.owner.id, f.input),
          waitingPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 1,
            application_name: 'actuator-owner-revocation',
            connectionTimeoutMillis: 5000,
          }),
          blocker = await sql.connect();
        let done: Promise<PromiseSettledResult<unknown>> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.owner.id]);
          const writer = new PostgresActuatorsRepository(
            waitingPool,
            new PostgresUsersRepository(waitingPool),
            farms,
            zones,
            devices,
          );
          done = writer.update(f.owner.id, actuator.id, { name: 'Forbidden' }).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason) => ({ status: 'rejected' as const, reason }),
          );
          let blocked = false;
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            blocked = Boolean(
              (
                await sql.query(
                  "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='actuator-owner-revocation' AND wait_event_type='Lock'",
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
          assert.deepEqual(await actuators.getRecord(actuator.id), actuator);
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
      'metadata registers shared pump and independent valves, never relay state or automatic control',
      async () => {
        const f = await actuatorFixture();
        for (const [capability_id, purpose] of [
          [2, 'shared'],
          [3, 'watering'],
          [4, 'spraying'],
        ] as const) {
          const actuator = await actuators.create(f.owner.id, { ...f.input, capability_id, purpose });
          assert.deepEqual(
            Object.keys(actuator).sort(),
            ['id', 'device_id', 'name', 'purpose', 'capability_id', 'status'].sort(),
          );
          assert.equal(actuator.status, 'Active');
          assert.equal(actuator.purpose, purpose);
          assert.equal(actuator.capability_id, capability_id);
          assert.equal((await actuators.getRecordByCapability(f.device.id, capability_id)).id, actuator.id);
        }
        assert.equal((await actuators.list(f.owner.id, new ActuatorListDto())).total, 3);
        for (const purpose of ACTUATOR_PURPOSES)
          assert.equal((await actuators.list(f.owner.id, { ...new ActuatorListDto(), purpose })).total, 1);
        assert.equal((await devices.getRecord(f.device.id)).last_seen_at, null);
      },
    );
    await t.test(
      'capability range preserves exact JSON integer through bigint driver strings, history and HTTP-compatible lookup',
      async () => {
        const f = await actuatorFixture(),
          actuator = await actuators.create(f.owner.id, { ...f.input, capability_id: MAX_CAPABILITY_ID });
        assert.equal(actuator.capability_id, 9007199254740991);
        assert.equal(typeof actuator.capability_id, 'number');
        assert.equal(
          (await actuators.getByCapability(f.owner.id, f.device.id, MAX_CAPABILITY_ID)).id,
          actuator.id,
        );
        assert.equal(
          (await actuators.history(admin, actuator.id, page)).items[0].after.capability_id,
          MAX_CAPABILITY_ID,
        );
        assert.equal(
          (await actuators.list(f.owner.id, { ...new ActuatorListDto(), q: '9007199254740991' })).total,
          1,
        );
        for (const id of [0, -1, 1.1, NaN, Infinity, MAX_CAPABILITY_ID + 1, '2', null]) {
          await assert.rejects(actuators.getRecordByCapability(f.device.id, id as never), status(400));
          await assert.rejects(
            actuators.create(f.owner.id, { ...f.input, capability_id: id } as never),
            status(400),
          );
        }
      },
    );
    await t.test(
      'Device-local uniqueness remains reserved when Inactive; identity and purpose cannot change even via SQL',
      async () => {
        const f = await actuatorFixture(),
          other = await actuatorFixture(),
          actuator = await actuators.create(f.owner.id, f.input);
        await actuators.update(f.owner.id, actuator.id, { status: 'Inactive' });
        await assert.rejects(actuators.create(f.owner.id, f.input), status(409));
        await assert.rejects(actuators.createRequest(admin, f.input), status(409));
        assert.equal((await actuators.create(other.owner.id, other.input)).capability_id, 2);
        for (const [column, value] of [
          ['id', randomUUID()],
          ['device_id', other.device.id],
          ['capability_id', 7],
          ['purpose', 'watering'],
        ]) {
          await assert.rejects(
            sql.query(`UPDATE public.actuators SET ${column}=$2 WHERE id=$1`, [actuator.id, value]),
          );
        }
        assert.equal((await actuators.getRecord(actuator.id)).purpose, 'shared');
      },
    );
    await t.test(
      'name edits preserve Inactive, maintenance parent permits metadata and does not invalidate child proposal',
      async () => {
        const f = await actuatorFixture();
        await devices.update(f.owner.id, f.device.id, { status: 'Inactive' });
        const actuator = await actuators.create(f.owner.id, { ...f.input, status: 'Inactive' });
        const next = await actuators.update(f.owner.id, actuator.id, { name: ' Đổi tên bơm ' });
        assert.equal(next.name, 'Đổi tên bơm');
        assert.equal(next.status, 'Inactive');
        const r = await actuators.updateRequest(admin, actuator.id, { name: 'Đã duyệt' });
        await devices.update(f.owner.id, f.device.id, { status: 'Maintenance' });
        await devices.recordSeen(f.device.id, '2026-10-19T01:00:00Z');
        await actuators.approve(f.owner.id, r.id);
        const after = await actuators.getRecord(actuator.id);
        assert.equal(after.name, 'Đã duyệt');
        assert.equal(after.status, 'Inactive');
        const history = await actuators.history(admin, actuator.id, page);
        assert.equal(history.total, 3);
        assert.equal(history.items[2].proposed_by, admin);
        assert.equal(history.items[2].actor_id, f.owner.id);
        assert.equal(history.items[2].request_id, r.id);
      },
    );
    await t.test(
      'owner approves Create only once; stale or revoked Admin proposal cannot apply; reject keeps official metadata',
      async () => {
        const f = await actuatorFixture(),
          create = await actuators.createRequest(admin, f.input);
        assert.equal(create.actuator_id, null);
        await assert.rejects(actuators.getRecordByCapability(f.device.id, 2), status(404));
        const accepted = await actuators.approve(f.owner.id, create.id),
          actuator = await actuators.getRecord(accepted.actuator_id!);
        await assert.rejects(actuators.approve(f.owner.id, create.id), status(409));
        const stale = await actuators.updateRequest(admin, actuator.id, { name: 'Stale' });
        await actuators.update(f.owner.id, actuator.id, { name: 'Owner changed' });
        await assert.rejects(actuators.approve(f.owner.id, stale.id), status(409));
        await actuators.reject(f.owner.id, stale.id, 'Nhập lại');
        for (const patch of ["status='Locked'", "role='Farmer'"]) {
          const r = await actuators.updateRequest(admin, actuator.id, { name: 'Proposal' });
          await sql.query(`UPDATE public.users SET ${patch} WHERE id=$1`, [admin]);
          try {
            await assert.rejects(
              actuators.approve(f.owner.id, r.id),
              patch.startsWith('status') ? status(403) : status(409),
            );
          } finally {
            await sql.query("UPDATE public.users SET status='Active',role='Admin' WHERE id=$1", [admin]);
          }
          assert.equal((await actuators.getRequest(admin, r.id)).status, 'Pending');
          await actuators.reject(f.owner.id, r.id);
        }
        assert.equal((await actuators.getRecord(actuator.id)).name, 'Owner changed');
      },
    );
    await t.test(
      'DTOs reject attempts to configure relay state, immutable fields or unknown metadata; paged search stays literal',
      async () => {
        const f = await actuatorFixture(),
          actuator = await actuators.create(f.owner.id, { ...f.input, name: '  Pump_shared  ' });
        assert.equal(actuator.name, 'Pump_shared');
        for (const input of [
          { name: null },
          { name: ' ' },
          { status: null },
          { status: 'On' },
          { device_id: f.device.id },
          { capability_id: 3 },
          { purpose: 'watering' },
          { action: 1 },
          { confirmed_at: '2026-10-19T00:00:00Z' },
          {},
        ])
          await assert.rejects(actuators.update(f.owner.id, actuator.id, input as never), status(400));
        for (const input of [
          { purpose: 'Pump' },
          { purpose: null },
          { device_id: f.device.station_id },
          { status: 'Online' },
          { name: 'x'.repeat(81) },
          { auth_token: 'x' },
        ])
          await assert.rejects(actuators.create(f.owner.id, { ...f.input, ...input } as never), status(400));
        assert.equal((await actuators.get(f.owner.id, actuator.id.toUpperCase())).id, actuator.id);
        assert.equal(
          (await actuators.getByCapability(f.owner.id, f.device.id.toUpperCase(), 2)).id,
          actuator.id,
        );
        assert.equal((await actuators.list(f.owner.id, { ...new ActuatorListDto(), q: 'PUMP_' })).total, 1);
        assert.equal((await actuators.list(f.owner.id, { ...new ActuatorListDto(), q: '%' })).total, 0);
        const out = await actuators.list(f.owner.id, { ...new ActuatorListDto(), offset: 100 });
        assert.equal(out.total, 1);
        assert.equal(out.items.length, 0);
        const r = await actuators.updateRequest(admin, actuator.id, { name: 'Next' }),
          requests = await actuators.listRequests(f.owner.id, { ...new FarmRequestListDto(), offset: 100 });
        assert.equal(requests.total, 1);
        assert.equal(requests.items.length, 0);
        await actuators.reject(f.owner.id, r.id);
      },
    );
    await t.test(
      'malformed record/request/history metadata fails closed and does not erase seed metadata',
      async () => {
        const f = await actuatorFixture(),
          actuator = await actuators.create(f.owner.id, f.input);
        for (const version of ['0', '9007199254740992']) {
          await sql.query(
            "UPDATE technical.entity_metadata SET version=$2 WHERE entity_type='actuators' AND entity_key=$1",
            [actuator.id, version],
          );
          await assert.rejects(actuators.getRecord(actuator.id), status(503));
        }
        await sql.query(
          'UPDATE technical.entity_metadata SET version=1,data=\'{"seed_key":"actuator-preserved"}\' WHERE entity_type=\'actuators\' AND entity_key=$1',
          [actuator.id],
        );
        await actuators.update(f.owner.id, actuator.id, { name: 'Updated' });
        assert.equal((await meta('actuators', actuator.id)).data.seed_key, 'actuator-preserved');
        const r = await actuators.updateRequest(admin, actuator.id, { name: 'Proposal' }),
          saved = (await sql.query('SELECT payload FROM technical.workflow_requests WHERE id=$1', [r.id]))
            .rows[0].payload;
        await sql.query(
          "UPDATE technical.entity_metadata SET version=0 WHERE entity_type='actuator_requests' AND entity_key=$1",
          [r.id],
        );
        await assert.rejects(actuators.approve(f.owner.id, r.id), status(503));
        await sql.query(
          "UPDATE technical.entity_metadata SET version=1 WHERE entity_type='actuator_requests' AND entity_key=$1",
          [r.id],
        );
        await sql.query(
          "UPDATE technical.workflow_requests SET payload=jsonb_set(payload,'{actuator_snapshot,capability_id}','\"2\"') WHERE id=$1",
          [r.id],
        );
        await assert.rejects(actuators.getRequest(admin, r.id), status(503));
        await sql.query('UPDATE technical.workflow_requests SET payload=$2 WHERE id=$1', [
          r.id,
          JSON.stringify(saved),
        ]);
        await actuators.reject(f.owner.id, r.id);
        const history = (await actuators.history(admin, actuator.id, page)).items.at(-1)!;
        await assert.rejects(
          sql.query("UPDATE technical.audit_events SET payload='{}' WHERE id=$1", [history.id]),
        );
        await sql.query(
          "INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ('actuators',$1,$2,'ActuatorUpdated',now(),$3)",
          [
            actuator.id,
            f.owner.id,
            JSON.stringify({
              proposed_by: null,
              request_id: null,
              version: 3,
              before: actuator,
              after: { ...actuator, purpose: 'watering' },
            }),
          ],
        );
        await assert.rejects(actuators.history(admin, actuator.id, page), status(503));
        await sql.query(
          "DELETE FROM technical.entity_metadata WHERE entity_type='actuators' AND entity_key=$1",
          [actuator.id],
        );
        await assert.rejects(actuators.getRecordByCapability(f.device.id, 2), status(503));
      },
    );
    await t.test(
      'fresh HTTP app/pool retains pending approval, exact numeric capability lookup, administrative status and history',
      async () => {
        const f = await actuatorFixture(),
          actuator = await actuators.create(f.owner.id, f.input),
          r = await actuators.updateRequest(admin, actuator.id, { status: 'Inactive' });
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
          assert.equal((await http('actuators')).status, 401);
          const owner = await login(f.owner.phone);
          assert.equal(
            (await http(`actuators/${actuator.id}`, 'PATCH', { purpose: 'watering' }, owner)).status,
            400,
          );
          await app.close();
          freshPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 5,
            connectionTimeoutMillis: 5000,
          });
          app = await application(freshPool);
          assert.throws(() => app.get(ActuatorsService).getRecord(actuator.id), status(404));
          assert.equal(
            (await http(`actuator-requests/${r.id}/approve`, 'PATCH', {}, await login(f.owner.phone))).status,
            200,
          );
          await app.close();
          app = await application(freshPool);
          const response = await http(
              `actuators/by-capability/${f.device.id}/2`,
              'GET',
              undefined,
              await login(f.owner.phone),
            ),
            value = (await response.json()) as TestActuator;
          assert.equal(response.status, 200);
          assert.equal(value.id, actuator.id);
          assert.equal(value.status, 'Inactive');
          assert.equal(value.capability_id, 2);
          const history = await http(
            `actuators/${actuator.id}/history`,
            'GET',
            undefined,
            await login(config.admin.phoneNumber),
          );
          assert.equal(((await history.json()) as { total: number }).total, 2);
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
