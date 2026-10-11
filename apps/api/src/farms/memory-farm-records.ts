import { Inject, Injectable } from '@nestjs/common';
import { FarmRecords } from './farm-records';
import { FarmsService } from './farms.service';
import { CreateFarmRequestDto, FarmListDto, FarmPageDto, FarmRequestListDto, UpdateFarmRequestDto } from './farms.dto';

@Injectable()
export class MemoryFarmRecords extends FarmRecords {
  constructor(@Inject(FarmsService) private readonly farms: FarmsService) { super(); }
  async list(actor: string, query: FarmListDto) { return this.farms.list(actor, query); }
  async get(actor: string, id: string) { return this.farms.get(actor, id); }
  async createRequest(actor: string, input: CreateFarmRequestDto) { return this.farms.createRequest(actor, input); }
  async updateRequest(actor: string, id: string, input: UpdateFarmRequestDto) { return this.farms.updateRequest(actor, id, input); }
  async joinRequest(actor: string, id: string, cooperative: string) { return this.farms.joinRequest(actor, id, cooperative); }
  async leaveRequest(actor: string, id: string) { return this.farms.leaveRequest(actor, id); }
  async listRequests(actor: string, query: FarmRequestListDto) { return this.farms.listRequests(actor, query); }
  async getRequest(actor: string, id: string) { return this.farms.getRequest(actor, id); }
  async approve(actor: string, id: string) { return this.farms.approve(actor, id); }
  async reject(actor: string, id: string, reason?: string) { return this.farms.reject(actor, id, reason); }
  async listNotifications(actor: string, query: FarmPageDto) { return this.farms.listNotifications(actor, query); }
}
