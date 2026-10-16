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
import { HarvestRecords } from '../tree-harvests/harvest-records';
import {
  HarvestBackdatePermission,
  HarvestDetails,
  HarvestRequest,
  TestTreeHarvest,
} from '../tree-harvests/tree-harvests.types';
import {
  CreateHarvestBackdateDto,
  CreateHarvestDto,
  HarvestCorrectionDto,
  HarvestListDto,
  HarvestRequestListDto,
  UpdateHarvestDto,
} from '../tree-harvests/tree-harvests.dto';
import { HARVEST_BACKDATE_DAYS, validateHarvestDate } from '../tree-harvests/harvest-date-policy';
import { FarmPage } from '../farms/farm-records';
import { FarmPageDto, RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { TestTree } from '../trees/trees.types';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresTreesRepository } from './postgres-trees.repository';
import { PostgresAssignmentsRepository } from './postgres-assignments.repository';
import { PostgresDomainAccess, RetryDomainContext, ZoneWriteContext } from './domain-access';
import { ZONE_READ_SCOPE } from './zone-read-scope';
import {
  HARVEST_FIELDS,
  HarvestRow,
  HarvestSnapshot,
  HarvestRequestRow,
  HarvestPermissionRow,
  harvestDetails,
  harvestRequestPayload,
  mapHarvest,
  mapHarvestRequest,
  mapHarvestPermission,
} from './harvest-mappers';
import { inPostgresTransaction, lockHarvestBatches } from './transactions';
import { safeInteger } from './mappers';

// DATE is projected as text explicitly: pg's date parser/host timezone must
// never move a Vietnamese business day to the previous UTC date.
const SELECT_HARVEST = `SELECT h.id,h.tree_id,h.created_by,h.season_name,h.harvest_date::text AS harvest_date,h.fruit_count,h.total_weight_kg,h.batch_code,h.status,h.updated_by,h.updated_at,h.created_at,m.version::text AS entity_version,m.data
 FROM public.tree_harvests h JOIN public.trees t ON t.id=h.tree_id JOIN public.zones z ON z.id=t.zone_id
 LEFT JOIN technical.entity_metadata m ON m.entity_type='tree_harvests' AND m.entity_key=h.id::text`;
const SELECT_REQUEST = `SELECT w.id,w.action,w.status,w.target_key,w.requested_by,w.expected_version::text,w.payload,w.created_at,w.resolved_at,w.resolved_by,m.version::text AS request_version
 FROM technical.workflow_requests w LEFT JOIN technical.entity_metadata m ON m.entity_type='harvest_requests' AND m.entity_key=w.id::text WHERE w.module='harvests'`;
const SELECT_PERMISSION = `SELECT w.id,w.action,w.status,w.target_key,w.requested_by,w.expected_version::text,w.payload,w.created_at,w.resolved_at,w.resolved_by,m.version::text AS request_version
 FROM technical.workflow_requests w LEFT JOIN technical.entity_metadata m ON m.entity_type='harvest_backdates' AND m.entity_key=w.id::text WHERE w.module='harvest_backdates'`;
const READ_SCOPE = `(${ZONE_READ_SCOPE} OR ($1='Farmer' AND h.created_by=$2::uuid))`;
// History remains readable after allowed Draft deletion: scope via snapshot's
// Tree → current Zone/Farm, never INNER JOIN only through live Harvest.
const REQUEST_SCOPE = `($1::text='Admin' OR w.requested_by::text=$2 OR w.payload->>'editor_id'=$2 OR ($1='Farmer' AND w.payload->'harvest_snapshot'->>'created_by'=$2)
 OR EXISTS(SELECT 1 FROM public.trees t JOIN public.zones z ON z.id=t.zone_id JOIN public.farms f ON f.id=z.farm_id WHERE t.id::text=w.payload->'harvest_snapshot'->>'tree_id'
 AND (f.owner_id=$2::uuid OR ($1='Manager' AND EXISTS(SELECT 1 FROM public.cooperatives c WHERE c.id=f.cooperative_id AND c.manager_id=$2::uuid)))))`;
interface Context extends ZoneWriteContext {
  tree: TestTree | null;
  harvest: HarvestSnapshot | null;
  request: ReturnType<typeof mapHarvestRequest> | null;
  permission: HarvestBackdatePermission | null;
}
interface Target {
  treeId?: string;
  harvestId?: string;
  requestId?: string;
  permissionId?: string;
  zoneId?: string;
  related?: string[];
  grantDate?: string;
}

