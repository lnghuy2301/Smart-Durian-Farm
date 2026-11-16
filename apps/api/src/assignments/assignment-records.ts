import { FarmPage } from '../farms/farm-records';
import { FarmRequestListDto } from '../farms/farms.dto';
import { AssignmentListDto, CreateAssignmentRequestDto } from './assignments.dto';
import { AssignmentHistory, AssignmentRequest } from './assignments.types';
import { AssignmentCandidates } from './assignment-candidates';

export interface AssignmentHistoryResponse extends AssignmentHistory {
  active: boolean;
  correction_grace_days: number;
  correction_deadline: string | null;
}
export interface AssignmentEventContext {
  assignment_id: string;
  zone_id: string;
  author_id: string;
  created_at: string;
}
export abstract class AssignmentRecords {
  abstract candidates(actor: string, zone: string, query?: string): Promise<AssignmentCandidates>;
  abstract createRequest(
    actor: string,
    zone: string,
    input: CreateAssignmentRequestDto,
  ): Promise<AssignmentRequest>;
  abstract list(
    actor: string,
    query: AssignmentListDto,
    mineOnly?: boolean,
  ): Promise<FarmPage<AssignmentHistoryResponse>>;
  abstract get(actor: string, id: string): Promise<AssignmentHistoryResponse>;
  abstract listRequests(actor: string, query: FarmRequestListDto): Promise<FarmPage<AssignmentRequest>>;
  abstract getRequest(actor: string, id: string): Promise<AssignmentRequest>;
  abstract approve(actor: string, id: string): Promise<AssignmentRequest>;
  abstract reject(actor: string, id: string, reason?: string): Promise<AssignmentRequest>;
  abstract end(actor: string, id: string): Promise<AssignmentHistory>;
  abstract endRequest(actor: string, id: string): Promise<AssignmentRequest>;
  abstract assertCanWork(actor: string, zone: string): Promise<void>;
  abstract assertCanCorrect(actor: string, event: AssignmentEventContext): Promise<void>;
}
