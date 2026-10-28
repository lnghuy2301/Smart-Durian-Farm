import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BSON } from 'mongodb';
import { taskPersistenceFixture } from './helpers/task-persistence-fixture';
import { expandMaterialCatalog } from '../src/persistence/material-catalog-expansion';
import { applyCultivationEnrichment, planCultivationEnrichment } from '../src/persistence/cultivation-enrichment';
import { createDatabaseBackup } from '../src/persistence/backup';

test('cultivation enrichment appends diverse records, resumes after a lost checkpoint and never rewrites history', async () => {
  const f = await taskPersistenceFixture();
  try {
    await expandMaterialCatalog(f.pool);
    const db = f.mongo.db(f.name), now = new Date(Date.now() + 29 * 86400000);
    const before = await createDatabaseBackup(f.pool, f.mongo, db);
    const plan = await planCultivationEnrichment(f.pool, db, now);
    assert(plan.entries.length > 0); assert.deepEqual(new Set(plan.entries.map((e) => e.input.action_type)), new Set(['Watering', 'Spraying', 'Fertilizing', 'Other']));
    assert(plan.entries.some((e) => e.input.action_type === 'Spraying' && e.input.target_type === 'Tree'));
    let injected = false;
    const failing = new Proxy(f.pool, { get(target, key) {
      if (key === 'query') return async (sql: string, values?: unknown[]) => {
        if (!injected && sql.includes("VALUES ('dataset_steps'")) { injected = true; throw new Error('lost checkpoint'); }
        return target.query(sql, values);
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(applyCultivationEnrichment(failing, f.mongo, db, now), /lost checkpoint/);
    const first = await db.collection('CULTIVATION_EVENTS').findOne({}); assert(first);
    const resumed = await applyCultivationEnrichment(f.pool, f.mongo, db, now);
    assert.equal(resumed.created, plan.entries.length - 1);
    assert.equal(await db.collection('CULTIVATION_EVENTS').countDocuments(), plan.entries.length);
    assert.equal(await db.collection('CULTIVATION_EVENTS').countDocuments({ status: 'Locked' }), plan.entries.length);
    const after = await createDatabaseBackup(f.pool, f.mongo, db);
    for (const table of before.postgres.filter((t) => t.name.startsWith('public.'))) assert.deepEqual(after.postgres.find((t) => t.name === table.name), table);
    for (const c of before.mongo.filter((c) => !['CULTIVATION_EVENTS', 'PERSISTENCE_STATE'].includes(c.name))) assert.deepEqual(after.mongo.find((item) => item.name === c.name), c);
    const locked = await db.collection('CULTIVATION_EVENTS').find({}).sort({ _id: 1 }).toArray();
    assert.equal((await applyCultivationEnrichment(f.pool, f.mongo, db, now)).created, 0);
    assert.equal((await createDatabaseBackup(f.pool, f.mongo, db)).data_sha256, after.data_sha256);
    assert.deepEqual((await db.collection('CULTIVATION_EVENTS').find({}).sort({ _id: 1 }).toArray()).map((r) => BSON.serialize(r)), locked.map((r) => BSON.serialize(r)));
  } finally { await f.close(); }
});
