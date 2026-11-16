import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObjectId } from 'mongodb';
import { taskPersistenceFixture } from './helpers/task-persistence-fixture';
import { MongoAiStore } from '../src/ai/ai.store';

test('Mongo diagnosis deletion is author-scoped and feedback cannot resurrect a deleted record', async () => {
  const f = await taskPersistenceFixture();
  try {
    const db = f.mongo.db(f.name), store = new MongoAiStore(db), owner = await f.farmer(), other = await f.farmer(), id = new ObjectId();
    await store.addDiagnosis({ _id: id, farmer_id: owner.id, zone_id: null, image_url: `/api/ai/diagnoses/${id}/image`, image_file: `${id}.png`, mime: 'image/png', ai_predictions: [{ class_id: 0, label: 'fixture', confidence: 0.9 }], image_sha256: 'a'.repeat(64), model_sha256: 'b'.repeat(64), user_feedback: null, created_at: new Date() });
    assert.equal(await store.deleteDiagnosis(id, other.id), false); assert(await store.diagnosis(id, owner.id));
    assert.equal(await store.deleteDiagnosis(id, owner.id), true); assert.equal(await store.diagnosis(id, owner.id), null);
    assert.equal(await store.feedback(id, owner.id, true), false); assert.equal(await store.deleteDiagnosis(id, owner.id), false);
    assert.equal(await db.collection('AI_DISEASE_DIAGNOSTICS').countDocuments(), 0);
  } finally { await f.close(); }
});
