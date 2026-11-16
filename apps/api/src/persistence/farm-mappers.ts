import { FarmChangeRequest, FarmLeaveNotification, TestFarm } from '../farms/farms.types';
import { FarmDetailsDto, FARM_REQUEST_STATUSES, RejectFarmRequestDto, UpdateFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { farmApprovals } from '../farms/farm-workflow';
import { decimalNumber, safeInteger, utcIso } from './mappers';

export interface FarmRow extends Omit<TestFarm, 'area_size' | 'longitude' | 'latitude' | 'join_cooperative_date'> {
  area_size: string | number; longitude: string | number; latitude: string | number;
  join_cooperative_date: Date | string | null; entity_version: string | null;
}
export interface FarmSnapshot { farm: TestFarm; version: number }
export interface FarmRequestRow {
  id: string; action: FarmChangeRequest['action']; status: FarmChangeRequest['status']; target_key: string | null;
  requested_by: string; expected_version: string | null; payload: Omit<FarmChangeRequest, 'id' | 'action' | 'status' | 'farm_id' | 'proposed_by' | 'created_at' | 'resolved_at'>;
  created_at: Date | string; resolved_at: Date | string | null; resolved_by: string | null;
}
export interface StoredFarmRequest { value: FarmChangeRequest; farmVersion: number | null }
export interface FarmNotificationRow {
  id: string; recipient_id: string; type: 'FarmLeftCooperative'; created_at: Date | string;
  payload: { module: 'farms'; farm_id: string; owner_id: string; cooperative_id: string; request_id: string };
}

function requireState(condition: boolean): asserts condition { if (!condition) { throw new Error('Invalid persisted Farm state'); } }
function iso(value: Date | string): string { return utcIso(value instanceof Date ? value : new Date(value)); }
function canonicalId(id: string): string { requireState(farmUuid(id) === id); return id; }
function canonicalDate(value: string): void { requireState(typeof value === 'string' && iso(value) === value); }

export function mapFarm(row: FarmRow): FarmSnapshot {
  try {
    const version = row.entity_version === null ? 0 : safeInteger(row.entity_version);
    requireState(version >= 1);
    const farm: TestFarm = { id: row.id, owner_id: row.owner_id, cooperative_id: row.cooperative_id,
      join_cooperative_date: row.join_cooperative_date === null ? null : iso(row.join_cooperative_date),
      area_size: decimalNumber(row.area_size), longitude: decimalNumber(row.longitude), latitude: decimalNumber(row.latitude),
      address: row.address, certificate_number: row.certificate_number };
    validateFarmShape(farm);
    return { farm, version };
  } catch { throw new Error('Invalid persisted Farm record'); }
}

function validateFarmShape(farm: TestFarm) {
  canonicalId(farm.id); canonicalId(farm.owner_id);
  if (farm.cooperative_id !== null) { canonicalId(farm.cooperative_id); }
  if (farm.join_cooperative_date !== null) { canonicalDate(farm.join_cooperative_date); }
  requireState((farm.cooperative_id === null) === (farm.join_cooperative_date === null));
  farmInput(FarmDetailsDto, { area_size: farm.area_size, address: farm.address, certificate_number: farm.certificate_number,
    longitude: farm.longitude, latitude: farm.latitude });
}

// JSONB là dữ liệu backend, không phải DTO client. Corrupt state phải chặn
// thao tác với503; không đoán/chữa chữ ký hoặc biến payload lỗi thành400 client.
export function mapFarmRequest(row: FarmRequestRow): StoredFarmRequest {
  try {
    requireState(['Create', 'Update', 'Join', 'Leave'].includes(row.action) && FARM_REQUEST_STATUSES.includes(row.status));
    const payload = row.payload;
    requireState(Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload));
    const keys = ['owner_id', 'proposed_role', 'proposed_changes', 'cooperative_id', 'required_approvals', 'farm_snapshot', 'rejected_by', 'rejection_reason'];
    requireState(Object.keys(payload).length === keys.length && Object.keys(payload).every((key) => keys.includes(key)));
    const value: FarmChangeRequest = { id: canonicalId(row.id), action: row.action, status: row.status,
      farm_id: row.target_key === null ? null : canonicalId(row.target_key), proposed_by: canonicalId(row.requested_by),
      owner_id: canonicalId(payload.owner_id), proposed_role: payload.proposed_role, proposed_changes: structuredClone(payload.proposed_changes),
      cooperative_id: payload.cooperative_id === null ? null : canonicalId(payload.cooperative_id),
      required_approvals: structuredClone(payload.required_approvals), farm_snapshot: structuredClone(payload.farm_snapshot),
      created_at: iso(row.created_at), resolved_at: row.resolved_at === null ? null : iso(row.resolved_at),
      rejected_by: payload.rejected_by, rejection_reason: payload.rejection_reason };
    requireState(['Admin', 'Farmer'].includes(value.proposed_role));
    requireState(value.proposed_role !== 'Farmer' || value.proposed_by === value.owner_id);
    requireState(Boolean(value.proposed_changes) && typeof value.proposed_changes === 'object' && !Array.isArray(value.proposed_changes));
    if (value.action === 'Create') {
      farmInput(FarmDetailsDto, value.proposed_changes as FarmDetailsDto);
      requireState(row.expected_version === null && value.farm_snapshot === null && value.cooperative_id === null);
      requireState((value.status === 'Accepted') === (value.farm_id !== null));
    } else {
      requireState(value.farm_id !== null && value.farm_snapshot !== null && row.expected_version !== null);
      validateFarmShape(value.farm_snapshot);
      requireState(value.farm_snapshot.id === value.farm_id && value.farm_snapshot.owner_id === value.owner_id);
      if (value.action === 'Update') {
        requireState(Object.keys(value.proposed_changes).every((key) => ['area_size', 'address', 'certificate_number', 'longitude', 'latitude'].includes(key)));
        farmInput(UpdateFarmRequestDto, value.proposed_changes);
        requireState(Object.keys(value.proposed_changes).length > 0 && value.cooperative_id === value.farm_snapshot.cooperative_id);
      } else {
        requireState(Object.keys(value.proposed_changes).length === 0 && value.cooperative_id !== null);
        requireState(value.action === 'Join' ? value.farm_snapshot.cooperative_id === null : value.farm_snapshot.cooperative_id === value.cooperative_id);
      }
    }
    requireState(Array.isArray(value.required_approvals));
    const manager = value.required_approvals.find((approval) => approval.role === 'Manager')?.user_id;
    requireState(value.action !== 'Join' || Boolean(manager));
    const expected = farmApprovals(value.proposed_role, value.owner_id, value.action === 'Join' ? manager! : undefined);
    requireState(value.required_approvals.length === expected.length);
    value.required_approvals.forEach((approval, index) => {
      requireState(Object.keys(approval).length === 4 && Object.keys(approval).every((key) => ['role', 'user_id', 'approved_by', 'approved_at'].includes(key)));
      requireState(approval.role === expected[index].role && approval.user_id === expected[index].user_id);
      if (approval.user_id !== null) { canonicalId(approval.user_id); }
      requireState((approval.approved_by === null) === (approval.approved_at === null));
      if (approval.approved_by !== null) {
        canonicalId(approval.approved_by); canonicalDate(approval.approved_at!);
        requireState(approval.approved_by !== value.proposed_by && (!approval.user_id || approval.user_id === approval.approved_by));
      }
    });
    if (value.status === 'Pending') { requireState(value.resolved_at === null && row.resolved_by === null && value.rejected_by === null && value.rejection_reason === null); }
    else {
      requireState(value.resolved_at !== null && row.resolved_by !== null); canonicalId(row.resolved_by!);
      if (value.status === 'Accepted') {
        requireState(value.required_approvals.every((approval) => approval.approved_by !== null));
        requireState(value.required_approvals.some((approval) => approval.approved_by === row.resolved_by));
        requireState(value.rejected_by === null && value.rejection_reason === null);
      } else {
        requireState(value.rejected_by === row.resolved_by);
        // Dùng cùng MaxLength DTO (Unicode), không đếm UTF-16 code units bằng
        // string.length khiến reason hợp lệ chứa emoji bị coi là corrupt.
        if (value.rejection_reason !== null) { farmInput(RejectFarmRequestDto, { reason: value.rejection_reason }); }
      }
    }
    const farmVersion = row.expected_version === null ? null : safeInteger(row.expected_version);
    requireState(farmVersion === null || farmVersion >= 1);
    return { value, farmVersion };
  } catch { throw new Error('Invalid persisted Farm workflow'); }
}

export function farmRequestPayload(value: FarmChangeRequest): FarmRequestRow['payload'] {
  const { owner_id, proposed_role, proposed_changes, cooperative_id, required_approvals, farm_snapshot, rejected_by, rejection_reason } = value;
  return { owner_id, proposed_role, proposed_changes, cooperative_id, required_approvals, farm_snapshot, rejected_by, rejection_reason };
}

export function mapFarmNotification(row: FarmNotificationRow): FarmLeaveNotification {
  try {
    const p = row.payload;
    requireState(row.type === 'FarmLeftCooperative' && p.module === 'farms');
    return { id: canonicalId(row.id), recipient_id: canonicalId(row.recipient_id), type: row.type,
      farm_id: canonicalId(p.farm_id), owner_id: canonicalId(p.owner_id), cooperative_id: canonicalId(p.cooperative_id),
      request_id: canonicalId(p.request_id), created_at: iso(row.created_at) };
  } catch { throw new Error('Invalid persisted Farm notification'); }
}
