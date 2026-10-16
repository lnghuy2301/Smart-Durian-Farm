import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { UserRecord } from '../auth/user-accounts';
import { DeviceRecords } from '../devices/device-records';
import { TestDevice, DeviceDetails, DeviceCreationDetails } from '../devices/devices.types';
import { PostgresTreesRepository } from './postgres-trees.repository';
import {
  CreateDeviceDto,
  DeviceListDto,
  UpdateDeviceDto,
  DeviceStationParamDto,
} from '../devices/devices.dto';
import { FarmPageDto, FarmRequestListDto, RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { FarmPage } from '../farms/farm-records';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresDomainAccess, RetryDomainContext, ZoneWriteContext } from './domain-access';
import { ZONE_READ_SCOPE } from './zone-read-scope';
import {
  DeviceRow,
  DeviceSnapshot,
  DeviceRequestRow,
  DEVICE_FIELDS,
  mapDevice,
  mapDeviceRequest,
  mapDeviceHistory,
  deviceRequestPayload,
  deviceChanges,
} from './device-mappers';
import { inPostgresTransaction } from './transactions';
import { safeInteger } from './mappers';

const SELECT_DEVICE = `SELECT t.id,t.zone_id,t.station_id,t.installed_at,t.cost,t.status,t.last_seen_at,m.version::text AS entity_version
  FROM public.devices t JOIN public.zones z ON z.id=t.zone_id LEFT JOIN technical.entity_metadata m ON m.entity_type='devices' AND m.entity_key=t.id::text`;
const SELECT_REQUEST = `SELECT r.id,r.action,r.status,r.target_key,r.requested_by,r.expected_version::text,r.payload,r.created_at,r.resolved_at,r.resolved_by,m.version::text AS request_version
  FROM technical.workflow_requests r LEFT JOIN technical.entity_metadata m ON m.entity_type='device_requests' AND m.entity_key=r.id::text WHERE r.module='devices'`;
interface Context extends ZoneWriteContext {
  device: DeviceSnapshot | null;
  request: ReturnType<typeof mapDeviceRequest> | null;
}

