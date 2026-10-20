import { DynamicModule, Module } from '@nestjs/common';
import { MqttController } from './mqtt.controller';
import { MqttService } from './mqtt.service';
import { MqttDiagnostics } from './mqtt-diagnostics';

@Module({})
export class MqttModule {
  static register(authModule: DynamicModule, devicesModule: DynamicModule,
    sensorsModule: DynamicModule, telemetryModule: DynamicModule, transportModule: DynamicModule, taskModule: DynamicModule): DynamicModule {
    // Reuse the exact module instances; rebuilding forMock here would create independent metadata stores.
    return { module: MqttModule, imports: [authModule, devicesModule, sensorsModule, telemetryModule, transportModule, taskModule], controllers: [MqttController],
      providers: [MqttService, { provide: MqttDiagnostics, useExisting: MqttService }], exports: [MqttService, transportModule] };
  }
}
