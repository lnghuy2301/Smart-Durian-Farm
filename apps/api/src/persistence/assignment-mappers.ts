import { AssignmentHistory, AssignmentRequest } from '../assignments/assignments.types';
import { AssignmentHistoryResponse } from '../assignments/assignment-records';
import { assignmentActive, CORRECTION_GRACE_DAYS } from '../assignments/assignment-policy';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { RejectFarmRequestDto } from '../farms/farms.dto';
import { safeInteger, utcIso } from './mappers';
import { validateZoneSnapshot } from './zone-mappers';

export interface AssignmentRow {
  id: string;
  user_id: string;
  zone_id: string;
  farm_id: string;
  start_date: Date | string;
  end_date: Date | string | null;
  entity_version: string | null;
  data: { accepted_at?: unknown; zone_snapshot?: unknown } | null;
}
export interface AssignmentRequestRow {
  id: string;
  action: AssignmentRequest['action'];
  status: AssignmentRequest['status'];
  target_key: string | null;
  requested_by: string;
  expected_version: string | null;
  payload: Omit<
    AssignmentRequest,
    'id' | 'action' | 'status' | 'proposed_by' | 'created_at' | 'resolved_at' | 'resolved_by'
  >;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  entity_version: string | null;
}
function invariant(value: boolean): asserts value {
  if (!value) {
    throw new Error('Invalid persisted assignment state');
  }
}
function id(value: string): string {
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
  invariant(value !== null && safeInteger(value) >= 1);
}

