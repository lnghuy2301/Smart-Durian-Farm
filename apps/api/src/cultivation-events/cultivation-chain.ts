import { createHash } from 'node:crypto';
import { CultivationEvent } from './cultivation-events.types';

// Sắp xếp key đệ quy để hash không phụ thuộc thứ tự thêm thuộc tính JS.
// Array giữ nguyên thứ tự; chỉ chấp nhận giá trị JSON hữu hạn.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') { return JSON.stringify(value); }
  if (typeof value === 'number' && Number.isFinite(value)) { return JSON.stringify(value); }
  if (Array.isArray(value)) { return `[${value.map(canonicalJson).join(',')}]`; }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new TypeError('Hash payload must contain finite JSON values');
}

export function eventHash(event: CultivationEvent): string {
  // Danh sách field cố định: metadata nội bộ thêm sau không làm đổi hash v1.
  const payload = { domain: 'smart-durian/cultivation-events/v1', _id: event._id, farmer_id: event.farmer_id,
    target_id: event.target_id, target_type: event.target_type, action_type: event.action_type,
    details: event.details, status: event.status, is_correction: event.is_correction,
    reference_event_id: event.reference_event_id, root_event_id: event.root_event_id,
    correction_reason: event.correction_reason, created_at: event.created_at,
    locked_at: event.locked_at, lock_at: event.lock_at, previous_hash: event.previous_hash };
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

export function compareEvents(a: CultivationEvent, b: CultivationEvent): number {
  return a.lock_at.localeCompare(b.lock_at) || a._id.localeCompare(b._id);
}

export function verifyEvents(events: CultivationEvent[], expected: { count: number; hash: string | null }) {
  let previous: CultivationEvent | undefined;
  for (const event of events) {
    let code: string | undefined;
    if (event.status !== 'Locked' || !event.locked_at) { code = 'NOT_LOCKED'; }
    else if (previous && compareEvents(previous, event) >= 0) { code = 'ORDER_MISMATCH'; }
    else if (event.previous_hash !== (previous?.hash ?? null)) { code = 'LINK_MISMATCH'; }
    else if (event.hash !== eventHash(event)) { code = 'HASH_MISMATCH'; }
    if (code) { return { valid: false, failure: { code, event_id: event._id } }; }
    previous = event;
  }
  if (events.length !== expected.count || (previous?.hash ?? null) !== expected.hash) {
    return { valid: false, failure: { code: 'HEAD_MISMATCH', event_id: previous?._id ?? null } };
  }
  return { valid: true, failure: null };
}
