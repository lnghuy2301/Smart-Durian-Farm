import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { UserRecord } from '../auth/user-accounts';
import { AssignmentRecords, AssignmentEventContext } from '../assignments/assignment-records';
import { AssignmentListDto, CreateAssignmentRequestDto } from '../assignments/assignments.dto';
import { AssignmentHistory, AssignmentRequest } from '../assignments/assignments.types';
import { assignmentActive, assignmentAllowsCorrection } from '../assignments/assignment-policy';
import { FarmRequestListDto, RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { FarmPage } from '../farms/farm-records';
import { TestZone } from '../zones/zones.types';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { FarmSnapshot } from './farm-mappers';
import { ZONE_FIELDS } from './zone-mappers';
import {
  AssignmentRow,
  AssignmentRequestRow,
  assignmentRequestPayload,
  assignmentResponse,
  mapAssignment,
  mapAssignmentRequest,
} from './assignment-mappers';
import { safeInteger } from './mappers';
import { inPostgresTransaction } from './transactions';
import { AssignmentCandidate, candidateSearch, CANDIDATE_LIMIT } from '../assignments/assignment-candidates';

const SELECT_ASSIGNMENT = `SELECT a.id,a.user_id,a.zone_id,z.farm_id,a.start_date,a.end_date,m.version::text AS entity_version,m.data
  FROM public.users_zones a JOIN public.zones z ON z.id=a.zone_id
  LEFT JOIN technical.entity_metadata m ON m.entity_type='users_zones' AND m.entity_key=a.id::text`;
const SELECT_REQUEST = `SELECT w.id,w.action,w.status,w.target_key,w.requested_by,w.expected_version::text,w.payload,w.created_at,w.resolved_at,w.resolved_by,m.version::text AS entity_version
  FROM technical.workflow_requests w LEFT JOIN technical.entity_metadata m ON m.entity_type='assignment_requests' AND m.entity_key=w.id::text WHERE w.module='assignments'`;
const MANAGED_FARM = `EXISTS(SELECT 1 FROM public.farms f WHERE f.id=z.farm_id AND
  (($1='Farmer' AND f.owner_id=$2::uuid) OR ($1='Manager' AND EXISTS(SELECT 1 FROM public.cooperatives c WHERE c.id=f.cooperative_id AND c.manager_id=$2::uuid))))`;
const ENTRY_SCOPE = `($1::text='Admin' OR a.user_id=$2::uuid OR ${MANAGED_FARM})`;
const REQUEST_SCOPE = `($1::text='Admin' OR w.payload->>'owner_id'=$2 OR w.payload->>'user_id'=$2
  OR EXISTS(SELECT 1 FROM public.zones z WHERE z.id::text=w.payload->>'zone_id' AND ${MANAGED_FARM}))`;
interface Context {
  actor: UserRecord;
  users: Map<string, UserRecord>;
  farm: FarmSnapshot;
  zone: TestZone;
  request: AssignmentRequest | null;
  entry: AssignmentHistory | null;
}
class RetryAssignmentContext extends Error {}

export class PostgresAssignmentsRepository extends AssignmentRecords {
  constructor(
    private readonly pool: Pool,
    private readonly users: PostgresUsersRepository,
    private readonly farms: PostgresFarmsRepository,
    private readonly zones: PostgresZonesRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {
    super();
  }

  async list(actor: string, input: AssignmentListDto, mineOnly = false) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(AssignmentListDto, input),
        now = this.clock().getTime();
      return this.page(
        client,
        `${SELECT_ASSIGNMENT} WHERE ${mineOnly ? 'a.user_id=$2::uuid' : ENTRY_SCOPE}
        AND ($3::uuid IS NULL OR a.zone_id=$3) AND $1::text IS NOT NULL`,
        [user.role, user.id, q.zone_id ? farmUuid(q.zone_id) : null],
        q,
        'id',
        (row: AssignmentRow) => assignmentResponse(mapAssignment(row), now),
      );
    });
  }
  async candidates(actor: string, zoneId: string, query = '') {
    zoneId = farmUuid(zoneId);
    return this.readAs(actor, async (client, user) => {
      const zone = (await this.zones.loadOnClient(client, zoneId)).zone;
      const farm = (await this.farms.loadOnClient(client, zone.farm_id)).farm;
      if (user.role !== 'Admin' && !(user.role === 'Farmer' && farm.owner_id === user.id)) {
        throw new ForbiddenException('Chỉ chủ Farmer hoặc Admin được tìm người nhận phân công');
      }
      const owner = await this.users.loadOnClient(client, farm.owner_id);
      if (owner?.user.role !== 'Farmer' || owner.user.status !== 'Active') {
        throw new ForbiddenException('Chủ Farm phải là Farmer Active');
      }
      const search = candidateSearch(query);
      // Scope is rechecked in the same SELECT that reads contacts. A concurrent
      // ownership change cannot turn a preflight check into a user directory.
      const previous = `EXISTS(SELECT 1 FROM public.users_zones a JOIN public.zones z ON z.id=a.zone_id WHERE a.user_id=u.id AND z.farm_id=$1)`;
      const result = await client.query<AssignmentCandidate>(`SELECT u.id,u.user_name,u.phone_number,${previous} AS previously_assigned
        FROM public.users u WHERE u.role='Farmer' AND u.status='Active'
        AND EXISTS(SELECT 1 FROM public.farms f JOIN public.users owner ON owner.id=f.owner_id WHERE f.id=$1
          AND owner.role='Farmer' AND owner.status='Active' AND ($3::text='Admin' OR f.owner_id=$4::uuid))
        AND (CASE WHEN $2::text='' THEN ${previous} WHEN $5::text IS NOT NULL THEN
          (strpos(CASE WHEN ltrim(u.phone_number,'+') ~ '^0[0-9]{9}$' THEN '84'||substr(ltrim(u.phone_number,'+'),2) ELSE ltrim(u.phone_number,'+') END,$5)>0
            OR strpos(ltrim(u.phone_number,'+'),regexp_replace($2,'[^0-9]','','g'))>0)
          ELSE strpos(translate(regexp_replace(normalize(lower(u.user_name),NFD),U&'[\\0300-\\036f]','','g'),'đ','d'),$2)>0 END)
        ORDER BY normalize(lower(u.user_name),NFC) COLLATE "C",u.id LIMIT $6`, [zone.farm_id, search.name, user.role, user.id, search.phone, CANDIDATE_LIMIT + 1]);
      return { items: result.rows.slice(0, CANDIDATE_LIMIT), has_more: result.rows.length > CANDIDATE_LIMIT };
    });
  }
  async get(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const rows = await client.query<AssignmentRow>(
        `${SELECT_ASSIGNMENT} WHERE ${ENTRY_SCOPE} AND a.id=$3`,
        [user.role, user.id, id],
      );
      if (!rows.rows[0]) {
        throw new NotFoundException('Không tìm thấy phân công trong phạm vi truy cập');
      }
      return assignmentResponse(mapAssignment(rows.rows[0]), this.clock().getTime());
    });
  }
  async listRequests(actor: string, input: FarmRequestListDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(FarmRequestListDto, input);
      return this.page(
        client,
        `${SELECT_REQUEST} AND ${REQUEST_SCOPE} AND ($3::text IS NULL OR w.status=$3)`,
        [user.role, user.id, q.status ?? null],
        q,
        'created_at,id',
        mapAssignmentRequest,
      );
    });
  }
  async getRequest(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const rows = await client.query<AssignmentRequestRow>(
        `${SELECT_REQUEST} AND ${REQUEST_SCOPE} AND w.id=$3`,
        [user.role, user.id, id],
      );
      if (!rows.rows[0]) {
        throw new NotFoundException('Không tìm thấy lời mời phân công');
      }
      return mapAssignmentRequest(rows.rows[0]);
    });
  }
  async createRequest(actor: string, zoneId: string, input: CreateAssignmentRequestDto) {
    actor = farmUuid(actor);
    zoneId = farmUuid(zoneId);
    const value = farmInput(CreateAssignmentRequestDto, input);
    value.user_id = farmUuid(value.user_id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { zoneId, userId: value.user_id });
      this.manage(c, c.actor);
      this.farmer(c.users, value.user_id);
      const now = this.clock().toISOString(),
        start = value.start_date ? this.date(value.start_date) : now,
        end = value.end_date ? this.date(value.end_date) : null;
      const earliest = new Date(Math.max(Date.parse(start), Date.parse(now))).toISOString();
      if (end && Date.parse(end) <= Date.parse(earliest)) {
        throw new BadRequestException('end_date phải sau start_date và sau thời điểm hiện tại');
      }
      await this.available(client, zoneId, earliest, end);
      return this.addRequest(client, c, 'Assign', value.user_id, start, end, null, now);
    });
  }
  async approve(actor: string, id: string) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { requestId: id }),
        r = structuredClone(c.request!);
      this.farmer(c.users, actor);
      this.pending(r);
      if (!r.required_approvals.some((a) => a.user_id === actor && a.approved_at === null)) {
        throw new ForbiddenException('Bạn không phải bên còn cần chấp nhận phân công');
      }
      const proposer = this.active(c.users, r.proposed_by);
      this.manage(c, proposer);
      if (proposer.role !== r.proposed_role || c.farm.farm.owner_id !== r.owner_id) {
        throw new ConflictException('Vai trò người đề xuất hoặc chủ Farm đã thay đổi');
      }
      if (r.action === 'Assign') {
        this.farmer(c.users, r.user_id);
        // JSONB không giữ thứ tự key. So sánh giá trị theo whitelist, không so
        // JSON.stringify để tránh coi snapshot giống nhau là khác nhau.
        if (
          !['id', 'farm_id', ...ZONE_FIELDS].every(
            (key) => c.zone[key as keyof TestZone] === r.zone_snapshot[key as keyof TestZone],
          )
        ) {
          throw new ConflictException('Zone đã thay đổi; cần lập lời mời mới');
        }
      } else if (!assignmentActive(c.entry!.assignment, this.clock().getTime())) {
        throw new ConflictException('Phân công không còn hiệu lực');
      }
      const now = this.clock().toISOString();
      // Owner cũng là Assignee: một xác nhận đáp ứng cả hai mục đích.
      for (const approval of r.required_approvals) {
        if (approval.user_id === actor) {
          approval.approved_at ??= now;
        }
      }
      if (r.required_approvals.every((a) => a.approved_at !== null)) {
        for (const approval of r.required_approvals) {
          this.farmer(c.users, approval.user_id);
        }
        if (r.action === 'Assign') {
          const start = new Date(Math.max(Date.parse(r.start_date), Date.parse(now))).toISOString();
          if (r.end_date && Date.parse(r.end_date) <= Date.parse(start)) {
            throw new ConflictException('Lời mời đã hết khoảng thời gian; cần lập lại');
          }
          await this.available(client, r.zone_id, start, r.end_date, r.id);
          const saved = await client.query<{ id: string }>(
            'INSERT INTO public.users_zones(user_id,zone_id,start_date,end_date) VALUES ($1,$2,$3,$4) RETURNING id',
            [r.user_id, r.zone_id, start, r.end_date],
          );
          r.assignment_id = saved.rows[0].id;
          await this.metadata(client, 'users_zones', r.assignment_id, {
            accepted_at: now,
            zone_snapshot: c.zone,
          });
          await this.audit(client, 'users_zones', r.assignment_id, actor, 'AssignmentAccepted', {
            request_id: r.id,
            user_id: r.user_id,
            zone_id: r.zone_id,
            start_date: start,
            end_date: r.end_date,
          });
        } else {
          r.end_date = (await this.endEntry(client, c.entry!, actor, now, r.id)).assignment.end_date;
        }
        r.status = 'Accepted';
        r.resolved_at = now;
        r.resolved_by = actor;
      }
      await this.saveRequest(
        client,
        r,
        actor,
        r.status === 'Accepted' ? 'AssignmentRequestAccepted' : 'AssignmentApprovalAdded',
      );
      return r;
    });
  }
  async reject(actor: string, id: string, reason?: string) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    reason = farmInput(RejectFarmRequestDto, { reason }).reason;
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { requestId: id }),
        r = structuredClone(c.request!);
      this.pending(r);
      if (
        actor !== r.owner_id &&
        actor !== r.proposed_by &&
        !(r.action === 'Assign' && actor === r.user_id)
      ) {
        throw new ForbiddenException('Bạn không có quyền từ chối lời mời này');
      }
      r.status = 'Rejected';
      r.resolved_by = actor;
      r.resolved_at = this.clock().toISOString();
      r.rejection_reason = reason ?? null;
      await this.saveRequest(client, r, actor, 'AssignmentRequestRejected');
      return r;
    });
  }
  async end(actor: string, id: string) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { assignmentId: id });
      this.manage(c, c.actor);
      if (c.actor.role !== 'Farmer') {
        throw new ForbiddenException('Admin phải đề xuất kết thúc để chủ Farmer duyệt');
      }
      return this.endEntry(client, c.entry!, actor, this.clock().toISOString(), null);
    });
  }
  async endRequest(actor: string, id: string) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { assignmentId: id });
      this.manage(c, c.actor);
      if (c.actor.role !== 'Admin') {
        throw new ForbiddenException('Chủ Farmer dùng endpoint kết thúc trực tiếp');
      }
      if (!assignmentActive(c.entry!.assignment, this.clock().getTime())) {
        throw new ConflictException('Chỉ đề xuất kết thúc phân công đang có hiệu lực');
      }
      const exists = await client.query(
        "SELECT 1 FROM technical.workflow_requests WHERE module='assignments' AND action='End' AND status='Pending' AND target_key=$1",
        [id],
      );
      if (exists.rowCount) {
        throw new ConflictException('Phân công đã có đề xuất kết thúc đang chờ');
      }
      const a = c.entry!.assignment;
      return this.addRequest(
        client,
        c,
        'End',
        a.user_id,
        a.start_date,
        a.end_date,
        a.id,
        this.clock().toISOString(),
      );
    });
  }
  async assertCanWork(actor: string, zoneId: string) {
    actor = farmUuid(actor);
    zoneId = farmUuid(zoneId);
    return this.readAs(actor, async (client, user) => {
      this.farmer(new Map([[actor, user]]), actor);
      await this.zones.loadOnClient(client, zoneId);
      const found = await this.activeOnClient(client, actor, zoneId);
      if (!found) {
        throw new ForbiddenException('Farmer không có phân công đang hiệu lực tại Zone');
      }
    });
  }
  async assertCanCorrect(actor: string, event: AssignmentEventContext) {
    actor = farmUuid(actor);
    const assignmentId = farmUuid(event.assignment_id);
    return this.readAs(actor, async (client, user) => {
      this.farmer(new Map([[actor, user]]), actor);
      const { assignment } = await this.loadOnClient(client, assignmentId);
      if (
        assignment.user_id !== actor ||
        assignment.zone_id !== event.zone_id ||
        event.author_id !== actor ||
        !assignmentAllowsCorrection(assignment, event.created_at, this.clock().getTime())
      ) {
        throw new ForbiddenException(
          'Chỉ tác giả được correction trong phân công gốc hoặc tối đa 15 ngày sau end_date',
        );
      }
    });
  }
  // Lookup nội bộ: caller ghi domain phải giữ user/parent locks trên cùng
  // transaction tới commit, không dùng helper public như bằng chứng lâu dài.
  async activeOnClient(
    client: PoolClient,
    userId: string,
    zoneId: string,
  ): Promise<AssignmentHistory | null> {
    const rows = await client.query<AssignmentRow>(
      `${SELECT_ASSIGNMENT} WHERE a.user_id=$1 AND a.zone_id=$2 AND a.start_date<=$3 AND (a.end_date IS NULL OR a.end_date>$3)`,
      [farmUuid(userId), farmUuid(zoneId), this.clock()],
    );
    if (!rows.rows[0]) {
      return null;
    }
    return mapAssignment(rows.rows[0]);
  }
  async loadOnClient(client: PoolClient, id: string, lock = false): Promise<AssignmentHistory> {
    id = farmUuid(id);
    if (lock) {
      await client.query('SELECT id FROM public.users_zones WHERE id=$1 FOR UPDATE', [id]);
    }
    const rows = await client.query<AssignmentRow>(`${SELECT_ASSIGNMENT} WHERE a.id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy phân công');
    }
    return mapAssignment(rows.rows[0]);
  }
  private async addRequest(
    client: PoolClient,
    c: Context,
    action: 'Assign' | 'End',
    userId: string,
    start: string,
    end: string | null,
    assignmentId: string | null,
    now: string,
  ) {
    const required: AssignmentRequest['required_approvals'] = [];
    if (c.actor.role === 'Admin') {
      required.push({ purpose: 'Owner', user_id: c.farm.farm.owner_id, approved_at: null });
    }
    if (action === 'Assign') {
      required.push({ purpose: 'Assignee', user_id: userId, approved_at: null });
    }
    const payload = {
      zone_id: c.zone.id,
      owner_id: c.farm.farm.owner_id,
      user_id: userId,
      proposed_role: c.actor.role as 'Admin' | 'Farmer',
      start_date: start,
      end_date: end,
      assignment_id: assignmentId,
      zone_snapshot: c.zone,
      required_approvals: required,
      rejection_reason: null,
    };
    const row = await client.query<{ id: string }>(
      `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at) VALUES ('assignments',$1,'Pending',$2,$3,$4,$5) RETURNING id`,
      [action, action === 'Assign' ? c.zone.id : assignmentId, c.actor.id, JSON.stringify(payload), now],
    );
    const id = row.rows[0].id;
    await this.metadata(client, 'assignment_requests', id);
    await this.audit(client, 'assignment_requests', id, c.actor.id, 'AssignmentRequestCreated', {
      action,
      zone_id: c.zone.id,
      user_id: userId,
      assignment_id: assignmentId,
    });
    return this.request(client, id);
  }
  private async saveRequest(client: PoolClient, r: AssignmentRequest, actor: string, action: string) {
    await client.query(
      "UPDATE technical.workflow_requests SET status=$2,payload=$3,resolved_at=$4,resolved_by=$5 WHERE module='assignments' AND id=$1",
      [r.id, r.status, JSON.stringify(assignmentRequestPayload(r)), r.resolved_at, r.resolved_by],
    );
    await this.metadata(client, 'assignment_requests', r.id);
    await this.audit(client, 'assignment_requests', r.id, actor, action, {
      zone_id: r.zone_id,
      assignment_id: r.assignment_id,
      required_approvals: r.required_approvals,
    });
  }
  private async endEntry(
    client: PoolClient,
    entry: AssignmentHistory,
    actor: string,
    now: string,
    requestId: string | null,
  ) {
    if (
      !assignmentActive(entry.assignment, Date.parse(now)) ||
      Date.parse(now) <= Date.parse(entry.assignment.start_date)
    ) {
      throw new ConflictException('Chỉ kết thúc phân công đang có hiệu lực với khoảng thời gian dương');
    }
    await client.query('UPDATE public.users_zones SET end_date=$2 WHERE id=$1', [entry.assignment.id, now]);
    await this.metadata(client, 'users_zones', entry.assignment.id);
    await this.audit(client, 'users_zones', entry.assignment.id, actor, 'AssignmentEnded', {
      request_id: requestId,
      previous_end_date: entry.assignment.end_date,
      end_date: now,
    });
    return this.loadOnClient(client, entry.assignment.id);
  }
  private async available(
    client: PoolClient,
    zoneId: string,
    start: string,
    end: string | null,
    exceptId: string | null = null,
  ) {
    const accepted = await client.query(
      `SELECT 1 FROM public.users_zones WHERE zone_id=$1 AND tstzrange(start_date,end_date,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1`,
      [zoneId, start, end],
    );
    if (accepted.rowCount) {
      throw new ConflictException('Zone đã có phân công giao nhau trong khoảng thời gian này');
    }
    const pending = await client.query<AssignmentRequestRow>(
      `${SELECT_REQUEST} AND w.action='Assign' AND w.status='Pending' AND w.target_key=$1 AND ($4::uuid IS NULL OR w.id<>$4)
      AND tstzrange((w.payload->>'start_date')::timestamptz,(w.payload->>'end_date')::timestamptz,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)')`,
      [zoneId, start, end, exceptId],
    );
    for (const row of pending.rows) {
      mapAssignmentRequest(row);
    }
    if (pending.rowCount) {
      throw new ConflictException('Zone có lời mời Pending giao nhau; xử lý lời mời đó trước');
    }
  }
  private async request(client: PoolClient, id: string, lock = false): Promise<AssignmentRequest> {
    if (lock) {
      await client.query(
        "SELECT id FROM technical.workflow_requests WHERE module='assignments' AND id=$1 FOR UPDATE",
        [id],
      );
    }
    const rows = await client.query<AssignmentRequestRow>(`${SELECT_REQUEST} AND w.id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy lời mời phân công');
    }
    return mapAssignmentRequest(rows.rows[0]);
  }
  private async context(
    client: PoolClient,
    actor: string,
    target: { zoneId?: string; userId?: string; assignmentId?: string; requestId?: string },
  ): Promise<Context> {
    const hint = target.requestId ? await this.request(client, target.requestId) : null;
    const entryId = target.assignmentId ?? hint?.assignment_id;
    const entryHint = entryId ? await this.loadOnClient(client, entryId) : null;
    const zoneHint = (
      await this.zones.loadOnClient(client, target.zoneId ?? hint?.zone_id ?? entryHint!.assignment.zone_id)
    ).zone;
    const farmHint = await this.farms.loadOnClient(client, zoneHint.farm_id);
    const ids = [
      actor,
      farmHint.farm.owner_id,
      ...(hint ? [hint.owner_id, hint.proposed_by, hint.user_id] : []),
      ...(entryHint ? [entryHint.assignment.user_id] : []),
      ...(target.userId ? [target.userId] : []),
    ];
    const users = await this.lockUsers(client, ids),
      user = this.active(users, actor);
    // Shared order with Farm/Zone writers; never acquire user locks late.
    if (farmHint.farm.cooperative_id) {
      await client.query('SELECT id FROM public.cooperatives WHERE id=$1 FOR UPDATE', [
        farmHint.farm.cooperative_id,
      ]);
    }
    const farm = await this.farms.loadOnClient(client, farmHint.farm.id, true);
    if (
      farm.farm.owner_id !== farmHint.farm.owner_id ||
      farm.farm.cooperative_id !== farmHint.farm.cooperative_id
    ) {
      throw new RetryAssignmentContext();
    }
    const zone = (await this.zones.loadOnClient(client, zoneHint.id, true)).zone;
    if (zone.farm_id !== farm.farm.id) {
      throw new Error('Persisted assignment parent mismatch');
    }
    const entry = entryId ? await this.loadOnClient(client, entryId, true) : null;
    const request = target.requestId ? await this.request(client, target.requestId, true) : null;
    if (request && JSON.stringify(request) !== JSON.stringify(hint)) {
      throw new RetryAssignmentContext();
    }
    if (
      entry &&
      (entry.assignment.user_id !== entryHint!.assignment.user_id || entry.assignment.zone_id !== zone.id)
    ) {
      throw new Error('Persisted assignment identity mismatch');
    }
    if (request && (request.zone_id !== zone.id || (entry && request.user_id !== entry.assignment.user_id))) {
      throw new Error('Persisted assignment request mismatch');
    }
    return { actor: user, users, farm, zone, request, entry };
  }
  private manage(c: Context, actor: UserRecord) {
    if (actor.role !== 'Admin' && !(actor.role === 'Farmer' && actor.id === c.farm.farm.owner_id)) {
      throw new ForbiddenException('Chỉ chủ Farmer hoặc Admin được đề xuất phân công');
    }
    this.farmer(c.users, c.farm.farm.owner_id);
  }
  private pending(request: AssignmentRequest) {
    if (request.status !== 'Pending') {
      throw new ConflictException('Lời mời đã được xử lý');
    }
  }
  private date(value: string) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException('Ngày phân công không hợp lệ');
    }
    return new Date(parsed).toISOString();
  }
  private active(users: ReadonlyMap<string, UserRecord>, id: string) {
    const user = users.get(id);
    if (!user || user.status !== 'Active') {
      throw new ForbiddenException('Tài khoản phải Active');
    }
    return user;
  }
  private farmer(users: ReadonlyMap<string, UserRecord>, id: string) {
    const user = this.active(users, id);
    if (user.role !== 'Farmer') {
      throw new ForbiddenException('Phân công chỉ dành cho Farmer Active');
    }
    return user;
  }
  private async lockUsers(client: PoolClient, ids: string[]) {
    const keys = [...new Set(ids.map(farmUuid))].sort();
    await client.query('SELECT id FROM public.users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [keys]);
    await client.query(
      "SELECT entity_key FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=ANY($1::text[]) ORDER BY entity_key FOR UPDATE",
      [keys],
    );
    const users = new Map<string, UserRecord>();
    for (const id of keys) {
      const row = await this.users.loadOnClient(client, id);
      if (row) {
        users.set(id, row.user);
      }
    }
    return users;
  }
  private async readAs<T>(actor: string, work: (client: PoolClient, user: UserRecord) => Promise<T>) {
    actor = farmUuid(actor);
    return this.transaction(async (client) =>
      work(client, this.active(await this.lockUsers(client, [actor]), actor)),
    );
  }
  private async page<Row, T>(
    client: PoolClient,
    select: string,
    values: unknown[],
    q: { limit: number; offset: number },
    order: string,
    map: (row: Row) => T,
  ): Promise<FarmPage<T>> {
    const n = values.length,
      result = await client.query<{ total: string; items: Row[] }>(
        `WITH filtered AS (${select}),page AS (SELECT * FROM filtered ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2})
      SELECT (SELECT count(*) FROM filtered)::text AS total,COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY ${order}) FROM page p),'[]'::jsonb) AS items`,
        [...values, q.limit, q.offset],
      );
    return {
      items: result.rows[0].items.map(map),
      total: safeInteger(result.rows[0].total),
      limit: q.limit,
      offset: q.offset,
    };
  }
  private async metadata(client: PoolClient, type: string, id: string, data: object = {}) {
    const result = await client.query(
      `INSERT INTO technical.entity_metadata(entity_type,entity_key,data,version) VALUES ($1,$2,$3,1)
      ON CONFLICT(entity_type,entity_key) DO UPDATE SET version=technical.entity_metadata.version+1,data=technical.entity_metadata.data || EXCLUDED.data
      WHERE technical.entity_metadata.version BETWEEN 1 AND 9007199254740990 RETURNING version`,
      [type, id, JSON.stringify(data)],
    );
    if (!result.rowCount) {
      throw new Error('Invalid or exhausted assignment version');
    }
  }
  private async audit(
    client: PoolClient,
    type: string,
    id: string,
    actor: string,
    action: string,
    payload: object,
  ) {
    await client.query(
      'INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ($1,$2,$3,$4,$5,$6)',
      [type, id, actor, action, this.clock(), JSON.stringify(payload)],
    );
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await inPostgresTransaction(this.pool, work);
      } catch (error) {
        if (error instanceof RetryAssignmentContext) {
          continue;
        }
        if (error instanceof HttpException) {
          throw error;
        }
        const pg = error as { code?: string; constraint?: string };
        if (pg.code === '23P01') {
          throw new ConflictException('Zone đã có phân công giao nhau trong khoảng thời gian này');
        }
        if (pg.code === '23505' && pg.constraint === 'assignment_one_pending_end') {
          throw new ConflictException('Phân công đã có đề xuất kết thúc đang chờ');
        }
        throw new ServiceUnavailableException('Không thể truy cập dữ liệu phân công; vui lòng thử lại sau');
      }
    }
    throw new ConflictException('Dữ liệu phân công vừa thay đổi; hãy tải lại');
  }
}
