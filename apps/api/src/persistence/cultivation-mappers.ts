import { ObjectId } from 'mongodb';
import { CultivationEvent, EventContext, LOCK_DELAY_MS } from '../cultivation-events/cultivation-events.types';
import { canonicalJson, eventHash } from '../cultivation-events/cultivation-chain';
import { fromMongoRecord, toMongoRecord } from './mappers';

export function cultivationInvariant(value: unknown): asserts value {
  if (!value) throw new Error('Invalid persisted cultivation state');
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const cultivationUuid = (value: unknown) => typeof value === 'string' && uuidPattern.test(value);
export const cultivationId = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
function exact(value: object, keys: string[]) {
  cultivationInvariant(value && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
}
function time(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function quantity(value: unknown, max: number) { return typeof value === 'number' && Number.isFinite(value) && value >= 0.001 && value <= max; }
export function validateCultivation(event: CultivationEvent, hashes = true) {
  exact(event, ['_id', 'farmer_id', 'target_id', 'target_type', 'action_type', 'details', 'status', 'is_correction', 'reference_event_id',
    'root_event_id', 'correction_reason', 'created_at', 'locked_at', 'lock_at', 'previous_hash', 'hash']);
  cultivationInvariant(cultivationId(event._id) && cultivationUuid(event.farmer_id) && cultivationUuid(event.target_id));
  cultivationInvariant(['Zone', 'Tree'].includes(event.target_type) && ['Watering', 'Spraying', 'Fertilizing', 'Other'].includes(event.action_type));
  cultivationInvariant(time(event.created_at) && time(event.lock_at) && Date.parse(event.lock_at) - Date.parse(event.created_at) === LOCK_DELAY_MS);
  cultivationInvariant(typeof event.is_correction === 'boolean');
  if (event.is_correction) cultivationInvariant(cultivationId(event.reference_event_id) && cultivationId(event.root_event_id)
    && event.reference_event_id !== event._id && event.root_event_id !== event._id && typeof event.correction_reason === 'string'
    && event.correction_reason.trim().length > 0 && event.correction_reason.length <= 2000);
  else cultivationInvariant(event.reference_event_id === null && event.root_event_id === null && event.correction_reason === null);
  const details = event.details;
  exact(details, event.action_type === 'Watering' ? ['standard_snapshot', 'note', 'warnings', 'duration_minutes', 'water_volume_l']
    : event.action_type === 'Other' ? ['standard_snapshot', 'note', 'warnings', 'activity_name'] : ['standard_snapshot', 'note', 'warnings', 'materials']);
  exact(details.standard_snapshot, ['standard_id', 'code', 'name']);
  cultivationInvariant(cultivationUuid(details.standard_snapshot.standard_id) && typeof details.standard_snapshot.name === 'string'
    && typeof details.standard_snapshot.code === 'string' && (details.note === null || typeof details.note === 'string' && details.note.length <= 2000));
  cultivationInvariant(Array.isArray(details.warnings));
  if (event.action_type === 'Watering') cultivationInvariant(quantity(details.duration_minutes, 10080)
    && (details.water_volume_l === null || quantity(details.water_volume_l, 1000000)) && !details.warnings.length);
  else if (event.action_type === 'Other') {
    cultivationInvariant(typeof details.activity_name === 'string' && details.activity_name.trim().length > 0 && details.activity_name.length <= 200 && !details.warnings.length);
  } else {
    cultivationInvariant(Array.isArray(details.materials) && details.materials.length >= 1 && details.materials.length <= 20);
    cultivationInvariant(new Set(details.materials.map((item) => item.material_id)).size === details.materials.length);
    for (const item of details.materials) {
      const normalized = item.default_dosage_value !== undefined;
      exact(item, ['material_id', 'quantity', 'name', 'material_type', 'unit', 'default_dosage', 'quarantine_days', 'standard_linked', ...(normalized ? ['default_dosage_value', 'dosage_basis'] : [])]);
      if (normalized) cultivationInvariant(quantity(item.default_dosage_value, 1000000) && typeof item.dosage_basis === 'string' && item.dosage_basis.trim().length > 0 && item.dosage_basis.length <= 60);
      cultivationInvariant(cultivationUuid(item.material_id) && quantity(item.quantity, 1000000) && typeof item.name === 'string'
        && typeof item.unit === 'string' && typeof item.default_dosage === 'string' && ['Fertilizer', 'Pesticide', 'Biological'].includes(item.material_type)
        && Number.isSafeInteger(item.quarantine_days) && item.quarantine_days >= 0 && typeof item.standard_linked === 'boolean');
    }
    cultivationInvariant(canonicalJson(details.warnings) === canonicalJson(details.materials.filter((item) => !item.standard_linked)
      .map((item) => ({ code: 'MATERIAL_OUTSIDE_STANDARD', material_id: item.material_id }))));
  }
  if (event.status === 'Pending') cultivationInvariant(event.locked_at === null && event.hash === null && event.previous_hash === null);
  else {
    cultivationInvariant(event.status === 'Locked' && time(event.locked_at) && Date.parse(event.locked_at) >= Date.parse(event.lock_at)
      && typeof event.hash === 'string' && /^[0-9a-f]{64}$/.test(event.hash)
      && (event.previous_hash === null || typeof event.previous_hash === 'string' && /^[0-9a-f]{64}$/.test(event.previous_hash)));
    if (hashes) cultivationInvariant(eventHash(event) === event.hash);
  }
}
export function validateContext(context: EventContext) {
  exact(context, ['zone_id', 'farm_id', 'author_id', 'assignment_id', 'original_created_at', 'root_id']);
  cultivationInvariant([context.zone_id, context.farm_id, context.author_id].every(cultivationUuid)
    && (context.assignment_id === null || cultivationUuid(context.assignment_id)) && time(context.original_created_at) && cultivationId(context.root_id));
}
const ids = ['_id', 'reference_event_id', 'root_event_id'], dates = ['created_at', 'locked_at', 'lock_at'];
export interface EventDocument { _id: ObjectId; [key: string]: unknown }
export function cultivationDocument(event: CultivationEvent): EventDocument {
  validateCultivation(event); return toMongoRecord(event as unknown as Record<string, unknown>, ids, dates) as EventDocument;
}
export function mapCultivation(row: EventDocument, hashes = true): CultivationEvent {
  const event = fromMongoRecord(row, ids, dates) as unknown as CultivationEvent;
  validateCultivation(event, hashes); return event;
}
export function contextDocument(context: EventContext) {
  validateContext(context);
  return { ...structuredClone(context), original_created_at: new Date(context.original_created_at), root_id: new ObjectId(context.root_id) };
}
export function mapCultivationContext(row: Record<string, unknown>): EventContext {
  const context = fromMongoRecord(row, ['root_id'], ['original_created_at']) as unknown as EventContext;
  validateContext(context); return context;
}
