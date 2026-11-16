import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { MongoClient, ObjectId } from 'mongodb';
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
import { TelemetryModule } from '../src/telemetry/telemetry.module';
import { TelemetryRecords } from '../src/telemetry/telemetry-records';
import { TelemetryRecord, TelemetryPage } from '../src/telemetry/telemetry.types';
import { TelemetryStore } from '../src/telemetry/telemetry.store';
import { MongoTelemetryStore } from '../src/persistence/mongo-telemetry.store';
import { DatabaseTelemetryRecords } from '../src/persistence/database-telemetry-records';
import { MONGO_SCHEMA_V1 } from '../src/persistence/mongo-schema';
import { PostgresSensorsRepository } from '../src/persistence/postgres-sensors.repository';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { PostgresUserManagement } from '../src/persistence/postgres-user-management';
import { PostgresCooperativesRepository } from '../src/persistence/postgres-cooperatives.repository';
import { PostgresCatalogRepository } from '../src/persistence/postgres-catalog.repository';
import { PostgresFarmsRepository } from '../src/persistence/postgres-farms.repository';
import { PostgresZonesRepository } from '../src/persistence/postgres-zones.repository';
import { PostgresAssignmentsRepository } from '../src/persistence/postgres-assignments.repository';
import { PostgresTreesRepository } from '../src/persistence/postgres-trees.repository';
import { PostgresDevicesRepository } from '../src/persistence/postgres-devices.repository';
import { runMigrations } from '../src/persistence/migrations';
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
const page = { limit: 100, offset: 0 };
const status = (code: number) => (error: unknown) =>
  error instanceof HttpException && error.getStatus() === code;

