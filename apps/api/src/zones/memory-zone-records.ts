import { Inject, Injectable } from '@nestjs/common';
import { FarmRequestListDto } from '../farms/farms.dto';
import { CreateZoneDto, UpdateZoneDto, ZoneListDto } from './zones.dto';
import { ZoneRecords } from './zone-records';
import { ZonesService } from './zones.service';

@Injectable()
export class MemoryZoneRecords extends ZoneRecords {
  constructor(@Inject(ZonesService) private readonly zones: ZonesService) {
    super();
  }
  async list(actor: string, q: ZoneListDto) {
    return this.zones.list(actor, q);
  }
  async get(actor: string, id: string) {
    return this.zones.get(actor, id);
  }
  async create(actor: string, input: CreateZoneDto) {
    return this.zones.create(actor, input);
  }
  async update(actor: string, id: string, input: UpdateZoneDto) {
    return this.zones.update(actor, id, input);
  }
  async createRequest(actor: string, input: CreateZoneDto) {
    return this.zones.createRequest(actor, input);
  }
  async updateRequest(actor: string, id: string, input: UpdateZoneDto) {
    return this.zones.updateRequest(actor, id, input);
  }
  async listRequests(actor: string, q: FarmRequestListDto) {
    return this.zones.listRequests(actor, q);
  }
  async getRequest(actor: string, id: string) {
    return this.zones.getRequest(actor, id);
  }
  async approve(actor: string, id: string) {
    return this.zones.approve(actor, id);
  }
  async reject(actor: string, id: string, reason?: string) {
    return this.zones.reject(actor, id, reason);
  }
}
