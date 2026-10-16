import { ZoneDetailsDto, UpdateZoneDto } from '../zones/zones.dto';
import { TestZone, ZoneChangeRequest } from '../zones/zones.types';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { FARM_REQUEST_STATUSES, RejectFarmRequestDto } from '../farms/farms.dto';
import { decimalNumber, safeInteger, utcIso } from './mappers';

export const ZONE_FIELDS = ['standard_id', 'zone_name', 'area_size', 'longitude', 'latitude'] as const;
export interface ZoneRow extends Omit<TestZone, 'area_size' | 'longitude' | 'latitude'> {
  area_size: string | number;
  longitude: string | number;
  latitude: string | number;
  entity_version: string | null;
}
export interface ZoneSnapshot {
  zone: TestZone;
  version: number;
}
export interface ZoneRequestRow {
  id: string;
  action: ZoneChangeRequest['action'];
  status: ZoneChangeRequest['status'];
  target_key: string | null;
  requested_by: string;
  expected_version: string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  payload: Pick<
    ZoneChangeRequest,
    'farm_id' | 'owner_id' | 'proposed_changes' | 'zone_snapshot' | 'rejection_reason'
  >;
}
export interface StoredZoneRequest {
  value: ZoneChangeRequest;
  version: number | null;
}
function invariant(condition: boolean): asserts condition {
  if (!condition) {
    throw new Error('Invalid persisted Zone state');
  }
}
function id(value: string): string {
  invariant(farmUuid(value) === value);
  return value;
}
function time(value: Date | string) {
  return utcIso(value instanceof Date ? value : new Date(value));
}
export function validateZoneSnapshot(zone: TestZone): void {
  invariant(Boolean(zone) && typeof zone === 'object' && !Array.isArray(zone));
  invariant(
    Object.keys(zone).length === 7 &&
      Object.keys(zone).every((key) => ['id', 'farm_id', ...ZONE_FIELDS].includes(key)),
  );
  id(zone.id);
  id(zone.farm_id);
  id(zone.standard_id);
  farmInput(ZoneDetailsDto, {
    standard_id: zone.standard_id,
    zone_name: zone.zone_name,
    area_size: zone.area_size,
    longitude: zone.longitude,
    latitude: zone.latitude,
  });
}
export function mapZone(row: ZoneRow): ZoneSnapshot {
  try {
    const zone: TestZone = {
      id: row.id,
      farm_id: row.farm_id,
      standard_id: row.standard_id,
      zone_name: row.zone_name,
      area_size: decimalNumber(row.area_size),
      longitude: decimalNumber(row.longitude),
      latitude: decimalNumber(row.latitude),
    };
    validateZoneSnapshot(zone);
    const version = row.entity_version === null ? 0 : safeInteger(row.entity_version);
    invariant(version >= 1);
    return { zone, version };
  } catch {
    throw new Error('Invalid persisted Zone record');
  }
}
export function mapZoneRequest(row: ZoneRequestRow): StoredZoneRequest {
  try {
    invariant(['Create', 'Update'].includes(row.action) && FARM_REQUEST_STATUSES.includes(row.status));
    const p = row.payload;
    const keys = ['farm_id', 'owner_id', 'proposed_changes', 'zone_snapshot', 'rejection_reason'];
    invariant(
      Boolean(p) &&
        typeof p === 'object' &&
        Object.keys(p).length === keys.length &&
        Object.keys(p).every((key) => keys.includes(key)),
    );
    const value: ZoneChangeRequest = {
      id: id(row.id),
      action: row.action,
      status: row.status,
      farm_id: id(p.farm_id),
      owner_id: id(p.owner_id),
      zone_id: row.target_key === null ? null : id(row.target_key),
      proposed_by: id(row.requested_by),
      proposed_changes: structuredClone(p.proposed_changes),
      zone_snapshot: structuredClone(p.zone_snapshot),
      created_at: time(row.created_at),
      resolved_at: row.resolved_at === null ? null : time(row.resolved_at),
      resolved_by: row.resolved_by === null ? null : id(row.resolved_by),
      rejection_reason: p.rejection_reason,
    };
    invariant(
      Boolean(p.proposed_changes) &&
        typeof p.proposed_changes === 'object' &&
        !Array.isArray(p.proposed_changes),
    );
    invariant(
      Object.keys(p.proposed_changes).every((key) => (ZONE_FIELDS as readonly string[]).includes(key)),
    );
    if (p.proposed_changes.standard_id !== undefined) {
      id(p.proposed_changes.standard_id);
    }
    if (value.action === 'Create') {
      farmInput(ZoneDetailsDto, value.proposed_changes as ZoneDetailsDto);
      invariant(row.expected_version === null && value.zone_snapshot === null);
      invariant((value.status === 'Accepted') === (value.zone_id !== null));
    } else {
      farmInput(UpdateZoneDto, value.proposed_changes);
      invariant(
        Object.keys(value.proposed_changes).length > 0 &&
          row.expected_version !== null &&
          value.zone_id !== null &&
          value.zone_snapshot !== null,
      );
      validateZoneSnapshot(value.zone_snapshot);
      invariant(value.zone_snapshot.id === value.zone_id && value.zone_snapshot.farm_id === value.farm_id);
    }
    const version = row.expected_version === null ? null : safeInteger(row.expected_version);
    invariant(version === null || version >= 1);
    if (value.status === 'Pending') {
      invariant(value.resolved_by === null && value.resolved_at === null && value.rejection_reason === null);
    } else {
      invariant(value.resolved_at !== null && value.resolved_by === value.owner_id);
      if (value.status === 'Accepted') {
        invariant(value.rejection_reason === null);
      } else if (value.rejection_reason !== null) {
        farmInput(RejectFarmRequestDto, { reason: value.rejection_reason });
      }
    }
    return { value, version };
  } catch {
    throw new Error('Invalid persisted Zone workflow');
  }
}
export function zoneRequestPayload(value: ZoneChangeRequest): ZoneRequestRow['payload'] {
  const { farm_id, owner_id, proposed_changes, zone_snapshot, rejection_reason } = value;
  return { farm_id, owner_id, proposed_changes, zone_snapshot, rejection_reason };
}
