import { Inject, Injectable } from '@nestjs/common';
import { FarmPageDto, FarmRequestListDto } from '../farms/farms.dto';
import { CreateSensorDto, SensorListDto, UpdateSensorDto } from './sensors.dto';
import { SensorRecords } from './sensor-records';
import { SensorsService } from './sensors.service';

@Injectable()
export class MemorySensorRecords extends SensorRecords {
  constructor(@Inject(SensorsService) private readonly service: SensorsService) {
    super();
  }
  async list(actor: string, query: SensorListDto) {
    return this.service.list(actor, query);
  }
  async get(actor: string, id: string) {
    return this.service.get(actor, id);
  }
  async getByStream(actor: string, deviceId: string, streamId: string) {
    return this.service.getByStream(actor, deviceId, streamId);
  }
  async history(actor: string, id: string, query: FarmPageDto) {
    return this.service.history(actor, id, query);
  }
  async create(actor: string, input: CreateSensorDto) {
    return this.service.create(actor, input);
  }
  async update(actor: string, id: string, input: UpdateSensorDto) {
    return this.service.update(actor, id, input);
  }
  async createRequest(actor: string, input: CreateSensorDto) {
    return this.service.createRequest(actor, input);
  }
  async updateRequest(actor: string, id: string, input: UpdateSensorDto) {
    return this.service.updateRequest(actor, id, input);
  }
  async listRequests(actor: string, query: FarmRequestListDto) {
    return this.service.listRequests(actor, query);
  }
  async getRequest(actor: string, id: string) {
    return this.service.getRequest(actor, id);
  }
  async approve(actor: string, id: string) {
    return this.service.approve(actor, id);
  }
  async reject(actor: string, id: string, reason?: string) {
    return this.service.reject(actor, id, reason);
  }
  async getRecord(id: string) {
    return this.service.getRecord(id);
  }
  async getRecordByStream(deviceId: string, streamId: string) {
    return this.service.getRecordByStream(deviceId, streamId);
  }
}
