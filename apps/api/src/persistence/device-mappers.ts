import {
  TestDevice,
  DeviceDetails,
  DeviceCreationDetails,
  DeviceChangeRequest,
  DeviceMetadataHistory,
} from '../devices/devices.types';
import { CreateDeviceDto, UpdateDeviceDto } from '../devices/devices.dto';
import { RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { decimalNumber, safeInteger, utcIso } from './mappers';

export const DEVICE_FIELDS = ['installed_at', 'cost', 'status'] as const;
export interface DeviceRow extends Omit<TestDevice, 'installed_at' | 'cost' | 'last_seen_at'> {
  installed_at: Date | string;
  cost: string | number;
  last_seen_at: Date | string | null;
  entity_version: string | null;
}
export interface DeviceSnapshot {
  device: TestDevice;
  version: number;
}
export interface DeviceRequestRow {
  id: string;
  action: DeviceChangeRequest['action'];
  status: DeviceChangeRequest['status'];
  target_key: string | null;
  requested_by: string;
  expected_version: string | null;
  request_version: string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  payload: Pick<
    DeviceChangeRequest,
    'zone_id' | 'farm_id' | 'owner_id' | 'proposed_changes' | 'device_snapshot' | 'rejection_reason'
  >;
}
export interface DeviceHistoryRow {
  id: string;
  entity_key: string;
  actor_id: string;
  action: 'DeviceCreated' | 'DeviceUpdated';
  changed_at: Date | string;
  payload: Pick<DeviceMetadataHistory, 'proposed_by' | 'request_id' | 'version' | 'before' | 'after'>;
}
function invariant(value: boolean): asserts value {
  if (!value) {
    throw new Error('Invalid persisted Device state');
  }
}
function id(value: string) {
  invariant(farmUuid(value) === value);
  return value;
}
function time(value: Date | string) {
  return utcIso(value instanceof Date ? value : new Date(value));
}
export function validateDevice(device: TestDevice): void {
  invariant(Boolean(device) && typeof device === 'object' && !Array.isArray(device));
  invariant(
    Object.keys(device).length === 7 &&
      Object.keys(device).every((key) =>
        ['id', 'zone_id', 'station_id', 'last_seen_at', ...DEVICE_FIELDS].includes(key),
      ),
  );
  id(device.id);
  id(device.zone_id);
  farmInput(CreateDeviceDto, {
    zone_id: device.zone_id,
    station_id: device.station_id,
    ...Object.fromEntries(DEVICE_FIELDS.map((key) => [key, device[key]])),
  } as CreateDeviceDto);
  invariant(time(device.installed_at) === device.installed_at);
  invariant(device.last_seen_at === null || time(device.last_seen_at) === device.last_seen_at);
}
export function mapDevice(row: DeviceRow): DeviceSnapshot {
  try {
    const device: TestDevice = {
      id: row.id,
      zone_id: row.zone_id,
      station_id: row.station_id,
      installed_at: time(row.installed_at),
      cost: decimalNumber(row.cost),
      status: row.status,
      last_seen_at: row.last_seen_at === null ? null : time(row.last_seen_at),
    };
    validateDevice(device);
    invariant(row.entity_version !== null);
    const version = safeInteger(row.entity_version);
    invariant(version >= 1);
    return { device, version };
  } catch {
    throw new Error('Invalid persisted Device record');
  }
}
export function deviceRequestPayload(value: DeviceChangeRequest): DeviceRequestRow['payload'] {
  const { zone_id, farm_id, owner_id, proposed_changes, device_snapshot, rejection_reason } = value;
  return { zone_id, farm_id, owner_id, proposed_changes, device_snapshot, rejection_reason };
}
export function mapDeviceRequest(row: DeviceRequestRow): {
  value: DeviceChangeRequest;
  version: number | null;
  requestVersion: number;
} {
  try {
    invariant(
      ['Create', 'Update'].includes(row.action) && ['Pending', 'Accepted', 'Rejected'].includes(row.status),
    );
    const p = row.payload,
      keys = ['zone_id', 'farm_id', 'owner_id', 'proposed_changes', 'device_snapshot', 'rejection_reason'];
    invariant(
      Boolean(p) &&
        typeof p === 'object' &&
        Object.keys(p).length === 6 &&
        Object.keys(p).every((key) => keys.includes(key)),
    );
    const value: DeviceChangeRequest = {
      ...structuredClone(p),
      id: id(row.id),
      action: row.action,
      status: row.status,
      device_id: row.target_key === null ? null : id(row.target_key),
      proposed_by: id(row.requested_by),
      created_at: time(row.created_at),
      resolved_at: row.resolved_at === null ? null : time(row.resolved_at),
      resolved_by: row.resolved_by === null ? null : id(row.resolved_by),
    };
    id(value.zone_id);
    id(value.farm_id);
    id(value.owner_id);
    const changes = value.proposed_changes;
    invariant(
      Boolean(changes) &&
        typeof changes === 'object' &&
        !Array.isArray(changes) &&
        Object.keys(changes).every((key) =>
          [...DEVICE_FIELDS, ...(value.action === 'Create' ? ['station_id'] : [])].includes(key),
        ),
    );
    if (changes.installed_at !== undefined) {
      invariant(time(changes.installed_at) === changes.installed_at);
    }
    invariant(row.request_version !== null);
    const requestVersion = safeInteger(row.request_version);
    invariant(requestVersion >= 1);
    const version = row.expected_version === null ? null : safeInteger(row.expected_version);
    if (value.action === 'Create') {
      farmInput(CreateDeviceDto, { ...changes, zone_id: value.zone_id } as CreateDeviceDto);
      invariant(changes.status !== undefined);
      invariant(
        version === null &&
          value.device_snapshot === null &&
          (value.status === 'Accepted') === (value.device_id !== null),
      );
    } else {
      farmInput(UpdateDeviceDto, changes);
      invariant(
        Object.keys(changes).length > 0 &&
          version !== null &&
          version >= 1 &&
          value.device_id !== null &&
          value.device_snapshot !== null,
      );
      validateDevice(value.device_snapshot);
      invariant(
        value.device_snapshot.id === value.device_id && value.device_snapshot.zone_id === value.zone_id,
      );
      invariant(
        Object.entries(changes).some(
          ([key, value]) => value !== row.payload.device_snapshot![key as keyof DeviceDetails],
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
    throw new Error('Invalid persisted Device workflow');
  }
}
export function mapDeviceHistory(row: DeviceHistoryRow): DeviceMetadataHistory {
  try {
    invariant(['DeviceCreated', 'DeviceUpdated'].includes(row.action));
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
    validateDevice(p.after);
    invariant(p.after.id === id(row.entity_key));
    if (row.action === 'DeviceCreated') {
      invariant(p.before === null && version === 1);
    } else {
      invariant(p.before !== null && version >= 2);
      validateDevice(p.before);
      invariant(
        p.before.id === p.after.id &&
          p.before.zone_id === p.after.zone_id &&
          p.before.station_id === p.after.station_id,
      );
    }
    invariant((p.proposed_by === null) === (p.request_id === null));
    if (p.proposed_by !== null) {
      id(p.proposed_by);
      id(p.request_id!);
    }
    return {
      id: id(row.id),
      device_id: row.entity_key,
      action: row.action === 'DeviceCreated' ? 'Create' : 'Update',
      actor_id: id(row.actor_id),
      changed_at: time(row.changed_at),
      ...structuredClone(p),
      version,
    };
  } catch {
    throw new Error('Invalid persisted Device history');
  }
}
export function deviceChanges(input: Partial<DeviceCreationDetails>): Partial<DeviceCreationDetails> {
  return Object.fromEntries(
    [...DEVICE_FIELDS, 'station_id' as const]
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
}