export class PostgresHarvestsRepository extends HarvestRecords {
  private readonly access: PostgresDomainAccess;
  constructor(
    private readonly pool: Pool,
    users: PostgresUsersRepository,
    private readonly farms: PostgresFarmsRepository,
    private readonly zones: PostgresZonesRepository,
    private readonly trees: PostgresTreesRepository,
    private readonly assignments: PostgresAssignmentsRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {
    super();
    this.access = new PostgresDomainAccess(users, farms, zones);
  }
  async list(actor: string, input: HarvestListDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(HarvestListDto, input),
        scope = await this.access.scopeValues(client, user);
      return this.page(
        client,
        `${SELECT_HARVEST} WHERE ${READ_SCOPE} AND ($4::uuid IS NULL OR h.tree_id=$4) AND ($5::uuid IS NULL OR z.id=$5) AND ($6::text IS NULL OR h.status=$6)
   AND ($7::text IS NULL OR strpos(lower(h.batch_code),lower($7))>0 OR strpos(lower(h.season_name),lower($7))>0)`,
        [
          ...scope,
          q.tree_id ? farmUuid(q.tree_id) : null,
          q.zone_id ? farmUuid(q.zone_id) : null,
          q.status ?? null,
          q.q ?? null,
        ],
        q,
        'id',
        (row: HarvestRow) => mapHarvest(row).record,
      );
    });
  }
  async get(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const scope = await this.access.scopeValues(client, user),
        rows = await client.query<HarvestRow>(`${SELECT_HARVEST} WHERE ${READ_SCOPE} AND h.id=$4`, [
          ...scope,
          id,
        ]);
      if (!rows.rows[0]) {
        throw new NotFoundException('Không tìm thấy thu hoạch trong phạm vi truy cập');
      }
      return mapHarvest(rows.rows[0]).record;
    });
  }
  async create(actor: string, input: CreateHarvestDto) {
    actor = farmUuid(actor);
    const value = farmInput(CreateHarvestDto, input);
    value.tree_id = farmUuid(value.tree_id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { treeId: value.tree_id, grantDate: value.harvest_date });
      await this.writer(client, c, actor);
      const details = harvestDetails(value);
      await this.validate(client, c, actor, details, null, true, true);
      const rows = await client.query<{ id: string }>(
        `INSERT INTO public.tree_harvests(tree_id,created_by,season_name,harvest_date,fruit_count,total_weight_kg,batch_code,status,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'Draft',$8) RETURNING id`,
        [value.tree_id, actor, ...HARVEST_FIELDS.map((key) => details[key]), this.clock()],
      );
      const id = rows.rows[0].id;
      await this.metadata(client, 'tree_harvests', id, { ever_confirmed: false });
      const after = (await this.loadOnClient(client, id)).record;
      await this.audit(client, 'tree_harvests', id, actor, 'HarvestCreated', { after });
      return after;
    });
  }
  async updateDraft(actor: string, id: string, input: UpdateHarvestDto) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    const value = farmInput(UpdateHarvestDto, input);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { harvestId: id, grantDate: value.harvest_date });
      await this.draftEditor(client, c, actor);
      const record = c.harvest!.record;
      if (record.status !== 'Draft') {
        throw new ConflictException('Chỉ sửa trực tiếp bản nháp Draft');
      }
      const changes = this.changes(record, value),
        next = { ...record, ...changes };
      await this.validate(client, c, actor, next, id, changes.harvest_date !== undefined, true);
      return this.save(client, c.harvest!, next, actor, 'HarvestDraftUpdated');
    });
  }
  async removeDraft(actor: string, id: string) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { harvestId: id });
      await this.draftEditor(client, c, actor);
      const current = c.harvest!;
      if (current.record.status !== 'Draft' || current.everConfirmed) {
        throw new ConflictException('Không xóa Pending hoặc bản ghi đã từng Confirmed');
      }
      await lockHarvestBatches(client, [current.record.batch_code]);
      await client.query('DELETE FROM public.tree_harvests WHERE id=$1', [id]);
      await client.query(
        "DELETE FROM technical.entity_metadata WHERE entity_type='tree_harvests' AND entity_key=$1",
        [id],
      );
      await this.audit(client, 'tree_harvests', id, actor, 'HarvestDraftDeleted', { before: current.record });
      return { deleted: true, id };
    });
  }
  async submit(actor: string, id: string) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { harvestId: id });
      await this.writer(client, c, actor);
      const record = c.harvest!.record;
      if (record.created_by !== actor) {
        throw new ForbiddenException('Chỉ người tạo gửi bản nháp lên xác nhận');
      }
      if (record.status !== 'Draft') {
        throw new ConflictException('Chỉ gửi bản nháp Draft');
      }
      await this.validate(client, c, actor, record, id, false, false);
      if (actor === c.farm.farm.owner_id) {
        return this.save(
          client,
          c.harvest!,
          { ...record, status: 'Confirmed' },
          actor,
          'HarvestConfirmed',
          true,
        );
      }
      await this.addRequest(client, c, 'Confirm', actor, null, null, null);
      return (await this.loadOnClient(client, id)).record;
    });
  }
  async correction(actor: string, id: string, input: HarvestCorrectionDto) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    const value = farmInput(HarvestCorrectionDto, input);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { harvestId: id, grantDate: value.changes?.harvest_date }),
        record = c.harvest!.record;
      if (c.actor.role !== 'Farmer' || (actor !== record.created_by && actor !== c.farm.farm.owner_id)) {
        throw new ForbiddenException('Chỉ tác giả hoặc chủ Farm yêu cầu sửa');
      }
      if (record.status !== 'Confirmed') {
        throw new ConflictException('Chỉ yêu cầu sửa bản ghi Confirmed');
      }
      this.owner(c);
      const canEdit =
        actor === c.farm.farm.owner_id ||
        Boolean(await this.assignments.activeOnClient(client, actor, c.zone.id));
      if (!canEdit && value.changes !== undefined) {
        throw new ForbiddenException('Tác giả hết phân công chỉ gửi lý do; chủ Farm chuẩn bị nội dung sửa');
      }
      let changes: Partial<HarvestDetails> | null = null;
      if (value.changes !== undefined) {
        changes = this.changes(record, value.changes);
        const changed = changes.harvest_date !== undefined;
        await this.validate(client, c, actor, { ...record, ...changes }, id, changed, changed);
      }
      return this.addRequest(client, c, 'Correct', actor, changes ? actor : null, changes, value.reason);
    });
  }
  async prepareCorrection(actor: string, id: string, input: UpdateHarvestDto) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    const value = farmInput(UpdateHarvestDto, input);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { requestId: id, grantDate: value.harvest_date }),
        r = structuredClone(c.request!.value),
        record = c.harvest!.record;
      if (r.action !== 'Correct') {
        throw new ConflictException('Không bổ sung nội dung cho yêu cầu xác nhận lần đầu');
      }
      this.requestContext(c);
      await this.writer(client, c, actor);
      if (actor !== c.farm.farm.owner_id && actor !== r.requested_by) {
        throw new ForbiddenException('Chỉ người yêu cầu hoặc chủ Farm chuẩn bị nội dung sửa');
      }
      const changes = this.changes(record, value),
        changed = changes.harvest_date !== undefined;
      await this.validate(client, c, actor, { ...record, ...changes }, record.id, changed, changed);
      r.editor_id = actor;
      r.proposed_changes = changes;
      await this.saveRequest(client, r, actor, 'HarvestCorrectionPrepared');
      return r;
    });
  }
  async approve(actor: string, id: string) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { requestId: id }),
        r = structuredClone(c.request!.value),
        record = c.harvest!.record;
      await this.reviewer(client, c, r);
      this.requestContext(c);
      this.access.active(c.users, r.requested_by);
      this.owner(c);
      let next: TestTreeHarvest;
      if (r.action === 'Confirm') {
        await this.writer(client, c, record.created_by);
        next = { ...record, status: 'Confirmed' };
        await lockHarvestBatches(client, [record.batch_code]);
      } else {
        if (!r.editor_id || !r.proposed_changes) {
          throw new ConflictException('Chủ/người yêu cầu cần bổ sung nội dung sửa trước khi duyệt');
        }
        await this.writer(client, c, r.editor_id);
        const details = { ...record, ...r.proposed_changes };
        const changed =
          r.proposed_changes.harvest_date !== undefined &&
          r.proposed_changes.harvest_date !== record.harvest_date;
        // User rule: keep stored day editable; a changed day must recheck current
        // Tree status at final approval, not only when the proposal was entered.
        await this.validate(client, c, r.editor_id, details, record.id, changed, changed);
        next = {
          ...details,
          status: 'Confirmed',
          updated_by: r.editor_id,
          updated_at: this.clock().toISOString(),
        };
      }
      await this.save(
        client,
        c.harvest!,
        next,
        actor,
        r.action === 'Confirm' ? 'HarvestConfirmed' : 'HarvestCorrectionApplied',
        true,
      );
      r.status = 'Accepted';
      r.resolved_at = this.clock().toISOString();
      r.resolved_by = actor;
      await this.saveRequest(client, r, actor, 'HarvestRequestAccepted');
      return r;
    });
  }
  async reject(actor: string, id: string, reason?: string) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    reason = farmInput(RejectFarmRequestDto, { reason }).reason;
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { requestId: id }),
        r = structuredClone(c.request!.value),
        record = c.harvest!.record;
      if (actor !== r.requested_by && actor !== c.farm.farm.owner_id) {
        await this.reviewer(client, c, r);
      }
      if (record.status !== 'Pending') {
        throw new ConflictException('Bản ghi đã thay đổi; cần yêu cầu mới');
      }
      await lockHarvestBatches(client, [record.batch_code]);
      await this.save(
        client,
        c.harvest!,
        { ...record, status: r.action === 'Confirm' ? 'Draft' : 'Confirmed' },
        actor,
        'HarvestRequestWithdrawn',
      );
      r.status = 'Rejected';
      r.resolved_by = actor;
      r.resolved_at = this.clock().toISOString();
      r.rejection_reason = reason ?? null;
      await this.saveRequest(client, r, actor, 'HarvestRequestRejected');
      return r;
    });
  }
  async listRequests(actor: string, input: HarvestRequestListDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(HarvestRequestListDto, input);
      return this.page(
        client,
        `${SELECT_REQUEST} AND ${REQUEST_SCOPE} AND ($3::text IS NULL OR w.status=$3) AND ($4::uuid IS NULL OR w.target_key=$4::text)`,
        [user.role, user.id, q.status ?? null, q.harvest_id ? farmUuid(q.harvest_id) : null],
        q,
        'created_at,id',
        (row: HarvestRequestRow) => mapHarvestRequest(row).value,
      );
    });
  }
  async getRequest(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const rows = await client.query<HarvestRequestRow>(
        `${SELECT_REQUEST} AND ${REQUEST_SCOPE} AND w.id=$3`,
        [user.role, user.id, id],
      );
      if (!rows.rows[0]) {
        throw new NotFoundException('Không tìm thấy yêu cầu thu hoạch');
      }
      return mapHarvestRequest(rows.rows[0]).value;
    });
  }
  async grantBackdate(actor: string, input: CreateHarvestBackdateDto) {
    actor = farmUuid(actor);
    const value = farmInput(CreateHarvestBackdateDto, input);
    value.user_id = farmUuid(value.user_id);
    value.zone_id = farmUuid(value.zone_id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { zoneId: value.zone_id, related: [value.user_id] });
      this.admin(c.actor);
      await this.writer(client, c, value.user_id);
      validateHarvestDate(value.harvest_date, this.clock().getTime());
      const expires = new Date(value.expires_at);
      if (!Number.isFinite(expires.getTime()) || expires.getTime() <= this.clock().getTime()) {
        throw new BadRequestException('expires_at phải ở tương lai');
      }
      const payload = {
        user_id: value.user_id,
        harvest_date: value.harvest_date,
        expires_at: expires.toISOString(),
        reason: value.reason,
        revoked_at: null,
      };
      const row = await client.query<{ id: string }>(
        `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at) VALUES ('harvest_backdates','Grant','Active',$1,$2,$3,$4) RETURNING id`,
        [c.zone.id, actor, JSON.stringify(payload), this.clock()],
      );
      const id = row.rows[0].id;
      await this.metadata(client, 'harvest_backdates', id);
      await this.audit(client, 'harvest_backdates', id, actor, 'HarvestBackdateGranted', {
        zone_id: c.zone.id,
        user_id: value.user_id,
        harvest_date: value.harvest_date,
      });
      return this.permission(client, id);
    });
  }
  async listBackdates(actor: string, input: FarmPageDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(FarmPageDto, input);
      return this.page(
        client,
        `${SELECT_PERMISSION} AND ($1::text='Admin' OR w.payload->>'user_id'=$2 OR EXISTS(SELECT 1 FROM public.zones z JOIN public.farms f ON f.id=z.farm_id WHERE z.id::text=w.target_key AND f.owner_id=$2::uuid))`,
        [user.role, user.id],
        q,
        'created_at,id',
        mapHarvestPermission,
      );
    });
  }
  async revokeBackdate(actor: string, id: string) {
    actor = farmUuid(actor);
    id = farmUuid(id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { permissionId: id });
      this.admin(c.actor);
      const p = c.permission!;
      if (p.revoked_at !== null) {
        throw new ConflictException('Quyền đã bị thu hồi');
      }
      const revoked = this.clock().toISOString(),
        payload = {
          user_id: p.user_id,
          harvest_date: p.harvest_date,
          expires_at: p.expires_at,
          reason: p.reason,
          revoked_at: revoked,
        };
      await client.query(
        "UPDATE technical.workflow_requests SET status='Revoked',payload=$2,resolved_at=$3,resolved_by=$4 WHERE module='harvest_backdates' AND id=$1",
        [id, JSON.stringify(payload), revoked, actor],
      );
      await this.metadata(client, 'harvest_backdates', id);
      await this.audit(client, 'harvest_backdates', id, actor, 'HarvestBackdateRevoked', {
        zone_id: p.zone_id,
        user_id: p.user_id,
      });
      return this.permission(client, id);
    });
  }
  async confirmedForTrace(treeId: string) {
    treeId = farmUuid(treeId);
    return this.transaction(async (client) => {
      await this.trees.loadOnClient(client, treeId);
      const rows = await client.query<HarvestRow>(
        `${SELECT_HARVEST} WHERE h.tree_id=$1 AND m.data->>'ever_confirmed'='true' ORDER BY h.created_at,h.id`,
        [treeId],
      );
      return rows.rows.map((row) => harvestDetails(mapHarvest(row).record));
    });
  }
  async loadOnClient(client: PoolClient, id: string, lock = false): Promise<HarvestSnapshot> {
    id = farmUuid(id);
    if (lock) {
      await client.query('SELECT id FROM public.tree_harvests WHERE id=$1 FOR UPDATE', [id]);
    }
    const rows = await client.query<HarvestRow>(`${SELECT_HARVEST} WHERE h.id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy bản ghi thu hoạch');
    }
    return mapHarvest(rows.rows[0]);
  }
  private async validate(
    client: PoolClient,
    c: Context,
    actor: string,
    next: HarvestDetails,
    id: string | null,
    checkBackdate: boolean,
    checkTree: boolean,
  ): Promise<void> {
    const days = validateHarvestDate(next.harvest_date, this.clock().getTime());
    if (checkTree && c.tree!.status !== 'Active' && days === 0) {
      throw new BadRequestException('Cây Dead/Removed chỉ được nhập bù ngày cũ');
    }
    if (
      checkBackdate &&
      days > HARVEST_BACKDATE_DAYS &&
      !(await this.hasBackdate(client, c, actor, next.harvest_date))
    ) {
      throw new ForbiddenException('Nhập bù quá 7 ngày cần quyền Admin đúng người/Zone/ngày còn hạn');
    }
    await lockHarvestBatches(client, [next.batch_code, ...(c.harvest ? [c.harvest.record.batch_code] : [])]);
    const same = await client.query(
      'SELECT 1 FROM public.tree_harvests WHERE tree_id=$1 AND harvest_date=$2 AND ($3::uuid IS NULL OR id<>$3) LIMIT 1',
      [c.tree!.id, next.harvest_date, id],
    );
    if (same.rowCount) {
      throw new ConflictException('Cây đã có thu hoạch trong ngày này; sửa cộng dồn bản nháp');
    }
    const batch = await client.query(
      `SELECT 1 FROM public.tree_harvests h JOIN public.trees t ON t.id=h.tree_id WHERE h.batch_code=$1 AND ($4::uuid IS NULL OR h.id<>$4) AND (h.harvest_date<>$2::date OR t.zone_id<>$3) LIMIT 1`,
      [next.batch_code, next.harvest_date, c.zone.id, id],
    );
    if (batch.rowCount) {
      throw new ConflictException('Mã batch chỉ dùng trong một Zone và một ngày thu hoạch');
    }
  }
  private async hasBackdate(client: PoolClient, c: Context, user: string, date: string): Promise<boolean> {
    const rows = await client.query<HarvestPermissionRow>(
      `${SELECT_PERMISSION} AND w.status='Active' AND w.target_key=$1 AND w.payload->>'user_id'=$2 AND w.payload->>'harvest_date'=$3`,
      [c.zone.id, user, date],
    );
    for (const row of rows.rows) {
      const p = mapHarvestPermission(row);
      if (p.revoked_at !== null || Date.parse(p.expires_at) <= this.clock().getTime()) {
        continue;
      }
      // Grant may have appeared while waiting for the parent. Restart the whole
      // context before writes rather than acquiring its Admin lock out of order.
      if (!c.users.has(p.granted_by)) {
        throw new RetryDomainContext();
      }
      const grantor = c.users.get(p.granted_by)!;
      if (grantor.status === 'Active' && grantor.role === 'Admin') {
        return true;
      }
    }
    return false;
  }
  private async writer(client: PoolClient, c: Context, id: string): Promise<void> {
    const user = this.access.active(c.users, id);
    this.owner(c);
    if (
      user.role !== 'Farmer' ||
      (id !== c.farm.farm.owner_id && !(await this.assignments.activeOnClient(client, id, c.zone.id)))
    ) {
      throw new ForbiddenException('Chỉ chủ Farm hoặc Farmer đang phụ trách Zone được ghi thu hoạch');
    }
  }
  private owner(c: Context) {
    if (this.access.active(c.users, c.farm.farm.owner_id).role !== 'Farmer') {
      throw new ConflictException('Chủ Farm phải là Farmer Active');
    }
  }
  private admin(user: UserRecord) {
    if (user.role !== 'Admin') {
      throw new ForbiddenException('Chỉ Admin cấp/thu hồi quyền nhập bù');
    }
  }
  private async draftEditor(client: PoolClient, c: Context, actor: string) {
    await this.writer(client, c, actor);
    if (actor !== c.farm.farm.owner_id && actor !== c.harvest!.record.created_by) {
      throw new ForbiddenException('Chỉ tác giả hoặc chủ Farm sửa/xóa nháp');
    }
  }
  private async reviewer(client: PoolClient, c: Context, r: HarvestRequest) {
    if (r.action === 'Confirm') {
      if (c.actor.role !== 'Farmer' || c.actor.id !== c.farm.farm.owner_id) {
        throw new ForbiddenException('Chỉ chủ Farm xác nhận lần đầu');
      }
    } else if (c.farm.farm.cooperative_id) {
      const coop = await client.query<{ manager_id: string | null }>(
        'SELECT manager_id FROM public.cooperatives WHERE id=$1',
        [c.farm.farm.cooperative_id],
      );
      if (c.actor.role !== 'Manager' || coop.rows[0]?.manager_id !== c.actor.id) {
        throw new ForbiddenException('Chỉ Manager HTX hiện tại duyệt sửa');
      }
    } else if (c.actor.role !== 'Admin') {
      throw new ForbiddenException('Farm độc lập cần Admin duyệt sửa');
    }
  }
  private requestContext(c: Context) {
    const r = c.request!;
    if (
      r.value.owner_id !== c.farm.farm.owner_id ||
      (r.value.action === 'Correct' && r.value.cooperative_id !== c.farm.farm.cooperative_id)
    ) {
      throw new ConflictException('Chủ/HTX đã thay đổi; rút yêu cầu và gửi lại');
    }
    if (c.harvest!.version !== r.version || c.harvest!.record.status !== 'Pending') {
      throw new ConflictException('Bản ghi đã thay đổi; cần yêu cầu mới');
    }
  }
  private changes(record: TestTreeHarvest, input: UpdateHarvestDto): Partial<HarvestDetails> {
    const changes = Object.fromEntries(
      HARVEST_FIELDS.filter((key) => input[key] !== undefined && input[key] !== record[key]).map((key) => [
        key,
        input[key],
      ]),
    );
    if (!Object.keys(changes).length) {
      throw new BadRequestException('Cần ít nhất một thay đổi thực sự');
    }
    return changes;
  }
  private async save(
    client: PoolClient,
    current: HarvestSnapshot,
    next: TestTreeHarvest,
    actor: string,
    action: string,
    confirmed = false,
  ): Promise<TestTreeHarvest> {
    await client.query(
      'UPDATE public.tree_harvests SET season_name=$2,harvest_date=$3,fruit_count=$4,total_weight_kg=$5,batch_code=$6,status=$7,updated_by=$8,updated_at=$9 WHERE id=$1',
      [next.id, ...HARVEST_FIELDS.map((key) => next[key]), next.status, next.updated_by, next.updated_at],
    );
    await this.metadata(client, 'tree_harvests', next.id, {
      ever_confirmed: current.everConfirmed || confirmed,
    });
    await this.audit(client, 'tree_harvests', next.id, actor, action, {
      before: current.record,
      after: next,
    });
    return (await this.loadOnClient(client, next.id)).record;
  }
  private async addRequest(
    client: PoolClient,
    c: Context,
    action: HarvestRequest['action'],
    actor: string,
    editor: string | null,
    changes: Partial<HarvestDetails> | null,
    reason: string | null,
  ): Promise<HarvestRequest> {
    const record = c.harvest!.record;
    if (
      (
        await client.query(
          "SELECT 1 FROM technical.workflow_requests WHERE module='harvests' AND status='Pending' AND target_key=$1",
          [record.id],
        )
      ).rowCount
    ) {
      throw new ConflictException('Bản ghi đã có yêu cầu Pending');
    }
    await lockHarvestBatches(client, [record.batch_code]);
    await this.save(client, c.harvest!, { ...record, status: 'Pending' }, actor, 'HarvestRequestOpened');
    const expected = (await this.loadOnClient(client, record.id)).version;
    const payload = {
      editor_id: editor,
      owner_id: c.farm.farm.owner_id,
      cooperative_id: c.farm.farm.cooperative_id,
      reason,
      proposed_changes: changes,
      harvest_snapshot: record,
      rejection_reason: null,
    };
    const row = await client.query<{ id: string }>(
      `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,expected_version,payload,created_at) VALUES ('harvests',$1,'Pending',$2,$3,$4,$5,$6) RETURNING id`,
      [action, record.id, actor, expected, JSON.stringify(payload), this.clock()],
    );
    const id = row.rows[0].id;
    await this.metadata(client, 'harvest_requests', id);
    await this.audit(client, 'harvest_requests', id, actor, 'HarvestRequestCreated', {
      action,
      harvest_id: record.id,
    });
    return (await this.request(client, id)).value;
  }
  private async saveRequest(client: PoolClient, r: HarvestRequest, actor: string, action: string) {
    await client.query(
      "UPDATE technical.workflow_requests SET status=$2,payload=$3,resolved_at=$4,resolved_by=$5 WHERE module='harvests' AND id=$1",
      [r.id, r.status, JSON.stringify(harvestRequestPayload(r)), r.resolved_at, r.resolved_by],
    );
    await this.metadata(client, 'harvest_requests', r.id);
    await this.audit(client, 'harvest_requests', r.id, actor, action, {
      harvest_id: r.harvest_id,
      editor_id: r.editor_id,
    });
  }
  private async request(client: PoolClient, id: string, lock = false) {
    if (lock) {
      await client.query(
        "SELECT id FROM technical.workflow_requests WHERE module='harvests' AND id=$1 FOR UPDATE",
        [id],
      );
    }
    const rows = await client.query<HarvestRequestRow>(`${SELECT_REQUEST} AND w.id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy yêu cầu thu hoạch');
    }
    return mapHarvestRequest(rows.rows[0]);
  }
  private async permission(client: PoolClient, id: string, lock = false): Promise<HarvestBackdatePermission> {
    if (lock) {
      await client.query(
        "SELECT id FROM technical.workflow_requests WHERE module='harvest_backdates' AND id=$1 FOR UPDATE",
        [id],
      );
    }
    const rows = await client.query<HarvestPermissionRow>(`${SELECT_PERMISSION} AND w.id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy quyền nhập bù');
    }
    return mapHarvestPermission(rows.rows[0]);
  }
  private async context(client: PoolClient, actor: string, target: Target): Promise<Context> {
    const requestHint = target.requestId ? await this.request(client, target.requestId) : null;
    // A terminal Confirm request can outlive its deleted Draft. It stays readable
    // through its snapshot, and actions must return409 before loading that Draft.
    if (requestHint && requestHint.value.status !== 'Pending') {
      throw new ConflictException('Yêu cầu đã được xử lý');
    }
    const permissionHint = target.permissionId ? await this.permission(client, target.permissionId) : null;
    const harvestId = target.harvestId ?? requestHint?.value.harvest_id,
      harvestHint = harvestId ? await this.loadOnClient(client, harvestId) : null;
    const treeId = target.treeId ?? harvestHint?.record.tree_id,
      treeHint = treeId ? (await this.trees.loadOnClient(client, treeId)).tree : null;
    const zoneId = target.zoneId ?? permissionHint?.zone_id ?? treeHint!.zone_id;
    const date = target.grantDate ?? requestHint?.value.proposed_changes?.harvest_date;
    const grantors = date
      ? (
          await client.query<{ requested_by: string }>(
            "SELECT DISTINCT requested_by FROM technical.workflow_requests WHERE module='harvest_backdates' AND status='Active' AND target_key=$1 AND payload->>'harvest_date'=$2",
            [zoneId, date],
          )
        ).rows.map((row) => row.requested_by)
      : [];
    const related = [
      ...(target.related ?? []),
      ...(harvestHint ? [harvestHint.record.created_by] : []),
      ...(requestHint
        ? [
            requestHint.value.owner_id,
            requestHint.value.requested_by,
            ...(requestHint.value.editor_id ? [requestHint.value.editor_id] : []),
          ]
        : []),
      ...(permissionHint ? [permissionHint.user_id, permissionHint.granted_by] : []),
      ...grantors,
    ];
    const c = await this.access.lockZone(client, actor, zoneId, related);
    const tree = treeId ? (await this.trees.loadOnClient(client, treeId, true)).tree : null;
    if (tree && tree.zone_id !== c.zone.id) {
      throw new Error('Persisted Harvest Tree parent mismatch');
    }
    const harvest = harvestId ? await this.loadOnClient(client, harvestId, true) : null;
    if (harvest && harvest.record.tree_id !== tree?.id) {
      throw new Error('Persisted Harvest identity mismatch');
    }
    const request = target.requestId ? await this.request(client, target.requestId, true) : null,
      permission = target.permissionId ? await this.permission(client, target.permissionId, true) : null;
    if (request && JSON.stringify(request) !== JSON.stringify(requestHint)) {
      throw new RetryDomainContext();
    }
    if (permission && JSON.stringify(permission) !== JSON.stringify(permissionHint)) {
      throw new RetryDomainContext();
    }
    return { ...c, tree, harvest, request, permission };
  }
  private async readAs<T>(
    actor: string,
    work: (client: PoolClient, user: UserRecord) => Promise<T>,
  ): Promise<T> {
    actor = farmUuid(actor);
    return this.transaction(async (client) => work(client, await this.access.actorOnClient(client, actor)));
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
      rows = await client.query<{ total: string; items: Row[] }>(
        `WITH filtered AS (${select}),page AS (SELECT * FROM filtered ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2}) SELECT (SELECT count(*) FROM filtered)::text AS total,COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY ${order}) FROM page p),'[]'::jsonb) AS items`,
        [...values, q.limit, q.offset],
      );
    return {
      items: rows.rows[0].items.map(map),
      total: safeInteger(rows.rows[0].total),
      limit: q.limit,
      offset: q.offset,
    };
  }
  private async metadata(client: PoolClient, type: string, id: string, data: object = {}): Promise<void> {
    const rows = await client.query(
      `INSERT INTO technical.entity_metadata(entity_type,entity_key,version,data) VALUES ($1,$2,1,$3) ON CONFLICT(entity_type,entity_key) DO UPDATE SET version=technical.entity_metadata.version+1,data=technical.entity_metadata.data || EXCLUDED.data WHERE technical.entity_metadata.version BETWEEN 1 AND 9007199254740990 RETURNING version`,
      [type, id, JSON.stringify(data)],
    );
    if (!rows.rowCount) {
      throw new Error('Invalid or exhausted Harvest version');
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
        if (error instanceof RetryDomainContext) {
          continue;
        }
        if (error instanceof HttpException) {
          throw error;
        }
        const pg = error as { code?: string; constraint?: string };
        if (pg.code === '23505' && pg.constraint === 'harvest_one_pending_request') {
          throw new ConflictException('Bản ghi đã có yêu cầu Pending');
        }
        if (pg.code === '23505' && pg.constraint === 'tree_harvests_tree_id_harvest_date_key') {
          throw new ConflictException('Cây đã có thu hoạch trong ngày này; sửa cộng dồn bản nháp');
        }
        throw new ServiceUnavailableException('Không thể truy cập dữ liệu thu hoạch; vui lòng thử lại sau');
      }
    }
    throw new ConflictException('Dữ liệu thu hoạch vừa thay đổi; hãy tải lại');
  }
}
