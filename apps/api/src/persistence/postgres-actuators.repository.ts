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
import { ActuatorRecords } from '../actuators/actuator-records';
import { TestActuator, ActuatorDetails, ActuatorCreationDetails } from '../actuators/actuators.types';
import { PostgresDevicesRepository } from './postgres-devices.repository';
import { DeviceSnapshot } from './device-mappers';
import {
  CreateActuatorDto,
  ActuatorListDto,
  UpdateActuatorDto,
  ActuatorCapabilityParamDto,
} from '../actuators/actuators.dto';
import { FarmPageDto, FarmRequestListDto, RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { FarmPage } from '../farms/farm-records';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresDomainAccess, RetryDomainContext, ZoneWriteContext } from './domain-access';
import { ZONE_READ_SCOPE } from './zone-read-scope';
import {
  ActuatorRow,
  ActuatorSnapshot,
  ActuatorRequestRow,
  ACTUATOR_FIELDS,
  mapActuator,
  mapActuatorRequest,
  mapActuatorHistory,
  actuatorRequestPayload,
  actuatorChanges,
} from './actuator-mappers';
import { inPostgresTransaction } from './transactions';
import { safeInteger } from './mappers';

const SELECT_ACTUATOR = `SELECT t.id,t.device_id,t.name,t.purpose,t.capability_id::text AS capability_id,t.status,m.version::text AS entity_version
  FROM public.actuators t JOIN public.devices d ON d.id=t.device_id JOIN public.zones z ON z.id=d.zone_id LEFT JOIN technical.entity_metadata m ON m.entity_type='actuators' AND m.entity_key=t.id::text`;
const SELECT_REQUEST = `SELECT r.id,r.action,r.status,r.target_key,r.requested_by,r.expected_version::text,r.payload,r.created_at,r.resolved_at,r.resolved_by,m.version::text AS request_version
  FROM technical.workflow_requests r LEFT JOIN technical.entity_metadata m ON m.entity_type='actuator_requests' AND m.entity_key=r.id::text WHERE r.module='actuators'`;
interface Context extends ZoneWriteContext {
  parent: DeviceSnapshot;
  actuator: ActuatorSnapshot | null;
  request: ReturnType<typeof mapActuatorRequest> | null;
}

