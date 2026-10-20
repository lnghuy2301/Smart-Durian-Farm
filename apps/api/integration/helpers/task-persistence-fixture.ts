import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule } from '../../src/auth/auth.module';
import { UserAccounts } from '../../src/auth/user-accounts';
import { ActuatorTasksController } from '../../src/actuator-tasks/actuator-tasks.controller';
import { ActuatorTaskRecords } from '../../src/actuator-tasks/actuator-task-records';
import { MqttTransport, TransportHandlers } from '../../src/mqtt/mqtt.transport';
import { PostgresUsersRepository } from '../../src/persistence/postgres-users.repository';
import { PostgresFarmsRepository } from '../../src/persistence/postgres-farms.repository';
import { PostgresCatalogRepository } from '../../src/persistence/postgres-catalog.repository';
import { PostgresZonesRepository } from '../../src/persistence/postgres-zones.repository';
import { PostgresTreesRepository } from '../../src/persistence/postgres-trees.repository';
import { PostgresDevicesRepository } from '../../src/persistence/postgres-devices.repository';
import { PostgresActuatorsRepository } from '../../src/persistence/postgres-actuators.repository';
import { PostgresAssignmentsRepository } from '../../src/persistence/postgres-assignments.repository';
import { PostgresCooperativesRepository } from '../../src/persistence/postgres-cooperatives.repository';
import { PostgresTaskAccess } from '../../src/persistence/postgres-task-access';
import { DatabaseActuatorTaskRecords } from '../../src/persistence/database-actuator-task-records';
import { MongoActuatorTaskStore } from '../../src/persistence/mongo-actuator-task.store';
import { runMigrations } from '../../src/persistence/migrations';
import { seedDemo } from '../../src/persistence/seed';
import { readSeedConfig } from '../../src/persistence/seed-config';