export function mapAssignment(row: AssignmentRow): AssignmentHistory {
  try {
    version(row.entity_version);
    const assignment = {
      id: id(row.id),
      user_id: id(row.user_id),
      zone_id: id(row.zone_id),
      start_date: time(row.start_date),
      end_date: row.end_date === null ? null : time(row.end_date),
    };
    invariant(
      assignment.end_date === null || Date.parse(assignment.end_date) > Date.parse(assignment.start_date),
    );
    const accepted_at = canonicalTime(row.data?.accepted_at as string);
    invariant(Date.parse(accepted_at) <= Date.parse(assignment.start_date));
    const zone_snapshot = structuredClone(row.data?.zone_snapshot) as AssignmentHistory['zone_snapshot'];
    validateZoneSnapshot(zone_snapshot);
    invariant(zone_snapshot.id === assignment.zone_id && zone_snapshot.farm_id === row.farm_id);
    return { assignment, accepted_at, zone_snapshot };
  } catch {
    throw new Error('Invalid persisted assignment record');
  }
}
export function assignmentResponse(entry: AssignmentHistory, now: number): AssignmentHistoryResponse {
  const end = entry.assignment.end_date;
  return {
    ...entry,
    active: assignmentActive(entry.assignment, now),
    correction_grace_days: CORRECTION_GRACE_DAYS,
    correction_deadline:
      end === null ? null : new Date(Date.parse(end) + CORRECTION_GRACE_DAYS * 86400000).toISOString(),
  };
}
export function assignmentRequestPayload(request: AssignmentRequest): AssignmentRequestRow['payload'] {
  const {
    zone_id,
    owner_id,
    user_id,
    proposed_role,
    start_date,
    end_date,
    assignment_id,
    zone_snapshot,
    required_approvals,
    rejection_reason,
  } = request;
  return {
    zone_id,
    owner_id,
    user_id,
    proposed_role,
    start_date,
    end_date,
    assignment_id,
    zone_snapshot,
    required_approvals,
    rejection_reason,
  };
}
export function mapAssignmentRequest(row: AssignmentRequestRow): AssignmentRequest {
  try {
    version(row.entity_version);
    invariant(
      row.expected_version === null &&
        ['Assign', 'End'].includes(row.action) &&
        ['Pending', 'Accepted', 'Rejected'].includes(row.status),
    );
    const p = row.payload;
    const keys = [
      'zone_id',
      'owner_id',
      'user_id',
      'proposed_role',
      'start_date',
      'end_date',
      'assignment_id',
      'zone_snapshot',
      'required_approvals',
      'rejection_reason',
    ];
    invariant(
      Boolean(p) &&
        typeof p === 'object' &&
        Object.keys(p).length === keys.length &&
        Object.keys(p).every((key) => keys.includes(key)),
    );
    const value: AssignmentRequest = {
      ...structuredClone(p),
      id: id(row.id),
      action: row.action,
      status: row.status,
      proposed_by: id(row.requested_by),
      created_at: time(row.created_at),
      resolved_at: row.resolved_at === null ? null : time(row.resolved_at),
      resolved_by: row.resolved_by === null ? null : id(row.resolved_by),
    };
    id(value.zone_id);
    id(value.owner_id);
    id(value.user_id);
    if (value.assignment_id !== null) {
      id(value.assignment_id);
    }
    validateZoneSnapshot(value.zone_snapshot);
    invariant(value.zone_snapshot.id === value.zone_id);
    canonicalTime(value.start_date);
    if (value.end_date !== null) {
      canonicalTime(value.end_date);
      invariant(Date.parse(value.end_date) > Date.parse(value.start_date));
    }
    invariant(value.proposed_role === 'Admin' || value.proposed_role === 'Farmer');
    invariant(value.proposed_role !== 'Farmer' || value.proposed_by === value.owner_id);
    invariant(value.action !== 'End' || (value.proposed_role === 'Admin' && value.assignment_id !== null));
    if (value.action === 'Assign') {
      invariant((value.status === 'Accepted') === (value.assignment_id !== null));
      invariant(row.target_key === value.zone_id);
    } else {
      invariant(row.target_key === value.assignment_id);
    }
    const expected: { purpose: 'Owner' | 'Assignee'; user_id: string }[] = [];
    if (value.proposed_role === 'Admin') {
      expected.push({ purpose: 'Owner', user_id: value.owner_id });
    }
    if (value.action === 'Assign') {
      expected.push({ purpose: 'Assignee', user_id: value.user_id });
    }
    invariant(Array.isArray(value.required_approvals) && value.required_approvals.length === expected.length);
    value.required_approvals.forEach((approval, index) => {
      invariant(
        Object.keys(approval).length === 3 &&
          Object.keys(approval).every((key) => ['purpose', 'user_id', 'approved_at'].includes(key)),
      );
      invariant(approval.purpose === expected[index].purpose && approval.user_id === expected[index].user_id);
      if (approval.approved_at !== null) {
        canonicalTime(approval.approved_at);
        invariant(Date.parse(approval.approved_at) >= Date.parse(value.created_at));
      }
    });
    if (value.status === 'Pending') {
      invariant(
        value.resolved_at === null &&
          value.resolved_by === null &&
          value.rejection_reason === null &&
          value.required_approvals.some((a) => a.approved_at === null),
      );
    } else {
      invariant(
        value.resolved_at !== null &&
          value.resolved_by !== null &&
          Date.parse(value.resolved_at) >= Date.parse(value.created_at),
      );
      if (value.status === 'Accepted') {
        invariant(
          value.rejection_reason === null &&
            value.required_approvals.every(
              (a) => a.approved_at !== null && Date.parse(a.approved_at) <= Date.parse(value.resolved_at!),
            ) &&
            value.required_approvals.some((a) => a.user_id === value.resolved_by),
        );
      } else {
        invariant(
          value.resolved_by === value.owner_id ||
            value.resolved_by === value.proposed_by ||
            (value.action === 'Assign' && value.resolved_by === value.user_id),
        );
        if (value.rejection_reason !== null) {
          farmInput(RejectFarmRequestDto, { reason: value.rejection_reason });
        }
      }
    }
    return value;
  } catch {
    throw new Error('Invalid persisted assignment workflow');
  }
}
