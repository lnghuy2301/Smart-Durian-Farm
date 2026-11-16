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
import { SensorRecords } from '../sensors/sensor-records';
import { TestSensor, SensorDetails, SensorCreationDetails } from '../sensors/sensors.types';
import { PostgresDevicesRepository } from './postgres-devices.repository';
import { DeviceSnapshot } from './device-mappers';
import {
  CreateSensorDto,
  SensorListDto,
  UpdateSensorDto,
  SensorStreamParamDto,
} from '../sensors/sensors.dto';
import { FarmPageDto, FarmRequestListDto, RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { FarmPage } from '../farms/farm-records';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresDomainAccess, RetryDomainContext, ZoneWriteContext } from './domain-access';
import { ZONE_READ_SCOPE } from './zone-read-scope';
import {
  SensorRow,
  SensorSnapshot,
  SensorRequestRow,
  SENSOR_FIELDS,
  mapSensor,
  mapSensorRequest,
  mapSensorHistory,
  sensorRequestPayload,
  sensorChanges,
  sensorThresholds,
} from './sensor-mappers';
import { inPostgresTransaction } from './transactions';
import { safeInteger } from './mappers';

const SELECT_SENSOR = `SELECT t.id,t.device_id,t.name,t.sensor_type,t.data_stream_id,t.unit,t.min_threshold,t.max_threshold,t.status,m.version::text AS entity_version
  FROM public.sensors t JOIN public.devices d ON d.id=t.device_id JOIN public.zones z ON z.id=d.zone_id LEFT JOIN technical.entity_metadata m ON m.entity_type='sensors' AND m.entity_key=t.id::text`;
const SELECT_REQUEST = `SELECT r.id,r.action,r.status,r.target_key,r.requested_by,r.expected_version::text,r.payload,r.created_at,r.resolved_at,r.resolved_by,m.version::text AS request_version
  FROM technical.workflow_requests r LEFT JOIN technical.entity_metadata m ON m.entity_type='sensor_requests' AND m.entity_key=r.id::text WHERE r.module='sensors'`;
interface Context extends ZoneWriteContext {
  parent: DeviceSnapshot;
  sensor: SensorSnapshot | null;
  request: ReturnType<typeof mapSensorRequest> | null;
}

