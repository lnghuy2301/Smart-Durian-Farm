import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ACTION_TYPES, EVENT_STATUSES, TARGET_TYPES } from './cultivation-events.types';

const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const id: SchemaObject = { type: 'string', pattern: '^[a-f0-9]{24}$' };
const time: SchemaObject = { type: 'string', format: 'date-time' };
const object = (properties: Record<string, SchemaObject>): SchemaObject => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const standard = object({ standard_id: uuid, code: { type: 'string' }, name: { type: 'string' } });
const material = object({ material_id: uuid, quantity: { type: 'number' }, name: { type: 'string' },
  material_type: { type: 'string', enum: ['Fertilizer', 'Pesticide', 'Biological'] }, unit: { type: 'string' },
  default_dosage: { type: 'string' }, quarantine_days: { type: 'integer' }, standard_linked: { type: 'boolean' } });
const commonDetails = { standard_snapshot: standard, note: { type: 'string', nullable: true } as SchemaObject,
  warnings: { type: 'array', items: object({ code: { type: 'string', enum: ['MATERIAL_OUTSIDE_STANDARD'] }, material_id: uuid }) } as SchemaObject };

export const eventSchema = object({ _id: id, farmer_id: uuid, target_id: uuid,
  target_type: { type: 'string', enum: [...TARGET_TYPES] }, action_type: { type: 'string', enum: [...ACTION_TYPES] },
  details: { oneOf: [object({ ...commonDetails, duration_minutes: { type: 'number' }, water_volume_l: { type: 'number', nullable: true } }),
    object({ ...commonDetails, materials: { type: 'array', items: material } })] },
  status: { type: 'string', enum: [...EVENT_STATUSES] }, is_correction: { type: 'boolean' },
  reference_event_id: { ...id, nullable: true }, root_event_id: { ...id, nullable: true },
  correction_reason: { type: 'string', nullable: true }, created_at: time, lock_at: time,
  locked_at: { ...time, nullable: true }, previous_hash: { type: 'string', nullable: true, pattern: '^[a-f0-9]{64}$' },
  hash: { type: 'string', nullable: true, pattern: '^[a-f0-9]{64}$' } });
export const eventPageSchema = object({ items: { type: 'array', items: eventSchema },
  total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } });
export const chainSchema = object({ zone_id: uuid, algorithm: { type: 'string', enum: ['SHA-256'] },
  valid: { type: 'boolean' }, locked_events: { type: 'integer' }, tail_hash: { type: 'string', nullable: true },
  checked_at: time, failure: { ...object({ code: { type: 'string' }, event_id: { ...id, nullable: true } }), nullable: true } });