export class PostgresDevicesRepository extends DeviceRecords {
  private readonly access: PostgresDomainAccess;
  constructor(
    private readonly pool: Pool,
    users: PostgresUsersRepository,
    farms: PostgresFarmsRepository,
    zones: PostgresZonesRepository,
    private readonly trees: PostgresTreesRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {
    super();
    this.access = new PostgresDomainAccess(users, farms, zones);
  }
  async list(actor: string, input: DeviceListDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(DeviceListDto, input),
        scope = await this.access.scopeValues(client, user);
      return this.page(
        client,
        `${SELECT_DEVICE} WHERE ${ZONE_READ_SCOPE} AND ($4::uuid IS NULL OR t.zone_id=$4) AND ($5::text IS NULL OR t.status=$5)
      AND ($6::text IS NULL OR strpos(lower(t.station_id),lower($6))>0)`,
        [...scope, q.zone_id ? farmUuid(q.zone_id) : null, q.status ?? null, q.q ?? null],
        q,
        'id',
        (row: DeviceRow) => mapDevice(row).device,
      );
    });
  }
  async get(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => this.scoped(client, user, 't.id', id));
  }
  async getByStationId(actor: string, code: string) {
    code = farmInput(DeviceStationParamDto, { stationId: code }).stationId;
    return this.readAs(actor, async (client, user) => this.scoped(client, user, 't.station_id', code));
  }
  async affectedTrees(actor: string, id: string, input: FarmPageDto) {
    const q = farmInput(FarmPageDto, input),
      device = await this.get(actor, id);
    // Zone is immutable. Both reads enforce current permissions; there is no
    // TREES.device_id and no persisted list of affected trees to drift apart.
    return this.trees.list(actor, { ...q, zone_id: device.zone_id });
  }
  async history(actor: string, id: string, input: FarmPageDto) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(FarmPageDto, input);
      await this.scoped(client, user, 't.id', id);
      return this.page(
        client,
        `SELECT id,entity_key,actor_id,action,changed_at,payload FROM technical.audit_events WHERE entity_type='devices' AND entity_key=$1 AND action IN ('DeviceCreated','DeviceUpdated')`,
        [id],
        q,
        "(payload->>'version')::bigint,id",
        mapDeviceHistory,
      );
    });
  }
  async getRecord(id: string) {
    id = farmUuid(id);
    return this.transaction(async (client) => (await this.loadOnClient(client, id)).device);
  }
  async getRecordByStationId(code: string) {
    code = farmInput(DeviceStationParamDto, { stationId: code }).stationId;
    return this.transaction(async (client) => {
      const row = await client.query<DeviceRow>(`${SELECT_DEVICE} WHERE t.station_id=$1`, [code]);
      if (!row.rows[0]) {
        throw new NotFoundException('Không tìm thấy thiết bị');
      }
      return mapDevice(row.rows[0]).device;
    });
  }
  async recordSeen(id: string, receivedAt: string): Promise<void> {
    id = farmUuid(id);
    const epoch = Date.parse(receivedAt);
    if (!Number.isFinite(epoch)) {
      throw new BadRequestException('Thời điểm nhận MQTT không hợp lệ');
    }
    await this.transaction(async (client) => {
      const before = await this.loadOnClient(client, id, true);
      if (before.device.last_seen_at === null || epoch > Date.parse(before.device.last_seen_at)) {
        // Receiver-only, monotonic presence. Metadata writes lock the same row
        // and never write last_seen_at, so neither path can erase the other.
        await client.query('UPDATE public.devices SET last_seen_at=$2 WHERE id=$1', [id, new Date(epoch)]);
      }
    });
  }
  async create(actor: string, input: CreateDeviceDto) {
    return this.write(actor, input);
  }
  async update(actor: string, id: string, input: UpdateDeviceDto) {
    return this.write(actor, input, farmUuid(id));
  }
  async createRequest(actor: string, input: CreateDeviceDto) {
    return this.propose(actor, input);
  }
  async updateRequest(actor: string, id: string, input: UpdateDeviceDto) {
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
        (row: DeviceRequestRow) => mapDeviceRequest(row).value,
      );
    });
  }
  async getRequest(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const r = (await this.request(client, id)).value;
      if (user.role !== 'Admin' && user.id !== r.owner_id) {
        throw new NotFoundException('Không tìm thấy đề xuất thiết bị');
      }
      return r;
    });
  }
  async approve(actor: string, id: string) {
    return this.decide(actor, farmUuid(id));
  }
  async reject(actor: string, id: string, reason?: string) {
    return this.decide(actor, farmUuid(id), { reason: farmInput(RejectFarmRequestDto, { reason }).reason });
  }
  async loadOnClient(client: PoolClient, id: string, lock = false): Promise<DeviceSnapshot> {
    id = farmUuid(id);
    if (lock) {
      await client.query('SELECT id FROM public.devices WHERE id=$1 FOR UPDATE', [id]);
    }
    const rows = await client.query<DeviceRow>(`${SELECT_DEVICE} WHERE t.id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy thiết bị');
    }
    return mapDevice(rows.rows[0]);
  }
  private input(
    input: CreateDeviceDto | UpdateDeviceDto,
    creating: boolean,
  ): Partial<DeviceCreationDetails> & { zone_id?: string } {
    const value = creating
      ? farmInput(CreateDeviceDto, input as CreateDeviceDto)
      : farmInput(UpdateDeviceDto, input);
    const result = { ...value };
    if (result.installed_at !== undefined) {
      result.installed_at = new Date(result.installed_at).toISOString();
    }
    if (creating) {
      result.status ??= 'Active';
    }
    return result;
  }
  private async write(actor: string, input: CreateDeviceDto | UpdateDeviceDto, id?: string) {
    actor = farmUuid(actor);
    const value = this.input(input, !id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, {
        deviceId: id,
        zoneId: value.zone_id ? farmUuid(value.zone_id) : undefined,
      });
      this.access.writable(c, 'Farmer');
      const changes = deviceChanges(value);
      if (c.device) {
        this.requireChanges(c.device.device, changes);
      }
      return this.save(client, c, { ...c.device?.device, ...changes } as DeviceCreationDetails, actor);
    });
  }
  private async propose(actor: string, input: CreateDeviceDto | UpdateDeviceDto, id?: string) {
    actor = farmUuid(actor);
    const value = this.input(input, !id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, {
        deviceId: id,
        zoneId: value.zone_id ? farmUuid(value.zone_id) : undefined,
      });
      this.access.writable(c, 'Admin');
      const changes = deviceChanges(value);
      if (!c.device) {
        await this.stationAvailable(client, changes.station_id!);
      }
      if (c.device) {
        this.requireChanges(c.device.device, changes);
        if (
          (
            await client.query(
              "SELECT 1 FROM technical.workflow_requests WHERE module='devices' AND status='Pending' AND target_key=$1",
              [id],
            )
          ).rowCount
        ) {
          throw new ConflictException('Thiết bị đã có đề xuất sửa Pending');
        }
      }
      const payload = {
        zone_id: c.zone.id,
        farm_id: c.farm.farm.id,
        owner_id: c.farm.farm.owner_id,
        proposed_changes: changes,
        device_snapshot: c.device?.device ?? null,
        rejection_reason: null,
      };
      const rows = await client.query<{ id: string }>(
        `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,expected_version,payload,created_at)
        VALUES ('devices',$1,'Pending',$2,$3,$4,$5,$6) RETURNING id`,
        [
          c.device ? 'Update' : 'Create',
          c.device?.device.id ?? null,
          actor,
          c.device?.version ?? null,
          JSON.stringify(payload),
          this.clock(),
        ],
      );
      await this.metadata(client, 'device_requests', rows.rows[0].id);
      const r = (await this.request(client, rows.rows[0].id)).value;
      await this.audit(client, 'device_requests', r.id, actor, 'DeviceRequestCreated', {
        action: r.action,
        zone_id: r.zone_id,
        device_id: r.device_id,
      });
      return r;
    });
  }
  private async decide(actor: string, id: string, rejection?: { reason?: string }) {
    actor = farmUuid(actor);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { requestId: id }),
        r = structuredClone(c.request!.value);
      if (r.status !== 'Pending') {
        throw new ConflictException('Đề xuất thiết bị đã được xử lý');
      }
      if (c.actor.role !== 'Farmer' || actor !== r.owner_id) {
        throw new ForbiddenException('Chỉ chủ Farmer được duyệt/từ chối đề xuất thiết bị');
      }
      if (rejection) {
        r.status = 'Rejected';
        r.rejection_reason = rejection.reason ?? null;
      } else {
        this.access.writable(c, 'Farmer');
        if (c.farm.farm.id !== r.farm_id || c.farm.farm.owner_id !== r.owner_id) {
          throw new ConflictException('Farm/chủ đã thay đổi; cần đề xuất mới');
        }
        if (this.access.active(c.users, r.proposed_by).role !== 'Admin') {
          throw new ConflictException('Người đề xuất không còn là Admin');
        }
        if (c.device && c.device.version !== c.request!.version) {
          throw new ConflictException('Thiết bị đã thay đổi; từ chối và lập đề xuất mới');
        }
        r.device_id = (
          await this.save(
            client,
            c,
            { ...c.device?.device, ...r.proposed_changes } as DeviceCreationDetails,
            actor,
            r.id,
            r.proposed_by,
          )
        ).id;
        r.status = 'Accepted';
      }
      r.resolved_by = actor;
      r.resolved_at = this.clock().toISOString();
      await client.query(
        "UPDATE technical.workflow_requests SET status=$2,target_key=$3,payload=$4,resolved_at=$5,resolved_by=$6 WHERE module='devices' AND id=$1",
        [id, r.status, r.device_id, JSON.stringify(deviceRequestPayload(r)), r.resolved_at, actor],
      );
      await this.metadata(client, 'device_requests', id);
      await this.audit(
        client,
        'device_requests',
        id,
        actor,
        rejection ? 'DeviceRequestRejected' : 'DeviceRequestAccepted',
        { zone_id: r.zone_id, device_id: r.device_id },
      );
      return r;
    });
  }
  private async save(
    client: PoolClient,
    c: Context,
    next: DeviceCreationDetails,
    actor: string,
    requestId: string | null = null,
    proposedBy: string | null = null,
  ): Promise<TestDevice> {
    let id = c.device?.device.id;
    if (id) {
      await client.query('UPDATE public.devices SET installed_at=$2,cost=$3,status=$4 WHERE id=$1', [
        id,
        ...DEVICE_FIELDS.map((key) => next[key]),
      ]);
    } else {
      // DO NOTHING keeps the transaction usable for bounded UUID collisions.
      // A station conflict is final, including an Inactive device, and never
      // turns into a new identity or a transfer to another Zone.
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = farmUuid(this.idFactory());
        const inserted = await client.query(
          'INSERT INTO public.devices(id,zone_id,station_id,installed_at,cost,status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',
          [candidate, c.zone.id, next.station_id, ...DEVICE_FIELDS.map((key) => next[key])],
        );
        if (inserted.rowCount) {
          id = candidate;
          break;
        }
        await this.stationAvailable(client, next.station_id);
      }
      if (!id) {
        throw new ConflictException('Không thể sinh mã thiết bị duy nhất; thử lại');
      }
    }
    const version = await this.metadata(client, 'devices', id),
      after = (await this.loadOnClient(client, id)).device;
    await this.audit(client, 'devices', id, actor, c.device ? 'DeviceUpdated' : 'DeviceCreated', {
      proposed_by: proposedBy,
      request_id: requestId,
      version,
      before: c.device?.device ?? null,
      after,
    });
    return after;
  }
  private async stationAvailable(client: PoolClient, stationId: string): Promise<void> {
    if ((await client.query('SELECT id FROM public.devices WHERE station_id=$1', [stationId])).rowCount) {
      throw new ConflictException('station_id đã được đăng ký');
    }
  }
  private requireChanges(device: TestDevice, input: Partial<DeviceDetails>) {
    if (!Object.entries(input).some(([key, value]) => device[key as keyof DeviceDetails] !== value)) {
      throw new BadRequestException('Cần ít nhất một thông tin thiết bị thực sự thay đổi');
    }
  }
  private async scoped(
    client: PoolClient,
    user: UserRecord,
    column: 't.id' | 't.station_id',
    value: string,
  ): Promise<TestDevice> {
    const scope = await this.access.scopeValues(client, user),
      rows = await client.query<DeviceRow>(`${SELECT_DEVICE} WHERE ${ZONE_READ_SCOPE} AND ${column}=$4`, [
        ...scope,
        value,
      ]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy thiết bị trong phạm vi truy cập');
    }
    return mapDevice(rows.rows[0]).device;
  }
  private async request(client: PoolClient, id: string, lock = false) {
    if (lock) {
      await client.query(
        "SELECT id FROM technical.workflow_requests WHERE module='devices' AND id=$1 FOR UPDATE",
        [id],
      );
    }
    const rows = await client.query<DeviceRequestRow>(`${SELECT_REQUEST} AND id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy đề xuất thiết bị');
    }
    return mapDeviceRequest(rows.rows[0]);
  }
  private async context(
    client: PoolClient,
    actor: string,
    target: { zoneId?: string; deviceId?: string; requestId?: string },
  ): Promise<Context> {
    const hint = target.requestId ? await this.request(client, target.requestId) : null,
      deviceId = target.deviceId ?? hint?.value.device_id;
    const deviceHint = deviceId ? await this.loadOnClient(client, deviceId) : null;
    const c = await this.access.lockZone(
      client,
      actor,
      target.zoneId ?? hint?.value.zone_id ?? deviceHint!.device.zone_id,
      hint ? [hint.value.owner_id, hint.value.proposed_by] : [],
    );
    const device = deviceId ? await this.loadOnClient(client, deviceId, true) : null,
      request = target.requestId ? await this.request(client, target.requestId, true) : null;
    if (device && device.device.zone_id !== c.zone.id) {
      throw new Error('Persisted Device parent mismatch');
    }
    if (request && JSON.stringify(request) !== JSON.stringify(hint)) {
      throw new RetryDomainContext();
    }
    return { ...c, device, request };
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
  private async metadata(client: PoolClient, type: string, id: string): Promise<number> {
    const rows = await client.query<{ version: string }>(
      `INSERT INTO technical.entity_metadata(entity_type,entity_key,version) VALUES ($1,$2,1) ON CONFLICT(entity_type,entity_key) DO UPDATE SET version=technical.entity_metadata.version+1
      WHERE technical.entity_metadata.version BETWEEN 1 AND 9007199254740990 RETURNING version::text`,
      [type, id],
    );
    if (!rows.rows[0]) {
      throw new Error('Invalid or exhausted Device version');
    }
    return safeInteger(rows.rows[0].version);
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
        if (pg.code === '23505' && pg.constraint === 'device_one_pending_update') {
          throw new ConflictException('Thiết bị đã có đề xuất sửa Pending');
        }
        throw new ServiceUnavailableException('Không thể truy cập dữ liệu thiết bị; vui lòng thử lại sau');
      }
    }
    throw new ConflictException('Dữ liệu thiết bị vừa thay đổi; hãy tải lại');
  }
}
