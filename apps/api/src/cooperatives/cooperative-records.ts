import { BadRequestException, ConflictException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { TestCooperative } from '../users/mock-cooperative.store';
import { CreateCooperativeDto } from '../users/users.dto';
import { UpdateCooperativeDto } from './cooperatives.dto';
import { CooperativeNotification, CooperativeUpdateRequest, CooperativeUpdateStatus } from './cooperatives.types';

export const COOPERATIVE_TERMINAL: CooperativeUpdateStatus[] = ['Accepted', 'Cancelled', 'Expired', 'Failed'];
export interface CooperativeRecord { cooperative: TestCooperative; version: number; createdAt: string }
export interface CooperativeWorkflow {
  value: CooperativeUpdateRequest;
  cooperativeVersion: number;
  tokenVersion: number;
  revision: number;
  sessionId: string;
}
export interface WorkflowIdentity { email: string; phone: string }

// Chỉ lưu nội dung/quy trình, không OTP/digest/proof hoặc địa chỉ nhận OTP.
// Các thao tác ghi nhận context + phiên bản và recheck trong transaction adapter.
export abstract class CooperativeRecords {
  abstract list(actorId: string): Promise<TestCooperative[]>;
  abstract get(actorId: string, id: string): Promise<CooperativeRecord>;
  abstract create(actorId: string, input: CreateCooperativeDto): Promise<TestCooperative>;
  abstract update(actorId: string, id: string, input: UpdateCooperativeDto): Promise<TestCooperative>;
  abstract insertRequest(request: CooperativeWorkflow, identity: WorkflowIdentity): Promise<CooperativeWorkflow>;
  abstract saveRequest(current: CooperativeWorkflow, next: CooperativeUpdateRequest, identity?: WorkflowIdentity):
    Promise<{ stored: CooperativeWorkflow; cooperative?: TestCooperative }>;
  abstract getRequest(actorId: string, id: string): Promise<CooperativeWorkflow>;
  abstract listRequests(actorId: string): Promise<CooperativeWorkflow[]>;
  abstract initialize(sessionId: string): Promise<void>;
  abstract expireRequests(now: number): Promise<void>;
  abstract sweep(): Promise<void>;
  abstract notifications(actorId: string): Promise<CooperativeNotification[]>;
}

export function cooperativeChanges(cooperative: TestCooperative, input: UpdateCooperativeDto, manager = false): UpdateCooperativeDto {
  const fields = ['cooperative_name', 'director', 'address', 'contact_number', ...(manager ? [] : ['certificate_number'])];
  if (Object.keys(input).some((key) => !fields.includes(key))) { throw new BadRequestException('Thông tin không thuộc phạm vi được sửa'); }
  const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as UpdateCooperativeDto;
  if (!Object.entries(changes).some(([key, value]) => cooperative[key as keyof CreateCooperativeDto] !== value)) {
    throw new BadRequestException('Cần ít nhất một thông tin thực sự thay đổi');
  }
  return changes;
}

export function requireWorkflowTransition(current: CooperativeWorkflow, next: CooperativeUpdateRequest): void {
  if (COOPERATIVE_TERMINAL.includes(current.value.status)) { throw new ConflictException('Yêu cầu đã được xử lý'); }
  const steps: Partial<Record<CooperativeUpdateStatus, CooperativeUpdateStatus[]>> = {
    EmailPending: ['EmailSending', 'EmailVerified'], EmailSending: ['EmailPending'],
    EmailVerified: ['SmsSending'], SmsPending: ['SmsSending', 'SmsChecking'],
    SmsSending: ['SmsPending'], SmsChecking: ['SmsPending', 'Accepted'],
  };
  if (!['Failed', 'Expired'].includes(next.status) &&
      !(next.status === 'Cancelled' && ['EmailPending', 'EmailVerified', 'SmsPending'].includes(current.value.status)) &&
      !steps[current.value.status]?.includes(next.status)) { throw new ConflictException('Yêu cầu không ở bước xác minh phù hợp'); }
  if (next.id !== current.value.id || next.manager_id !== current.value.manager_id || next.cooperative_id !== current.value.cooperative_id ||
      next.created_at !== current.value.created_at || !isDeepStrictEqual(next.proposed_changes, current.value.proposed_changes)) {
    throw new BadRequestException('Nội dung yêu cầu sửa HTX là cố định');
  }
}
