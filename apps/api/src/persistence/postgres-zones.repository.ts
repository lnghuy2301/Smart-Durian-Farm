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
import { FarmPage } from '../farms/farm-records';
import { FarmRequestListDto, RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { ZoneRecords } from '../zones/zone-records';
import { CreateZoneDto, UpdateZoneDto, ZoneDetailsDto, ZoneListDto } from '../zones/zones.dto';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresCatalogRepository } from './postgres-catalog.repository';
import { FarmSnapshot } from './farm-mappers';
import { inPostgresTransaction } from './transactions';
import { decimalNumber, safeInteger } from './mappers';
import {
  ZoneRow,
  ZoneSnapshot,
  ZoneRequestRow,
  StoredZoneRequest,
  ZONE_FIELDS,
  mapZone,
  mapZoneRequest,
  zoneRequestPayload,
} from './zone-mappers';
import { AssignmentRow, mapAssignment } from './assignment-mappers';
import { ZONE_READ_SCOPE as SCOPE } from './zone-read-scope';

const SELECT_ZONE = `SELECT z.id,z.farm_id,z.standard_id,z.zone_name,z.area_size,z.longitude,z.latitude,m.version::text AS entity_version
  FROM public.zones z LEFT JOIN technical.entity_metadata m ON m.entity_type='zones' AND m.entity_key=z.id::text`;
const SELECT_REQUEST = `SELECT id,action,status,target_key,requested_by,expected_version::text,payload,created_at,resolved_at,resolved_by
  FROM technical.workflow_requests WHERE module='zones'`;
interface Context {
  actor: UserRecord;
  users: Map<string, UserRecord>;
  farm: FarmSnapshot;
  zone: ZoneSnapshot | null;
  request: StoredZoneRequest | null;
}
class RetryZoneContext extends Error {}

