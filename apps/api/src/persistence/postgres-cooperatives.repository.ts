import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { publicUser, UserRecord } from '../auth/user-accounts';
import { AccountSnapshot } from '../auth/user-accounts';
import { TestCooperative } from '../users/mock-cooperative.store';
import { ApproveManagerDto, CreateCooperativeDto } from '../users/users.dto';
import { CooperativeNotification } from '../cooperatives/cooperatives.types';
import { COOPERATIVE_WARNING_DAYS, COOPERATIVE_DELETE_DAYS, COOPERATIVE_DAY_MS as DAY } from '../cooperatives/cooperative-lifecycle';
import { UpdateCooperativeDto } from '../cooperatives/cooperatives.dto';
import { safeInteger } from './mappers';
import { PostgresUsersRepository } from './postgres-users.repository';
import { inPostgresTransaction } from './transactions';

interface CooperativeRow extends TestCooperative { entity_version: string | null; metadata: Record<string, unknown> | null }
export interface CooperativeSnapshot { cooperative: TestCooperative; version: number; createdAt: string }
const READ = `SELECT c.id,c.manager_id,c.cooperative_name,c.director,c.certificate_number,c.address,c.contact_number,
  m.version AS entity_version,m.data AS metadata FROM public.cooperatives c LEFT JOIN technical.entity_metadata m
  ON m.entity_type='cooperatives' AND m.entity_key=c.id::text`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Registry/admin approval/lifecycle adapter. Manager email→SMS workflow wiring
// dùng tiếp repository này ở đợt sau; không tự seed/pool/timer hoặc gửi tin.
export class PostgresCooperativesRepository {
  constructor(private readonly pool: Pool, private readonly users: PostgresUsersRepository,
    private readonly clock: () => Date = () => new Date()) {}

  // Workflow dùng cùng pool/client và thứ tự khóa với registry/Manager approval.
  // Quyền sửa/identity/version phải được callback recheck trước mọi ghi.
  async withWorkflowLocks<T>(managerId: string, cooperativeId: string,
    work: (client: PoolClient, account: AccountSnapshot, cooperative: CooperativeSnapshot) => Promise<T>): Promise<T> {
    return this.transaction(async (client) => {
      await this.lockUsers(client, [managerId]);
      const account = await this.users.loadOnClient(client, managerId);
      if (!account) { throw new NotFoundException('Không tìm thấy tài khoản'); }
      return work(client, account, await this.read(client, cooperativeId, true));
    });
  }

  async withActor<T>(actorId: string, work: (client: PoolClient, actor: UserRecord) => Promise<T>): Promise<T> {
    return this.transaction(async (client) => work(client, await this.actor(client, actorId)));
  }

  async sweepScheduled(): Promise<void> {
    // Job không nhận actor từ HTTP. Dùng Admin Active trong DB làm audit actor;
    // chưa có Admin thì không tự xóa HTX mà không thể ghi audit hợp lệ.
    const admin = await this.transaction(async (client) => (await client.query<{ id: string }>(
      "SELECT id FROM public.users WHERE role='Admin' AND status='Active' ORDER BY id LIMIT 1")).rows[0]);
    if (admin) { await this.sweep(admin.id); }
  }

  async list(actorId: string, adminOnly = false): Promise<TestCooperative[]> {
    return this.transaction(async (client) => {
      const actor = await this.actor(client, actorId, adminOnly);
      return (await client.query<CooperativeRow>(`${READ} WHERE ($1::text <> 'Manager' OR c.manager_id=$2) ORDER BY c.id`, [actor.role, actor.id]))
        .rows.map((row) => this.map(row).cooperative);
    });
  }

  async get(actorId: string, id: string): Promise<CooperativeSnapshot> {
    return this.transaction(async (client) => {
      const actor = await this.actor(client, actorId);
      const value = await this.read(client, id);
      if (actor.role === 'Manager' && value.cooperative.manager_id !== actor.id) { throw new NotFoundException('Không tìm thấy HTX'); }
      return value;
    });
  }

  async create(adminId: string, input: CreateCooperativeDto): Promise<TestCooperative> {
    return this.transaction(async (client) => {
      await this.actor(client, adminId, true);
      return this.insert(client, adminId, input, null);
    });
  }

