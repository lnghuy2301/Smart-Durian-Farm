import { DynamicModule, Module } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { TelemetryStore } from './telemetry.store';
import { TelemetryRecords } from './telemetry-records';
import { MemoryTelemetryRecords } from './memory-telemetry-records';

@Module({})
export class TelemetryModule {
  static forMock(auth: DynamicModule, farms: DynamicModule, zones: DynamicModule,
    devices: DynamicModule, sensors: DynamicModule): DynamicModule {
    // AppModule truyền cùng instance vào HTTP và MQTT, không tạo store/metadata modules lần hai.
    return { module: TelemetryModule, imports: [auth, farms, zones, devices, sensors],
      controllers: [TelemetryController], providers: [TelemetryStore, TelemetryService, MemoryTelemetryRecords,
        { provide: TelemetryRecords, useExisting: MemoryTelemetryRecords }], exports: [TelemetryService, TelemetryRecords] };
  }
}
