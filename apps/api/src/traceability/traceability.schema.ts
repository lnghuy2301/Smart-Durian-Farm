import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
const text: SchemaObject = { type: 'string' };
const time: SchemaObject = { type: 'string', format: 'date-time' };
const bool: SchemaObject = { type: 'boolean' };
const integer: SchemaObject = { type: 'integer' };
const object = (properties: Record<string, SchemaObject>): SchemaObject => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const standard = object({ code: text, name: text });
const target = object({ type: { type: 'string', enum: ['Zone', 'Tree'] }, label: text });
const page = (item: SchemaObject) => object({ items: { type: 'array', items: item }, total: integer, limit: integer, offset: integer });
export const traceSchema = object({
  tree: object({ tree_code: text, variety: text, plant_date: time, status: { type: 'string', enum: ['Active', 'Dead', 'Removed'] } }),
  zone: object({ name: text }), cooperative: { ...object({ name: text }), nullable: true },
  standard: object({ code: text, name: text, status: { type: 'string', enum: ['Active', 'Inactive'] } }),
  trace_url: { type: 'string', format: 'uri' },
});
export const versionSchema = object({ history_key: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  version: integer, latest_version: integer, is_correction: bool, is_latest: bool, applies_to_tree: bool, latest_applies_to_tree: bool,
  target, latest_target: target, action_type: { type: 'string', enum: ['Watering', 'Spraying', 'Fertilizing', 'Other'] },
  entered_at: time, locked_at: time, details: { oneOf: [object({ standard_snapshot: standard,
    duration_minutes: { type: 'number' }, water_volume_l: { type: 'number', nullable: true } }),
    object({ standard_snapshot: standard, materials: { type: 'array', items: object({ name: text,
      quantity: { type: 'number' }, unit: text, standard_linked: bool }) } })] } });
export const versionPageSchema = page(versionSchema);
export const harvestPageSchema = page(object({ season_name: text, harvest_date: { type: 'string', format: 'date' },
  fruit_count: integer, total_weight_kg: { type: 'number' }, batch_code: text,
  confirmation_state: { type: 'string', enum: ['Confirmed'] } }));
