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
import { SensorsModule } from '../src/sensors/sensors.module';
import { SensorRecords } from '../src/sensors/sensor-records';
import { SensorsService } from '../src/sensors/sensors.service';
import { SensorListDto } from '../src/sensors/sensors.dto';
import { TestSensor, SENSOR_TYPES } from '../src/sensors/sensors.types';
import { PostgresSensorsRepository } from '../src/persistence/postgres-sensors.repository';
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
      SensorsModule.forMock(
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
    .overrideProvider(SensorRecords)
    .useValue(new PostgresSensorsRepository(pool, users, farms, zones, devices))
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

test('PostgreSQL Sensors preserve composite stream identity, thresholds, metadata workflows and restart state', async (t) => {
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
      'migration012 rejects duplicate Pending targets atomically without modifying records or earlier checksums',
      async () => {
        await runMigrations(sql, mongo.db(name), MIGRATIONS.slice(0, 11));
        const user = (
          await sql.query(
            `INSERT INTO public.users(user_name,phone_number,password,role,status) VALUES ('Migration fixture','0900000087','unused-fixture','Farmer','Active') RETURNING id`,
          )
        ).rows[0].id;
        const rows = await sql.query(
          `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at) VALUES ('sensors','Update','Pending',$1,$2,'{}',now()),('sensors','Update','Pending',upper($1),$2,'{}',now()) RETURNING id`,
          [randomUUID(), user],
        );
        await assert.rejects(
          runMigrations(sql, mongo.db(name)),
          (error: unknown) => (error as { code: string }).code === '23505',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count,
          '11',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.workflow_requests')).rows[0].count,
          '2',
        );
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[1].id]);
        assert.deepEqual(await runMigrations(sql, mongo.db(name)), MIGRATIONS.filter((entry) => entry.id >= '012_sensor_workflow').map((entry) => entry.id));
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
      sensors = new PostgresSensorsRepository(sql, users, farms, zones, devices),
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
    const sensorFixture = async () => {
      const f = await fixture();
      return {
        ...f,
        input: {
          device_id: f.device.id,
          name: 'Nhiệt độ không khí',
          sensor_type: 'air_temperature' as const,
          data_stream_id: '301',
          unit: 'C',
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
      'owner registration supports all six types, raw units and future stream IDs, with nullable thresholds',
      async () => {
        const f = await sensorFixture();
        const units = ['C', '%', '%RH', 'C', 'H+', 'μS/cm'];
        for (const [i, sensor_type] of SENSOR_TYPES.entries()) {
          const sensor = await sensors.create(f.owner.id, {
            ...f.input,
            sensor_type,
            data_stream_id: String(301 + i),
            unit: units[i],
          });
          assert.equal(sensor.sensor_type, sensor_type);
          assert.equal(sensor.unit, units[i]);
          assert.equal(sensor.min_threshold, null);
          assert.equal(sensor.max_threshold, null);
          assert.equal(sensor.status, 'Active');
          assert.deepEqual(
            Object.keys(sensor).sort(),
            [
              'id',
              'device_id',
              'name',
              'sensor_type',
              'data_stream_id',
              'unit',
              'min_threshold',
              'max_threshold',
              'status',
            ].sort(),
          );
          assert.notEqual(sensor.id, sensor.data_stream_id);
        }
        const future = await sensors.create(f.owner.id, { ...f.input, data_stream_id: 'NEW_STREAM_307' });
        assert.equal((await sensors.getRecordByStream(f.device.id, 'NEW_STREAM_307')).id, future.id);
        assert.equal((await sensors.list(f.owner.id, new SensorListDto())).total, 7);
      },
    );
    await t.test(
      'composite uniqueness is Device-local and exact, Inactive retains stream, SQL prevents immutable field changes',
      async () => {
        const f = await sensorFixture(),
          other = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, f.input);
        const second = await sensors.create(other.owner.id, other.input);
        assert.notEqual(second.id, sensor.id);
        assert.equal(second.data_stream_id, sensor.data_stream_id);
        await sensors.update(f.owner.id, sensor.id, { status: 'Inactive' });
        await assert.rejects(sensors.create(f.owner.id, f.input), status(409));
        await assert.rejects(sensors.createRequest(admin, f.input), status(409));
        for (const [column, value] of [
          ['id', randomUUID()],
          ['device_id', other.device.id],
          ['data_stream_id', 'CHANGED'],
          ['sensor_type', 'soil_ph'],
        ]) {
          await assert.rejects(
            sql.query(`UPDATE public.sensors SET ${column}=$2 WHERE id=$1`, [sensor.id, value]),
          );
        }
        const upper = await sensors.create(f.owner.id, { ...f.input, data_stream_id: 'AbC' }),
          lower = await sensors.create(f.owner.id, { ...f.input, data_stream_id: 'abc' });
        assert.equal((await sensors.getByStream(f.owner.id, f.device.id, 'AbC')).id, upper.id);
        assert.equal((await sensors.getByStream(f.owner.id, f.device.id, 'abc')).id, lower.id);
      },
    );
    await t.test(
      'threshold PATCH merges both fields, supports explicit paired null and unit edits without implicit conversion or activation',
      async () => {
        const f = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, {
            ...f.input,
            min_threshold: 10,
            max_threshold: 30,
            status: 'Inactive',
          });
        const after = await sensors.update(f.owner.id, sensor.id, { unit: '%RH', min_threshold: 11.25 });
        assert.equal(after.max_threshold, 30);
        assert.equal(after.min_threshold, 11.25);
        assert.equal(after.unit, '%RH');
        assert.equal(after.status, 'Inactive');
        for (const input of [
          { min_threshold: null },
          { max_threshold: null },
          { min_threshold: 30 },
          { max_threshold: 11.25 },
        ]) {
          await assert.rejects(sensors.update(f.owner.id, sensor.id, input), status(400));
          await assert.rejects(sensors.updateRequest(admin, sensor.id, input), status(400));
        }
        const cleared = await sensors.update(f.owner.id, sensor.id, {
          min_threshold: null,
          max_threshold: null,
        });
        assert.equal(cleared.min_threshold, null);
        assert.equal(cleared.max_threshold, null);
        const history = await sensors.history(admin, sensor.id, page);
        assert.equal(history.total, 3);
        assert.deepEqual(history.items[0].after, sensor);
        assert.equal(history.items[1].after.unit, '%RH');
        assert.equal(history.items[0].after.unit, 'C');
        assert.equal((await meta('sensors', sensor.id)).version, '3');
        await assert.rejects(
          sensors.create(f.owner.id, { ...f.input, data_stream_id: '302', min_threshold: 1 }),
          status(400),
        );
      },
    );
    await t.test(
      'current Accepted worker reads metadata/history but cannot write; End removes Sensor access',
      async () => {
        const f = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, f.input);
        await assert.rejects(sensors.get(f.worker.id, sensor.id), status(404));
        const r = await assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id });
        await assert.rejects(sensors.getByStream(f.worker.id, f.device.id, '301'), status(404));
        const a = await assignments.approve(f.worker.id, r.id);
        assert.equal((await sensors.history(f.worker.id, sensor.id, page)).total, 1);
        await assert.rejects(sensors.update(f.worker.id, sensor.id, { name: 'Worker' }), status(403));
        await assert.rejects(sensors.update(admin, sensor.id, { name: 'Admin direct' }), status(403));
        await assert.rejects(
          sensors.createRequest(f.owner.id, { ...f.input, data_stream_id: '302' }),
          status(403),
        );
        await assignments.end(f.owner.id, a.assignment_id!);
        await assert.rejects(sensors.history(f.worker.id, sensor.id, page), status(404));
        assert.equal((await sensors.list(f.worker.id, new SensorListDto())).total, 0);
      },
    );
    await t.test(
      'Manager scope follows current Farm membership and cannot view proposals or change metadata',
      async () => {
        const f = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, f.input),
          phone = `0900000${String(n++).padStart(3, '0')}`,
          gmail = `sensor-manager${n}@example.invalid`;
        const account = await users.createRegisteredUser(
          { user_name: 'Manager fixture', phone_number: phone, gmail, passwordHash: hash, role: 'Manager' },
          gmail,
        );
        const c = await registry.approve(admin, account.user.id, {
          cooperative: {
            cooperative_name: 'HTX cảm biến',
            director: 'Ban quản trị',
            certificate_number: `SENSOR-HTX-${n}`,
            address: 'Đắk Lắk',
            contact_number: phone,
          },
        });
        await assert.rejects(sensors.get(account.user.id, sensor.id), status(404));
        const join = await farms.joinRequest(f.owner.id, f.farm, c.cooperative.id);
        await farms.approve(admin, join.id);
        await farms.approve(account.user.id, join.id);
        assert.equal((await sensors.get(account.user.id, sensor.id)).id, sensor.id);
        const r = await sensors.updateRequest(admin, sensor.id, { name: 'Đề xuất' });
        await assert.rejects(sensors.getRequest(account.user.id, r.id), status(404));
        await assert.rejects(sensors.approve(account.user.id, r.id), status(403));
        await assert.rejects(sensors.update(account.user.id, sensor.id, { name: 'Manager' }), status(403));
        const leave = await farms.leaveRequest(f.owner.id, f.farm);
        await farms.approve(admin, leave.id);
        await assert.rejects(sensors.history(account.user.id, sensor.id, page), status(404));
        await sensors.reject(f.owner.id, r.id);
      },
    );
    await t.test(
      'Admin Create/Update proposals apply only through owner, keep snapshots and nullable threshold changes',
      async () => {
        const f = await sensorFixture(),
          r = await sensors.createRequest(admin, f.input);
        assert.equal(r.sensor_id, null);
        assert.equal(r.device_id, f.device.id);
        assert.equal(r.zone_id, f.zone.id);
        await assert.rejects(sensors.getRecordByStream(f.device.id, '301'), status(404));
        const accepted = await sensors.approve(f.owner.id, r.id),
          sensor = await sensors.getRecord(accepted.sensor_id!);
        assert.equal(accepted.status, 'Accepted');
        assert.equal(accepted.resolved_by, f.owner.id);
        const edit = await sensors.updateRequest(admin, sensor.id, {
          min_threshold: -10.5,
          max_threshold: 50.25,
          unit: 'oC',
        });
        assert.deepEqual(edit.sensor_snapshot, sensor);
        assert.deepEqual(await sensors.getRecord(sensor.id), sensor);
        await sensors.approve(f.owner.id, edit.id);
        const after = await sensors.getRecord(sensor.id);
        assert.equal(after.min_threshold, -10.5);
        assert.equal(after.max_threshold, 50.25);
        assert.equal(after.unit, 'oC');
        const history = await sensors.history(admin, sensor.id, page);
        assert.equal(history.total, 2);
        assert.equal(history.items[1].proposed_by, admin);
        assert.equal(history.items[1].actor_id, f.owner.id);
        assert.equal(history.items[1].request_id, edit.id);
        await assert.rejects(sensors.approve(f.owner.id, edit.id), status(409));
        assert.equal((await meta('sensor_requests', edit.id)).version, '2');
      },
    );
    await t.test(
      'stale version or revoked Admin cannot apply; rejected workflows leave official data unchanged',
      async () => {
        const f = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, f.input),
          r = await sensors.updateRequest(admin, sensor.id, { name: 'Stale' });
        await sensors.update(f.owner.id, sensor.id, { name: 'Owner changed' });
        await assert.rejects(sensors.approve(f.owner.id, r.id), status(409));
        await sensors.reject(f.owner.id, r.id, 'Gửi lại');
        for (const patch of ["status='Locked'", "role='Farmer'"]) {
          const p = await sensors.updateRequest(admin, sensor.id, { unit: 'oC' });
          await sql.query(`UPDATE public.users SET ${patch} WHERE id=$1`, [admin]);
          try {
            await assert.rejects(
              sensors.approve(f.owner.id, p.id),
              patch.startsWith('status') ? status(403) : status(409),
            );
          } finally {
            await sql.query("UPDATE public.users SET status='Active',role='Admin' WHERE id=$1", [admin]);
          }
          assert.equal((await sensors.getRequest(admin, p.id)).status, 'Pending');
          await sensors.reject(f.owner.id, p.id);
        }
        assert.equal((await sensors.getRecord(sensor.id)).unit, 'C');
      },
    );
    await t.test(
      'same-pair concurrent creates and Pending approvals serialize, same stream across Devices remains allowed',
      async () => {
        const f = await sensorFixture();
        const creates = await Promise.allSettled([
          sensors.create(f.owner.id, f.input),
          sensors.create(f.owner.id, f.input),
        ]);
        assert.equal(creates.filter((x) => x.status === 'fulfilled').length, 1);
        assert.ok(creates.some((x) => x.status === 'rejected' && status(409)(x.reason)));
        const sensor = await sensors.getRecordByStream(f.device.id, '301');
        const updates = await Promise.allSettled([
          sensors.updateRequest(admin, sensor.id, { name: 'A' }),
          sensors.updateRequest(admin, sensor.id, { name: 'B' }),
        ]);
        assert.equal(updates.filter((x) => x.status === 'fulfilled').length, 1);
        const p = updates.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<
          Awaited<ReturnType<typeof sensors.updateRequest>>
        >;
        const approvals = await Promise.allSettled([
          sensors.approve(f.owner.id, p.value.id),
          sensors.approve(f.owner.id, p.value.id),
        ]);
        assert.equal(approvals.filter((x) => x.status === 'fulfilled').length, 1);
        assert.equal((await sensors.history(admin, sensor.id, page)).total, 2);
        const pending = await sensors.createRequest(admin, { ...f.input, data_stream_id: '302' });
        await sensors.create(f.owner.id, { ...f.input, data_stream_id: '302' });
        await assert.rejects(sensors.approve(f.owner.id, pending.id), status(409));
        await sensors.reject(f.owner.id, pending.id);
        const other = await sensorFixture();
        assert.equal((await sensors.create(other.owner.id, other.input)).data_stream_id, '301');
      },
    );
    await t.test(
      'metadata maintenance is allowed on Inactive/Maintenance parent and presence does not stale Sensor proposal',
      async () => {
        const f = await sensorFixture();
        await devices.update(f.owner.id, f.device.id, { status: 'Inactive' });
        const sensor = await sensors.create(f.owner.id, f.input),
          r = await sensors.updateRequest(admin, sensor.id, { unit: 'oC' });
        await devices.update(f.owner.id, f.device.id, { status: 'Maintenance' });
        await devices.recordSeen(f.device.id, '2026-10-19T01:00:00Z');
        await sensors.approve(f.owner.id, r.id);
        assert.equal((await sensors.getRecord(sensor.id)).unit, 'oC');
        assert.equal((await devices.getRecord(f.device.id)).status, 'Maintenance');
      },
    );
    await t.test(
      'UUID collision is bounded without rewriting an existing sensor or leaving partial history',
      async () => {
        const f = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, f.input);
        let calls = 0;
        const retry = new PostgresSensorsRepository(sql, users, farms, zones, devices, undefined, () =>
          ++calls < 3 ? sensor.id : randomUUID(),
        );
        const created = await retry.create(f.owner.id, { ...f.input, data_stream_id: '302' });
        assert.equal(calls, 3);
        assert.notEqual(created.id, sensor.id);
        const exhausted = new PostgresSensorsRepository(
          sql,
          users,
          farms,
          zones,
          devices,
          undefined,
          () => sensor.id,
        );
        await assert.rejects(
          exhausted.create(f.owner.id, { ...f.input, data_stream_id: '303' }),
          status(409),
        );
        await assert.rejects(sensors.getRecordByStream(f.device.id, '303'), status(404));
        assert.deepEqual(await sensors.getRecord(sensor.id), sensor);
      },
    );
    await t.test(
      'audit failure rolls back official record, version, history and request terminal atomically',
      async () => {
        const f = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, f.input),
          r = await sensors.updateRequest(admin, sensor.id, { name: 'Apply' });
        await sql.query(
          `CREATE FUNCTION technical.fail_sensor_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='sensors' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_sensor_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW EXECUTE FUNCTION technical.fail_sensor_audit()`,
        );
        try {
          await assert.rejects(sensors.approve(f.owner.id, r.id), status(503));
          await assert.rejects(
            sensors.create(f.owner.id, { ...f.input, data_stream_id: '302' }),
            status(503),
          );
        } finally {
          await sql.query(
            'DROP TRIGGER fail_sensor_audit ON technical.audit_events; DROP FUNCTION technical.fail_sensor_audit()',
          );
        }
        assert.deepEqual(await sensors.getRecord(sensor.id), sensor);
        assert.equal((await meta('sensors', sensor.id)).version, '1');
        assert.equal((await sensors.getRequest(admin, r.id)).status, 'Pending');
        assert.equal((await sensors.history(admin, sensor.id, page)).total, 1);
        await assert.rejects(sensors.getRecordByStream(f.device.id, '302'), status(404));
        await sensors.approve(f.owner.id, r.id);
      },
    );
    await t.test(
      'DTOs enforce immutable identifiers, nullable numeric pairs, canonical UUID, trimmed text and literal paged search',
      async () => {
        const f = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, { ...f.input, name: '  Air_sensor  ', unit: ' C ' });
        assert.equal(sensor.name, 'Air_sensor');
        assert.equal(sensor.unit, 'C');
        for (const input of [
          { name: null },
          { unit: null },
          { unit: 'x'.repeat(17) },
          { name: ' ' },
          { sensor_type: 'soil_ph' },
          { device_id: f.device.id },
          { data_stream_id: '302' },
          { status: 'Online' },
          { min_threshold: '1' },
          { min_threshold: 1.234, max_threshold: 5 },
          { min_threshold: -100000, max_threshold: 1 },
          {},
        ]) {
          await assert.rejects(sensors.update(f.owner.id, sensor.id, input as never), status(400));
        }
        for (const input of [
          { sensor_type: 'unsupported' },
          { data_stream_id: 301 },
          { data_stream_id: 'a/b' },
          { device_id: f.device.station_id },
          { min_threshold: 1 },
          { min_threshold: 1, max_threshold: 1 },
        ]) {
          await assert.rejects(sensors.create(f.owner.id, { ...f.input, ...input } as never), status(400));
        }
        assert.equal((await sensors.get(f.owner.id, sensor.id.toUpperCase())).id, sensor.id);
        assert.equal((await sensors.getByStream(f.owner.id, f.device.id.toUpperCase(), '301')).id, sensor.id);
        assert.equal((await sensors.list(f.owner.id, { ...new SensorListDto(), q: 'AIR_' })).total, 1);
        assert.equal((await sensors.list(f.owner.id, { ...new SensorListDto(), q: '%' })).total, 0);
        const out = await sensors.list(f.owner.id, { ...new SensorListDto(), offset: 100 });
        assert.equal(out.total, 1);
        assert.equal(out.items.length, 0);
        assert.equal(
          (await sensors.list(f.owner.id, { ...new SensorListDto(), sensor_type: 'soil_ec' })).total,
          0,
        );
        const r = await sensors.updateRequest(admin, sensor.id, { name: 'Next' }),
          requests = await sensors.listRequests(f.owner.id, { ...new FarmRequestListDto(), offset: 100 });
        assert.equal(requests.total, 1);
        assert.equal(requests.items.length, 0);
        await sensors.reject(f.owner.id, r.id);
      },
    );
    await t.test(
      'missing/overflow metadata and corrupt workflow/history fail closed without RAM fallback; seed metadata survives writes',
      async () => {
        const f = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, f.input);
        for (const version of ['0', '9007199254740992']) {
          await sql.query(
            "UPDATE technical.entity_metadata SET version=$2 WHERE entity_type='sensors' AND entity_key=$1",
            [sensor.id, version],
          );
          await assert.rejects(sensors.getRecord(sensor.id), status(503));
        }
        await sql.query(
          'UPDATE technical.entity_metadata SET version=1,data=\'{"seed_key":"sensor-preserved"}\' WHERE entity_type=\'sensors\' AND entity_key=$1',
          [sensor.id],
        );
        await sensors.update(f.owner.id, sensor.id, { unit: 'oC' });
        assert.equal((await meta('sensors', sensor.id)).data.seed_key, 'sensor-preserved');
        const r = await sensors.updateRequest(admin, sensor.id, { name: 'Proposal' }),
          saved = (await sql.query('SELECT payload FROM technical.workflow_requests WHERE id=$1', [r.id]))
            .rows[0].payload;
        await sql.query(
          "UPDATE technical.entity_metadata SET version=0 WHERE entity_type='sensor_requests' AND entity_key=$1",
          [r.id],
        );
        await assert.rejects(sensors.approve(f.owner.id, r.id), status(503));
        await sql.query(
          "UPDATE technical.entity_metadata SET version=1 WHERE entity_type='sensor_requests' AND entity_key=$1",
          [r.id],
        );
        await sql.query(
          "UPDATE technical.workflow_requests SET payload=jsonb_set(payload,'{sensor_snapshot,device_id}','null') WHERE id=$1",
          [r.id],
        );
        await assert.rejects(sensors.getRequest(admin, r.id), status(503));
        await sql.query('UPDATE technical.workflow_requests SET payload=$2 WHERE id=$1', [
          r.id,
          JSON.stringify(saved),
        ]);
        await sensors.reject(f.owner.id, r.id);
        const history = (await sensors.history(admin, sensor.id, page)).items.at(-1)!;
        await assert.rejects(
          sql.query("UPDATE technical.audit_events SET payload='{}' WHERE id=$1", [history.id]),
        );
        await sql.query(
          "INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ('sensors',$1,$2,'SensorUpdated',now(),$3)",
          [
            sensor.id,
            f.owner.id,
            JSON.stringify({
              proposed_by: null,
              request_id: null,
              version: 3,
              before: sensor,
              after: { ...sensor, sensor_type: 'soil_ec' },
            }),
          ],
        );
        await assert.rejects(sensors.history(admin, sensor.id, page), status(503));
        await sql.query(
          "DELETE FROM technical.entity_metadata WHERE entity_type='sensors' AND entity_key=$1",
          [sensor.id],
        );
        await assert.rejects(sensors.getRecordByStream(f.device.id, '301'), status(503));
      },
    );
    await t.test(
      'owner revocation while the writer waits on a lock is rechecked before Sensor mutation',
      async () => {
        const f = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, f.input),
          waitingPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 1,
            application_name: 'sensor-owner-revocation',
            connectionTimeoutMillis: 5000,
          }),
          blocker = await sql.connect();
        let done: Promise<PromiseSettledResult<unknown>> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.owner.id]);
          const writer = new PostgresSensorsRepository(
            waitingPool,
            new PostgresUsersRepository(waitingPool),
            farms,
            zones,
            devices,
          );
          done = writer.update(f.owner.id, sensor.id, { name: 'Forbidden' }).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason) => ({ status: 'rejected' as const, reason }),
          );
          let blocked = false;
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            blocked = Boolean(
              (
                await sql.query(
                  "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='sensor-owner-revocation' AND wait_event_type='Lock'",
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
          assert.deepEqual(await sensors.getRecord(sensor.id), sensor);
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
      'fresh HTTP app and pool retain pending proposal, accepted nullable thresholds, exact stream lookup and history',
      async () => {
        const f = await sensorFixture(),
          sensor = await sensors.create(f.owner.id, { ...f.input, min_threshold: 1, max_threshold: 9 }),
          r = await sensors.updateRequest(admin, sensor.id, {
            min_threshold: null,
            max_threshold: null,
            unit: 'oC',
          });
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
          assert.equal((await http('sensors')).status, 401);
          const owner = await login(f.owner.phone);
          assert.equal(
            (await http(`sensors/${sensor.id}`, 'PATCH', { sensor_type: 'soil_ph' }, owner)).status,
            400,
          );
          await app.close();
          freshPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 5,
            connectionTimeoutMillis: 5000,
          });
          app = await application(freshPool);
          assert.throws(() => app.get(SensorsService).getRecord(sensor.id), status(404));
          assert.equal(
            (await http(`sensor-requests/${r.id}/approve`, 'PATCH', {}, await login(f.owner.phone))).status,
            200,
          );
          await app.close();
          app = await application(freshPool);
          const response = await http(
              `sensors/by-stream/${f.device.id}/301`,
              'GET',
              undefined,
              await login(f.owner.phone),
            ),
            value = (await response.json()) as TestSensor;
          assert.equal(response.status, 200);
          assert.equal(value.id, sensor.id);
          assert.equal(value.unit, 'oC');
          assert.equal(value.min_threshold, null);
          assert.equal(value.max_threshold, null);
          const history = await http(
            `sensors/${sensor.id}/history`,
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
