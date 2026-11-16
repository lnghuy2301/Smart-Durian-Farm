import { DynamicModule, InjectionToken, Module, Provider } from '@nestjs/common';
import { Environment } from '../config/environment';
import { DatabaseService } from '../database/database.service';
import { MqttTransport } from '../mqtt/mqtt.transport';
import { UserAccounts } from '../auth/user-accounts';
import { UserManagement } from '../users/user-management';
import { CooperativeRecords } from '../cooperatives/cooperative-records';
import { MaterialRecords, StandardRecords, StandardMaterialRecords } from '../catalog/catalog-records';
import { FarmRecords } from '../farms/farm-records';
import { ZoneRecords } from '../zones/zone-records';
import { AssignmentRecords } from '../assignments/assignment-records';
import { TreeRecords } from '../trees/tree-records';
import { HarvestRecords } from '../tree-harvests/harvest-records';
import { DeviceRecords } from '../devices/device-records';
import { SensorRecords } from '../sensors/sensor-records';
import { ActuatorRecords } from '../actuators/actuator-records';
import { TelemetryRecords } from '../telemetry/telemetry-records';
import { ActuatorTaskRecords } from '../actuator-tasks/actuator-task-records';
import { CultivationRecords } from '../cultivation-events/cultivation-records';
import { TraceabilityRecords } from '../traceability/traceability-records';
import { PostgresUsersRepository } from './postgres-users.repository';
import { DatabaseActuatorTaskRecords } from './database-actuator-task-records';
import { DatabaseCultivationRecords } from './database-cultivation-records';
import { RUNTIME_REPOSITORIES, runtimeRepositories, RuntimeRepositories } from './runtime-repositories';

@Module({})
export class PersistenceRuntimeModule {
  static register(config: Environment, databaseModule: DynamicModule, transportModule: DynamicModule): DynamicModule {
    const view = (provide: InjectionToken, key: keyof RuntimeRepositories): Provider => ({ provide, inject: [RUNTIME_REPOSITORIES], useFactory: (r: RuntimeRepositories) => r[key] });
    const providers: Provider[] = [
      { provide: RUNTIME_REPOSITORIES, inject: [DatabaseService, MqttTransport], useFactory: (db: DatabaseService, transport: MqttTransport) => runtimeRepositories(db, config, transport) },
      view(PostgresUsersRepository, 'users'), { provide: UserAccounts, useExisting: PostgresUsersRepository },
      view(UserManagement, 'management'), view(CooperativeRecords, 'cooperativeRecords'),
      ...[[FarmRecords, 'farms'], [ZoneRecords, 'zones'], [AssignmentRecords, 'assignments'], [TreeRecords, 'trees'], [HarvestRecords, 'harvests'],
        [DeviceRecords, 'devices'], [SensorRecords, 'sensors'], [ActuatorRecords, 'actuators'], [TelemetryRecords, 'telemetry'], [TraceabilityRecords, 'trace']]
        .map(([token, key]) => view(token as InjectionToken, key as keyof RuntimeRepositories)),
      { provide: MaterialRecords, inject: [RUNTIME_REPOSITORIES], useFactory: (r: RuntimeRepositories) => r.catalogs.materials },
      { provide: StandardRecords, inject: [RUNTIME_REPOSITORIES], useFactory: (r: RuntimeRepositories) => r.catalogs.standards },
      { provide: StandardMaterialRecords, inject: [RUNTIME_REPOSITORIES], useFactory: (r: RuntimeRepositories) => r.catalogs.links },
      // Concrete providers own hooks once. Ports are aliases, not second hook
      // owners or wrappers around RAM services.
      view(DatabaseActuatorTaskRecords, 'tasks'), { provide: ActuatorTaskRecords, useExisting: DatabaseActuatorTaskRecords },
      view(DatabaseCultivationRecords, 'cultivation'), { provide: CultivationRecords, useExisting: DatabaseCultivationRecords },
    ];
    return { module: PersistenceRuntimeModule, imports: [databaseModule, transportModule], providers,
      exports: [RUNTIME_REPOSITORIES, PostgresUsersRepository, UserAccounts, UserManagement, CooperativeRecords, MaterialRecords, StandardRecords,
        StandardMaterialRecords, FarmRecords, ZoneRecords, AssignmentRecords, TreeRecords, HarvestRecords, DeviceRecords, SensorRecords, ActuatorRecords,
        TelemetryRecords, TraceabilityRecords, ActuatorTaskRecords, CultivationRecords] };
  }
}