export class PostgresZonesRepository extends ZoneRecords {
  constructor(
    private readonly pool: Pool,
    private readonly users: PostgresUsersRepository,
    private readonly farms: PostgresFarmsRepository,
    private readonly catalogs: PostgresCatalogRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {
    super();
  }
  async list(actor: string, input: ZoneListDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(ZoneListDto, input),
        assigned = await this.acceptedZoneIdsOnClient(client, user);
      return this.page(
        client,
        `${SELECT_ZONE} WHERE ${SCOPE} AND ($4::uuid IS NULL OR z.farm_id=$4)
        AND ($5::text IS NULL OR strpos(lower(z.zone_name),lower($5))>0)`,
        [user.role, user.id, assigned, q.farm_id ? farmUuid(q.farm_id) : null, q.q ?? null],
        q,
        'id',
        (row: ZoneRow) => mapZone(row).zone,
      );
    });
  }
  async get(actor: string, id: string) {
    return this.readAs(actor, async (client, user) => {
      const rows = await client.query<ZoneRow>(`${SELECT_ZONE} WHERE ${SCOPE} AND z.id=$4`, [
        user.role,
        user.id,
        await this.acceptedZoneIdsOnClient(client, user),
        farmUuid(id),
      ]);
      if (!rows.rows[0]) {
        throw new NotFoundException('Không tìm thấy Zone trong phạm vi truy cập');
      }
      return mapZone(rows.rows[0]).zone;
    });
  }
  async create(actor: string, input: CreateZoneDto) {
    return this.write(actor, input);
  }
  async update(actor: string, id: string, input: UpdateZoneDto) {
    return this.write(actor, input, farmUuid(id));
  }
  async createRequest(actor: string, input: CreateZoneDto) {
    return this.propose(actor, input);
  }
  async updateRequest(actor: string, id: string, input: UpdateZoneDto) {
    return this.propose(actor, input, farmUuid(id));
  }
  async listRequests(actor: string, input: FarmRequestListDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(FarmRequestListDto, input);
      return this.page(
        client,
        `${SELECT_REQUEST} AND ($1::text='Admin' OR payload->>'owner_id'=$2) AND ($3::text IS NULL OR status=$3)`,
        [user.role, user.id, q.status ?? null],
        q,
        'created_at,id',
        (row: ZoneRequestRow) => mapZoneRequest(row).value,
      );
    });
  }
  async getRequest(actor: string, id: string) {
    return this.readAs(actor, async (client, user) => {
      const row = await this.request(client, farmUuid(id));
      if (user.role !== 'Admin' && user.id !== row.value.owner_id) {
        throw new NotFoundException('Không tìm thấy đề xuất Zone');
      }
      return row.value;
    });
  }
  async approve(actor: string, id: string) {
    return this.decide(actor, farmUuid(id));
  }
  async reject(actor: string, id: string, reason?: string) {
    return this.decide(actor, farmUuid(id), { reason: farmInput(RejectFarmRequestDto, { reason }).reason });
  }

  // Future domain adapter must already hold parent Farm lock before lock=true.
  async loadOnClient(client: PoolClient, id: string, lock = false): Promise<ZoneSnapshot> {
    id = farmUuid(id);
    if (lock) {
      await client.query('SELECT id FROM public.zones WHERE id=$1 FOR UPDATE', [id]);
    }
    const rows = await client.query<ZoneRow>(`${SELECT_ZONE} WHERE z.id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy Zone');
    }
    return mapZone(rows.rows[0]);
  }
  private input<T extends ZoneDetailsDto | UpdateZoneDto>(type: new () => T, input: T): T {
    const value = farmInput(type, input);
    if (value.standard_id) {
      value.standard_id = farmUuid(value.standard_id);
    }
    return value;
  }
  private async write(actor: string, input: CreateZoneDto | UpdateZoneDto, id?: string) {
    const value = id ? this.input(UpdateZoneDto, input) : this.input(CreateZoneDto, input as CreateZoneDto);
    actor = farmUuid(actor);
    return this.transaction(async (client) => {
      const c = await this.context(
        client,
        actor,
        id ? undefined : farmUuid((value as CreateZoneDto).farm_id),
        id,
      );
      this.writable(c, 'Farmer');
      const changes = this.changes(value);
      if (c.zone) {
        this.requireChanges(c.zone, changes);
      }
      const next = { ...c.zone?.zone, ...changes } as ZoneDetailsDto;
      await this.validate(client, c.farm, next, c.zone);
      return this.save(client, c, next, actor);
    });
  }
  private async propose(actor: string, input: CreateZoneDto | UpdateZoneDto, id?: string) {
    const value = id ? this.input(UpdateZoneDto, input) : this.input(CreateZoneDto, input as CreateZoneDto);
    actor = farmUuid(actor);
    return this.transaction(async (client) => {
      const c = await this.context(
        client,
        actor,
        id ? undefined : farmUuid((value as CreateZoneDto).farm_id),
        id,
      );
      this.writable(c, 'Admin');
      const changes = this.changes(value);
      if (c.zone) {
        this.requireChanges(c.zone, changes);
      }
      await this.validate(client, c.farm, { ...c.zone?.zone, ...changes } as ZoneDetailsDto, c.zone);
      if (
        c.zone &&
        (
          await client.query(
            "SELECT 1 FROM technical.workflow_requests WHERE module='zones' AND status='Pending' AND target_key=$1",
            [c.zone.zone.id],
          )
        ).rowCount
      ) {
        throw new ConflictException('Zone đã có đề xuất Admin đang chờ');
      }
      const payload = {
        farm_id: c.farm.farm.id,
        owner_id: c.farm.farm.owner_id,
        proposed_changes: changes,
        zone_snapshot: c.zone?.zone ?? null,
        rejection_reason: null,
      };
      const result = await client.query<ZoneRequestRow>(
        `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,expected_version,payload,created_at)
        VALUES ('zones',$1,'Pending',$2,$3,$4,$5,$6) RETURNING id,action,status,target_key,requested_by,expected_version::text,payload,created_at,resolved_at,resolved_by`,
        [
          c.zone ? 'Update' : 'Create',
          c.zone?.zone.id ?? null,
          actor,
          c.zone?.version ?? null,
          JSON.stringify(payload),
          this.clock(),
        ],
      );
      const request = mapZoneRequest(result.rows[0]).value;
      await this.metadata(client, 'zone_requests', request.id);
      await this.audit(client, 'zone_requests', request.id, actor, 'ZoneRequestCreated', {
        action: request.action,
        farm_id: request.farm_id,
        zone_id: request.zone_id,
      });
      return request;
    });
  }
  private async decide(actor: string, id: string, rejection?: { reason?: string }) {
    actor = farmUuid(actor);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, undefined, undefined, id),
        r = structuredClone(c.request!.value);
      if (r.status !== 'Pending') {
        throw new ConflictException('Đề xuất Zone đã được xử lý');
      }
      if (c.actor.role !== 'Farmer' || c.actor.id !== r.owner_id) {
        throw new ForbiddenException('Chỉ chủ Farmer được duyệt/từ chối đề xuất Zone');
      }
      if (rejection) {
        r.status = 'Rejected';
        r.rejection_reason = rejection.reason ?? null;
      } else {
        this.writable(c, 'Farmer');
        const proposer = this.active(c.users, r.proposed_by);
        if (proposer.role !== 'Admin') {
          throw new ConflictException('Người đề xuất không còn là Admin');
        }
        if (c.zone && c.zone.version !== c.request!.version) {
          throw new ConflictException('Zone đã thay đổi; từ chối và lập đề xuất mới');
        }
        const next = { ...c.zone?.zone, ...r.proposed_changes } as ZoneDetailsDto;
        await this.validate(client, c.farm, next, c.zone);
        r.zone_id = (await this.save(client, c, next, actor, r.id, r.proposed_by)).id;
        r.status = 'Accepted';
      }
      r.resolved_by = actor;
      r.resolved_at = this.clock().toISOString();
      await client.query(
        "UPDATE technical.workflow_requests SET status=$2,target_key=$3,payload=$4,resolved_at=$5,resolved_by=$6 WHERE id=$1 AND module='zones'",
        [id, r.status, r.zone_id, JSON.stringify(zoneRequestPayload(r)), r.resolved_at, actor],
      );
      await this.metadata(client, 'zone_requests', id);
      await this.audit(
        client,
        'zone_requests',
        id,
        actor,
        rejection ? 'ZoneRequestRejected' : 'ZoneRequestAccepted',
        { zone_id: r.zone_id, farm_id: r.farm_id },
      );
      return r;
    });
  }
  private async validate(
    client: PoolClient,
    farm: FarmSnapshot,
    next: ZoneDetailsDto,
    previous: ZoneSnapshot | null,
  ) {
    const standard = await this.catalogs.loadStandardOnClient(client, next.standard_id, true);
    if ((!previous || previous.zone.standard_id !== next.standard_id) && standard.status !== 'Active') {
      throw new ConflictException('Tiêu chuẩn mới gắn Zone phải Active');
    }
    // Parent Farm was locked BEFORE this SUM; shared standard lock prevents a
    // catalog change from invalidating the new attachment before COMMIT.
    const sum = await client.query<{ used: string }>(
      'SELECT COALESCE(sum(area_size),0)::text AS used FROM public.zones WHERE farm_id=$1 AND ($2::uuid IS NULL OR id<>$2)',
      [farm.farm.id, previous?.zone.id ?? null],
    );
    if (
      Math.round(decimalNumber(sum.rows[0].used) * 1000) + Math.round(next.area_size * 1000) >
      Math.round(farm.farm.area_size * 1000)
    ) {
      throw new ConflictException('Tổng diện tích Zone vượt diện tích Farm');
    }
  }
  private async save(
    client: PoolClient,
    c: Context,
    next: ZoneDetailsDto,
    actor: string,
    requestId: string | null = null,
    proposedBy: string | null = null,
  ) {
    let id: string;
    if (c.zone) {
      id = c.zone.zone.id;
      await client.query(
        'UPDATE public.zones SET standard_id=$2,zone_name=$3,area_size=$4,longitude=$5,latitude=$6 WHERE id=$1',
        [id, ...ZONE_FIELDS.map((key) => next[key])],
      );
    } else {
      id = (
        await client.query<{ id: string }>(
          'INSERT INTO public.zones(farm_id,standard_id,zone_name,area_size,longitude,latitude) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [c.farm.farm.id, ...ZONE_FIELDS.map((key) => next[key])],
        )
      ).rows[0].id;
    }
    await this.metadata(client, 'zones', id);
    const after = (await this.loadOnClient(client, id)).zone;
    await this.audit(client, 'zones', id, actor, c.zone ? 'ZoneUpdated' : 'ZoneCreated', {
      request_id: requestId,
      proposed_by: proposedBy,
      before: c.zone?.zone ?? null,
      after,
    });
    return after;
  }
  private changes(input: ZoneDetailsDto | UpdateZoneDto): Partial<ZoneDetailsDto> {
    return Object.fromEntries(
      ZONE_FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]),
    );
  }
  private requireChanges(zone: ZoneSnapshot, input: Partial<ZoneDetailsDto>) {
    if (!Object.entries(input).some(([key, value]) => zone.zone[key as keyof ZoneDetailsDto] !== value)) {
      throw new BadRequestException('Cần ít nhất một thay đổi khác dữ liệu Zone hiện tại');
    }
  }
  private writable(c: Context, role: 'Admin' | 'Farmer') {
    if (c.actor.role !== role) {
      throw new ForbiddenException(
        role === 'Admin' ? 'Admin phải gửi đề xuất Zone' : 'Chỉ chủ Farmer được ghi trực tiếp Zone',
      );
    }
    if (role === 'Farmer' && c.actor.id !== c.farm.farm.owner_id) {
      throw new ForbiddenException('Chỉ chủ Farm được thay đổi Zone');
    }
    const owner = this.active(c.users, c.farm.farm.owner_id);
    if (owner.role !== 'Farmer') {
      throw new ConflictException('Chủ Farm phải là Farmer Active');
    }
  }
  private async request(client: PoolClient, id: string, lock = false): Promise<StoredZoneRequest> {
    const rows = await client.query<ZoneRequestRow>(
      `${SELECT_REQUEST} AND id=$1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy đề xuất Zone');
    }
    return mapZoneRequest(rows.rows[0]);
  }
  private async context(
    client: PoolClient,
    actor: string,
    farmId?: string,
    zoneId?: string,
    requestId?: string,
  ): Promise<Context> {
    const hint = requestId ? await this.request(client, requestId) : null;
    const zoneHint =
      zoneId || hint?.value.zone_id ? await this.loadOnClient(client, zoneId ?? hint!.value.zone_id!) : null;
    const farmHint = await this.farms.loadOnClient(
      client,
      farmId ?? hint?.value.farm_id ?? zoneHint!.zone.farm_id,
    );
    const ids = [
      actor,
      farmHint.farm.owner_id,
      ...(hint ? [hint.value.owner_id, hint.value.proposed_by] : []),
    ];
    const users = await this.lockUsers(client, ids),
      user = this.active(users, actor);
    // Same global order as Farm/HTX. Farm may leave/join during hint reads;
    // retry without writes if parent identity changed, never lock a user late.
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
      throw new RetryZoneContext();
    }
    const zone = zoneHint ? await this.loadOnClient(client, zoneHint.zone.id, true) : null;
    if (zone && zone.zone.farm_id !== farm.farm.id) {
      throw new Error('Persisted Zone parent does not match locked Farm');
    }
    const request = requestId ? await this.request(client, requestId, true) : null;
    if (request && JSON.stringify(request.value) !== JSON.stringify(hint!.value)) {
      throw new RetryZoneContext();
    }
    return { actor: user, users, farm, zone, request };
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
      const account = await this.users.loadOnClient(client, id);
      if (account) {
        users.set(id, account.user);
      }
    }
    return users;
  }
  private active(users: ReadonlyMap<string, UserRecord>, id: string) {
    const user = users.get(id);
    if (!user || user.status !== 'Active') {
      throw new ForbiddenException('Tài khoản phải Active');
    }
    return user;
  }
  private async readAs<T>(actor: string, work: (client: PoolClient, user: UserRecord) => Promise<T>) {
    actor = farmUuid(actor);
    return this.transaction(async (client) =>
      work(client, this.active(await this.lockUsers(client, [actor]), actor)),
    );
  }
  async acceptedZoneIdsOnClient(client: PoolClient, user: UserRecord): Promise<string[]> {
    if (user.role !== 'Farmer') {
      return [];
    }
    const rows = await client.query<AssignmentRow & { farm_id: string }>(
      `SELECT a.id,a.user_id,a.zone_id,a.start_date,a.end_date,z.farm_id,m.version::text AS entity_version,m.data FROM public.users_zones a JOIN public.zones z ON z.id=a.zone_id
      LEFT JOIN technical.entity_metadata m ON m.entity_type='users_zones' AND m.entity_key=a.id::text
      WHERE a.user_id=$1 AND a.start_date<=$2 AND (a.end_date IS NULL OR a.end_date>$2)`,
      [user.id, this.clock()],
    );
    return rows.rows
      .filter((row) => {
        try {
          return mapAssignment(row).zone_snapshot.farm_id === row.farm_id;
        } catch {
          return false;
        }
      })
      .map((row) => row.zone_id);
  }
  private async page<Row, T>(
    client: PoolClient,
    select: string,
    values: unknown[],
    q: { limit: number; offset: number },
    order: string,
    map: (row: Row) => T,
  ): Promise<FarmPage<T>> {
    const n = values.length;
    const result = await client.query<{ items: Row[]; total: string }>(
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
  private async metadata(client: PoolClient, type: string, id: string) {
    const row = await client.query(
      `INSERT INTO technical.entity_metadata(entity_type,entity_key,version) VALUES ($1,$2,1)
    ON CONFLICT(entity_type,entity_key) DO UPDATE SET version=technical.entity_metadata.version+1 WHERE technical.entity_metadata.version BETWEEN 1 AND 9007199254740990 RETURNING version`,
      [type, id],
    );
    if (!row.rowCount) {
      throw new Error('Invalid or exhausted Zone version');
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
        if (error instanceof RetryZoneContext) {
          continue;
        }
        if (error instanceof HttpException) {
          throw error;
        }
        const pg = error as { code?: string; constraint?: string };
        if (pg.code === '23505' && pg.constraint === 'zone_one_pending_update') {
          throw new ConflictException('Zone đã có đề xuất Admin đang chờ');
        }
        throw new ServiceUnavailableException('Không thể truy cập dữ liệu Zone; vui lòng thử lại sau');
      }
    }
    throw new ConflictException('Dữ liệu Zone vừa thay đổi; hãy tải lại');
  }
}