  async update(adminId: string, id: string, input: UpdateCooperativeDto): Promise<TestCooperative> {
    return this.transaction(async (client) => {
      await this.actor(client, adminId, true);
      const current = await this.read(client, id, true);
      const fields = ['cooperative_name', 'director', 'address', 'contact_number', 'certificate_number'] as const;
      if (Object.keys(input).some((key) => !fields.includes(key as typeof fields[number]))) { throw new BadRequestException('Thông tin không thuộc phạm vi được sửa'); }
      const changes = Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && value !== current.cooperative[key as keyof CreateCooperativeDto]));
      if (!Object.keys(changes).length) { throw new BadRequestException('Cần ít nhất một thông tin thực sự thay đổi'); }
      this.requireNextVersion(current.version);
      const next = { ...current.cooperative, ...changes };
      await client.query(`UPDATE public.cooperatives SET cooperative_name=$2,director=$3,address=$4,contact_number=$5,certificate_number=$6 WHERE id=$1`,
        [id, next.cooperative_name, next.director, next.address, next.contact_number, next.certificate_number]);
      await client.query("UPDATE technical.entity_metadata SET version=version+1 WHERE entity_type='cooperatives' AND entity_key=$1", [id]);
      await this.audit(client, 'cooperatives', id, adminId, 'CooperativeUpdated', { changed_fields: Object.keys(changes) });
      return next;
    });
  }

  async approve(adminId: string, managerId: string, input: ApproveManagerDto) {
    if (Boolean(input.cooperative_id) === Boolean(input.cooperative)) { throw new BadRequestException('Chọn đúng một cách: cooperative_id hoặc cooperative'); }
    return this.transaction(async (client) => {
      // Một thứ tự toàn cục user UUID → user metadata → HTX → HTX metadata.
      // Cả approve và reject recheck quyền/trạng thái sau khi đợi row lock.
      await this.lockUsers(client, [adminId, managerId]);
      await this.actor(client, adminId, true);
      const account = await this.pending(client, managerId);
      if (!account.user.gmail || !account.user.gmail_verify) { throw new ConflictException('Manager chưa xác minh email'); }
      const existing = await client.query('SELECT id FROM public.cooperatives WHERE manager_id=$1', [managerId]);
      if (existing.rowCount) { throw new ConflictException('Manager đã quản lý một HTX'); }
      let cooperative: TestCooperative;
      if (input.cooperative_id) {
        const current = await this.read(client, input.cooperative_id, true);
        if (current.cooperative.manager_id) { throw new ConflictException('HTX đã có Manager; không tự ghi đè người quản lý'); }
        this.requireNextVersion(current.version);
        await client.query('UPDATE public.cooperatives SET manager_id=$1 WHERE id=$2', [managerId, current.cooperative.id]);
        await client.query("UPDATE technical.entity_metadata SET version=version+1 WHERE entity_type='cooperatives' AND entity_key=$1", [current.cooperative.id]);
        cooperative = { ...current.cooperative, manager_id: managerId };
        await this.audit(client, 'cooperatives', cooperative.id, adminId, 'ManagerAssigned', { manager_id: managerId });
      } else { cooperative = await this.insert(client, adminId, input.cooperative!, managerId); }
      await this.resolveManager(client, managerId, 'Active', account.tokenVersion);
      await this.audit(client, 'users', managerId, adminId, 'ManagerApproved', { cooperative_id: cooperative.id, status: 'Active' });
      return { user: publicUser((await this.users.loadOnClient(client, managerId))!.user), cooperative };
    });
  }

  async reject(adminId: string, managerId: string) {
    return this.transaction(async (client) => {
      await this.lockUsers(client, [adminId, managerId]);
      await this.actor(client, adminId, true);
      const account = await this.pending(client, managerId);
      await this.resolveManager(client, managerId, 'Reject', account.tokenVersion);
      await this.audit(client, 'users', managerId, adminId, 'ManagerRejected', { status: 'Reject' });
      return publicUser((await this.users.loadOnClient(client, managerId))!.user);
    });
  }

  async pendingManagers(adminId: string) {
    return this.transaction(async (client) => {
      await this.actor(client, adminId, true);
      const ids = await client.query<{ id: string }>("SELECT id FROM public.users WHERE role='Manager' AND status='Pending' ORDER BY created_at,id");
      const snapshots = await Promise.all(ids.rows.map(({ id }) => this.users.loadOnClient(client, id)));
      return snapshots.filter((account) => account?.user.status === 'Pending').map((account) => publicUser(account!.user));
    });
  }

  // Caller scheduler dùng Admin context cấu hình nội bộ, không lấy actor/now
  // từ HTTP. Snapshot thông báo giữ lại ngay cả sau khi HTX đã bị xóa.
  async sweep(adminId: string): Promise<{ warned: number; blocked: number; deleted: number }> {
    return this.transaction(async (client) => {
      await this.actor(client, adminId, true);
      const ids = await client.query<{ id: string }>('SELECT id FROM public.cooperatives WHERE manager_id IS NULL ORDER BY id');
      const now = this.clock();
      const counts = { warned: 0, blocked: 0, deleted: 0 };
      for (const { id } of ids.rows) {
        // Phải đọc lại manager/deadline sau khi chờ lock; attach trước thì skip.
        const snapshot = await this.readOptional(client, id, true);
        if (!snapshot || snapshot.cooperative.manager_id) { continue; }
        const age = now.getTime() - Date.parse(snapshot.createdAt);
        if (age >= COOPERATIVE_WARNING_DAYS * DAY && await this.notify(client, snapshot, 'ManagerMissing', now)) { counts.warned++; }
        if (age < COOPERATIVE_DELETE_DAYS * DAY) { continue; }
        const blocked = await client.query(`SELECT EXISTS(SELECT 1 FROM public.farms WHERE cooperative_id=$1) OR
          EXISTS(SELECT 1 FROM technical.workflow_requests WHERE (module='cooperatives' AND target_key=$1::text)
            OR payload->>'cooperative_id'=$1::text OR payload->'farm_snapshot'->>'cooperative_id'=$1::text) OR
          EXISTS(SELECT 1 FROM technical.notifications WHERE payload->>'module' IS DISTINCT FROM 'cooperatives'
            AND payload->>'cooperative_id'=$1::text) AS blocked`, [id]);
        if (blocked.rows[0].blocked) {
          if (await this.notify(client, snapshot, 'DeletionBlocked', now)) { counts.blocked++; }
          continue;
        }
        await this.notify(client, snapshot, 'CooperativeDeleted', now);
        await this.audit(client, 'cooperatives', id, adminId, 'UnmanagedCooperativeDeleted', { source: 'LifecycleJob', cooperative_name: snapshot.cooperative.cooperative_name });
        await client.query('DELETE FROM public.cooperatives WHERE id=$1', [id]);
        await client.query("DELETE FROM technical.entity_metadata WHERE entity_type='cooperatives' AND entity_key=$1", [id]);
        counts.deleted++;
      }
      return counts;
    });
  }

  async notifications(adminId: string): Promise<CooperativeNotification[]> {
    return this.transaction(async (client) => {
      await this.actor(client, adminId, true);
      return (await client.query<{ id: string; type: CooperativeNotification['type']; payload: { cooperative_id: string; cooperative_name: string; created_at: string; manager_deadline: string } }>(
        "SELECT id,type,payload FROM technical.notifications WHERE payload->>'module'='cooperatives' ORDER BY created_at,id"))
        .rows.map(({ id, type, payload }) => ({ id, type, cooperative_id: payload.cooperative_id, cooperative_name: payload.cooperative_name,
          created_at: payload.created_at, manager_deadline: payload.manager_deadline }));
    });
  }

  private async pending(client: PoolClient, id: string) {
    const account = await this.users.loadOnClient(client, id);
    if (!account) { throw new NotFoundException('Không tìm thấy tài khoản'); }
    if (account.user.role !== 'Manager' || account.user.status !== 'Pending') { throw new ConflictException('Chỉ xử lý Manager đang Pending'); }
    return account;
  }
  private async actor(client: PoolClient, id: string, adminOnly = false): Promise<UserRecord> {
    await this.lockUsers(client, [id]);
    const account = await this.users.loadOnClient(client, id);
    if (!account || account.user.status !== 'Active' || (adminOnly && account.user.role !== 'Admin')) {
      throw new ForbiddenException(adminOnly ? 'Chỉ Admin được thực hiện thao tác này' : 'Tài khoản phải Active');
    }
    return account.user;
  }
  private async lockUsers(client: PoolClient, ids: string[]) {
    if (ids.some((id) => !UUID.test(id))) { throw new NotFoundException('Không tìm thấy tài khoản'); }
    const keys = [...new Set(ids)].sort();
    await client.query('SELECT id FROM public.users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [keys]);
    await client.query("SELECT entity_key FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=ANY($1::text[]) ORDER BY entity_key FOR UPDATE", [keys]);
  }
  private async resolveManager(client: PoolClient, id: string, status: 'Active' | 'Reject', tokenVersion: number) {
    const meta = await client.query<{ version: string }>("SELECT version FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=$1", [id]);
    this.requireNextVersion(safeInteger(meta.rows[0].version)); this.requireNextVersion(tokenVersion);
    await client.query('UPDATE public.users SET status=$1 WHERE id=$2', [status, id]);
    await client.query(`UPDATE technical.entity_metadata SET version=version+1,data=jsonb_set(data,'{token_version}',$2::jsonb)
      WHERE entity_type='users' AND entity_key=$1`, [id, JSON.stringify(tokenVersion + 1)]);
  }
  private async insert(client: PoolClient, actorId: string, input: CreateCooperativeDto, managerId: string | null) {
    const row = await client.query<TestCooperative>(`INSERT INTO public.cooperatives(manager_id,cooperative_name,director,certificate_number,address,contact_number)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,manager_id,cooperative_name,director,certificate_number,address,contact_number`,
      [managerId, input.cooperative_name, input.director, input.certificate_number, input.address, input.contact_number]);
    const cooperative = row.rows[0];
    await client.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,version,data) VALUES ('cooperatives',$1,1,$2)`,
      [cooperative.id, JSON.stringify({ created_at: this.clock().toISOString() })]);
    await this.audit(client, 'cooperatives', cooperative.id, actorId, 'CooperativeCreated', { manager_id: managerId });
    return cooperative;
  }
  private async readOptional(client: PoolClient, id: string, lock = false): Promise<CooperativeSnapshot | null> {
    if (!UUID.test(id)) { return null; }
    if (lock) {
      const locked = await client.query('SELECT id FROM public.cooperatives WHERE id=$1 FOR UPDATE', [id]);
      if (!locked.rowCount) { return null; }
      await client.query("SELECT entity_key FROM technical.entity_metadata WHERE entity_type='cooperatives' AND entity_key=$1 FOR UPDATE", [id]);
    }
    const rows = await client.query<CooperativeRow>(`${READ} WHERE c.id=$1`, [id]);
    return rows.rows[0] ? this.map(rows.rows[0]) : null;
  }
  private async read(client: PoolClient, id: string, lock = false): Promise<CooperativeSnapshot> {
    const snapshot = await this.readOptional(client, id, lock);
    if (!snapshot) { throw new NotFoundException('Không tìm thấy HTX'); } return snapshot;
  }
  private map(row: CooperativeRow): CooperativeSnapshot {
    const createdAt = row.metadata?.created_at;
    if (row.entity_version === null || safeInteger(row.entity_version) < 1 || typeof createdAt !== 'string' ||
        !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) { throw new Error('Invalid cooperative persistence state'); }
    const { id, manager_id, cooperative_name, director, certificate_number, address, contact_number } = row;
    return { cooperative: { id, manager_id, cooperative_name, director, certificate_number, address, contact_number }, version: safeInteger(row.entity_version), createdAt };
  }
  private requireNextVersion(current: number): void { if (!Number.isSafeInteger(current + 1)) { throw new Error('Entity version exhausted'); } }
  private async notify(client: PoolClient, snapshot: CooperativeSnapshot, type: CooperativeNotification['type'], now: Date): Promise<boolean> {
    const coop = snapshot.cooperative;
    const result = await client.query(`INSERT INTO technical.notifications(dedup_key,type,created_at,payload) VALUES ($1,$2,$3,$4)
      ON CONFLICT (dedup_key) DO NOTHING`, [`cooperatives:${coop.id}:${type}`, type, now,
      JSON.stringify({ module: 'cooperatives', cooperative_id: coop.id, cooperative_name: coop.cooperative_name, created_at: now.toISOString(),
        manager_deadline: new Date(Date.parse(snapshot.createdAt) + COOPERATIVE_DELETE_DAYS * DAY).toISOString() })]);
    return result.rowCount === 1;
  }
  private async audit(client: PoolClient, entity: string, id: string, actorId: string, action: string, payload: Record<string, unknown>): Promise<void> {
    await client.query(`INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ($1,$2,$3,$4,$5,$6)`,
      [entity, id, actorId, action, this.clock(), JSON.stringify(payload)]);
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    try { return await inPostgresTransaction(this.pool, work); }
    catch (error) {
      if (error instanceof HttpException) { throw error; }
      const driver = error as { code?: string; constraint?: string };
      if (driver.code === '23505' && driver.constraint === 'cooperatives_certificate_number') { throw new ConflictException('HTX có số chứng nhận này đã tồn tại'); }
      if (driver.code === '23505' && driver.constraint === 'cooperatives_manager_id_key') { throw new ConflictException('Manager đã quản lý một HTX'); }
      if (driver.code === '23505' && driver.constraint === 'cooperative_one_pending_manager') { throw new ConflictException('Manager đã có yêu cầu sửa HTX đang chờ; hoàn tất hoặc hủy trước'); }
      throw new ServiceUnavailableException('Không thể truy cập dữ liệu HTX; vui lòng thử lại sau');
    }
  }
}
