import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskPersistenceFixture } from './helpers/task-persistence-fixture';
import { createDatabaseBackup } from '../src/persistence/backup';
import { RICH_PROFILE, seedRichOperationalData } from '../src/persistence/rich-operational-data';
import { richDataCommand } from '../src/persistence/rich-data-cli';

test('one-month generated operational history resumes safely and preserves real data', async (t) => {
  const f = await taskPersistenceFixture();
  try {
    const db = f.mongo.db(f.name), now = new Date();
    const before = await createDatabaseBackup(f.pool, f.mongo, db);
    await t.test('CLI refuses production without touching services or local files', async () => {
      await assert.rejects(richDataCommand({ NODE_ENV: 'production' }), /LOCAL_ENVIRONMENT_REQUIRED/);
    });
    await t.test('a failure between Mongo creation and PG checkpoint retains recoverable progress', async () => {
      let injected = false;
      const failing = new Proxy(f.pool, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          if (!injected && sql.includes("VALUES ('dataset_steps'")) { injected = true; throw new Error('Simulated checkpoint failure'); }
          return target.query(sql, values);
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      await assert.rejects(seedRichOperationalData(failing, f.mongo, db, 'RichFixtureOnlyPassword!', now), /checkpoint failure/);
      assert(injected);
      assert.equal(await db.collection('CULTIVATION_EVENTS').countDocuments(), 1);
    });
    await t.test('resume adopts the committed event, creates diverse workflows and verifies ten chains', async () => {
      const result = await seedRichOperationalData(f.pool, f.mongo, db, 'RichFixtureOnlyPassword!', now);
      assert.equal(result.new_cultivation, 129); assert.equal(result.new_harvests, 160);
      assert.equal(await db.collection('CULTIVATION_EVENTS').countDocuments(), 130);
      assert.equal(await db.collection('CULTIVATION_EVENTS').countDocuments({ status: 'Locked' }), 130);
      const profile = (await f.pool.query("SELECT data FROM technical.entity_metadata WHERE entity_type='dataset_profiles' AND entity_key=$1", [RICH_PROFILE])).rows[0].data;
      assert.equal(profile.status, 'Complete');
      const managers = (await f.pool.query('SELECT status,gmail_verify FROM public.users WHERE id=ANY($1::uuid[]) ORDER BY status', [profile.managers])).rows;
      assert.deepEqual(managers.map((row) => row.status), ['Active', 'Active', 'Pending']);
      assert(managers.every((row) => row.gmail_verify));
      assert.equal((await f.farms.list(profile.managers[0], { limit: 100, offset: 0 })).total, 2);
      await assert.rejects(f.farms.get(profile.managers[0], profile.farms[2]), /Farm/);
      assert.equal((await f.farms.list(profile.users[5], { limit: 100, offset: 0 })).total, 0);
      assert.equal((await f.zones.list(profile.users[5], { limit: 100, offset: 0 })).total, 2);
      const memberships = (await f.pool.query('SELECT cooperative_id FROM public.farms WHERE id=ANY($1::uuid[])', [profile.farms])).rows;
      assert.equal(memberships.filter((row) => row.cooperative_id !== null).length, 3);
      assert.equal(memberships.filter((row) => row.cooperative_id === null).length, 2);
      const harvests = (await f.pool.query('SELECT status,count(*)::int AS count FROM public.tree_harvests GROUP BY status ORDER BY status')).rows;
      assert.deepEqual(harvests, [{ status: 'Confirmed', count: 130 }, { status: 'Draft', count: 20 }, { status: 'Pending', count: 10 }]);
      assert.equal((await f.pool.query("SELECT count(*)::int AS count FROM public.tree_harvests WHERE status='Confirmed' AND (updated_at IS NOT NULL OR updated_by IS NOT NULL)")).rows[0].count, 0);
      const after = await createDatabaseBackup(f.pool, f.mongo, db);
      for (const name of ['public.devices', 'public.sensors', 'public.actuators']) assert.deepEqual(after.postgres.find((table) => table.name === name), before.postgres.find((table) => table.name === name));
      for (const name of ['IOT_TELEMETRIES', 'ACTUATOR_TASKS']) assert.deepEqual(after.mongo.find((collection) => collection.name === name), before.mongo.find((collection) => collection.name === name));
    });
    await t.test('completed profile rerun preserves every record, timestamp, password and hash', async () => {
      const stable = await createDatabaseBackup(f.pool, f.mongo, db);
      const result = await seedRichOperationalData(f.pool, f.mongo, db, 'DifferentConfigurationDoesNotReset!', now);
      assert.equal(result.already_complete, true);
      assert.equal((await createDatabaseBackup(f.pool, f.mongo, db)).data_sha256, stable.data_sha256);
    });
  } finally { await f.close(); }
});
