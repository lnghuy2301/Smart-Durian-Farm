import { Inject, Injectable } from '@nestjs/common';
import { FarmRequestListDto } from '../farms/farms.dto';
import { AssignmentRecords, AssignmentEventContext } from './assignment-records';
import { AssignmentListDto, CreateAssignmentRequestDto } from './assignments.dto';
import { AssignmentsService } from './assignments.service';

@Injectable()
export class MemoryAssignmentRecords extends AssignmentRecords {
  constructor(@Inject(AssignmentsService) private readonly service: AssignmentsService) {
    super();
  }
  async createRequest(actor: string, zone: string, input: CreateAssignmentRequestDto) {
    return this.service.createRequest(actor, zone, input);
  }
  async candidates(actor: string, zone: string, query = '') { return this.service.candidates(actor, zone, query); }
  async list(actor: string, query: AssignmentListDto, mineOnly = false) {
    return this.service.list(actor, query, mineOnly);
  }
  async get(actor: string, id: string) {
    return this.service.get(actor, id);
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
  async end(actor: string, id: string) {
    return this.service.end(actor, id);
  }
  async endRequest(actor: string, id: string) {
    return this.service.endRequest(actor, id);
  }
  async assertCanWork(actor: string, zone: string) {
    this.service.assertCanWork(actor, zone);
  }
  async assertCanCorrect(actor: string, event: AssignmentEventContext) {
    this.service.assertCanCorrect(actor, event);
  }
}