async function application(
  pool: Pool,
  mongo: MongoClient,
  dbName: string,
  clock: () => Date = () => new Date(),
): Promise<INestApplication> {
  const users = new PostgresUsersRepository(pool),
    farms = new PostgresFarmsRepository(pool, users),
    catalogs = new PostgresCatalogRepository(pool, users),
    registry = new PostgresCooperativesRepository(pool, users);
  const zones = new PostgresZonesRepository(pool, users, farms, catalogs, clock),
    trees = new PostgresTreesRepository(pool, users, farms, zones),
    devices = new PostgresDevicesRepository(pool, users, farms, zones, trees),
    sensors = new PostgresSensorsRepository(pool, users, farms, zones, devices),
    assignments = new PostgresAssignmentsRepository(pool, users, farms, zones, clock),
    auth = AuthModule.forMock(config),
    userModule = UsersModule.forMock(config, auth),
    farmModule = FarmsModule.forMock(auth, userModule),
    zoneModule = ZonesModule.forMock(auth, farmModule, StandardsModule.forMock(auth)),
    treeModule = TreesModule.forMock(auth, farmModule, zoneModule);
  const deviceModule = DevicesModule.forMock(auth, farmModule, zoneModule, treeModule),
    sensorModule = SensorsModule.forMock(auth, farmModule, zoneModule, deviceModule);
  const module = await Test.createTestingModule({
    imports: [TelemetryModule.forMock(auth, farmModule, zoneModule, deviceModule, sensorModule)],
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
    .useValue(sensors)
    .overrideProvider(TelemetryRecords)
    .useValue(
      new DatabaseTelemetryRecords(
        pool,
        users,
        farms,
        zones,
        devices,
        sensors,
        assignments,
        new MongoTelemetryStore(mongo, mongo.db(dbName)),
        clock,
      ),
    )
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

test('MongoDB telemetry retains atomic FIFO across restart and enforces PostgreSQL identity and current permissions', async (t) => {
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
    await runMigrations(sql, mongo.db(name));
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
    let now = new Date();
    const clock = () => new Date(now);
    const users = new PostgresUsersRepository(sql),
      farms = new PostgresFarmsRepository(sql, users),
      catalogs = new PostgresCatalogRepository(sql, users),
      zones = new PostgresZonesRepository(sql, users, farms, catalogs, clock),
      trees = new PostgresTreesRepository(sql, users, farms, zones),
      devices = new PostgresDevicesRepository(sql, users, farms, zones, trees),
      sensors = new PostgresSensorsRepository(sql, users, farms, zones, devices),
      assignments = new PostgresAssignmentsRepository(sql, users, farms, zones, clock),
      registry = new PostgresCooperativesRepository(sql, users);
    const store = new MongoTelemetryStore(mongo, mongo.db(name)),
      telemetry = new DatabaseTelemetryRecords(
        sql,
        users,
        farms,
        zones,
        devices,
        sensors,
        assignments,
        store,
        clock,
      );
    const reset = async () => {
      await mongo.db(name).collection('IOT_TELEMETRIES').deleteMany({});
      await mongo.db(name).collection('PERSISTENCE_STATE').deleteMany({ kind: 'TelemetryInsertionCounter' });
    };
    const reading = (value = 26.5, dataStreamId = '301', receivedUnit = 'C') => ({
      dataStreamId,
      value,
      receivedUnit,
      rawResult: `${value} ${receivedUnit}`,
    });
    const raw = (deviceId: string, value = 1): TelemetryRecord => ({
      _id: new ObjectId().toHexString(),
      device_id: deviceId,
      data_stream_id: '301',
      value,
      unit: 'C',
      measured_at: now.toISOString(),
      received_at: now.toISOString(),
    });
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
    const mapped = async () => {
      const f = await sensorFixture();
      return { ...f, sensor: await sensors.create(f.owner.id, f.input) };
    };

    await t.test('empty latest/history do not bypass current scope or create a counter', async () => {
      await reset();
      const f = await mapped();
      const empty = await telemetry.latest(f.owner.id, f.device.id, page);
      assert.equal(empty.total, 0);
      assert.equal(empty.storage.mode, 'MongoDB');
      await assert.rejects(telemetry.latest(f.worker.id, f.device.id, page), status(404));
      assert.equal(
        await mongo
          .db(name)
          .collection('PERSISTENCE_STATE')
          .countDocuments({ kind: 'TelemetryInsertionCounter' }),
        0,
      );
    });
    await t.test(
      'all six streams and future stream preserve raw units, packet arrival and write time as separate BSON dates',
      async () => {
        await reset();
        const f = await mapped(),
          units = ['C', '%', '%rH', 'C', 'H+', 'µS/cm'];
        const types = [
          'air_temperature',
          'air_humidity',
          'soil_moisture',
          'soil_temperature',
          'soil_ph',
          'soil_ec',
        ] as const;
        for (let i = 1; i < 6; i++)
          await sensors.create(f.owner.id, {
            ...f.input,
            sensor_type: types[i],
            data_stream_id: String(301 + i),
            unit: units[i],
          });
        await sensors.create(f.owner.id, { ...f.input, data_stream_id: '307', unit: '%' });
        const measured = new Date(now.getTime() - 15000).toISOString();
        await telemetry.record(
          f.device.id,
          [...units.map((unit, i) => reading(20 + i, String(301 + i), unit)), reading(42, '307', '%')],
          measured,
        );
        const result = await telemetry.latest(f.owner.id, f.device.id, page);
        assert.equal(result.total, 7);
        for (const record of result.items) {
          assert.equal(record.measured_at, measured);
          assert.equal(record.received_at, now.toISOString());
          assert.equal(Object.keys(record).length, 7);
          assert.match(record._id, /^[0-9a-f]{24}$/);
        }
        assert.equal(result.items.find((r) => r.data_stream_id === '306')!.unit, 'µS/cm');
        assert.equal(result.items.find((r) => r.data_stream_id === '303')!.unit, '%rH');
        const stored = await mongo.db(name).collection('IOT_TELEMETRIES').findOne({ device_id: f.device.id });
        assert.ok(stored!._id instanceof ObjectId);
        assert.ok(stored!.received_at instanceof Date);
        assert.ok(stored!.measured_at instanceof Date);
      },
    );
    await t.test(
      'every valid packet records new readings even for equal values; insertion order wins over tied or reversed clocks',
      async () => {
        await reset();
        const f = await mapped(),
          a = raw(f.device.id, 1),
          b = raw(f.device.id, 2),
          c = raw(f.device.id, 2);
        // Explicitly reverse ObjectId ordering as well as the clock: neither
        // identifier creation time nor received_at may replace insertion FIFO.
        b._id='000000000000000000000002';
        c._id='000000000000000000000001';
        b.received_at = new Date(now.getTime() - 10000).toISOString();
        c.received_at = a.received_at;
        await store.append([a]);
        await store.append([b, c]);
        assert.deepEqual(
          (await store.newestFirst()).map((r) => r._id),
          [c._id, b._id, a._id],
        );
        assert.equal((await telemetry.latest(f.owner.id, f.device.id, page)).items[0]._id, c._id);
        await sensors.update(f.owner.id, f.sensor.id, { unit: 'oC' });
        assert.equal((await telemetry.history(f.owner.id, f.device.id, page)).items[0].unit, 'C');
      },
    );
    await t.test(
      'whole packet validation rejects duplicates, unmapped/inactive streams and malformed readings without partial writes',
      async () => {
        await reset();
        const f = await mapped();
        await telemetry.record(f.device.id, [reading()], now.toISOString());
        for (const input of [
          [reading(), reading(1)],
          [reading(), reading(1, '999')],
          [reading(NaN)],
          [reading(1, '301', '')],
          [reading(1, '301', 'x'.repeat(17))],
          [{ ...reading(), value: '1' }],
          [{ ...reading(), dataStreamId: 301 }],
        ]) {
          await assert.rejects(telemetry.record(f.device.id, input as never, now.toISOString()));
          assert.equal((await store.newestFirst()).length, 1);
        }
        await assert.rejects(telemetry.record(f.device.id, [reading()], 'bad'), status(400));
        await sensors.update(f.owner.id, f.sensor.id, { status: 'Inactive' });
        await assert.rejects(telemetry.record(f.device.id, [reading()], now.toISOString()), status(400));
        await devices.update(f.owner.id, f.device.id, { status: 'Maintenance' });
        await telemetry.record(f.device.id, [reading()], 'bad');
        assert.equal((await store.newestFirst()).length, 1);
        assert.equal((await telemetry.history(f.owner.id, f.device.id, page)).total, 1);
      },
    );
    await t.test(
      'concurrent first-counter initialization and appends serialize without lost records or reused order',
      async () => {
        await reset();
        const f = await mapped(),
          records = Array.from({ length: 20 }, (_, i) => raw(f.device.id, i));
        await Promise.all(
          records.map((record, i) =>
            (i % 2 ? new MongoTelemetryStore(mongo, mongo.db(name)) : store).append([record]),
          ),
        );
        const retained = await store.newestFirst();
        assert.equal(retained.length, 20);
        assert.equal(new Set(retained.map((r) => r._id)).size, 20);
        assert.deepEqual(
          retained.map((r) => r.value).sort((a, b) => a - b),
          records.map((r) => r.value),
        );
        const counter = await mongo
          .db(name)
          .collection('PERSISTENCE_STATE')
          .findOne({ kind: 'TelemetryInsertionCounter', key: 'global' });
        assert.equal(counter!.payload.sequence, 20);
        assert.equal(counter!.payload.retained_ids.length, 20);
      },
    );
    await t.test(
      'global FIFO retains exactly10000 across Devices and restart, with no extra latest cache',
      async () => {
        await reset();
        const f = await mapped(),
          other = await mapped(),
          old = raw(f.device.id, -1);
        await store.append([old]);
        const batch = Array.from({ length: 10000 }, (_, i) => raw(other.device.id, i));
        await store.append(batch);
        const fresh = new MongoTelemetryStore(mongo, mongo.db(name)),
          retained = await fresh.newestFirst();
        assert.equal(retained.length, 10000);
        assert.equal(retained[0]._id, batch[9999]._id);
        assert.equal(retained.at(-1)!._id, batch[0]._id);
        assert.equal(
          await mongo
            .db(name)
            .collection('IOT_TELEMETRIES')
            .countDocuments({ _id: new ObjectId(old._id) }),
          0,
        );
        assert.equal((await telemetry.latest(f.owner.id, f.device.id, page)).total, 0);
        assert.equal((await telemetry.history(other.owner.id, other.device.id, page)).total, 10000);
      },
    );
    await t.test(
      'failure updating the FIFO counter rolls back inserted readings AND eviction in the same Mongo transaction',
      async () => {
        const before = await store.newestFirst();
        assert.equal(before.length, 10000);
        const state = await mongo
            .db(name)
            .collection('PERSISTENCE_STATE')
            .findOne({ kind: 'TelemetryInsertionCounter' }),
          validator = MONGO_SCHEMA_V1.find((s) => s.name === 'PERSISTENCE_STATE')!.validator;
        await mongo.db(name).command({
          collMod: 'PERSISTENCE_STATE',
          validator: {
            $and: [
              validator,
              {
                $or: [
                  { kind: { $ne: 'TelemetryInsertionCounter' } },
                  { 'payload.sequence': state!.payload.sequence },
                ],
              },
            ],
          },
          validationLevel: 'strict',
          validationAction: 'error',
        });
        try {
          await assert.rejects(store.append([raw(before[0].device_id, 10001)]), status(503));
        } finally {
          await mongo.db(name).command({
            collMod: 'PERSISTENCE_STATE',
            validator,
            validationLevel: 'strict',
            validationAction: 'error',
          });
        }
        assert.deepEqual(
          (await store.newestFirst()).map((r) => r._id),
          before.map((r) => r._id),
        );
        assert.equal(
          (await mongo
            .db(name)
            .collection('PERSISTENCE_STATE')
            .findOne({ kind: 'TelemetryInsertionCounter' }))!.payload.sequence,
          state!.payload.sequence,
        );
      },
    );
    await t.test(
      'exhausted safe insertion counter rejects new writes without resetting order or losing retained readings',
      async () => {
        await reset();
        const f = await mapped(),
          record = raw(f.device.id);
        await store.append([record]);
        await mongo
          .db(name)
          .collection('PERSISTENCE_STATE')
          .updateOne(
            { kind: 'TelemetryInsertionCounter' },
            { $set: { 'payload.sequence': Number.MAX_SAFE_INTEGER } },
          );
        await assert.rejects(store.append([raw(f.device.id, 2)]), status(503));
        assert.deepEqual(
          (await store.newestFirst()).map((r) => r._id),
          [record._id],
        );
        assert.equal(
          (await mongo
            .db(name)
            .collection('PERSISTENCE_STATE')
            .findOne({ kind: 'TelemetryInsertionCounter' }))!.payload.sequence,
          Number.MAX_SAFE_INTEGER,
        );
      },
    );
    await t.test(
      'Accepted current assignment filters received_at before latest and counts; renewal does not expose prior history',
      async () => {
        await reset();
        const f = await mapped();
        await telemetry.record(f.device.id, [reading(1)], now.toISOString());
        now = new Date(now.getTime() + 1000);
        const r = await assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id });
        await assert.rejects(telemetry.history(f.worker.id, f.device.id, page), status(404));
        const accepted = await assignments.approve(f.worker.id, r.id);
        assert.equal((await telemetry.latest(f.worker.id, f.device.id, page)).total, 0);
        now = new Date(now.getTime() + 1000);
        await telemetry.record(f.device.id, [reading(2)], now.toISOString());
        assert.equal((await telemetry.history(f.worker.id, f.device.id, page)).total, 1);
        now = new Date(now.getTime() + 1000);
        await assignments.end(f.owner.id, accepted.assignment_id!);
        await assert.rejects(telemetry.latest(f.worker.id, f.device.id, page), status(404));
        const second = await assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id });
        await assignments.approve(f.worker.id, second.id);
        assert.equal((await telemetry.history(f.worker.id, f.device.id, page)).total, 0);
        now = new Date(now.getTime() + 1000);
        await telemetry.record(f.device.id, [reading(3)], now.toISOString());
        assert.equal((await telemetry.latest(f.worker.id, f.device.id, page)).items[0].value, 3);
        assert.equal((await telemetry.history(f.owner.id, f.device.id, page)).total, 3);
      },
    );
    await t.test(
      'Manager current HTX scope follows Join/Leave while Admin and owner retain their scopes',
      async () => {
        await reset();
        const f = await mapped(),
          phone = `0900000${String(n++).padStart(3, '0')}`,
          gmail = `telemetry-manager${n}@example.invalid`;
        await telemetry.record(f.device.id, [reading()], now.toISOString());
        const account = await users.createRegisteredUser(
          { user_name: 'Manager fixture', phone_number: phone, gmail, passwordHash: hash, role: 'Manager' },
          gmail,
        );
        const c = await registry.approve(admin, account.user.id, {
          cooperative: {
            cooperative_name: 'HTX telemetry',
            director: 'Ban quản trị',
            certificate_number: `TELEM-${n}`,
            address: 'Đắk Lắk',
            contact_number: phone,
          },
        });
        await assert.rejects(telemetry.latest(account.user.id, f.device.id, page), status(404));
        const join = await farms.joinRequest(f.owner.id, f.farm, c.cooperative.id);
        await farms.approve(admin, join.id);
        await farms.approve(account.user.id, join.id);
        assert.equal((await telemetry.history(account.user.id, f.device.id, page)).total, 1);
        const leave = await farms.leaveRequest(f.owner.id, f.farm);
        await farms.approve(admin, leave.id);
        await assert.rejects(telemetry.latest(account.user.id, f.device.id, page), status(404));
        assert.equal((await telemetry.latest(admin, f.device.id, page)).total, 1);
        assert.equal((await telemetry.latest(f.owner.id, f.device.id, page)).total, 1);
      },
    );
    await t.test(
      'history uses half-open received range, strict DTOs and exact streams; total survives an empty last page',
      async () => {
        await reset();
        const f = await mapped(),
          first = now.toISOString();
        await telemetry.record(f.device.id, [reading(1)], first);
        now = new Date(now.getTime() + 1000);
        const second = now.toISOString();
        await telemetry.record(f.device.id, [reading(2)], first);
        const result = await telemetry.history(f.owner.id, f.device.id, { ...page, from: first, to: second });
        assert.equal(result.total, 1);
        assert.equal(result.items[0].value, 1);
        const out = await telemetry.history(f.owner.id, f.device.id, { ...page, offset: 100 });
        assert.equal(out.total, 2);
        assert.equal(out.items.length, 0);
        assert.equal(
          (
            await telemetry.latest(f.owner.id, f.device.id.toUpperCase(), {
              ...page,
              data_stream_id: 'missing',
            })
          ).total,
          0,
        );
        for (const query of [
          { ...page, limit: 101 },
          { ...page, offset: -1 },
          { ...page, data_stream_id: 301 },
          { ...page, user_id: f.owner.id },
          { ...page, from: second, to: first },
          { ...page, from: '2026-02-30T00:00:00Z' },
          { ...page, from: '2026-10-19' },
        ])
          await assert.rejects(telemetry.history(f.owner.id, f.device.id, query as never), status(400));
        await assert.rejects(
          telemetry.latest(f.owner.id, f.device.id, { ...page, from: first } as never),
          status(400),
        );
      },
    );
    await t.test(
      'corrupt ordering state, missing reading and orphan records fail closed instead of repairing or changing retention',
      async () => {
        await reset();
        const f = await mapped();
        await store.append([raw(f.device.id)]);
        const state = await mongo
          .db(name)
          .collection('PERSISTENCE_STATE')
          .findOne({ kind: 'TelemetryInsertionCounter' });
        await mongo
          .db(name)
          .collection('PERSISTENCE_STATE')
          .updateOne({ _id: state!._id }, { $set: { 'payload.retained_ids': [new ObjectId()] } });
        await assert.rejects(telemetry.latest(f.owner.id, f.device.id, page), status(503));
        await mongo.db(name).collection('PERSISTENCE_STATE').replaceOne({ _id: state!._id }, state!);
        await mongo
          .db(name)
          .collection('IOT_TELEMETRIES')
          .insertOne({ ...raw(f.device.id), _id: new ObjectId(), measured_at: now, received_at: now });
        await assert.rejects(store.newestFirst(), status(503));
        await mongo
          .db(name)
          .collection('PERSISTENCE_STATE')
          .deleteMany({ kind: 'TelemetryInsertionCounter' });
        await assert.rejects(store.newestFirst(), status(503));
        await assert.rejects(telemetry.record(f.device.id, [reading()], now.toISOString()), status(503));
        assert.equal(await mongo.db(name).collection('IOT_TELEMETRIES').countDocuments({}), 2);
        await reset();
      },
    );
    await t.test(
      'Sensor metadata corruption prevents insertion; unavailable Mongo never falls back and outside scope fails before storage',
      async () => {
        const f = await mapped();
        await sql.query(
          "UPDATE technical.entity_metadata SET version=0 WHERE entity_type='sensors' AND entity_key=$1",
          [f.sensor.id],
        );
        await assert.rejects(telemetry.record(f.device.id, [reading()], now.toISOString()), status(503));
        assert.equal((await store.newestFirst()).length, 0);
        await sql.query(
          "UPDATE technical.entity_metadata SET version=1 WHERE entity_type='sensors' AND entity_key=$1",
          [f.sensor.id],
        );
        const failedStore = new MongoTelemetryStore(mongo, mongo.db(name));
        failedStore.newestFirst = async () => {
          throw new Error('private driver error should stay hidden');
        };
        const unavailable = new DatabaseTelemetryRecords(
          sql,
          users,
          farms,
          zones,
          devices,
          sensors,
          assignments,
          failedStore,
          clock,
        );
        await assert.rejects(unavailable.latest(f.worker.id, f.device.id, page), status(404));
        await assert.rejects(
          unavailable.latest(f.owner.id, f.device.id, page),
          (error) => status(503)(error) && !String(error).includes('private driver'),
        );
      },
    );
    await t.test(
      'user revocation while a read waits on a PostgreSQL lock is rechecked before returning Mongo data',
      async () => {
        const f = await mapped();
        await telemetry.record(f.device.id, [reading()], now.toISOString());
        const waitingPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 1,
            application_name: 'telemetry-read-revocation',
            connectionTimeoutMillis: 5000,
          }),
          blocker = await sql.connect();
        let done: Promise<PromiseSettledResult<unknown>> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.owner.id]);
          const reader = new DatabaseTelemetryRecords(
            waitingPool,
            new PostgresUsersRepository(waitingPool),
            farms,
            zones,
            devices,
            sensors,
            assignments,
            store,
            clock,
          );
          done = reader.history(f.owner.id, f.device.id, page).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason) => ({ status: 'rejected' as const, reason }),
          );
          let blocked = false;
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            blocked = Boolean(
              (
                await sql.query(
                  "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='telemetry-read-revocation' AND wait_event_type='Lock'",
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
      'fresh HTTP app, PostgreSQL pool and Mongo client retain readings, raw units and FIFO state while unused RAM is empty',
      async () => {
        await reset();
        const f = await mapped();
        await telemetry.record(f.device.id, [reading(12, '301', 'oC')], now.toISOString());
        let app = await application(sql, mongo, name, clock),
          freshPool: Pool | undefined,
          freshMongo: MongoClient | undefined;
        const http = async (path: string, method = 'GET', body?: object, token?: string) =>
          fetch(`${await app.getUrl()}/api/${path}`, {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        const login = async () => {
          const response = await http('auth/login', 'POST', {
            phone_number: f.owner.phone,
            password: config.admin.password,
          });
          assert.equal(response.status, 200);
          return ((await response.json()) as { access_token: string }).access_token;
        };
        try {
          assert.equal((await http(`telemetry/devices/${f.device.id}/latest`)).status, 401);
          await app.close();
          freshPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 5,
            connectionTimeoutMillis: 5000,
          });
          freshMongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
          await freshMongo.connect();
          app = await application(freshPool, freshMongo, name, clock);
          assert.equal(app.get(TelemetryStore).newestFirst().length, 0);
          const token = await login(),
            response = await http(`telemetry/devices/${f.device.id}/latest`, 'GET', undefined, token),
            result = (await response.json()) as TelemetryPage;
          assert.equal(response.status, 200);
          assert.equal(result.items[0].value, 12);
          assert.equal(result.items[0].unit, 'oC');
          assert.equal(result.storage.mode, 'MongoDB');
          assert.equal(
            (await http(`telemetry/devices/${f.device.id}/history`, 'POST', {}, token)).status,
            404,
          );
          await app.close();
          app = await application(freshPool, freshMongo, name, clock);
          assert.equal(
            (
              (await (
                await http(`telemetry/devices/${f.device.id}/history`, 'GET', undefined, await login())
              ).json()) as TelemetryPage
            ).total,
            1,
          );
        } finally {
          await app.close();
          await freshPool?.end();
          await freshMongo?.close();
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
