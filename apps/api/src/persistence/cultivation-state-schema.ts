import { Db, Document } from 'mongodb';
import { MONGO_SCHEMA_V1 } from './mongo-schema';

// Append a migration instead of changing the checksum of issued migration002.
export const CULTIVATION_STATE_SCHEMA: Document = structuredClone(MONGO_SCHEMA_V1.find((entry) => entry.name === 'PERSISTENCE_STATE')!.validator);
const schema = CULTIVATION_STATE_SCHEMA.$jsonSchema;
schema.properties.kind.enum.push('CultivationLedger');
schema.oneOf.push({ properties: { kind: { enum: ['CultivationLedger'] }, payload: {
  bsonType: 'object', additionalProperties: false, required: ['revision', 'event_ids'], properties: {
    revision: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 },
    event_ids: { bsonType: 'array', maxItems: 10000, items: { bsonType: 'objectId' } },
  },
} } });
export async function applyCultivationStateSchema(db: Db) {
  await db.command({ collMod: 'PERSISTENCE_STATE', validator: CULTIVATION_STATE_SCHEMA, validationLevel: 'strict', validationAction: 'error' });
}
