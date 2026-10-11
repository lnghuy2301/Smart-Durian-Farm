import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { UserRecord } from '../auth/user-accounts';
import { FarmPage, FarmRecords } from '../farms/farm-records';
import { CreateFarmRequestDto, FarmDetailsDto, FarmListDto, FarmPageDto, FarmRequestListDto, RejectFarmRequestDto, UpdateFarmRequestDto } from '../farms/farms.dto';
import { FarmAction, FarmChangeRequest } from '../farms/farms.types';
import { assertFarmApprovers, farmApprovals, farmReviewerIndex } from '../farms/farm-workflow';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { FarmRequestRow, FarmRow, FarmSnapshot, StoredFarmRequest, farmRequestPayload, mapFarm, mapFarmNotification, mapFarmRequest } from './farm-mappers';
import { decimalNumber, safeInteger } from './mappers';
import { PostgresUsersRepository } from './postgres-users.repository';
import { inPostgresTransaction } from './transactions';

interface Cooperative { id: string; manager_id: string | null }
interface Context { actor: UserRecord; users: Map<string, UserRecord>; coops: Map<string, Cooperative>; farm: FarmSnapshot | null; request: StoredFarmRequest | null }
class RetryFarmContext extends Error {}
const FARM_SELECT = `SELECT f.id,f.owner_id,f.cooperative_id,f.area_size,f.address,f.certificate_number,f.join_cooperative_date,f.longitude,f.latitude,
  m.version::text AS entity_version FROM public.farms f LEFT JOIN technical.entity_metadata m ON m.entity_type='farms' AND m.entity_key=f.id::text`;
const REQUEST_SELECT = `SELECT id,action,status,target_key,requested_by,expected_version::text,payload,created_at,resolved_at,resolved_by
  FROM technical.workflow_requests WHERE module='farms'`;
const FARM_SCOPE = `($1::text='Admin' OR ($1='Farmer' AND f.owner_id=$2::uuid) OR
  ($1='Manager' AND EXISTS(SELECT 1 FROM public.cooperatives c WHERE c.id=f.cooperative_id AND c.manager_id=$2::uuid)))`;
const REQUEST_SCOPE = `($1::text='Admin' OR ($1='Farmer' AND payload->>'owner_id'=$2::text) OR ($1='Manager' AND action='Join'
  AND payload->'required_approvals' @> jsonb_build_array(jsonb_build_object('role','Manager','user_id',$2::text))
  AND EXISTS(SELECT 1 FROM public.cooperatives c WHERE c.id::text=payload->>'cooperative_id' AND c.manager_id=$2::uuid)))`;

// Dữ liệu chính chỉ đổi ở chữ ký cuối. Pool là shared dependency; repository
// không mở pool/cache/worker/store khác hoặc auto migrate/seed khi khởi động.
export class PostgresFarmsRepository extends FarmRecords {
  constructor(private readonly pool: Pool, private readonly users: PostgresUsersRepository,
    private readonly clock: () => Date = () => new Date()) { super(); }

  async list(actorId: string, input: FarmListDto) {
    return this.readAs(actorId, async (client, actor) => {
      const q = farmInput(FarmListDto, input);
      return this.page(client, `${FARM_SELECT} WHERE ${FARM_SCOPE} AND
        ($3::text IS NULL OR strpos(lower(f.address || ' ' || f.certificate_number),lower($3))>0)`,
      [actor.role, actor.id, q.q ?? null], q, 'id', (row: FarmRow) => mapFarm(row).farm);
    });
  }
  async get(actorId: string, id: string) {
    return this.readAs(actorId, async (client, actor) => {
      const rows = await client.query<FarmRow>(`${FARM_SELECT} WHERE ${FARM_SCOPE} AND f.id=$3`, [actor.role, actor.id, farmUuid(id)]);
      if (!rows.rows[0]) { throw new NotFoundException('Không tìm thấy Farm trong phạm vi truy cập'); }
      return mapFarm(rows.rows[0]).farm;
    });
  }

