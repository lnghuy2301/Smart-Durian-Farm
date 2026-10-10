import { ConflictException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { AccountSnapshot } from '../auth/user-accounts';
import { CreateCooperativeDto } from '../users/users.dto';
import { UpdateCooperativeDto } from '../cooperatives/cooperatives.dto';
import { CooperativeUpdateRequest, CooperativeUpdateStatus } from '../cooperatives/cooperatives.types';
import { COOPERATIVE_TERMINAL, CooperativeRecords, CooperativeWorkflow, WorkflowIdentity, cooperativeChanges, requireWorkflowTransition } from '../cooperatives/cooperative-records';
import { PostgresCooperativesRepository, CooperativeSnapshot } from './postgres-cooperatives.repository';
import { safeInteger } from './mappers';

interface WorkflowRow {
  id: string; target_key: string; requested_by: string; status: CooperativeUpdateStatus;
  expected_version: string; payload: Record<string, unknown>; created_at: Date; resolved_at: Date | null;
}
const SELECT = "SELECT id,target_key,requested_by,status,expected_version,payload,created_at,resolved_at FROM technical.workflow_requests WHERE module='cooperatives' AND action='ManagerUpdate'";
const ACTIVE = ['EmailPending', 'EmailSending', 'EmailVerified', 'SmsSending', 'SmsPending', 'SmsChecking'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cùng pool và registry instance với PostgresUserManagement; không chứa OTP.
export class PostgresCooperativeRecords extends CooperativeRecords {
  constructor(private readonly pool: Pool, private readonly registry: PostgresCooperativesRepository) { super(); }
  async list(actorId: string) { return this.registry.list(actorId); }
  async get(actorId: string, id: string) { return this.registry.get(actorId, id); }
  async create(actorId: string, input: CreateCooperativeDto) { return this.registry.create(actorId, input); }
  async update(actorId: string, id: string, input: UpdateCooperativeDto) { return this.registry.update(actorId, id, input); }
  async sweep() { await this.registry.sweepScheduled(); }
  async notifications(actorId: string) { return this.registry.notifications(actorId); }

  async insertRequest(request: CooperativeWorkflow, identity: WorkflowIdentity): Promise<CooperativeWorkflow> {
    return this.run(async () => this.registry.withWorkflowLocks(request.value.manager_id, request.value.cooperative_id, async (client, account, cooperative) => {
      this.context(request, account, cooperative, identity);
      cooperativeChanges(cooperative.cooperative, request.value.proposed_changes, true);
      const pending = await client.query("SELECT id FROM technical.workflow_requests WHERE module='cooperatives' AND action='ManagerUpdate' AND requested_by=$1 AND status=ANY($2::text[])", [request.value.manager_id, ACTIVE]);
      if (pending.rowCount) { throw new ConflictException('Manager đã có yêu cầu sửa HTX đang chờ; hoàn tất hoặc hủy trước'); }
      if (request.value.status !== 'EmailPending' || request.revision !== 1 || request.value.email_verified_at !== null || request.value.resolved_at !== null) {
        throw new ConflictException('Yêu cầu mới phải bắt đầu xác minh email');
      }
      const result = await client.query<WorkflowRow>(`INSERT INTO technical.workflow_requests
        (id,module,action,status,target_key,requested_by,expected_version,payload,created_at,resolved_at)
        VALUES ($1,'cooperatives','ManagerUpdate',$2,$3,$4,$5,$6,$7,NULL) RETURNING *`,
      [request.value.id, request.value.status, request.value.cooperative_id, request.value.manager_id, request.cooperativeVersion,
        JSON.stringify(this.payload(request)), request.value.created_at]);
      await this.audit(client, request, 'CooperativeUpdateRequested', { status: 'EmailPending' });
      return this.map(result.rows[0]);
    }));
  }
  async saveRequest(current: CooperativeWorkflow, next: CooperativeUpdateRequest, identity?: WorkflowIdentity) {
    return this.run(async () => this.registry.withWorkflowLocks(current.value.manager_id, current.value.cooperative_id, async (client, account, cooperative) => {
      const saved = await this.read(client, current.value.id, true);
      const failure = ['Failed', 'Expired'].includes(next.status);
      if ((!failure && saved.revision !== current.revision) || saved.sessionId !== current.sessionId || saved.cooperativeVersion !== current.cooperativeVersion ||
          saved.tokenVersion !== current.tokenVersion || saved.value.manager_id !== current.value.manager_id || saved.value.cooperative_id !== current.value.cooperative_id) {
        throw new ConflictException('Yêu cầu đã thay đổi');
      }
      // Mất response sau một bước commit có thể làm revision cache cũ. Chỉ
      // được đóng phiên cùng session/context, giữ nội dung mới nhất; terminal
      // Accepted/Expired vẫn không bị ghi đè. Không nới CAS cho bước áp dụng.
      if (failure) { next = { ...saved.value, status: next.status, resolved_at: next.resolved_at }; }
      requireWorkflowTransition(saved, next);
      if (!['Failed', 'Expired'].includes(next.status)) {
        if (!identity) { throw new ConflictException('Cần xác minh lại'); }
        this.context(saved, account, cooperative, identity);
        if (Date.now() >= Date.parse(saved.value.expires_at)) { throw new ConflictException('Yêu cầu đã hết hạn'); }
      }
      let updated: CooperativeSnapshot['cooperative'] | undefined;
      if (next.status === 'Accepted') {
        if (!saved.value.email_verified_at) { throw new ConflictException('Cần xác minh email trước'); }
        if (!Number.isSafeInteger(cooperative.version + 1)) { throw new Error('Version exhausted'); }
        updated = { ...cooperative.cooperative, ...saved.value.proposed_changes };
        await client.query(`UPDATE public.cooperatives SET cooperative_name=$2,director=$3,address=$4,contact_number=$5 WHERE id=$1`,
          [updated.id, updated.cooperative_name, updated.director, updated.address, updated.contact_number]);
        await client.query("UPDATE technical.entity_metadata SET version=version+1 WHERE entity_type='cooperatives' AND entity_key=$1", [updated.id]);
        await this.audit(client, saved, 'CooperativeUpdateAccepted', { request_id: saved.value.id, changed_fields: Object.keys(saved.value.proposed_changes) }, 'cooperatives', updated.id);
      }
      const stored = await this.write(client, saved, next);
      await this.audit(client, stored, 'CooperativeUpdateTransition', { from: saved.value.status, to: next.status });
      return { stored, cooperative: updated };
    }));
  }
  async getRequest(actorId: string, id: string) {
    return this.run(async () => this.registry.withActor(actorId, async (client, actor) => {
      const record = await this.read(client, id);
      if (actor.role !== 'Admin' && record.value.manager_id !== actorId) { throw new NotFoundException('Không tìm thấy yêu cầu sửa HTX'); }
      return record;
    }));
  }
  async listRequests(actorId: string) {
    return this.run(async () => this.registry.withActor(actorId, async (client, actor) => {
      if (actor.role === 'Farmer') { throw new ForbiddenException('Farmer không đọc yêu cầu sửa HTX của Manager'); }
      return (await client.query<WorkflowRow>(`${SELECT} AND ($1::text='Admin' OR requested_by=$2) ORDER BY created_at,id`, [actor.role, actor.id])).rows.map((row) => this.map(row));
    }));
  }
  async initialize(sessionId: string) {
    await this.closeMatching((r) => r.sessionId !== sessionId, 'BackendRestart');
  }
  async expireRequests(now: number) {
    await this.closeMatching((r) => now >= Date.parse(r.value.expires_at), 'Deadline');
  }
  private async closeMatching(matches: (r: CooperativeWorkflow) => boolean, reason: string) {
    await this.run(async () => {
      const candidates = (await this.pool.query<WorkflowRow>(`${SELECT} AND status=ANY($1::text[]) ORDER BY requested_by,target_key,id`, [ACTIVE])).rows.map((row) => this.map(row));
      for (const candidate of candidates.filter(matches)) {
        // Dùng user → metadata → HTX → request, kể cả expiry/restart. Khóa
        // request trước rồi INSERT audit (FK User) sẽ đảo thứ tự và dễ deadlock.
        await this.registry.withWorkflowLocks(candidate.value.manager_id, candidate.value.cooperative_id, async (client) => {
          const saved = await this.read(client, candidate.value.id, true);
          if (COOPERATIVE_TERMINAL.includes(saved.value.status) || !matches(saved)) { return; }
          const next = { ...saved.value, status: 'Expired' as const, resolved_at: new Date().toISOString() };
          const stored = await this.write(client, saved, next, false);
          await this.audit(client, stored, 'CooperativeUpdateExpired', { reason, from: saved.value.status });
        });
      }
    });
  }
  private context(request: CooperativeWorkflow, account: AccountSnapshot, cooperative: CooperativeSnapshot, identity: WorkflowIdentity) {
    const user = account.user;
    if (user.status !== 'Active' || user.role !== 'Manager' || cooperative.cooperative.manager_id !== user.id) { throw new ForbiddenException('Chỉ Manager Active của HTX được sửa'); }
    if (!user.gmail_verify || !user.gmail || user.gmail !== identity.email || user.phone_number !== identity.phone ||
        account.tokenVersion !== request.tokenVersion || cooperative.version !== request.cooperativeVersion) {
      throw new ConflictException('HTX hoặc tài khoản đã thay đổi; cần tạo yêu cầu và xác minh lại');
    }
  }
  private async read(client: PoolClient, id: string, lock = false): Promise<CooperativeWorkflow> {
    if (!UUID.test(id)) { throw new NotFoundException('Không tìm thấy yêu cầu sửa HTX'); }
    const result = await client.query<WorkflowRow>(`${SELECT} AND id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!result.rowCount) { throw new NotFoundException('Không tìm thấy yêu cầu sửa HTX'); } return this.map(result.rows[0]);
  }
  private async write(client: PoolClient, current: CooperativeWorkflow, next: CooperativeUpdateRequest, managerAction = true) {
    if (!Number.isSafeInteger(current.revision + 1)) { throw new Error('Revision exhausted'); }
    const changed = { ...current, value: next, revision: current.revision + 1 };
    const result = await client.query<WorkflowRow>(`UPDATE technical.workflow_requests SET status=$2,payload=$3,resolved_at=$4,resolved_by=$5
      WHERE id=$1 RETURNING *`, [next.id, next.status, JSON.stringify(this.payload(changed)), next.resolved_at,
      next.resolved_at && managerAction ? next.manager_id : null]);
    return this.map(result.rows[0]);
  }
  private payload(r: CooperativeWorkflow) {
    return { cooperative_id: r.value.cooperative_id, proposed_changes: r.value.proposed_changes, expires_at: r.value.expires_at,
      email_verified_at: r.value.email_verified_at, token_version: r.tokenVersion, revision: r.revision, session_id: r.sessionId };
  }
  private map(row: WorkflowRow): CooperativeWorkflow {
    const p = row.payload, status = row.status;
    if (typeof p.revision !== 'number' || typeof p.token_version !== 'number') { throw new Error('Invalid workflow counters'); }
    const version = safeInteger(row.expected_version), revision = safeInteger(p.revision), tokenVersion = safeInteger(p.token_version);
    const changes = p.proposed_changes as Record<string, unknown>;
    if (!UUID.test(row.target_key) || !UUID.test(String(p.session_id)) || p.cooperative_id !== row.target_key ||
        version < 1 || revision < 1 || tokenVersion < 0 || ![...ACTIVE, ...COOPERATIVE_TERMINAL].includes(status) ||
        !changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length ||
        Object.entries(changes).some(([key, value]) => !['cooperative_name', 'director', 'address', 'contact_number'].includes(key) || typeof value !== 'string' ||
          !value.trim() || value !== value.trim() || value.length > (key === 'address' ? 255 : key === 'contact_number' ? 14 : 40) ||
          (key === 'contact_number' && !/^\+?\d{9,13}$/.test(value))) ||
        (COOPERATIVE_TERMINAL.includes(status) !== (row.resolved_at !== null))) { throw new Error('Invalid cooperative workflow state'); }
    const value: CooperativeUpdateRequest = { id: row.id, cooperative_id: row.target_key, manager_id: row.requested_by,
      proposed_changes: { ...changes } as CooperativeUpdateRequest['proposed_changes'], status, created_at: row.created_at.toISOString(),
      resolved_at: row.resolved_at?.toISOString() ?? null, expires_at: this.iso(p.expires_at),
      email_verified_at: p.email_verified_at === null ? null : this.iso(p.email_verified_at) };
    return { value, cooperativeVersion: version, tokenVersion, revision, sessionId: String(p.session_id) };
  }
  private iso(value: unknown): string {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) { throw new Error('Invalid workflow timestamp'); } return value;
  }
  private async audit(client: PoolClient, r: CooperativeWorkflow, action: string, payload: Record<string, unknown>, entity = 'cooperative_update_requests', key = r.value.id) {
    await client.query(`INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ($1,$2,$3,$4,$5,$6)`,
      [entity, key, r.value.manager_id, action, new Date(), JSON.stringify(payload)]);
  }
  private async run<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof HttpException && !(error instanceof ServiceUnavailableException)) { throw error; }
      throw new ServiceUnavailableException('Không thể lưu quy trình sửa HTX; vui lòng thử lại sau');
    }
  }
}
