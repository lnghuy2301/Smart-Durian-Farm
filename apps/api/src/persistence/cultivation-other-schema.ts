import { Db, Document } from 'mongodb';
import { MONGO_SCHEMA_V1 } from './mongo-schema';

// Never mutate migration002's shared definition/checksum or rewrite old events.
export const CULTIVATION_OTHER_SCHEMA: Document = structuredClone(MONGO_SCHEMA_V1.find((entry) => entry.name === 'CULTIVATION_EVENTS')!.validator);
CULTIVATION_OTHER_SCHEMA.$and[0].$jsonSchema.properties.action_type.enum.push('Other');
export async function applyCultivationOtherSchema(db: Db) {
  await db.command({ collMod: 'CULTIVATION_EVENTS', validator: CULTIVATION_OTHER_SCHEMA, validationLevel: 'strict', validationAction: 'error' });
}