  async createRequest(actorId: string, input: CreateFarmRequestDto) {
    const data = farmInput(CreateFarmRequestDto, input), actor = farmUuid(actorId);
    const owner = data.owner_id ? farmUuid(data.owner_id) : actor;
    return this.transaction(async (client) => {
      const accounts = await this.lockUsers(client, [actor, owner]), proposer = this.active(accounts, actor);
      this.proposer(proposer);
      if (proposer.role === 'Admin' && !data.owner_id) { throw new BadRequestException('Admin phải chỉ định owner_id của Farmer'); }
      if (proposer.role === 'Farmer' && actor !== owner) { throw new ForbiddenException('Farmer chỉ tạo Farm cho chính mình'); }
      this.owner(accounts, owner);
      const changes: FarmDetailsDto = { area_size: data.area_size, address: data.address, certificate_number: data.certificate_number,
        longitude: data.longitude, latitude: data.latitude };
      return this.insertRequest(client, proposer, owner, 'Create', null, changes, null);
    });
  }
  async updateRequest(actor: string, id: string, input: UpdateFarmRequestDto) {
    const changes = Object.fromEntries(Object.entries(farmInput(UpdateFarmRequestDto, input)).filter(([, value]) => value !== undefined));
    return this.proposeExisting(actor, id, 'Update', changes);
  }
  async joinRequest(actor: string, id: string, cooperative: string) { return this.proposeExisting(actor, id, 'Join', {}, farmUuid(cooperative)); }
  async leaveRequest(actor: string, id: string) { return this.proposeExisting(actor, id, 'Leave', {}); }

  async listRequests(actorId: string, input: FarmRequestListDto) {
    return this.readAs(actorId, async (client, actor) => {
      const q = farmInput(FarmRequestListDto, input);
      return this.page(client, `${REQUEST_SELECT} AND ${REQUEST_SCOPE} AND ($3::text IS NULL OR status=$3)`,
        [actor.role, actor.id, q.status ?? null], q, 'created_at,id', (row: FarmRequestRow) => mapFarmRequest(row).value);
    });
  }
  async getRequest(actorId: string, id: string) {
    return this.readAs(actorId, async (client, actor) => {
      const rows = await client.query<FarmRequestRow>(`${REQUEST_SELECT} AND ${REQUEST_SCOPE} AND id=$3`, [actor.role, actor.id, farmUuid(id)]);
      if (!rows.rows[0]) { throw new NotFoundException('Không tìm thấy yêu cầu trong phạm vi truy cập'); }
      return mapFarmRequest(rows.rows[0]).value;
    });
  }
  async approve(actor: string, id: string) { return this.decide(actor, id); }
  async reject(actor: string, id: string, reason?: string) {
    const input = farmInput(RejectFarmRequestDto, { reason });
    return this.decide(actor, id, { reason: input.reason });
  }
  async listNotifications(actorId: string, input: FarmPageDto) {
    return this.readAs(actorId, async (client, actor) => {
      if (actor.role !== 'Manager') { throw new ForbiddenException('Thông báo rời HTX dành cho Manager nhận thông báo'); }
      const q = farmInput(FarmPageDto, input);
      return this.page(client, `SELECT id,recipient_id,type,created_at,payload FROM technical.notifications
        WHERE recipient_id=$1 AND type='FarmLeftCooperative' AND payload->>'module'='farms'`, [actor.id], q, 'created_at,id', mapFarmNotification);
    });
  }

  // Adapter Zone sau này dùng đúng client/parent lock, không đọc bằng pool phụ.
  async loadOnClient(client: PoolClient, id: string, lock = false): Promise<FarmSnapshot> {
    id = farmUuid(id);
    if (lock) { await client.query('SELECT id FROM public.farms WHERE id=$1 FOR UPDATE', [id]); }
    const rows = await client.query<FarmRow>(`${FARM_SELECT} WHERE f.id=$1`, [id]);
    if (!rows.rows[0]) { throw new NotFoundException('Không tìm thấy Farm'); }
    return mapFarm(rows.rows[0]);
  }

