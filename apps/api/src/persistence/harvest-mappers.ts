import { farmInput, farmUuid } from '../farms/farm-validation';
import { RejectFarmRequestDto } from '../farms/farms.dto';
import {
  HarvestDetailsDto,
  UpdateHarvestDto,
  HarvestCorrectionDto,
} from '../tree-harvests/tree-harvests.dto';
import {
  HarvestBackdatePermission,
  HarvestDetails,
  HarvestRequest,
  TestTreeHarvest,
} from '../tree-harvests/tree-harvests.types';
import { harvestDateEpoch } from '../tree-harvests/harvest-date-policy';
import { decimalNumber, safeInteger, utcIso } from './mappers';

export const HARVEST_FIELDS = [
  'season_name',
  'harvest_date',
  'fruit_count',
  'total_weight_kg',
  'batch_code',
] as const;
export interface HarvestRow extends Omit<TestTreeHarvest, 'total_weight_kg' | 'created_at' | 'updated_at'> {
  total_weight_kg: string | number;
  created_at: Date | string;
  updated_at: Date | string | null;
  entity_version: string | null;
  data: { ever_confirmed?: unknown } | null;
}
export interface HarvestSnapshot {
  record: TestTreeHarvest;
  version: number;
  everConfirmed: boolean;
}
export interface HarvestRequestRow {
  id: string;
  action: HarvestRequest['action'];
  status: HarvestRequest['status'];
  target_key: string;
  requested_by: string;
  expected_version: string | null;
  payload: Pick<
    HarvestRequest,
    | 'editor_id'
    | 'owner_id'
    | 'cooperative_id'
    | 'reason'
    | 'proposed_changes'
    | 'harvest_snapshot'
    | 'rejection_reason'
  >;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  request_version: string | null;
}
export interface HarvestPermissionRow {
  id: string;
  action: string;
  status: string;
  target_key: string;
  requested_by: string;
  expected_version: string | null;
  payload: Pick<
    HarvestBackdatePermission,
    'user_id' | 'harvest_date' | 'expires_at' | 'reason' | 'revoked_at'
  >;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  request_version: string | null;
}
function invariant(value: boolean): asserts value {
  if (!value) {
    throw new Error('Invalid persisted Harvest state');
  }
}
function id(value: string) {
  invariant(farmUuid(value) === value);
  return value;
}
function time(value: Date | string) {
  return utcIso(value instanceof Date ? value : new Date(value));
}
function canonicalTime(value: string) {
  invariant(typeof value === 'string' && time(value) === value);
  return value;
}
function version(value: string | null) {
  invariant(value !== null);
  const result = safeInteger(value);
  invariant(result >= 1);
  return result;
}
function objectKeys(value: object, keys: string[]) {
  invariant(
    Boolean(value) &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      Object.keys(value).every((key) => keys.includes(key)),
  );
}
export function harvestDetails(input: HarvestDetails): HarvestDetails {
  return Object.fromEntries(HARVEST_FIELDS.map((key) => [key, input[key]])) as unknown as HarvestDetails;
}
export function validateHarvestSnapshot(record: TestTreeHarvest): void {
  objectKeys(record, [
    'id',
    'tree_id',
    'created_by',
    'status',
    'updated_by',
    'updated_at',
    'created_at',
    ...HARVEST_FIELDS,
  ]);
  id(record.id);
  id(record.tree_id);
  id(record.created_by);
  invariant(['Draft', 'Pending', 'Confirmed'].includes(record.status));
  farmInput(HarvestDetailsDto, harvestDetails(record));
  harvestDateEpoch(record.harvest_date);
  canonicalTime(record.created_at);
  invariant((record.updated_by === null) === (record.updated_at === null));
  if (record.updated_by !== null) {
    id(record.updated_by);
    canonicalTime(record.updated_at!);
  }
  if (record.status === 'Draft') {
    invariant(record.updated_by === null);
  }
}
export function mapHarvest(row: HarvestRow): HarvestSnapshot {
  try {
    const details = { ...row, total_weight_kg: decimalNumber(row.total_weight_kg) };
    const record: TestTreeHarvest = {
      id: row.id,
      tree_id: row.tree_id,
      created_by: row.created_by,
      ...harvestDetails(details),
      status: row.status,
      updated_by: row.updated_by,
      updated_at: row.updated_at === null ? null : time(row.updated_at),
      created_at: time(row.created_at),
    };
    validateHarvestSnapshot(record);
    invariant(typeof row.data?.ever_confirmed === 'boolean');
    const everConfirmed = row.data.ever_confirmed;
    if (record.status === 'Confirmed') {
      invariant(everConfirmed);
    }
    if (record.status === 'Draft') {
      invariant(!everConfirmed);
    }
    if (!everConfirmed) {
      invariant(record.updated_by === null);
    }
    return { record, version: version(row.entity_version), everConfirmed };
  } catch {
    throw new Error('Invalid persisted Harvest record');
  }
}
export function harvestRequestPayload(value: HarvestRequest): HarvestRequestRow['payload'] {
  const {
    editor_id,
    owner_id,
    cooperative_id,
    reason,
    proposed_changes,
    harvest_snapshot,
    rejection_reason,
  } = value;
  return {
    editor_id,
    owner_id,
    cooperative_id,
    reason,
    proposed_changes,
    harvest_snapshot,
    rejection_reason,
  };
}
export function mapHarvestRequest(row: HarvestRequestRow): { value: HarvestRequest; version: number } {
  try {
    version(row.request_version);
    invariant(
      ['Confirm', 'Correct'].includes(row.action) && ['Pending', 'Accepted', 'Rejected'].includes(row.status),
    );
    const p = row.payload;
    objectKeys(p, [
      'editor_id',
      'owner_id',
      'cooperative_id',
      'reason',
      'proposed_changes',
      'harvest_snapshot',
      'rejection_reason',
    ]);
    const value: HarvestRequest = {
      ...structuredClone(p),
      id: id(row.id),
      harvest_id: id(row.target_key),
      action: row.action,
      status: row.status,
      requested_by: id(row.requested_by),
      created_at: time(row.created_at),
      resolved_at: row.resolved_at === null ? null : time(row.resolved_at),
      resolved_by: row.resolved_by === null ? null : id(row.resolved_by),
    };
    id(value.owner_id);
    if (value.cooperative_id !== null) {
      id(value.cooperative_id);
    }
    validateHarvestSnapshot(value.harvest_snapshot);
    invariant(value.harvest_snapshot.id === value.harvest_id);
    if (value.action === 'Confirm') {
      invariant(
        value.harvest_snapshot.status === 'Draft' &&
          value.requested_by === value.harvest_snapshot.created_by &&
          value.editor_id === null &&
          value.reason === null &&
          value.proposed_changes === null,
      );
    } else {
      invariant(value.harvest_snapshot.status === 'Confirmed' && value.reason !== null);
      farmInput(HarvestCorrectionDto, { reason: value.reason });
      invariant((value.editor_id === null) === (value.proposed_changes === null));
      if (value.editor_id !== null) {
        id(value.editor_id);
        farmInput(UpdateHarvestDto, value.proposed_changes!);
        invariant(Object.keys(value.proposed_changes!).length > 0);
        if (value.proposed_changes!.harvest_date !== undefined) {
          harvestDateEpoch(value.proposed_changes!.harvest_date);
        }
      }
    }
    if (value.status === 'Pending') {
      invariant(value.resolved_by === null && value.resolved_at === null && value.rejection_reason === null);
    } else {
      invariant(value.resolved_by !== null && value.resolved_at !== null);
      if (value.status === 'Accepted') {
        invariant(
          value.rejection_reason === null &&
            (value.action !== 'Confirm' || value.resolved_by === value.owner_id),
        );
      } else if (value.rejection_reason !== null) {
        farmInput(RejectFarmRequestDto, { reason: value.rejection_reason });
      }
    }
    return { value, version: version(row.expected_version) };
  } catch {
    throw new Error('Invalid persisted Harvest workflow');
  }
}
export function mapHarvestPermission(row: HarvestPermissionRow): HarvestBackdatePermission {
  try {
    version(row.request_version);
    invariant(
      row.action === 'Grant' && ['Active', 'Revoked'].includes(row.status) && row.expected_version === null,
    );
    const p = row.payload;
    objectKeys(p, ['user_id', 'harvest_date', 'expires_at', 'reason', 'revoked_at']);
    const value: HarvestBackdatePermission = {
      ...structuredClone(p),
      id: id(row.id),
      zone_id: id(row.target_key),
      granted_by: id(row.requested_by),
      created_at: time(row.created_at),
    };
    id(value.user_id);
    harvestDateEpoch(value.harvest_date);
    canonicalTime(value.expires_at);
    invariant(Date.parse(value.expires_at) > Date.parse(value.created_at));
    farmInput(RejectFarmRequestDto, { reason: value.reason });
    invariant(typeof value.reason === 'string');
    if (row.status === 'Active') {
      invariant(value.revoked_at === null && row.resolved_at === null && row.resolved_by === null);
    } else {
      canonicalTime(value.revoked_at!);
      invariant(
        row.resolved_at !== null && time(row.resolved_at) === value.revoked_at && row.resolved_by !== null,
      );
      id(row.resolved_by!);
    }
    return value;
  } catch {
    throw new Error('Invalid persisted Harvest backdate permission');
  }
}