export class PostgresSensorsRepository extends SensorRecords {
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
  async list(actor: string, input: SensorListDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(SensorListDto, input),
        scope = await this.access.scopeValues(client, user);
      return this.page(
        client,
        `${SELECT_SENSOR} WHERE ${ZONE_READ_SCOPE} AND ($4::uuid IS NULL OR t.device_id=$4) AND ($5::text IS NULL OR t.status=$5)
      AND ($6::text IS NULL OR strpos(lower(t.name),lower($6))>0 OR strpos(lower(t.data_stream_id),lower($6))>0) AND ($7::text IS NULL OR t.sensor_type=$7)`,
        [
          ...scope,
          q.device_id ? farmUuid(q.device_id) : null,
          q.status ?? null,
          q.q ?? null,
          q.sensor_type ?? null,
        ],
        q,
        'id',
        (row: SensorRow) => mapSensor(row).sensor,
      );
    });
  }
  async get(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => this.scoped(client, user, 't.id', id));
  }
  async getByStream(actor: string, deviceId: string, streamId: string) {
    const params = this.streamParams(deviceId, streamId);
    return this.readAs(actor, async (client, user) => {
      const scope = await this.access.scopeValues(client, user);
      const rows = await client.query<SensorRow>(
        `${SELECT_SENSOR} WHERE ${ZONE_READ_SCOPE} AND t.device_id=$4 AND t.data_stream_id=$5`,
        [...scope, params.deviceId, params.dataStreamId],
      );
      if (!rows.rows[0]) {
        throw new NotFoundException('Sensor not found in scope');
      }
      return mapSensor(rows.rows[0]).sensor;
    });
  }
  async history(actor: string, id: string, input: FarmPageDto) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(FarmPageDto, input);
      await this.scoped(client, user, 't.id', id);
      return this.page(
        client,
        `SELECT id,entity_key,actor_id,action,changed_at,payload FROM technical.audit_events WHERE entity_type='sensors' AND entity_key=$1 AND action IN ('SensorCreated','SensorUpdated')`,
        [id],
        q,
        "(payload->>'version')::bigint,id",
        mapSensorHistory,
      );
    });
  }
  async getRecord(id: string) {
    id = farmUuid(id);
    return this.transaction(async (client) => (await this.loadOnClient(client, id)).sensor);
  }
  async getRecordByStream(deviceId: string, streamId: string) {
    const params = this.streamParams(deviceId, streamId);
    return this.transaction(
      async (client) =>
        (await this.loadByStreamOnClient(client, params.deviceId, params.dataStreamId)).sensor,
    );
  }
  // Caller owns the transaction/parent and Sensor row locks for ingestion.
  async loadByStreamOnClient(
    client: PoolClient,
    deviceId: string,
    streamId: string,
  ): Promise<SensorSnapshot> {
    const params = this.streamParams(deviceId, streamId);
    const rows = await client.query<SensorRow>(
      `${SELECT_SENSOR} WHERE t.device_id=$1 AND t.data_stream_id=$2`,
      [params.deviceId, params.dataStreamId],
    );
    if (!rows.rows[0]) {
      throw new NotFoundException('Sensor not found');
    }
    return mapSensor(rows.rows[0]);
  }
  private streamParams(deviceId: string, streamId: string) {
    return farmInput(SensorStreamParamDto, { deviceId: farmUuid(deviceId), dataStreamId: streamId });
  }
  async create(actor: string, input: CreateSensorDto) {
    return this.write(actor, input);
  }
  async update(actor: string, id: string, input: UpdateSensorDto) {
    return this.write(actor, input, farmUuid(id));
  }
  async createRequest(actor: string, input: CreateSensorDto) {
    return this.propose(actor, input);
  }
  async updateRequest(actor: string, id: string, input: UpdateSensorDto) {
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
        (row: SensorRequestRow) => mapSensorRequest(row).value,
      );
    });
  }
  async getRequest(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const r = (await this.request(client, id)).value;
      if (user.role !== 'Admin' && user.id !== r.owner_id) {
        throw new NotFoundException('Không tìm thấy đề xuất cảm biến');
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
  async loadOnClient(client: PoolClient, id: string, lock = false): Promise<SensorSnapshot> {
    id = farmUuid(id);
    if (lock) {
      await client.query('SELECT id FROM public.sensors WHERE id=$1 FOR UPDATE', [id]);
    }
    const rows = await client.query<SensorRow>(`${SELECT_SENSOR} WHERE t.id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy cảm biến');
    }
    return mapSensor(rows.rows[0]);
  }
  private input(
    input: CreateSensorDto | UpdateSensorDto,
    creating: boolean,
  ): Partial<SensorCreationDetails> & { device_id?: string } {
    const value = creating
      ? farmInput(CreateSensorDto, input as CreateSensorDto)
      : farmInput(UpdateSensorDto, input);
    const result = { ...value };
    if (creating) {
      result.status ??= 'Active';
      result.min_threshold ??= null;
      result.max_threshold ??= null;
      this.requireThresholds(result as SensorCreationDetails);
    }
    return result;
  }
  private async write(actor: string, input: CreateSensorDto | UpdateSensorDto, id?: string) {
    actor = farmUuid(actor);
    const value = this.input(input, !id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, {
        sensorId: id,
        deviceId: value.device_id ? farmUuid(value.device_id) : undefined,
      });
      this.access.writable(c, 'Farmer');
      const changes = sensorChanges(value);
      if (c.sensor) {
        this.requireChanges(c.sensor.sensor, changes);
      }
      this.requireThresholds({ ...c.sensor?.sensor, ...changes } as SensorCreationDetails);
      return this.save(client, c, { ...c.sensor?.sensor, ...changes } as SensorCreationDetails, actor);
    });
  }
  private async propose(actor: string, input: CreateSensorDto | UpdateSensorDto, id?: string) {
    actor = farmUuid(actor);
    const value = this.input(input, !id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, {
        sensorId: id,
        deviceId: value.device_id ? farmUuid(value.device_id) : undefined,
      });
      this.access.writable(c, 'Admin');
      const changes = sensorChanges(value);
      this.requireThresholds({ ...c.sensor?.sensor, ...changes } as SensorCreationDetails);
      if (!c.sensor) {
        await this.streamAvailable(client, c.parent.device.id, changes.data_stream_id!);
      }
      if (c.sensor) {
        this.requireChanges(c.sensor.sensor, changes);
        if (
          (
            await client.query(
              "SELECT 1 FROM technical.workflow_requests WHERE module='sensors' AND status='Pending' AND target_key=$1",
              [id],
            )
          ).rowCount
        ) {
          throw new ConflictException('Cảm biến đã có đề xuất sửa Pending');
        }
      }
      const payload = {
        device_id: c.parent.device.id,
        zone_id: c.zone.id,
        farm_id: c.farm.farm.id,
        owner_id: c.farm.farm.owner_id,
        proposed_changes: changes,
        sensor_snapshot: c.sensor?.sensor ?? null,
        rejection_reason: null,
      };
      const rows = await client.query<{ id: string }>(
        `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,expected_version,payload,created_at)
        VALUES ('sensors',$1,'Pending',$2,$3,$4,$5,$6) RETURNING id`,
        [
          c.sensor ? 'Update' : 'Create',
          c.sensor?.sensor.id ?? null,
          actor,
          c.sensor?.version ?? null,
          JSON.stringify(payload),
          this.clock(),
        ],
      );
      await this.metadata(client, 'sensor_requests', rows.rows[0].id);
      const r = (await this.request(client, rows.rows[0].id)).value;
      await this.audit(client, 'sensor_requests', r.id, actor, 'SensorRequestCreated', {
        action: r.action,
        zone_id: r.zone_id,
        sensor_id: r.sensor_id,
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
        throw new ConflictException('Đề xuất cảm biến đã được xử lý');
      }
      if (c.actor.role !== 'Farmer' || actor !== r.owner_id) {
        throw new ForbiddenException('Chỉ chủ Farmer được duyệt/từ chối đề xuất cảm biến');
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
        if (c.sensor && c.sensor.version !== c.request!.version) {
          throw new ConflictException('Cảm biến đã thay đổi; từ chối và lập đề xuất mới');
        }
        r.sensor_id = (
          await this.save(
            client,
            c,
            { ...c.sensor?.sensor, ...r.proposed_changes } as SensorCreationDetails,
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
        "UPDATE technical.workflow_requests SET status=$2,target_key=$3,payload=$4,resolved_at=$5,resolved_by=$6 WHERE module='sensors' AND id=$1",
        [id, r.status, r.sensor_id, JSON.stringify(sensorRequestPayload(r)), r.resolved_at, actor],
      );
      await this.metadata(client, 'sensor_requests', id);
      await this.audit(
        client,
        'sensor_requests',
        id,
        actor,
        rejection ? 'SensorRequestRejected' : 'SensorRequestAccepted',
        { zone_id: r.zone_id, sensor_id: r.sensor_id },
      );
      return r;
    });
  }
  private async save(
    client: PoolClient,
    c: Context,
    next: SensorCreationDetails,
    actor: string,
    requestId: string | null = null,
    proposedBy: string | null = null,
  ): Promise<TestSensor> {
    this.requireThresholds(next);
    let id = c.sensor?.sensor.id;
    if (id) {
      await client.query(
        'UPDATE public.sensors SET name=$2,unit=$3,min_threshold=$4,max_threshold=$5,status=$6 WHERE id=$1',
        [id, ...SENSOR_FIELDS.map((key) => next[key])],
      );
    } else {
      // DO NOTHING keeps the transaction usable for bounded UUID collisions.
      // Stream uniqueness is scoped to this Device, including Inactive sensors.
      // Other Devices may use the same external dataStreamId.
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = farmUuid(this.idFactory());
        const inserted = await client.query(
          'INSERT INTO public.sensors(id,device_id,sensor_type,data_stream_id,name,unit,min_threshold,max_threshold,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id',
          [
            candidate,
            c.parent.device.id,
            next.sensor_type,
            next.data_stream_id,
            ...SENSOR_FIELDS.map((key) => next[key]),
          ],
        );
        if (inserted.rowCount) {
          id = candidate;
          break;
        }
        await this.streamAvailable(client, c.parent.device.id, next.data_stream_id);
      }
      if (!id) {
        throw new ConflictException('Không thể sinh mã cảm biến duy nhất; thử lại');
      }
    }
    const version = await this.metadata(client, 'sensors', id),
      after = (await this.loadOnClient(client, id)).sensor;
    await this.audit(client, 'sensors', id, actor, c.sensor ? 'SensorUpdated' : 'SensorCreated', {
      proposed_by: proposedBy,
      request_id: requestId,
      version,
      before: c.sensor?.sensor ?? null,
      after,
    });
    return after;
  }
  private async streamAvailable(client: PoolClient, deviceId: string, streamId: string): Promise<void> {
    if (
      (
        await client.query('SELECT id FROM public.sensors WHERE device_id=$1 AND data_stream_id=$2', [
          deviceId,
          streamId,
        ])
      ).rowCount
    ) {
      throw new ConflictException('Device đã có data_stream_id này');
    }
  }
  private requireThresholds(next: SensorDetails): void {
    try {
      sensorThresholds(next);
    } catch {
      throw new BadRequestException(
        'Hai ngưỡng phải cùng null hoặc cùng là số với min_threshold < max_threshold',
      );
    }
  }
  private requireChanges(sensor: TestSensor, input: Partial<SensorDetails>) {
    if (!Object.entries(input).some(([key, value]) => sensor[key as keyof SensorDetails] !== value)) {
      throw new BadRequestException('Cần ít nhất một thông tin cảm biến thực sự thay đổi');
    }
  }
  private async scoped(
    client: PoolClient,
    user: UserRecord,
    column: 't.id',
    value: string,
  ): Promise<TestSensor> {
    const scope = await this.access.scopeValues(client, user),
      rows = await client.query<SensorRow>(`${SELECT_SENSOR} WHERE ${ZONE_READ_SCOPE} AND ${column}=$4`, [
        ...scope,
        value,
      ]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy cảm biến trong phạm vi truy cập');
    }
    return mapSensor(rows.rows[0]).sensor;
  }
  private async request(client: PoolClient, id: string, lock = false) {
    if (lock) {
      await client.query(
        "SELECT id FROM technical.workflow_requests WHERE module='sensors' AND id=$1 FOR UPDATE",
        [id],
      );
    }
    const rows = await client.query<SensorRequestRow>(`${SELECT_REQUEST} AND id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy đề xuất cảm biến');
    }
    return mapSensorRequest(rows.rows[0]);
  }
  private async context(
    client: PoolClient,
    actor: string,
    target: { deviceId?: string; sensorId?: string; requestId?: string },
  ): Promise<Context> {
    const hint = target.requestId ? await this.request(client, target.requestId) : null,
      sensorId = target.sensorId ?? hint?.value.sensor_id;
    const sensorHint = sensorId ? await this.loadOnClient(client, sensorId) : null;
    const deviceId = target.deviceId ?? hint?.value.device_id ?? sensorHint!.sensor.device_id;
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
    const sensor = sensorId ? await this.loadOnClient(client, sensorId, true) : null,
      request = target.requestId ? await this.request(client, target.requestId, true) : null;
    if (parent.device.zone_id !== c.zone.id || (sensor && sensor.sensor.device_id !== parent.device.id)) {
      throw new Error('Persisted Sensor parent mismatch');
    }
    if (request && JSON.stringify(request) !== JSON.stringify(hint)) {
      throw new RetryDomainContext();
    }
    if (request && (request.value.device_id !== parent.device.id || request.value.zone_id !== c.zone.id)) {
      throw new Error('Persisted Sensor request parent mismatch');
    }
    return { ...c, parent, sensor, request };
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
      throw new Error('Invalid or exhausted Sensor version');
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
        if (pg.code === '23505' && pg.constraint === 'sensor_one_pending_update') {
          throw new ConflictException('Cảm biến đã có đề xuất sửa Pending');
        }
        throw new ServiceUnavailableException('Không thể truy cập dữ liệu cảm biến; vui lòng thử lại sau');
      }
    }
    throw new ConflictException('Dữ liệu cảm biến vừa thay đổi; hãy tải lại');
  }
}
