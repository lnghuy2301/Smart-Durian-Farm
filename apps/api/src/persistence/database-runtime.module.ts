import { DynamicModule, Module } from '@nestjs/common';
import { Environment } from '../config/environment';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CooperativesModule } from '../cooperatives/cooperatives.module';
import { CooperativeRecords } from '../cooperatives/cooperative-records';
import { MqttTransportModule } from '../mqtt/mqtt-transport.module';
import { MqttTransport } from '../mqtt/mqtt.transport';
import { MqttController } from '../mqtt/mqtt.controller';
import { MqttDiagnostics } from '../mqtt/mqtt-diagnostics';
import { readMqttConfig } from '../mqtt/mqtt.config';
import { HealthController } from '../health/health.controller';
import { MaterialsController } from '../materials/materials.controller';
import { StandardsController } from '../standards/standards.controller';
import { StandardMaterialsController } from '../standard-materials/standard-materials.controller';
import { FarmsController, FarmRequestsController, FarmAccessController } from '../farms/farms.controller';
import { ZonesController, ZoneRequestsController } from '../zones/zones.controller';
import { AssignmentsController, AssignmentRequestsController } from '../assignments/assignments.controller';
import { TreesController, TreeRequestsController } from '../trees/trees.controller';
import { TreeHarvestsController, HarvestRequestsController, HarvestBackdateController } from '../tree-harvests/tree-harvests.controller';
import { DevicesController, DeviceRequestsController } from '../devices/devices.controller';
import { SensorsController, SensorRequestsController } from '../sensors/sensors.controller';
import { ActuatorsController, ActuatorRequestsController } from '../actuators/actuators.controller';
import { TelemetryController } from '../telemetry/telemetry.controller';
import { ActuatorTasksController } from '../actuator-tasks/actuator-tasks.controller';
import { CultivationEventsController } from '../cultivation-events/cultivation-events.controller';
import { TraceabilityController } from '../traceability/traceability.controller';
import { DatabaseMqttService } from './database-mqtt.service';
import { PersistenceRuntimeModule } from './persistence-runtime.module';
import { RUNTIME_REPOSITORIES, RuntimeRepositories } from './runtime-repositories';
import { DisplayController } from '../display/display.controller';

@Module({})
export class DatabaseRuntimeModule {
  static register(config: Environment): DynamicModule {
    if (!config.auth) return { module: DatabaseRuntimeModule, imports: [DatabaseModule.register(config.database)], controllers: [HealthController] };
    // Construct each dynamic module ONCE and pass the same object everywhere;
    // Nest11 may otherwise create independent instances for equivalent metadata.
    const database = DatabaseModule.register(config.database), transport = MqttTransportModule.register(config.mqtt ?? readMqttConfig({})),
      persistence = PersistenceRuntimeModule.register(config, database, transport), auth = AuthModule.forDatabase(config.auth, persistence),
      users = UsersModule.forDatabase(config.auth, auth, persistence),
      cooperatives = CooperativesModule.forRecords(config.auth, auth, users,
        { provide: CooperativeRecords, inject: [RUNTIME_REPOSITORIES], useFactory: (r: RuntimeRepositories) => r.cooperativeRecords }, [persistence]);
    return { module: DatabaseRuntimeModule, imports: [database, transport, persistence, auth, users, cooperatives],
      controllers: [HealthController, MaterialsController, StandardsController, StandardMaterialsController,
        FarmsController, FarmRequestsController, FarmAccessController, ZonesController, ZoneRequestsController, AssignmentsController, AssignmentRequestsController,
        TreesController, TreeRequestsController, TreeHarvestsController, HarvestRequestsController, HarvestBackdateController,
        DevicesController, DeviceRequestsController, SensorsController, SensorRequestsController, ActuatorsController, ActuatorRequestsController,
        TelemetryController, ActuatorTasksController, CultivationEventsController, TraceabilityController, MqttController, DisplayController],
      providers: [{ provide: DatabaseMqttService, inject: [RUNTIME_REPOSITORIES, MqttTransport], useFactory: (r: RuntimeRepositories, wire: MqttTransport) =>
        new DatabaseMqttService(config.mqtt ?? readMqttConfig({}), wire, r.devices, r.sensors, r.telemetry, r.users, r.tasks, r.access) },
      { provide: MqttDiagnostics, useExisting: DatabaseMqttService }], exports: [persistence] };
  }
}
