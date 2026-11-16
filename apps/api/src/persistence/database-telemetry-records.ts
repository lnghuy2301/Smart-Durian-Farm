import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { Pool, PoolClient } from 'pg';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { SensorReading } from '../mqtt/mqtt.protocol';
import { TelemetryLatestDto, TelemetryHistoryDto } from '../telemetry/telemetry.dto';
import { TelemetryRecords } from '../telemetry/telemetry-records';
import { TelemetryPage, TelemetryRecord } from '../telemetry/telemetry.types';
import { TELEMETRY_READING_LIMIT } from '../telemetry/telemetry.store';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresDevicesRepository } from './postgres-devices.repository';
import { PostgresSensorsRepository } from './postgres-sensors.repository';
import { PostgresAssignmentsRepository } from './postgres-assignments.repository';
import { PostgresDomainAccess, RetryDomainContext } from './domain-access';
import { ZONE_READ_SCOPE } from './zone-read-scope';
import { MongoTelemetryStore } from './mongo-telemetry.store';
import { inPostgresTransaction } from './transactions';

// PostgreSQL supplies current identity/permissions; only Mongo stores readings.
// PG transactions below hold locks but perform NO business writes, so this is
// not a cross-database atomic commit or a second metadata authority.
export class DatabaseTelemetryRecords extends TelemetryRecords {
  private readonly access: PostgresDomainAccess;
  constructor(
    private readonly pool: Pool,
    users: PostgresUsersRepository,
    farms: PostgresFarmsRepository,
    zones: PostgresZonesRepository,
    private readonly devices: PostgresDevicesRepository,
    private readonly sensors: PostgresSensorsRepository,
    private readonly assignments: PostgresAssignmentsRepository,
    private readonly store: MongoTelemetryStore,
    private readonly clock: () => Date = () => new Date(),
  ) {
    super();
    this.access = new PostgresDomainAccess(users, farms, zones);
  }
  async record(deviceId: string, input: SensorReading[], measuredAt: string): Promise<void> {
    if (!Array.isArray(input)) {
      throw new BadRequestException('Danh sách readings không hợp lệ');
    }
    if (!input.length) {
      return;
    }
    deviceId = farmUuid(deviceId);
    const readings = structuredClone(input),
      measuredEpoch = Date.parse(measuredAt);
    await this.transaction(async (client) => {
      // Ingestion has no HTTP actor. Lock Device then Sensors and never take
      // user/parent locks afterward, so metadata edits cannot invert the order.
      const device = (await this.devices.loadOnClient(client, deviceId, true)).device;
      if (device.status !== 'Active') {
        return;
      }
      if (!Number.isFinite(measuredEpoch)) {
        throw new BadRequestException('Thời gian đọc MQTT không hợp lệ');
      }
      const streams = new Set<string>();
      for (const reading of readings) {
        if (
          !reading ||
          typeof reading.dataStreamId !== 'string' ||
          !/^[A-Za-z0-9_-]{1,50}$/.test(reading.dataStreamId) ||
          streams.has(reading.dataStreamId) ||
          typeof reading.value !== 'number' ||
          !Number.isFinite(reading.value) ||
          typeof reading.receivedUnit !== 'string' ||
          reading.receivedUnit.length < 1 ||
          reading.receivedUnit.length > 16
        ) {
          throw new BadRequestException('Reading nội bộ không hợp lệ');
        }
        streams.add(reading.dataStreamId);
      }
      await client.query(
        'SELECT id FROM public.sensors WHERE device_id=$1 AND data_stream_id=ANY($2::text[]) ORDER BY id FOR UPDATE',
        [deviceId, [...streams]],
      );
      for (const stream of streams) {
        if ((await this.sensors.loadByStreamOnClient(client, deviceId, stream)).sensor.status !== 'Active') {
          throw new BadRequestException('Sensor không Active');
        }
      }
      const receivedAt = this.clock().toISOString();
      const records = readings.map((reading): TelemetryRecord => ({
        _id: new ObjectId().toHexString(),
        device_id: deviceId,
        data_stream_id: reading.dataStreamId,
        measured_at: new Date(measuredEpoch).toISOString(),
        received_at: receivedAt,
        value: reading.value,
        unit: reading.receivedUnit,
      }));
      // Validate whole packet before this sole write. Raw units are immutable
      // historical data even if Sensor.unit changes or differs from hardware.
      await this.store.append(records);
    });
  }
  async latest(actor: string, deviceId: string, input: TelemetryLatestDto): Promise<TelemetryPage> {
    const query = farmInput(TelemetryLatestDto, input);
    return this.read(actor, deviceId, query, (records) => {
      const seen = new Set<string>();
      return records.filter((record) => {
        if (seen.has(record.data_stream_id)) return false;
        seen.add(record.data_stream_id);
        return true;
      });
    });
  }
  async history(actor: string, deviceId: string, input: TelemetryHistoryDto): Promise<TelemetryPage> {
    const query = farmInput(TelemetryHistoryDto, input),
      from = query.from === undefined ? -Infinity : Date.parse(query.from),
      to = query.to === undefined ? Infinity : Date.parse(query.to);
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to) {
      throw new BadRequestException('Khoảng from/to phải hợp lệ và from < to');
    }
    return this.read(actor, deviceId, query, (records) =>
      records.filter((record) => {
        const t = Date.parse(record.received_at);
        return t >= from && t < to;
      }),
    );
  }
  private async read(
    actor: string,
    deviceId: string,
    query: TelemetryLatestDto,
    select: (records: TelemetryRecord[]) => TelemetryRecord[],
  ): Promise<TelemetryPage> {
    actor = farmUuid(actor);
    deviceId = farmUuid(deviceId);
    return this.transaction(async (client) => {
      const hint = (await this.devices.loadOnClient(client, deviceId)).device,
        context = await this.access.lockZone(client, actor, hint.zone_id),
        device = (await this.devices.loadOnClient(client, deviceId, true)).device;
      if (device.zone_id !== context.zone.id) {
        throw new Error('Persisted telemetry Device parent mismatch');
      }
      const scope = await this.access.scopeValues(client, context.actor);
      const allowed = await client.query(
        `SELECT d.id FROM public.devices d JOIN public.zones z ON z.id=d.zone_id WHERE ${ZONE_READ_SCOPE} AND d.id=$4`,
        [...scope, deviceId],
      );
      if (!allowed.rowCount) {
        throw new NotFoundException('Không tìm thấy Device trong phạm vi truy cập');
      }
      let start = -Infinity,
        end = Infinity;
      if (context.actor.role === 'Farmer' && context.actor.id !== context.farm.farm.owner_id) {
        const current = await this.assignments.activeOnClient(client, actor, device.zone_id);
        if (!current) {
          throw new NotFoundException('Không có phân công đang hiệu lực tại Device');
        }
        start = Date.parse(current.assignment.start_date);
        end = current.assignment.end_date === null ? Infinity : Date.parse(current.assignment.end_date);
      }
      // Filter permission interval BEFORE latest/total/page; assignment renewal
      // cannot disclose readings from an older assignment. Locks also serialize
      // End/role/HTX changes while a consistent Mongo snapshot is being read.
      const visible = (await this.store.newestFirst()).filter(
        (record) =>
          record.device_id === deviceId &&
          (!query.data_stream_id || record.data_stream_id === query.data_stream_id) &&
          Date.parse(record.received_at) >= start &&
          Date.parse(record.received_at) < end,
      );
      const records = select(visible);
      return {
        device_id: deviceId,
        items: records.slice(query.offset, query.offset + query.limit),
        total: records.length,
        limit: query.limit,
        offset: query.offset,
        storage: { mode: 'MongoDB', capacity_readings: TELEMETRY_READING_LIMIT, eviction: 'OldestInserted' },
      };
    });
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
        throw new ServiceUnavailableException('Không thể truy cập dữ liệu telemetry; vui lòng thử lại sau');
      }
    }
    throw new ConflictException('Phạm vi Device vừa thay đổi; hãy tải lại');
  }
}
