import { Db, Document } from 'mongodb';

const uuid = { bsonType: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' };
const nullableDate = { bsonType: ['date', 'null'] };
const nullableId = { bsonType: ['objectId', 'null'] };
const nullableHash = { bsonType: ['string', 'null'], pattern: '^[0-9a-f]{64}$' };
const safeInteger = { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 };
const nonnegativeInteger = { ...safeInteger, minimum: 0 };
const statePayloads = [
  { kind: 'CultivationContext', schema: { bsonType: 'object', required: ['zone_id', 'farm_id', 'author_id', 'assignment_id', 'original_created_at', 'root_id'],
    properties: { zone_id: uuid, farm_id: uuid, author_id: uuid, assignment_id: { ...uuid, bsonType: ['string', 'null'] },
      original_created_at: { bsonType: 'date' }, root_id: { bsonType: 'objectId' } } } },
  { kind: 'ZoneChainHead', schema: { bsonType: 'object', required: ['count', 'hash', 'last_event_id', 'last_lock_at'],
    properties: { count: nonnegativeInteger, hash: nullableHash, last_event_id: nullableId, last_lock_at: nullableDate } } },
  { kind: 'TelemetryInsertionCounter', schema: { bsonType: 'object', required: ['sequence', 'retained_ids'],
    properties: { sequence: nonnegativeInteger, retained_ids: { bsonType: 'array', maxItems: 10000, items: { bsonType: 'objectId' } } } } },
  { kind: 'TaskIdAllocator', schema: { bsonType: 'object', required: ['next_id'], properties: { next_id: safeInteger } } },
];

export const MONGO_SCHEMA_V1: { name: string; validator: Document; indexes: { key: Document; name: string; unique?: boolean }[] }[] = [
  {
    name: 'IOT_TELEMETRIES',
    validator: { $jsonSchema: {
      bsonType: 'object', additionalProperties: false,
      required: ['_id', 'device_id', 'data_stream_id', 'measured_at', 'received_at', 'value', 'unit'],
      properties: { _id: { bsonType: 'objectId' }, device_id: uuid, data_stream_id: { bsonType: 'string', minLength: 1, maxLength: 50 },
        measured_at: { bsonType: 'date' }, received_at: { bsonType: 'date' },
        value: { bsonType: ['double', 'int', 'long', 'decimal'] }, unit: { bsonType: 'string', minLength: 1, maxLength: 16 } },
    } },
    indexes: [{ key: { device_id: 1, data_stream_id: 1, received_at: -1, _id: -1 }, name: 'telemetry_device_stream' },
      { key: { received_at: 1, _id: 1 }, name: 'telemetry_history' }],
  },
  {
    name: 'ACTUATOR_TASKS',
    validator: { $jsonSchema: {
      bsonType: 'object', additionalProperties: false,
      required: ['_id', 'device_id', 'command_id', 'targets', 'tasking_parameters', 'status', 'created_at', 'sent_at', 'confirmed_at', 'error_message', 'response_payload'],
      properties: { _id: { bsonType: 'objectId' }, device_id: uuid, command_id: safeInteger,
        targets: { bsonType: 'array', items: { bsonType: 'object', required: ['task_id', 'tasking_capability_id'],
          properties: { task_id: safeInteger, tasking_capability_id: safeInteger } } },
        tasking_parameters: { bsonType: 'object', required: ['actionType', 'action'],
          properties: { actionType: { enum: ['control'] }, action: { enum: [0, 1] } } },
        status: { enum: ['Pending', 'Confirmed', 'Failed'] }, created_at: { bsonType: 'date' },
        sent_at: nullableDate, confirmed_at: nullableDate, error_message: { bsonType: ['string', 'null'] }, response_payload: { bsonType: 'object' } },
    } },
    indexes: [{ key: { command_id: 1 }, name: 'task_command_unique', unique: true },
      { key: { device_id: 1, created_at: -1, _id: -1 }, name: 'task_device_history' },
      { key: { status: 1, created_at: 1 }, name: 'task_pending' }],
  },
  {
    name: 'CULTIVATION_EVENTS',
    validator: { $and: [{ $jsonSchema: {
      bsonType: 'object', additionalProperties: false,
      required: ['_id', 'farmer_id', 'target_id', 'target_type', 'action_type', 'details', 'status', 'is_correction', 'reference_event_id', 'root_event_id', 'correction_reason', 'created_at', 'locked_at', 'lock_at', 'previous_hash', 'hash'],
      properties: { _id: { bsonType: 'objectId' }, farmer_id: uuid, target_id: uuid,
        target_type: { enum: ['Zone', 'Tree'] }, action_type: { enum: ['Watering', 'Spraying', 'Fertilizing'] }, details: { bsonType: 'object' },
        status: { enum: ['Pending', 'Locked'] }, is_correction: { bsonType: 'bool' }, reference_event_id: nullableId, root_event_id: nullableId,
        correction_reason: { bsonType: ['string', 'null'] }, created_at: { bsonType: 'date' }, locked_at: nullableDate,
        lock_at: { bsonType: 'date' }, previous_hash: nullableHash, hash: nullableHash },
    } }, { $or: [{ status: 'Pending', locked_at: null, hash: null, previous_hash: null },
      { status: 'Locked', locked_at: { $type: 'date' }, hash: { $type: 'string' } }] }] },
    indexes: [{ key: { farmer_id: 1, created_at: -1, _id: -1 }, name: 'event_author' },
      { key: { target_type: 1, target_id: 1, created_at: -1, _id: -1 }, name: 'event_target' },
      { key: { root_event_id: 1, created_at: 1, _id: 1 }, name: 'event_lineage' },
      { key: { status: 1, lock_at: 1, _id: 1 }, name: 'event_pending_lock' }],
  },
  {
    name: 'PERSISTENCE_STATE',
    validator: { $jsonSchema: { bsonType: 'object', additionalProperties: false,
      required: ['_id', 'kind', 'key', 'payload'], properties: { _id: { bsonType: 'string' },
        kind: { enum: ['CultivationContext', 'ZoneChainHead', 'TelemetryInsertionCounter', 'TaskIdAllocator'] },
        key: { bsonType: 'string', minLength: 1 }, payload: { bsonType: 'object' } },
      oneOf: statePayloads.map((definition) => ({ properties: { kind: { enum: [definition.kind] }, payload: definition.schema } })) } },
    indexes: [{ key: { kind: 1, key: 1 }, name: 'state_kind_key', unique: true },
      { key: { kind: 1, 'payload.zone_id': 1 }, name: 'state_zone' }],
  },
];

export async function applyMongoSchema(db: Db): Promise<void> {
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName || !hello.isWritablePrimary) { throw new Error('MongoDB writable replica set required'); }
  // DDL Mongo không cùng transaction với ledger PostgreSQL. Mỗi bước idempotent để
  // chạy lại sau gián đoạn; chỉ ghi applied khi tất cả validators/indexes thành công.
  for (const definition of MONGO_SCHEMA_V1) {
    const exists = await db.listCollections({ name: definition.name }, { nameOnly: true }).hasNext();
    if (!exists) { await db.createCollection(definition.name, { validator: definition.validator, validationLevel: 'strict', validationAction: 'error' }); }
    else { await db.command({ collMod: definition.name, validator: definition.validator, validationLevel: 'strict', validationAction: 'error' }); }
    for (const index of definition.indexes) {
      await db.collection(definition.name).createIndex(index.key, { name: index.name, unique: index.unique ?? false });
    }
  }
}
