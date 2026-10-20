import { ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Environment } from '../config/environment';
import { MqttTransport } from '../mqtt/mqtt.transport';
import { readActuatorTasksConfig } from '../actuator-tasks/actuator-tasks.config';
import { readTraceabilityConfig } from '../traceability/traceability.config';
import { migrationStatus } from './migrations';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresCooperativesRepository } from './postgres-cooperatives.repository';
import { PostgresUserManagement } from './postgres-user-management';
import { PostgresCooperativeRecords } from './postgres-cooperative-records';
import { PostgresCatalogRepository } from './postgres-catalog.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresAssignmentsRepository } from './postgres-assignments.repository';
import { PostgresTreesRepository } from './postgres-trees.repository';
import { PostgresHarvestsRepository } from './postgres-harvests.repository';
import { PostgresDevicesRepository } from './postgres-devices.repository';
import { PostgresSensorsRepository } from './postgres-sensors.repository';
import { PostgresActuatorsRepository } from './postgres-actuators.repository';
import { PostgresTaskAccess } from './postgres-task-access';
import { MongoTelemetryStore } from './mongo-telemetry.store';
import { MongoActuatorTaskStore } from './mongo-actuator-task.store';
import { MongoCultivationStore } from './mongo-cultivation.store';
import { DatabaseTelemetryRecords } from './database-telemetry-records';
import { DatabaseActuatorTaskRecords } from './database-actuator-task-records';
import { DatabaseCultivationRecords } from './database-cultivation-records';
import { DatabaseTraceabilityRecords } from './database-traceability-records';
import { MONGO_SCHEMA_V1 } from './mongo-schema';
import { CULTIVATION_STATE_SCHEMA } from './cultivation-state-schema';
import { canonicalJson } from '../cultivation-events/cultivation-chain';

export const RUNTIME_REPOSITORIES = Symbol('RUNTIME_REPOSITORIES');
export type RuntimeRepositories = Awaited<ReturnType<typeof runtimeRepositories>>;
export async function runtimeRepositories(database: DatabaseService, config: Environment, transport: MqttTransport) {
  try {
    // Gate provider construction BEFORE task lifecycle or transport startup.
    // Never auto-migrate/seed a running app or silently switch back to RAM.
    const status = await migrationStatus(database.postgres);
    if (status.some((entry) => entry.state !== 'Applied')) throw new Error('Migration required');
    const hello = await database.mongo.db().admin().command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary) throw new Error('Writable replica set required');
    // A PG ledger alone cannot prove MONGODB_URI points at the migrated DB.
    // Refuse missing/altered collections BEFORE adapters could create a journal
    // implicitly in the wrong database without validators/indexes.
    const db = database.mongo.db(), definitions = MONGO_SCHEMA_V1;
    const collections = await db.listCollections({ name: { $in: definitions.map((entry) => entry.name) } }, { nameOnly: false }).toArray();
    for (const definition of definitions) {
      const collection = collections.find((entry) => entry.name === definition.name), options = collection?.options;
      const validator = definition.name === 'PERSISTENCE_STATE' ? CULTIVATION_STATE_SCHEMA : definition.validator;
      if (!options || options.validationLevel !== 'strict' || options.validationAction !== 'error'
        || canonicalJson(options.validator) !== canonicalJson(validator)) throw new Error('Mongo schema mismatch');
      const indexes = await db.collection(definition.name).listIndexes().toArray();
      for (const index of definition.indexes) {
        const current = indexes.find((entry) => entry.name === index.name);
        // Compound index field order is semantic; canonical JSON would sort
        // keys and incorrectly accept an index with a different leading field.
        if (!current || JSON.stringify(current.key) !== JSON.stringify(index.key) || !!current.unique !== !!index.unique) throw new Error('Mongo index mismatch');
      }
    }
  } catch { throw new ServiceUnavailableException('Database runtime chưa sẵn sàng; kiểm tra kết nối và chạy db:status/db:migrate trước khi khởi động'); }
  const pool = database.postgres, mongo = database.mongo, db = mongo.db();
  const users = new PostgresUsersRepository(pool), cooperatives = new PostgresCooperativesRepository(pool, users),
    management = new PostgresUserManagement(users, cooperatives), cooperativeRecords = new PostgresCooperativeRecords(pool, cooperatives),
    catalogs = new PostgresCatalogRepository(pool, users), farms = new PostgresFarmsRepository(pool, users),
    zones = new PostgresZonesRepository(pool, users, farms, catalogs), assignments = new PostgresAssignmentsRepository(pool, users, farms, zones),
    trees = new PostgresTreesRepository(pool, users, farms, zones), harvests = new PostgresHarvestsRepository(pool, users, farms, zones, trees, assignments),
    devices = new PostgresDevicesRepository(pool, users, farms, zones, trees), sensors = new PostgresSensorsRepository(pool, users, farms, zones, devices),
    actuators = new PostgresActuatorsRepository(pool, users, farms, zones, devices), access = new PostgresTaskAccess(pool, users, farms, zones, devices, actuators, assignments),
    telemetry = new DatabaseTelemetryRecords(pool, users, farms, zones, devices, sensors, assignments, new MongoTelemetryStore(mongo, db)),
    tasks = new DatabaseActuatorTaskRecords(config.actuatorTasks ?? readActuatorTasksConfig({}), transport, access, new MongoActuatorTaskStore(mongo, db)),
    cultivation = new DatabaseCultivationRecords(pool, users, farms, zones, trees, assignments, catalogs, new MongoCultivationStore(mongo, db)),
    trace = new DatabaseTraceabilityRecords(pool, trees, cultivation, harvests, config.traceability ?? readTraceabilityConfig({}));
  return { users, cooperatives, management, cooperativeRecords, catalogs, farms, zones, assignments, trees, harvests, devices, sensors, actuators, access, telemetry, tasks, cultivation, trace };
}
