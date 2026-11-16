import { Db, Document } from 'mongodb';
import { MONGO_SCHEMA_V1 } from './mongo-schema';
const text = (maxLength: number) => ({ bsonType: 'string', maxLength });
const uuid = { bsonType: 'string', pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' };
const integer = { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 };
const hash = { bsonType: 'string', pattern: '^[a-f0-9]{64}$' };
const object = (properties: Document, required = Object.keys(properties)) => ({ bsonType: 'object', additionalProperties: false, required, properties });
const citation = object({ document_id: { bsonType: 'string', pattern: '^[a-f0-9]{24}$' }, filename: text(255), sha256: hash,
  page: { ...integer, minimum: 1, maximum: 100 }, chunk_id: hash, excerpt: text(800) });
export const AI_MONGO_SCHEMA: typeof MONGO_SCHEMA_V1 = [
  { name: 'AI_DISEASE_DIAGNOSTICS', validator: { $jsonSchema: object({ _id: { bsonType: 'objectId' }, farmer_id: uuid,
    zone_id: { ...uuid, bsonType: ['string', 'null'] }, image_url: { bsonType: 'string', pattern: '^/api/ai/diagnoses/[a-f0-9]{24}/image$' },
    image_file: { bsonType: 'string', pattern: '^[a-f0-9]{24}\\.(png|jpg)$' }, mime: { enum: ['image/jpeg', 'image/png'] },
    ai_predictions: { bsonType: 'array', minItems: 1, maxItems: 3, items: object({ class_id: integer, label: { ...text(200), minLength: 1 }, confidence: { bsonType: ['double', 'int', 'long'], minimum: 0, maximum: 1 } }) },
    image_sha256: hash, model_sha256: hash, user_feedback: { bsonType: ['bool', 'null'] }, created_at: { bsonType: 'date' } }) },
    indexes: [{ key: { farmer_id: 1, created_at: -1, _id: -1 }, name: 'diagnosis_author' }] },
  { name: 'CHATBOT_CONVERSATIONS', validator: { $jsonSchema: object({ _id: { bsonType: 'objectId' }, farmer_id: uuid,
    session_title: { ...text(120), minLength: 1 }, version: integer, created_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' },
    messages: { bsonType: 'array', maxItems: 200, items: object({ role: { enum: ['user', 'assistant'] }, content: { ...text(8000), minLength: 1 },
      citations: { bsonType: 'array', maxItems: 5, items: citation }, created_at: { bsonType: 'date' } }) } }) },
    indexes: [{ key: { farmer_id: 1, created_at: -1, _id: -1 }, name: 'conversation_author' }] },
  { name: 'AI_RAG_DOCUMENTS', validator: { $jsonSchema: object({ _id: { bsonType: 'objectId' }, filename: { ...text(255), minLength: 1 },
    title: { ...text(120), minLength: 1 }, sha256: hash, page_count: { ...integer, minimum: 1, maximum: 100 }, status: { enum: ['Active', 'Inactive'] },
    created_by: uuid, created_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' },
    chunks: { bsonType: 'array', minItems: 1, maxItems: 700, items: object({ id: hash, page: { ...integer, minimum: 1, maximum: 100 }, text: { ...text(800), minLength: 1 } }) } }) },
    indexes: [{ key: { sha256: 1 }, name: 'rag_document_hash', unique: true }, { key: { status: 1, created_at: -1 }, name: 'rag_document_status' }] },
];
export async function applyAiSchema(db: Db, definitions = AI_MONGO_SCHEMA) {
  for (const definition of definitions) {
    const exists = await db.listCollections({ name: definition.name }, { nameOnly: true }).hasNext();
    if (exists && await db.collection(definition.name).findOne({ $nor: [definition.validator] }, { projection: { _id: 1 } })) throw new Error('AI schema contains incompatible existing data');
  }
  for (const definition of definitions) {
    const exists = await db.listCollections({ name: definition.name }, { nameOnly: true }).hasNext();
    if (!exists) await db.createCollection(definition.name, { validator: definition.validator, validationLevel: 'strict', validationAction: 'error' });
    else await db.command({ collMod: definition.name, validator: definition.validator, validationLevel: 'strict', validationAction: 'error' });
    for (const index of definition.indexes) await db.collection(definition.name).createIndex(index.key, { name: index.name, unique: index.unique ?? false });
  }
}