export class PostgresActuatorsRepository extends ActuatorRecords {
  private readonly access: PostgresDomainAccess;
  constructor(
    private readonly pool: Pool,
    users: PostgresUsersRepository,
    farms: PostgresFarmsRepository,
    zones: PostgresZonesRepository,
    private readonly devices: PostgresDevicesRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {
    super();
    this.access = new PostgresDomainAccess(users, farms, zones);
  }
  async list(actor: string, input: ActuatorListDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(ActuatorListDto, input),
        scope = await this.access.scopeValues(client, user);
      return this.page(
        client,
        `${SELECT_ACTUATOR} WHERE ${ZONE_READ_SCOPE} AND ($4::uuid IS NULL OR t.device_id=$4) AND ($5::text IS NULL OR t.status=$5)
      AND ($6::text IS NULL OR strpos(lower(t.name),lower($6))>0 OR strpos(t.capability_id::text,$6)>0) AND ($7::text IS NULL OR t.purpose=$7)`,
        [
          ...scope,
          q.device_id ? farmUuid(q.device_id) : null,
          q.status ?? null,
          q.q ?? null,
          q.purpose ?? null,
        ],
        q,
        'id',
        (row: ActuatorRow) => mapActuator(row).actuator,
      );
    });
  }
  async get(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => this.scoped(client, user, 't.id', id));
  }
  async getByCapability(actor: string, deviceId: string, capabilityId: number) {
    const params = this.capabilityParams(deviceId, capabilityId);
    return this.readAs(actor, async (client, user) => {
      const scope = await this.access.scopeValues(client, user);
      const rows = await client.query<ActuatorRow>(
        `${SELECT_ACTUATOR} WHERE ${ZONE_READ_SCOPE} AND t.device_id=$4 AND t.capability_id=$5`,
        [...scope, params.deviceId, params.capabilityId],
      );
      if (!rows.rows[0]) {
        throw new NotFoundException('Actuator not found in scope');
      }
      return mapActuator(rows.rows[0]).actuator;
    });
  }
  async history(actor: string, id: string, input: FarmPageDto) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(FarmPageDto, input);
      await this.scoped(client, user, 't.id', id);
      return this.page(
        client,
        `SELECT id,entity_key,actor_id,action,changed_at,payload FROM technical.audit_events WHERE entity_type='actuators' AND entity_key=$1 AND action IN ('ActuatorCreated','ActuatorUpdated')`,
        [id],
        q,
        "(payload->>'version')::bigint,id",
        mapActuatorHistory,
      );
    });
  }
  async getRecord(id: string) {
    id = farmUuid(id);
    return this.transaction(async (client) => (await this.loadOnClient(client, id)).actuator);
  }
  async getRecordByCapability(deviceId: string, capabilityId: number) {
    const params = this.capabilityParams(deviceId, capabilityId);
    return this.transaction(async (client) => {
      const rows = await client.query<ActuatorRow>(
        `${SELECT_ACTUATOR} WHERE t.device_id=$1 AND t.capability_id=$2`,
        [params.deviceId, params.capabilityId],
      );
      if (!rows.rows[0]) {
        throw new NotFoundException('Actuator not found');
      }
      return mapActuator(rows.rows[0]).actuator;
    });
  }
  private capabilityParams(deviceId: string, capabilityId: number) {
    if (typeof capabilityId !== 'number' || !Number.isSafeInteger(capabilityId) || capabilityId < 1) {
      throw new BadRequestException('capability_id phải là số nguyên dương trong miền chính xác JSON');
    }
    return farmInput(ActuatorCapabilityParamDto, {
      deviceId: farmUuid(deviceId),
      capabilityId: capabilityId,
    });
  }
  async create(actor: string, input: CreateActuatorDto) {
    return this.write(actor, input);
  }
  async update(actor: string, id: string, input: UpdateActuatorDto) {
    return this.write(actor, input, farmUuid(id));
  }
  async createRequest(actor: string, input: CreateActuatorDto) {
    return this.propose(actor, input);
  }
  async updateRequest(actor: string, id: string, input: UpdateActuatorDto) {
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
        (row: ActuatorRequestRow) => mapActuatorRequest(row).value,
      );
    });
  }
  async getRequest(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const r = (await this.request(client, id)).value;
      if (user.role !== 'Admin' && user.id !== r.owner_id) {
        throw new NotFoundException('Không tìm thấy đề xuất thiết bị chấp hành');
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
  async loadOnClient(client: PoolClient, id: string, lock = false): Promise<ActuatorSnapshot> {
    id = farmUuid(id);
    if (lock) {
      await client.query('SELECT id FROM public.actuators WHERE id=$1 FOR UPDATE', [id]);
    }
    const rows = await client.query<ActuatorRow>(`${SELECT_ACTUATOR} WHERE t.id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy thiết bị chấp hành');
    }
    return mapActuator(rows.rows[0]);
  }
  private input(
    input: CreateActuatorDto | UpdateActuatorDto,
    creating: boolean,
  ): Partial<ActuatorCreationDetails> & { device_id?: string } {
    const value = creating
      ? farmInput(CreateActuatorDto, input as CreateActuatorDto)
      : farmInput(UpdateActuatorDto, input);
    const result = { ...value };
    if (creating) {
      result.status ??= 'Active';
    }
    return result;
  }
  private async write(actor: string, input: CreateActuatorDto | UpdateActuatorDto, id?: string) {
    actor = farmUuid(actor);
    const value = this.input(input, !id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, {
        actuatorId: id,
        deviceId: value.device_id ? farmUuid(value.device_id) : undefined,
      });
      this.access.writable(c, 'Farmer');
      const changes = actuatorChanges(value);
      if (c.actuator) {
        this.requireChanges(c.actuator.actuator, changes);
      }
      return this.save(client, c, { ...c.actuator?.actuator, ...changes } as ActuatorCreationDetails, actor);
    });
  }
  private async propose(actor: string, input: CreateActuatorDto | UpdateActuatorDto, id?: string) {
    actor = farmUuid(actor);
    const value = this.input(input, !id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, {
        actuatorId: id,
        deviceId: value.device_id ? farmUuid(value.device_id) : undefined,
      });
      this.access.writable(c, 'Admin');
      const changes = actuatorChanges(value);
      if (!c.actuator) {
        await this.capabilityAvailable(client, c.parent.device.id, changes.capability_id!);
      }
      if (c.actuator) {
        this.requireChanges(c.actuator.actuator, changes);
        if (
          (
            await client.query(
              "SELECT 1 FROM technical.workflow_requests WHERE module='actuators' AND status='Pending' AND target_key=$1",
              [id],
            )
          ).rowCount
        ) {
          throw new ConflictException('Thiết bị chấp hành đã có đề xuất sửa Pending');
        }
      }
      const payload = {
        device_id: c.parent.device.id,
        zone_id: c.zone.id,
        farm_id: c.farm.farm.id,
        owner_id: c.farm.farm.owner_id,
        proposed_changes: changes,
        actuator_snapshot: c.actuator?.actuator ?? null,
        rejection_reason: null,
      };
      const rows = await client.query<{ id: string }>(
        `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,expected_version,payload,created_at)
        VALUES ('actuators',$1,'Pending',$2,$3,$4,$5,$6) RETURNING id`,
        [
          c.actuator ? 'Update' : 'Create',
          c.actuator?.actuator.id ?? null,
          actor,
          c.actuator?.version ?? null,
          JSON.stringify(payload),
          this.clock(),
        ],
      );
      await this.metadata(client, 'actuator_requests', rows.rows[0].id);
      const r = (await this.request(client, rows.rows[0].id)).value;
      await this.audit(client, 'actuator_requests', r.id, actor, 'ActuatorRequestCreated', {
        action: r.action,
        zone_id: r.zone_id,
        actuator_id: r.actuator_id,
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
        throw new ConflictException('Đề xuất thiết bị chấp hành đã được xử lý');
      }
      if (c.actor.role !== 'Farmer' || actor !== r.owner_id) {
        throw new ForbiddenException('Chỉ chủ Farmer được duyệt/từ chối đề xuất thiết bị chấp hành');
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
        if (c.actuator && c.actuator.version !== c.request!.version) {
          throw new ConflictException('Thiết bị chấp hành đã thay đổi; từ chối và lập đề xuất mới');
        }
        r.actuator_id = (
          await this.save(
            client,
            c,
            { ...c.actuator?.actuator, ...r.proposed_changes } as ActuatorCreationDetails,
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
        "UPDATE technical.workflow_requests SET status=$2,target_key=$3,payload=$4,resolved_at=$5,resolved_by=$6 WHERE module='actuators' AND id=$1",
        [id, r.status, r.actuator_id, JSON.stringify(actuatorRequestPayload(r)), r.resolved_at, actor],
      );
      await this.metadata(client, 'actuator_requests', id);
      await this.audit(
        client,
        'actuator_requests',
        id,
        actor,
        rejection ? 'ActuatorRequestRejected' : 'ActuatorRequestAccepted',
        { zone_id: r.zone_id, actuator_id: r.actuator_id },
      );
      return r;
    });
  }
  private async save(
    client: PoolClient,
    c: Context,
    next: ActuatorCreationDetails,
    actor: string,
    requestId: string | null = null,
    proposedBy: string | null = null,
  ): Promise<TestActuator> {
    let id = c.actuator?.actuator.id;
    if (id) {
      await client.query('UPDATE public.actuators SET name=$2,status=$3 WHERE id=$1', [
        id,
        ...ACTUATOR_FIELDS.map((key) => next[key]),
      ]);
    } else {
      // DO NOTHING keeps the transaction usable for bounded UUID collisions.
      // Numeric capability uniqueness is Device-local, including Inactive.
      // ON CONFLICT allows bounded UUID retry without an aborted transaction.
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = farmUuid(this.idFactory());
        const inserted = await client.query(
          'INSERT INTO public.actuators(id,device_id,purpose,capability_id,name,status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',
          [
            candidate,
            c.parent.device.id,
            next.purpose,
            next.capability_id,
            ...ACTUATOR_FIELDS.map((key) => next[key]),
          ],
        );
        if (inserted.rowCount) {
          id = candidate;
          break;
        }
        await this.capabilityAvailable(client, c.parent.device.id, next.capability_id);
      }
      if (!id) {
        throw new ConflictException('Không thể sinh mã thiết bị chấp hành duy nhất; thử lại');
      }
    }
    const version = await this.metadata(client, 'actuators', id),
      after = (await this.loadOnClient(client, id)).actuator;
    await this.audit(client, 'actuators', id, actor, c.actuator ? 'ActuatorUpdated' : 'ActuatorCreated', {
      proposed_by: proposedBy,
      request_id: requestId,
      version,
      before: c.actuator?.actuator ?? null,
      after,
    });
    return after;
  }
  private async capabilityAvailable(
    client: PoolClient,
    deviceId: string,
    capabilityId: number,
  ): Promise<void> {
    if (
      (
        await client.query('SELECT id FROM public.actuators WHERE device_id=$1 AND capability_id=$2', [
          deviceId,
          capabilityId,
        ])
      ).rowCount
    ) {
      throw new ConflictException('Device đã có capability_id này');
    }
  }
  private requireChanges(actuator: TestActuator, input: Partial<ActuatorDetails>) {
    if (!Object.entries(input).some(([key, value]) => actuator[key as keyof ActuatorDetails] !== value)) {
      throw new BadRequestException('Cần ít nhất một thông tin thiết bị chấp hành thực sự thay đổi');
    }
  }
  private async scoped(
    client: PoolClient,
    user: UserRecord,
    column: 't.id',
    value: string,
  ): Promise<TestActuator> {
    const scope = await this.access.scopeValues(client, user),
      rows = await client.query<ActuatorRow>(`${SELECT_ACTUATOR} WHERE ${ZONE_READ_SCOPE} AND ${column}=$4`, [
        ...scope,
        value,
      ]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy thiết bị chấp hành trong phạm vi truy cập');
    }
    return mapActuator(rows.rows[0]).actuator;
  }
  private async request(client: PoolClient, id: string, lock = false) {
    if (lock) {
      await client.query(
        "SELECT id FROM technical.workflow_requests WHERE module='actuators' AND id=$1 FOR UPDATE",
        [id],
      );
    }
    const rows = await client.query<ActuatorRequestRow>(`${SELECT_REQUEST} AND id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy đề xuất thiết bị chấp hành');
    }
    return mapActuatorRequest(rows.rows[0]);
  }
  private async context(
    client: PoolClient,
    actor: string,
    target: { deviceId?: string; actuatorId?: string; requestId?: string },
  ): Promise<Context> {
    const hint = target.requestId ? await this.request(client, target.requestId) : null,
      actuatorId = target.actuatorId ?? hint?.value.actuator_id;
    const actuatorHint = actuatorId ? await this.loadOnClient(client, actuatorId) : null;
    const deviceId = target.deviceId ?? hint?.value.device_id ?? actuatorHint!.actuator.device_id;
    const deviceHint = await this.devices.loadOnClient(client, deviceId);
    const c = await this.access.lockZone(
      client,
      actor,
      deviceHint.device.zone_id,
      hint ? [hint.value.owner_id, hint.value.proposed_by] : [],
    );
    // Lock Device before its child. Inactive/Maintenance still permits metadata
    // maintenance; telemetry/control enforce administrative status separately.
    const parent = await this.devices.loadOnClient(client, deviceId, true);
    const actuator = actuatorId ? await this.loadOnClient(client, actuatorId, true) : null,
      request = target.requestId ? await this.request(client, target.requestId, true) : null;
    if (
      parent.device.zone_id !== c.zone.id ||
      (actuator && actuator.actuator.device_id !== parent.device.id)
    ) {
      throw new Error('Persisted Actuator parent mismatch');
    }
    if (request && JSON.stringify(request) !== JSON.stringify(hint)) {
      throw new RetryDomainContext();
    }
    if (request && (request.value.device_id !== parent.device.id || request.value.zone_id !== c.zone.id)) {
      throw new Error('Persisted Actuator request parent mismatch');
    }
    return { ...c, parent, actuator, request };
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
      throw new Error('Invalid or exhausted Actuator version');
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
        if (pg.code === '23505' && pg.constraint === 'actuator_one_pending_update') {
          throw new ConflictException('Thiết bị chấp hành đã có đề xuất sửa Pending');
        }
        throw new ServiceUnavailableException(
          'Không thể truy cập dữ liệu thiết bị chấp hành; vui lòng thử lại sau',
        );
      }
    }
    throw new ConflictException('Dữ liệu thiết bị chấp hành vừa thay đổi; hãy tải lại');
  }
}
