import { SensorReading } from '../mqtt/mqtt.protocol';
import { TelemetryLatestDto, TelemetryHistoryDto } from './telemetry.dto';
import { TelemetryPage } from './telemetry.types';

export abstract class TelemetryRecords {
  // Trusted receiver only. No HTTP insertion/ACK injection endpoint.
  abstract record(deviceId: string, readings: SensorReading[], measuredAt: string): Promise<void>;
  abstract latest(actor: string, deviceId: string, query: TelemetryLatestDto): Promise<TelemetryPage>;
  abstract history(actor: string, deviceId: string, query: TelemetryHistoryDto): Promise<TelemetryPage>;
}
