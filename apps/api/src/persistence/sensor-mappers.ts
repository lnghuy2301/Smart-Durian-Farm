import {
  TestSensor,
  SensorDetails,
  SensorCreationDetails,
  SensorChangeRequest,
  SensorMetadataHistory,
} from '../sensors/sensors.types';
import { CreateSensorDto, UpdateSensorDto } from '../sensors/sensors.dto';
import { RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { decimalNumber, safeInteger, utcIso } from './mappers';

export const SENSOR_FIELDS = ['name', 'unit', 'min_threshold', 'max_threshold', 'status'] as const;
export interface SensorRow extends Omit<TestSensor, 'min_threshold' | 'max_threshold'> {
  min_threshold: string | number | null;
  max_threshold: string | number | null;
  entity_version: string | null;
}
export interface SensorSnapshot {
  sensor: TestSensor;
  version: number;
}
export interface SensorRequestRow {
  id: string;
  action: SensorChangeRequest['action'];
  status: SensorChangeRequest['status'];
  target_key: string | null;
  requested_by: string;
  expected_version: string | null;
  request_version: string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  payload: Pick<
    SensorChangeRequest,
    | 'device_id'
    | 'zone_id'
    | 'farm_id'
    | 'owner_id'
    | 'proposed_changes'
    | 'sensor_snapshot'
    | 'rejection_reason'
  >;
}
export interface SensorHistoryRow {
  id: string;
  entity_key: string;
  actor_id: string;
  action: 'SensorCreated' | 'SensorUpdated';
  changed_at: Date | string;
  payload: Pick<SensorMetadataHistory, 'proposed_by' | 'request_id' | 'version' | 'before' | 'after'>;
}
function invariant(value: boolean): asserts value {
  if (!value) {
    throw new Error('Invalid persisted Sensor state');
  }
}
function id(value: string) {
  invariant(farmUuid(value) === value);
  return value;
}
function time(value: Date | string) {
  return utcIso(value instanceof Date ? value : new Date(value));
}
export function validateSensor(sensor: TestSensor): void {
  invariant(Boolean(sensor) && typeof sensor === 'object' && !Array.isArray(sensor));
  invariant(
    Object.keys(sensor).length === 9 &&
      Object.keys(sensor).every((key) =>
        ['id', 'device_id', 'sensor_type', 'data_stream_id', ...SENSOR_FIELDS].includes(key),
      ),
  );
  id(sensor.id);
  id(sensor.device_id);
  invariant(typeof sensor.name === 'string' && sensor.name.trim() === sensor.name);
  invariant(typeof sensor.unit === 'string' && sensor.unit.trim() === sensor.unit);
  farmInput(CreateSensorDto, {
    device_id: sensor.device_id,
    sensor_type: sensor.sensor_type,
    data_stream_id: sensor.data_stream_id,
    ...Object.fromEntries(SENSOR_FIELDS.map((key) => [key, sensor[key]])),
  } as CreateSensorDto);
  // Nullable thresholds are configuration pairs, never implicit zeroes.
  invariant(sensor.min_threshold !== undefined && sensor.max_threshold !== undefined);
  sensorThresholds(sensor);
}
export function mapSensor(row: SensorRow): SensorSnapshot {
  try {
    const sensor: TestSensor = {
      id: row.id,
      device_id: row.device_id,
      sensor_type: row.sensor_type,
      data_stream_id: row.data_stream_id,
      name: row.name,
      unit: row.unit,
      min_threshold: row.min_threshold === null ? null : decimalNumber(row.min_threshold),
      max_threshold: row.max_threshold === null ? null : decimalNumber(row.max_threshold),
      status: row.status,
    };
    validateSensor(sensor);
    invariant(row.entity_version !== null);
    const version = safeInteger(row.entity_version);
    invariant(version >= 1);
    return { sensor, version };
  } catch {
    throw new Error('Invalid persisted Sensor record');
  }
}
export function sensorRequestPayload(value: SensorChangeRequest): SensorRequestRow['payload'] {
  const { device_id, zone_id, farm_id, owner_id, proposed_changes, sensor_snapshot, rejection_reason } =
    value;
  return { device_id, zone_id, farm_id, owner_id, proposed_changes, sensor_snapshot, rejection_reason };
}
export function mapSensorRequest(row: SensorRequestRow): {
  value: SensorChangeRequest;
  version: number | null;
  requestVersion: number;
} {
  try {
    invariant(
      ['Create', 'Update'].includes(row.action) && ['Pending', 'Accepted', 'Rejected'].includes(row.status),
    );
    const p = row.payload,
      keys = [
        'device_id',
        'zone_id',
        'farm_id',
        'owner_id',
        'proposed_changes',
        'sensor_snapshot',
        'rejection_reason',
      ];
    invariant(
      Boolean(p) &&
        typeof p === 'object' &&
        Object.keys(p).length === 7 &&
        Object.keys(p).every((key) => keys.includes(key)),
    );
    const value: SensorChangeRequest = {
      ...structuredClone(p),
      id: id(row.id),
      action: row.action,
      status: row.status,
      sensor_id: row.target_key === null ? null : id(row.target_key),
      proposed_by: id(row.requested_by),
      created_at: time(row.created_at),
      resolved_at: row.resolved_at === null ? null : time(row.resolved_at),
      resolved_by: row.resolved_by === null ? null : id(row.resolved_by),
    };
    id(value.zone_id);
    id(value.device_id);
    id(value.farm_id);
    id(value.owner_id);
    const changes = value.proposed_changes;
    invariant(
      Boolean(changes) &&
        typeof changes === 'object' &&
        !Array.isArray(changes) &&
        Object.keys(changes).every((key) =>
          [
            ...SENSOR_FIELDS,
            ...(value.action === 'Create' ? ['sensor_type', 'data_stream_id'] : []),
          ].includes(key),
        ),
    );
    invariant(row.request_version !== null);
    const requestVersion = safeInteger(row.request_version);
    invariant(requestVersion >= 1);
    const version = row.expected_version === null ? null : safeInteger(row.expected_version);
    if (value.action === 'Create') {
      farmInput(CreateSensorDto, { ...changes, device_id: value.device_id } as CreateSensorDto);
      invariant(
        changes.status !== undefined &&
          changes.min_threshold !== undefined &&
          changes.max_threshold !== undefined,
      );
      sensorThresholds(changes as SensorCreationDetails);
      invariant(
        version === null &&
          value.sensor_snapshot === null &&
          (value.status === 'Accepted') === (value.sensor_id !== null),
      );
    } else {
      farmInput(UpdateSensorDto, changes);
      invariant(
        Object.keys(changes).length > 0 &&
          version !== null &&
          version >= 1 &&
          value.sensor_id !== null &&
          value.sensor_snapshot !== null,
      );
      validateSensor(value.sensor_snapshot);
      invariant(
        value.sensor_snapshot.id === value.sensor_id && value.sensor_snapshot.device_id === value.device_id,
      );
      sensorThresholds({ ...value.sensor_snapshot, ...changes });
      invariant(
        Object.entries(changes).some(
          ([key, value]) => value !== row.payload.sensor_snapshot![key as keyof SensorDetails],
        ),
      );
    }
    if (value.status === 'Pending') {
      invariant(value.resolved_by === null && value.resolved_at === null && value.rejection_reason === null);
    } else {
      invariant(value.resolved_by === value.owner_id && value.resolved_at !== null);
      if (value.status === 'Accepted') {
        invariant(value.rejection_reason === null);
      } else if (value.rejection_reason !== null) {
        farmInput(RejectFarmRequestDto, { reason: value.rejection_reason });
      }
    }
    return { value, version, requestVersion };
  } catch {
    throw new Error('Invalid persisted Sensor workflow');
  }
}
export function mapSensorHistory(row: SensorHistoryRow): SensorMetadataHistory {
  try {
    invariant(['SensorCreated', 'SensorUpdated'].includes(row.action));
    const p = row.payload,
      keys = ['proposed_by', 'request_id', 'version', 'before', 'after'];
    invariant(
      Boolean(p) &&
        typeof p === 'object' &&
        Object.keys(p).length === 5 &&
        Object.keys(p).every((key) => keys.includes(key)),
    );
    const version = safeInteger(p.version);
    invariant(version >= 1);
    validateSensor(p.after);
    invariant(p.after.id === id(row.entity_key));
    if (row.action === 'SensorCreated') {
      invariant(p.before === null && version === 1);
    } else {
      invariant(p.before !== null && version >= 2);
      validateSensor(p.before);
      invariant(
        p.before.id === p.after.id &&
          p.before.device_id === p.after.device_id &&
          p.before.sensor_type === p.after.sensor_type &&
          p.before.data_stream_id === p.after.data_stream_id,
      );
    }
    invariant((p.proposed_by === null) === (p.request_id === null));
    if (p.proposed_by !== null) {
      id(p.proposed_by);
      id(p.request_id!);
    }
    return {
      id: id(row.id),
      sensor_id: row.entity_key,
      action: row.action === 'SensorCreated' ? 'Create' : 'Update',
      actor_id: id(row.actor_id),
      changed_at: time(row.changed_at),
      ...structuredClone(p),
      version,
    };
  } catch {
    throw new Error('Invalid persisted Sensor history');
  }
}
export function sensorChanges(input: Partial<SensorCreationDetails>): Partial<SensorCreationDetails> {
  return Object.fromEntries(
    [...SENSOR_FIELDS, 'sensor_type' as const, 'data_stream_id' as const]
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
}

export function sensorThresholds(details: Pick<SensorDetails, 'min_threshold' | 'max_threshold'>): void {
  const min = details.min_threshold,
    max = details.max_threshold;
  if (min === null && max === null) {
    return;
  }
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min >= max
  ) {
    throw new Error('Invalid persisted Sensor threshold pair');
  }
}
