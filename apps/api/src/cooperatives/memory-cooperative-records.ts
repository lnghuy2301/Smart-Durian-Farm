import { ConflictException, ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { MockUserStore } from '../auth/mock-user.store';
import { FarmsService } from '../farms/farms.service';
import { MockCooperativeStore, TestCooperative } from '../users/mock-cooperative.store';
import { CreateCooperativeDto } from '../users/users.dto';
import { COOPERATIVE_DELETE_DAYS, COOPERATIVE_WARNING_DAYS, COOPERATIVE_DAY_MS as DAY } from './cooperative-lifecycle';
import { UpdateCooperativeDto } from './cooperatives.dto';
import { CooperativeNotification, CooperativeUpdateRequest } from './cooperatives.types';
import { COOPERATIVE_TERMINAL, CooperativeRecords, CooperativeWorkflow, WorkflowIdentity, cooperativeChanges, requireWorkflowTransition } from './cooperative-records';
import { randomUUID } from 'node:crypto';

// Thay Maps nghiệp vụ cũ trong service; registry vẫn đúng shared store USERS/Farms.
export class MemoryCooperativeRecords extends CooperativeRecords {
  private readonly requests = new Map<string, CooperativeWorkflow>();
  private readonly notices = new Map<string, CooperativeNotification>();
  constructor(private readonly users: MockUserStore, private readonly store: MockCooperativeStore, private readonly farms: FarmsService) { super(); }
  async list(actorId: string) { const actor = this.actor(actorId); return this.store.list().filter((c) => actor.role !== 'Manager' || c.manager_id === actorId); }
  async get(actorId: string, id: string) {
    const actor = this.actor(actorId), cooperative = this.store.get(id), meta = this.store.lifecycle(id);
    if (actor.role === 'Manager' && cooperative.manager_id !== actorId) { throw new NotFoundException('Không tìm thấy HTX'); }
    return { cooperative, version: meta.version, createdAt: new Date(meta.createdAt).toISOString() };
  }
  async create(actorId: string, input: CreateCooperativeDto) { this.admin(actorId); return this.store.create(input, null); }
  async update(actorId: string, id: string, input: UpdateCooperativeDto) {
    this.admin(actorId); return this.store.update(id, cooperativeChanges(this.store.get(id), input));
  }
  async insertRequest(request: CooperativeWorkflow, identity: WorkflowIdentity) {
    this.context(request, identity);
    cooperativeChanges(this.store.get(request.value.cooperative_id), request.value.proposed_changes, true);
    if ([...this.requests.values()].some((r) => r.value.manager_id === request.value.manager_id && !COOPERATIVE_TERMINAL.includes(r.value.status))) {
      throw new ConflictException('Manager đã có yêu cầu sửa HTX đang chờ; hoàn tất hoặc hủy trước');
    }
    if (this.requests.size >= 500) { throw new HttpException('Bộ nhớ yêu cầu sửa HTX đã đầy', HttpStatus.TOO_MANY_REQUESTS); }
    this.requests.set(request.value.id, structuredClone(request)); return structuredClone(request);
  }
  async saveRequest(current: CooperativeWorkflow, next: CooperativeUpdateRequest, identity?: WorkflowIdentity) {
    const saved = this.requests.get(current.value.id);
    const failure = ['Failed', 'Expired'].includes(next.status);
    if (!saved || (!failure && saved.revision !== current.revision) || saved.sessionId !== current.sessionId) { throw new ConflictException('Yêu cầu đã thay đổi'); }
    if (failure) { next = { ...saved.value, status: next.status, resolved_at: next.resolved_at }; }
    requireWorkflowTransition(saved, next);
    let cooperative: TestCooperative | undefined;
    if (!['Failed', 'Expired'].includes(next.status)) {
      if (!identity) { throw new ConflictException('Cần xác minh lại'); }
      this.context(saved, identity);
      if (Date.now() >= Date.parse(saved.value.expires_at)) { throw new ConflictException('Yêu cầu đã hết hạn'); }
    }
    if (next.status === 'Accepted') {
      if (!saved.value.email_verified_at) { throw new ConflictException('Cần xác minh email trước'); }
      cooperative = this.store.update(saved.value.cooperative_id, saved.value.proposed_changes);
    }
    const stored = { ...saved, value: structuredClone(next), revision: saved.revision + 1 };
    this.requests.set(next.id, stored); return { stored: structuredClone(stored), cooperative };
  }
  async getRequest(actorId: string, id: string) {
    const actor = this.actor(actorId), request = this.requests.get(id);
    if (!request || (actor.role !== 'Admin' && request.value.manager_id !== actorId)) { throw new NotFoundException('Không tìm thấy yêu cầu sửa HTX'); }
    return structuredClone(request);
  }
  async listRequests(actorId: string) {
    const actor = this.actor(actorId);
    if (actor.role === 'Farmer') { throw new ForbiddenException('Farmer không đọc yêu cầu sửa HTX của Manager'); }
    return structuredClone([...this.requests.values()].filter((r) => actor.role === 'Admin' || r.value.manager_id === actorId));
  }
  async initialize(sessionId: string) {
    for (const r of this.requests.values()) {
      if (r.sessionId !== sessionId && !COOPERATIVE_TERMINAL.includes(r.value.status)) { this.close(r); }
    }
  }
  async expireRequests(now: number) {
    for (const r of this.requests.values()) { if (!COOPERATIVE_TERMINAL.includes(r.value.status) && now >= Date.parse(r.value.expires_at)) { this.close(r); } }
  }
  async sweep() {
    const now = Date.now();
    for (const cooperative of this.store.list()) {
      if (cooperative.manager_id) { continue; }
      const age = now - this.store.lifecycle(cooperative.id).createdAt;
      if (age >= COOPERATIVE_WARNING_DAYS * DAY) { this.notify(cooperative, 'ManagerMissing', now); }
      if (age < COOPERATIVE_DELETE_DAYS * DAY) { continue; }
      if (this.farms.hasCooperativeReferences(cooperative.id) || [...this.requests.values()].some((r) => r.value.cooperative_id === cooperative.id)) {
        this.notify(cooperative, 'DeletionBlocked', now); continue;
      }
      if (this.notify(cooperative, 'CooperativeDeleted', now)) { this.store.removeUnmanaged(cooperative.id); }
    }
  }
  async notifications(actorId: string) { this.admin(actorId); return structuredClone([...this.notices.values()]); }
  private close(r: CooperativeWorkflow) { r.value.status = 'Expired'; r.value.resolved_at = new Date(Date.now()).toISOString(); r.revision++; }
  private context(r: CooperativeWorkflow, identity: WorkflowIdentity) {
    const actor = this.actor(r.value.manager_id);
    if (actor.role !== 'Manager' || this.store.get(r.value.cooperative_id).manager_id !== actor.id) { throw new ForbiddenException('Chỉ Manager của HTX được gửi thay đổi'); }
    if (!actor.gmail || !actor.gmail_verify || actor.gmail !== identity.email || actor.phone_number !== identity.phone ||
        this.users.versionOf(actor.id) !== r.tokenVersion || this.store.lifecycle(r.value.cooperative_id).version !== r.cooperativeVersion) {
      throw new ConflictException('HTX hoặc tài khoản đã thay đổi; cần tạo yêu cầu và xác minh lại');
    }
  }
  private actor(id: string) { const user = this.users.findById(id); if (!user || user.status !== 'Active') { throw new ForbiddenException('Tài khoản phải Active'); } return user; }
  private admin(id: string) { if (this.actor(id).role !== 'Admin') { throw new ForbiddenException('Chỉ Admin tạo/sửa trực tiếp HTX'); } }
  private notify(cooperative: TestCooperative, type: CooperativeNotification['type'], now: number): boolean {
    const key = `${cooperative.id}:${type}`;
    if (this.notices.has(key)) { return true; } if (this.notices.size >= 2000) { return false; }
    this.notices.set(key, { id: randomUUID(), type, cooperative_id: cooperative.id, cooperative_name: cooperative.cooperative_name,
      created_at: new Date(now).toISOString(), manager_deadline: new Date(this.store.lifecycle(cooperative.id).createdAt + COOPERATIVE_DELETE_DAYS * DAY).toISOString() }); return true;
  }
}
