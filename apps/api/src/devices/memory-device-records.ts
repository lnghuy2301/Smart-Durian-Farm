import { Inject, Injectable } from '@nestjs/common';
import { FarmPageDto, FarmRequestListDto } from '../farms/farms.dto';
import { CreateDeviceDto, DeviceListDto, UpdateDeviceDto } from './devices.dto';
import { DeviceRecords } from './device-records';
import { DevicesService } from './devices.service';

@Injectable()
export class MemoryDeviceRecords extends DeviceRecords {
  constructor(@Inject(DevicesService) private readonly service: DevicesService) {
    super();
  }
  async list(actor: string, query: DeviceListDto) {
    return this.service.list(actor, query);
  }
  async get(actor: string, id: string) {
    return this.service.get(actor, id);
  }
  async getByStationId(actor: string, code: string) {
    return this.service.getByStationId(actor, code);
  }
  async affectedTrees(actor: string, id: string, query: FarmPageDto) {
    return this.service.affectedTrees(actor, id, query);
  }
  async history(actor: string, id: string, query: FarmPageDto) {
    return this.service.history(actor, id, query);
  }
  async create(actor: string, input: CreateDeviceDto) {
    return this.service.create(actor, input);
  }
  async update(actor: string, id: string, input: UpdateDeviceDto) {
    return this.service.update(actor, id, input);
  }
  async createRequest(actor: string, input: CreateDeviceDto) {
    return this.service.createRequest(actor, input);
  }
  async updateRequest(actor: string, id: string, input: UpdateDeviceDto) {
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
  async getRecordByStationId(code: string) {
    return this.service.getRecordByStationId(code);
  }
  async recordSeen(id: string, receivedAt: string) {
    this.service.recordSeen(id, receivedAt);
  }
}
