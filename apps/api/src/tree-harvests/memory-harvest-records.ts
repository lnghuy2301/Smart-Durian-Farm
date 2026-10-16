import { Inject, Injectable } from '@nestjs/common';
import { FarmPageDto } from '../farms/farms.dto';
import {
  CreateHarvestBackdateDto,
  CreateHarvestDto,
  HarvestCorrectionDto,
  HarvestListDto,
  HarvestRequestListDto,
  UpdateHarvestDto,
} from './tree-harvests.dto';
import { HarvestRecords } from './harvest-records';
import { TreeHarvestsService } from './tree-harvests.service';

@Injectable()
export class MemoryHarvestRecords extends HarvestRecords {
  constructor(@Inject(TreeHarvestsService) private readonly service: TreeHarvestsService) {
    super();
  }
  async list(actor: string, query: HarvestListDto) {
    return this.service.list(actor, query);
  }
  async get(actor: string, id: string) {
    return this.service.get(actor, id);
  }
  async create(actor: string, input: CreateHarvestDto) {
    return this.service.create(actor, input);
  }
  async updateDraft(actor: string, id: string, input: UpdateHarvestDto) {
    return this.service.updateDraft(actor, id, input);
  }
  async removeDraft(actor: string, id: string) {
    return this.service.removeDraft(actor, id);
  }
  async submit(actor: string, id: string) {
    return this.service.submit(actor, id);
  }
  async correction(actor: string, id: string, input: HarvestCorrectionDto) {
    return this.service.correction(actor, id, input);
  }
  async prepareCorrection(actor: string, id: string, input: UpdateHarvestDto) {
    return this.service.prepareCorrection(actor, id, input);
  }
  async approve(actor: string, id: string) {
    return this.service.approve(actor, id);
  }
  async reject(actor: string, id: string, reason?: string) {
    return this.service.reject(actor, id, reason);
  }
  async listRequests(actor: string, query: HarvestRequestListDto) {
    return this.service.listRequests(actor, query);
  }
  async getRequest(actor: string, id: string) {
    return this.service.getRequest(actor, id);
  }
  async grantBackdate(actor: string, input: CreateHarvestBackdateDto) {
    return this.service.grantBackdate(actor, input);
  }
  async listBackdates(actor: string, query: FarmPageDto) {
    return this.service.listBackdates(actor, query);
  }
  async revokeBackdate(actor: string, id: string) {
    return this.service.revokeBackdate(actor, id);
  }
  async confirmedForTrace(treeId: string) {
    return this.service.confirmedForTrace(treeId);
  }
}