  private async proposeExisting(actor: string, id: string, action: Exclude<FarmAction, 'Create'>, changes: Partial<FarmDetailsDto>, cooperative?: string) {
    actor = farmUuid(actor); id = farmUuid(id);
    return this.transaction(async (client) => {
      const context = await this.lockContext(client, actor, id, undefined, cooperative, true);
      this.proposer(context.actor);
      const current = context.farm!, farm = current.farm;
      if (context.actor.role === 'Farmer' && farm.owner_id !== actor) { throw new ForbiddenException('Chỉ chủ Farmer được đề xuất thay đổi Farm này'); }
      this.owner(context.users, farm.owner_id);
      let targetCoop = farm.cooperative_id, manager: string | undefined;
      if (action === 'Update') {
        if (!Object.keys(changes).length) { throw new BadRequestException('Cần ít nhất một field thay đổi'); }
        if (!Object.entries(changes).some(([key, value]) => farm[key as keyof FarmDetailsDto] !== value)) {
          throw new BadRequestException('Dữ liệu đề xuất không khác dữ liệu Farm hiện tại');
        }
      } else if (action === 'Join') {
        if (farm.cooperative_id) { throw new ConflictException('Farm đang thuộc HTX; phải rời trước khi xin gia nhập HTX khác'); }
        targetCoop = cooperative!;
        const coop = context.coops.get(targetCoop);
        if (!coop) { throw new NotFoundException('Không tìm thấy HTX'); }
        const account = coop.manager_id ? context.users.get(coop.manager_id) : undefined;
        if (account?.role !== 'Manager' || account.status !== 'Active') { throw new ConflictException('HTX cần có Manager Active để xét gia nhập'); }
        manager = account.id;
      } else if (!targetCoop) { throw new ConflictException('Farm chưa thuộc HTX'); }
      return this.insertRequest(client, context.actor, farm.owner_id, action, current, changes, targetCoop, manager);
    });
  }
  private async insertRequest(client: PoolClient, actor: UserRecord, owner: string, action: FarmAction,
    snapshot: FarmSnapshot | null, changes: Partial<FarmDetailsDto>, cooperative: string | null, manager?: string) {
    if (snapshot && (await client.query("SELECT 1 FROM technical.workflow_requests WHERE module='farms' AND status='Pending' AND target_key=$1", [snapshot.farm.id])).rowCount) {
      throw new ConflictException('Farm đã có yêu cầu đang chờ; hãy xử lý yêu cầu đó trước');
    }
    const payload: FarmRequestRow['payload'] = { owner_id: owner, proposed_role: actor.role as 'Admin' | 'Farmer', proposed_changes: changes,
      cooperative_id: cooperative, required_approvals: farmApprovals(actor.role as 'Admin' | 'Farmer', owner, manager),
      farm_snapshot: snapshot?.farm ?? null, rejected_by: null, rejection_reason: null };
    const rows = await client.query<FarmRequestRow>(`INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,expected_version,payload,created_at)
      VALUES ('farms',$1,'Pending',$2,$3,$4,$5,$6) RETURNING id,action,status,target_key,requested_by,expected_version::text,payload,created_at,resolved_at,resolved_by`,
    [action, snapshot?.farm.id ?? null, actor.id, snapshot?.version ?? null, JSON.stringify(payload), this.clock()]);
    const request = mapFarmRequest(rows.rows[0]).value;
    await this.metadata(client, 'farm_requests', request.id);
    await this.audit(client, 'farm_requests', request.id, actor.id, 'FarmRequestCreated', { action, farm_id: request.farm_id });
    return request;
  }