export interface Wire { targets: { taskId: number; taskingCapabilityId: number }[]; taskingParameters: { actionType: 'control'; action: 0 | 1 } }
export class TaskTransport extends MqttTransport {
  sent: { topic: string; wire: Wire }[] = [];
  hold = false;
  fail = false;
  deferred: { resolve: () => void; reject: () => void }[] = [];
  start(_handlers: TransportHandlers) { void _handlers; }
  async stop() {}
  publish(topic: string, payload: string): Promise<{ status: 'TransportAccepted' }> {
    this.sent.push({ topic, wire: JSON.parse(payload) as Wire });
    if (this.fail) { this.fail = false; return Promise.reject(new Error('private transport fixture')); }
    if (this.hold) return new Promise((resolve, reject) => this.deferred.push({ resolve: () => resolve({ status: 'TransportAccepted' }), reject: () => reject(new Error('private publish failure')) }));
    return Promise.resolve({ status: 'TransportAccepted' });
  }
}
export const readyState = { enabled: true, connected: true, subscribed: true, last_error: null } as const;
export const taskAuth = { mode: 'mock' as const, phoneNumber: '0900000000', password: 'TaskFixtureOnly123!', jwtSecret: 'task-fixture-secret-at-least-32-bytes', sms: { provider: 'mock' as const }, admin: { phoneNumber: '0900000001', password: 'TaskAdminFixture123!' } };
export const taskMongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
export const taskPgBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
export function taskRepositories(pool: Pool) {
  const users = new PostgresUsersRepository(pool), farms = new PostgresFarmsRepository(pool, users), catalogs = new PostgresCatalogRepository(pool, users),
    zones = new PostgresZonesRepository(pool, users, farms, catalogs), trees = new PostgresTreesRepository(pool, users, farms, zones),
    devices = new PostgresDevicesRepository(pool, users, farms, zones, trees), actuators = new PostgresActuatorsRepository(pool, users, farms, zones, devices),
    assignments = new PostgresAssignmentsRepository(pool, users, farms, zones), registry = new PostgresCooperativesRepository(pool, users);
  return { users, farms, catalogs, zones, trees, devices, actuators, assignments, registry,
    access: new PostgresTaskAccess(pool, users, farms, zones, devices, actuators, assignments) };
}
export async function taskPersistenceFixture() {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString: `${taskPgBase}/sdf_persistence_test`, connectionTimeoutMillis: 5000 });
  const mongo = new MongoClient(taskMongoUri, { serverSelectionTimeoutMS: 5000 });
  let pool: Pool | undefined, created = false;
  const close = async () => {
    await pool?.end();
    if (created && /^sdf_persistence_test_[0-9a-f]{32}$/.test(name)) {
      await mongo.db(name).dropDatabase();
      await adminPool.query(`DROP DATABASE "${name}"`);
    }
    await mongo.close(); await adminPool.end();
  };
  try {
    await adminPool.query(`CREATE DATABASE "${name}"`); created = true;
    pool = new Pool({ connectionString: `${taskPgBase}/${name}`, connectionTimeoutMillis: 5000, max: 10 });
    await mongo.connect(); await runMigrations(pool, mongo.db(name));
    await seedDemo(pool, readSeedConfig({ NODE_ENV: 'test', AUTH_TEST_PHONE: taskAuth.phoneNumber, AUTH_TEST_PASSWORD: taskAuth.password,
      AUTH_TEST_ADMIN_PHONE: taskAuth.admin.phoneNumber, AUTH_TEST_ADMIN_PASSWORD: taskAuth.admin.password,
      DEMO_DEVICE_STATION_ID: 'TASK_FIXTURE_ONLY', DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00', DEMO_DEVICE_COST: '100' }));
    const repositories = taskRepositories(pool), { users, farms, catalogs, zones, devices, actuators } = repositories;
    const admin = (await users.loadByPhone(taskAuth.admin.phoneNumber))!.user.id, hash = (await users.loadById(admin))!.user.password;
    let number = 10;
    const farmer = async () => {
      const phone = `0900000${String(number++).padStart(3, '0')}`;
      const result = await users.createRegisteredUser({ user_name: 'Task Farmer', phone_number: phone, gmail: null, passwordHash: hash, role: 'Farmer' });
      return { id: result.user.id, phone };
    };
    const standard = await catalogs.standards.create(admin, { code: 'TASK-STD', name: 'Task standard', description: '', certifying_body: 'Test' });
    const deviceFixture = async () => {
      const owner = await farmer(), worker = await farmer();
      const proposal = await farms.createRequest(owner.id, { area_size: 2, address: 'Task fixture farm', certificate_number: `TASK-${number}`, longitude: 106, latitude: 10 });
      const farm = (await farms.approve(admin, proposal.id)).farm_id!;
      const zone = await zones.create(owner.id, { farm_id: farm, standard_id: standard.id, zone_name: 'Task fixture zone', area_size: 1, longitude: 106, latitude: 10 });
      const device = await devices.create(owner.id, { zone_id: zone.id, station_id: `TASK_${randomUUID()}`, installed_at: '2026-09-01T08:30:00+07:00', cost: 10 });
      const relays = [];
      for (const [capability_id, purpose] of [[2, 'shared'], [3, 'watering'], [4, 'spraying']] as const) relays.push(await actuators.create(owner.id, { device_id: device.id, name: purpose, capability_id, purpose }));
      return { owner, worker, farm, zone, device, relays };
    };
    const store = new MongoActuatorTaskStore(mongo, mongo.db(name));
    const engine = async (transport = new TaskTransport(), timeout = 10000) => {
      const service = new DatabaseActuatorTaskRecords({ ackTimeoutMs: timeout }, transport, repositories.access, store);
      await service.initialize(); await service.brokerChanged(readyState);
      return { service, transport };
    };
    return { name, pool, mongo, ...repositories, admin, hash, farmer, deviceFixture, store, engine, close };
  } catch (error) { await close(); throw error; }
}
export async function taskHttpApplication(pool: Pool, mongo: MongoClient, name: string, transport: MqttTransport): Promise<{ app: INestApplication; service: DatabaseActuatorTaskRecords }> {
  const repositories = taskRepositories(pool);
  const service = new DatabaseActuatorTaskRecords({ ackTimeoutMs: 10000 }, transport, repositories.access, new MongoActuatorTaskStore(mongo, mongo.db(name)));
  // A concrete database provider owns lifecycle hooks. Do not replace a
  // useExisting alias: Nest skips init/destroy hooks on alias wrappers.
  const module = await Test.createTestingModule({ imports: [AuthModule.forMock(taskAuth)], controllers: [ActuatorTasksController],
    providers: [{ provide: ActuatorTaskRecords, useValue: service }] })
    .overrideProvider(UserAccounts).useValue(repositories.users)
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); await service.brokerChanged(readyState);
  return { app, service };
}
