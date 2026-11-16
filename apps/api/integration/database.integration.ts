import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from '../src/application';
import { readEnvironment } from '../src/config/environment';
import { DatabaseService } from '../src/database/database.service';

test('isolated database readiness and replica-set transactions work without local env or MQTT', async () => {
  // Never load the operator's .env here: it may enable real MQTT and providers.
  const app = await createApplication(readEnvironment({
    NODE_ENV: 'test', AUTH_MODE: 'disabled', BUSINESS_STORAGE: 'memory',
    DATABASE_URL: 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432/sdf_persistence_test',
    MONGODB_URI: 'mongodb://127.0.0.1:27028/sdf_persistence_test?replicaSet=rs-test&directConnection=true',
  }), false);
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/api/health/ready`);
    assert.equal(response.status, 200, 'Start Docker Compose and configure .env before running integration tests');
    assert.deepEqual(await response.json(), { status: 'ok', databases: { postgres: 'up', mongodb: 'up' } });
    const database = app.get(DatabaseService);
    const hello = await database.mongo.db('admin').command({ hello: 1 });
    assert.equal(hello.setName, 'rs-test');
    assert.equal(hello.isWritablePrimary, true);
    const session = database.mongo.startSession();
    try {
      await session.withTransaction(async () => {
        await database.mongo.db().collection('CULTIVATION_EVENTS').findOne({}, { session });
      });
    } finally { await session.endSession(); }
  } finally { await app.close(); }
});