  private async decide(actor: string, id: string, rejection?: { reason?: string }) {
    actor = farmUuid(actor); id = farmUuid(id);
    return this.transaction(async (client) => {
      const context = await this.lockContext(client, actor, undefined, id);
      const stored = context.request!, request = structuredClone(stored.value);
      const manager = request.cooperative_id ? context.coops.get(request.cooperative_id)?.manager_id ?? null : null;
      const index = farmReviewerIndex(context.actor, request, manager);
      const now = this.clock().toISOString();
      if (rejection) {
        // Từ chối vẫn được khi version/proposer/chữ ký trước đã stale; chỉ bên
        // chưa duyệt và còn quyền hiện tại được giải phóng slot Pending.
        request.status = 'Rejected'; request.rejected_by = actor; request.rejection_reason = rejection.reason ?? null; request.resolved_at = now;
      } else {
        this.validateContext(context);
        request.required_approvals[index].approved_by = actor; request.required_approvals[index].approved_at = now;
        if (request.required_approvals.every((approval) => approval.approved_by)) {
          assertFarmApprovers(request, context.users);
          await this.apply(client, request, context, actor, now);
          request.status = 'Accepted'; request.resolved_at = now;
        }
      }
      await client.query(`UPDATE technical.workflow_requests SET status=$2,target_key=$3,payload=$4,resolved_at=$5,resolved_by=$6 WHERE id=$1 AND module='farms'`,
        [id, request.status, request.farm_id, JSON.stringify(farmRequestPayload(request)), request.resolved_at, request.resolved_at ? actor : null]);
      await this.metadata(client, 'farm_requests', id);
      await this.audit(client, 'farm_requests', id, actor, rejection ? 'FarmRequestRejected' : request.status === 'Accepted' ? 'FarmRequestAccepted' : 'FarmRequestApprovalAdded',
        { action: request.action, farm_id: request.farm_id, approval_role: context.actor.role });
      return request;
    });
  }
  private validateContext(context: Context): void {
    const stored = context.request!, r = stored.value;
    this.owner(context.users, r.owner_id);
    const proposer = context.users.get(r.proposed_by);
    if (proposer?.status !== 'Active' || proposer.role !== r.proposed_role) { throw new ConflictException('Tài khoản đề xuất không còn đúng vai trò hoặc không Active'); }
    if (r.farm_id) {
      const current = context.farm!;
      if (current.farm.owner_id !== r.owner_id || current.version !== stored.farmVersion) { throw new ConflictException('Farm đã thay đổi; cần đề xuất mới'); }
      if (r.action === 'Join' && current.farm.cooperative_id) { throw new ConflictException('Farm đã thuộc HTX'); }
      if (r.action === 'Leave' && current.farm.cooperative_id !== r.cooperative_id) { throw new ConflictException('HTX của Farm đã thay đổi'); }
    }
    if (r.action === 'Join') {
      const coop = context.coops.get(r.cooperative_id!), approval = r.required_approvals.find((item) => item.role === 'Manager')!;
      const manager = approval.user_id ? context.users.get(approval.user_id) : undefined;
      if (!coop || coop.manager_id !== approval.user_id || manager?.role !== 'Manager' || manager.status !== 'Active') {
        throw new ConflictException('Manager của HTX đã thay đổi hoặc không Active; cần xử lý lại yêu cầu');
      }
    }
  }

