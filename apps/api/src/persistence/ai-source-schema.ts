import { AI_MONGO_SCHEMA } from './ai-schema';
import { Db } from 'mongodb';
import { canonicalJson } from '../cultivation-events/cultivation-chain';

// Clone the applied017 definitions: its checksum and old backup format stay intact.
export const AI_SOURCE_SCHEMA = structuredClone(AI_MONGO_SCHEMA);
const filename = { bsonType: 'string', minLength: 1, maxLength: 255 };
const sha256 = { bsonType: 'string', pattern: '^[a-f0-9]{64}$' };
const page = { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: 1000, multipleOf: 1 };
const source = (properties: Record<string, unknown>) => ({ bsonType: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const rag = AI_SOURCE_SCHEMA.find((v) => v.name === 'AI_RAG_DOCUMENTS')!.validator.$jsonSchema;
rag.properties.source = source({ filename, sha256, is_draft: { bsonType: 'bool' }, page_map: { bsonType: 'array', minItems: 1, maxItems: 100, items: page } });
const chat = AI_SOURCE_SCHEMA.find((v) => v.name === 'CHATBOT_CONVERSATIONS')!.validator.$jsonSchema;
chat.properties.messages.items.properties.citations.items.properties.source = source({ filename, sha256, page, is_draft: { bsonType: 'bool' } });

export async function assertAiSourceSchema(db: Db) {
  for (const definition of AI_SOURCE_SCHEMA) {
    const actual = await db.listCollections({ name: definition.name }, { nameOnly: false }).next();
    if (!actual || actual.options?.validationLevel !== 'strict' || actual.options?.validationAction !== 'error'
      || canonicalJson(actual.options.validator) !== canonicalJson(definition.validator)) throw new Error('AI Mongo schema mismatch');
    const indexes = await db.collection(definition.name).listIndexes().toArray();
    for (const expected of definition.indexes) {
      const index = indexes.find((v) => v.name === expected.name);
      if (!index || JSON.stringify(index.key) !== JSON.stringify(expected.key) || !!index.unique !== !!expected.unique) throw new Error('AI Mongo index mismatch');
    }
  }
}
