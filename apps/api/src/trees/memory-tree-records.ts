import { Inject, Injectable } from '@nestjs/common';
import { FarmPageDto, FarmRequestListDto } from '../farms/farms.dto';
import { CreateTreeDto, TreeListDto, UpdateTreeDto } from './trees.dto';
import { TreeRecords } from './tree-records';
import { TreesService } from './trees.service';

@Injectable()
export class MemoryTreeRecords extends TreeRecords {
  constructor(@Inject(TreesService) private readonly service: TreesService) {
    super();
  }
  async list(actor: string, query: TreeListDto) {
    return this.service.list(actor, query);
  }
  async get(actor: string, id: string) {
    return this.service.get(actor, id);
  }
  async getByCode(actor: string, code: string) {
    return this.service.getByCode(actor, code);
  }
  async history(actor: string, id: string, query: FarmPageDto) {
    return this.service.history(actor, id, query);
  }
  async create(actor: string, input: CreateTreeDto) {
    return this.service.create(actor, input);
  }
  async update(actor: string, id: string, input: UpdateTreeDto) {
    return this.service.update(actor, id, input);
  }
  async createRequest(actor: string, input: CreateTreeDto) {
    return this.service.createRequest(actor, input);
  }
  async updateRequest(actor: string, id: string, input: UpdateTreeDto) {
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
  async getTraceRecordByCode(code: string) {
    return this.service.getTraceRecordByCode(code);
  }
}
