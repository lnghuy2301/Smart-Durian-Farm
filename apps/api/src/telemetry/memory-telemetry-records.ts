import { Inject, Injectable } from '@nestjs/common';
import { SensorReading } from '../mqtt/mqtt.protocol';
import { TelemetryLatestDto, TelemetryHistoryDto } from './telemetry.dto';
import { TelemetryRecords } from './telemetry-records';
import { TelemetryService } from './telemetry.service';

@Injectable()
export class MemoryTelemetryRecords extends TelemetryRecords {
  constructor(@Inject(TelemetryService) private readonly service: TelemetryService) {
    super();
  }
  async record(deviceId: string, readings: SensorReading[], measuredAt: string) {
    this.service.record(deviceId, readings, measuredAt);
  }
  async latest(actor: string, deviceId: string, query: TelemetryLatestDto) {
    return this.service.latest(actor, deviceId, query);
  }
  async history(actor: string, deviceId: string, query: TelemetryHistoryDto) {
    return this.service.history(actor, deviceId, query);
  }
}