  private async apply(client: PoolClient, request: FarmChangeRequest, context: Context, actor: string, now: string) {
    if (request.action === 'Create') {
      const d = request.proposed_changes as FarmDetailsDto;
      const rows = await client.query<{ id: string }>(`INSERT INTO public.farms(owner_id,area_size,address,certificate_number,longitude,latitude)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [request.owner_id, d.area_size, d.address, d.certificate_number, d.longitude, d.latitude]);
      request.farm_id = rows.rows[0].id;
      await this.metadata(client, 'farms', request.farm_id);
      if (!context.users.get(request.owner_id)!.is_owner) {
        await client.query('UPDATE public.users SET is_owner=true WHERE id=$1', [request.owner_id]);
        await this.metadata(client, 'users', request.owner_id);
        await this.audit(client, 'users', request.owner_id, actor, 'FarmOwnershipGranted', { farm_id: request.farm_id });
      }
    } else if (request.action === 'Update') {
      const fields = Object.entries(request.proposed_changes);
      // Khóa Farm đã lấy trước statement SUM; dùng snapshot mới sau lock,
      // không dựa vào trigger đã bắt đầu statement ở snapshot trước khi đợi.
      const sum = await client.query<{ used: string }>('SELECT COALESCE(sum(area_size),0)::text AS used FROM public.zones WHERE farm_id=$1', [request.farm_id]);
      if ((request.proposed_changes.area_size ?? context.farm!.farm.area_size) < decimalNumber(sum.rows[0].used)) {
        throw new ConflictException('Diện tích Farm không đủ cho tổng diện tích Zone hiện có');
      }
      await client.query(`UPDATE public.farms SET ${fields.map(([key], i) => `${key}=$${i + 2}`).join(',')} WHERE id=$1`, [request.farm_id, ...fields.map(([, value]) => value)]);
      await this.metadata(client, 'farms', request.farm_id!);
    } else if (request.action === 'Join') {
      await client.query('UPDATE public.farms SET cooperative_id=$2,join_cooperative_date=$3 WHERE id=$1', [request.farm_id, request.cooperative_id, now]);
      await this.metadata(client, 'farms', request.farm_id!);
    } else {
      const coop = context.coops.get(request.cooperative_id!), manager = coop?.manager_id ? context.users.get(coop.manager_id) : undefined;
      // Manager Locked vẫn nhận thông báo bền; không cần duyệt rời/Active.
      if (manager?.role !== 'Manager') { throw new ConflictException('HTX không có Manager hợp lệ để nhận thông báo'); }
      await client.query('UPDATE public.farms SET cooperative_id=NULL,join_cooperative_date=NULL WHERE id=$1', [request.farm_id]);
      await this.metadata(client, 'farms', request.farm_id!);
      await client.query(`INSERT INTO technical.notifications(recipient_id,dedup_key,type,created_at,payload)
        VALUES ($1,$2,'FarmLeftCooperative',$3,$4)`, [manager.id, `farms:${request.id}:leave`, now,
        JSON.stringify({ module: 'farms', farm_id: request.farm_id, owner_id: request.owner_id, cooperative_id: request.cooperative_id, request_id: request.id })]);
    }
    await this.audit(client, 'farms', request.farm_id!, actor, `Farm${request.action}Applied`, { request_id: request.id });
  }

  private async readRequest(client: PoolClient, id: string, lock = false): Promise<StoredFarmRequest> {
    const rows = await client.query<FarmRequestRow>(`${REQUEST_SELECT} AND id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!rows.rows[0]) { throw new NotFoundException('Không tìm thấy yêu cầu Farm'); }
    return mapFarmRequest(rows.rows[0]);
  }
  private async lockContext(client: PoolClient, actorId: string, farmId?: string, requestId?: string, cooperativeId?: string, proposing = false): Promise<Context> {
    const firstActor = await this.users.loadOnClient(client, actorId);
    if (!firstActor || firstActor.user.status !== 'Active') { throw new ForbiddenException('Tài khoản phải Active'); }
    if (proposing) { this.proposer(firstActor.user); }
    const requestHint = requestId ? await this.readRequest(client, requestId) : null;
    const farmHint = farmId || requestHint?.value.farm_id ? await this.loadOnClient(client, farmId ?? requestHint!.value.farm_id!) : null;
    const request = requestHint?.value;
    const coopIds = [...new Set([cooperativeId, farmHint?.farm.cooperative_id, request?.cooperative_id, request?.farm_snapshot?.cooperative_id].filter((id): id is string => Boolean(id)))].sort();
    const hints = (await client.query<Cooperative>('SELECT id,manager_id FROM public.cooperatives WHERE id=ANY($1::uuid[]) ORDER BY id', [coopIds])).rows;
    const userIds = [actorId, farmHint?.farm.owner_id, request?.owner_id, request?.proposed_by,
      ...request?.required_approvals.flatMap((approval) => [approval.user_id, approval.approved_by]) ?? [], ...hints.map((coop) => coop.manager_id)]
      .filter((id): id is string => Boolean(id));
    // Tất cả users UUID tăng dần → user metadata → HTX tăng dần → Farm
    // → request. Không khóa thêm user sau HTX (registry cũng user→HTX).
    const accounts = await this.lockUsers(client, userIds), actor = this.active(accounts, actorId);
    const coops = new Map((await client.query<Cooperative>('SELECT id,manager_id FROM public.cooperatives WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [coopIds])).rows.map((coop) => [coop.id, coop]));
    if (hints.some((hint) => coops.get(hint.id)?.manager_id !== hint.manager_id)) { throw new RetryFarmContext(); }
    const farm = farmHint ? await this.loadOnClient(client, farmHint.farm.id, true) : null;
    const stored = requestId ? await this.readRequest(client, requestId, true) : null;
    // Chữ ký đầu có thể tới lúc đợi lock. Rollback/retry toàn transaction để
    // khóa cả Admin vừa ký trước khi bước cuối recheck; không mất chữ ký.
    if ((stored && JSON.stringify(stored.value) !== JSON.stringify(requestHint!.value)) ||
      (farm && (farm.farm.owner_id !== farmHint!.farm.owner_id || farm.farm.cooperative_id !== farmHint!.farm.cooperative_id))) { throw new RetryFarmContext(); }
    return { actor, users: accounts, coops, farm, request: stored };
  }
  private async lockUsers(client: PoolClient, ids: string[]): Promise<Map<string, UserRecord>> {
    const keys = [...new Set(ids.map(farmUuid))].sort();
    await client.query('SELECT id FROM public.users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [keys]);
    await client.query("SELECT entity_key FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=ANY($1::text[]) ORDER BY entity_key FOR UPDATE", [keys]);
    const result = new Map<string, UserRecord>();
    for (const id of keys) { const account = await this.users.loadOnClient(client, id); if (account) { result.set(id, account.user); } }
    return result;
  }
  private active(users: ReadonlyMap<string, UserRecord>, id: string): UserRecord {
    const user = users.get(id);
    if (!user || user.status !== 'Active') { throw new ForbiddenException('Tài khoản phải Active'); } return user;
  }
  private owner(users: ReadonlyMap<string, UserRecord>, id: string): UserRecord {
    const user = users.get(id);
    if (!user || user.role !== 'Farmer' || user.status !== 'Active') { throw new ConflictException('Chủ Farm phải là tài khoản Farmer Active'); } return user;
  }
  private proposer(actor: UserRecord): void {
    if (actor.role !== 'Admin' && actor.role !== 'Farmer') { throw new ForbiddenException('Chỉ Admin hoặc chủ Farmer được đề xuất thay đổi Farm'); }
  }
  private async readAs<T>(actor: string, work: (client: PoolClient, actor: UserRecord) => Promise<T>): Promise<T> {
    actor = farmUuid(actor);
    return this.transaction(async (client) => work(client, this.active(await this.lockUsers(client, [actor]), actor)));
  }
  private async page<Row, T>(client: PoolClient, select: string, values: unknown[], q: FarmPageDto, order: string, map: (row: Row) => T): Promise<FarmPage<T>> {
    const n = values.length;
    const result = await client.query<{ total: string; items: Row[] }>(`WITH filtered AS (${select}),
      page AS (SELECT * FROM filtered ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2})
      SELECT (SELECT count(*) FROM filtered)::text AS total, COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY ${order}) FROM page p),'[]'::jsonb) AS items`, [...values, q.limit, q.offset]);
    return { items: result.rows[0].items.map(map), total: safeInteger(result.rows[0].total), limit: q.limit, offset: q.offset };
  }
  private async metadata(client: PoolClient, table: string, key: string): Promise<void> {
    const result = await client.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,version) VALUES ($1,$2,1)
      ON CONFLICT(entity_type,entity_key) DO UPDATE SET version=technical.entity_metadata.version+1
      WHERE technical.entity_metadata.version BETWEEN 1 AND 9007199254740990 RETURNING version`, [table, key]);
    if (!result.rowCount) { throw new Error('Invalid or exhausted Farm version'); }
  }
  private async audit(client: PoolClient, table: string, key: string, actor: string, action: string, payload: object) {
    await client.query('INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ($1,$2,$3,$4,$5,$6)',
      [table, key, actor, action, this.clock(), JSON.stringify(payload)]);
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await inPostgresTransaction(this.pool, work); }
      catch (error) {
        if (error instanceof RetryFarmContext) { continue; }
        if (error instanceof HttpException) { throw error; }
        const driver = error as { code?: string; constraint?: string };
        if (driver.code === '23505' && driver.constraint === 'farm_one_pending_request') { throw new ConflictException('Farm đã có yêu cầu đang chờ; hãy xử lý yêu cầu đó trước'); }
        throw new ServiceUnavailableException('Không thể truy cập dữ liệu Farm; vui lòng thử lại sau');
      }
    }
    throw new ConflictException('Dữ liệu duyệt Farm vừa thay đổi; hãy tải lại trước khi tiếp tục');
  }
}
