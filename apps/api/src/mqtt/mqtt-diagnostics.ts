import type { MqttService } from './mqtt.service';
import { FarmPageDto } from '../farms/farms.dto';

export abstract class MqttDiagnostics {
  abstract brokerStatus(actor: string): ReturnType<MqttService['brokerStatus']> | Promise<ReturnType<MqttService['brokerStatus']>>;
  abstract deviceStatus(actor: string, device: string): ReturnType<MqttService['deviceStatus']> | Promise<ReturnType<MqttService['deviceStatus']>>;
  abstract messages(actor: string, device: string, page: FarmPageDto): ReturnType<MqttService['messages']> | Promise<ReturnType<MqttService['messages']>>;
}
