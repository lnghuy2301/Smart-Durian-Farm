import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApplication } from '../src/application';
import { readEnvironment } from '../src/config/environment';
import { MockUserStore } from '../src/auth/mock-user.store';
import { taskPersistenceFixture, taskAuth, taskPgBase } from './helpers/task-persistence-fixture';

test('production runtime uses existing database accounts, hides mock inbox/docs and never seeds on restart', async () => {
  const f = await taskPersistenceFixture();
  const env = { NODE_ENV: 'production', AUTH_MODE: 'database', BUSINESS_STORAGE: 'database',
    DATABASE_URL: `${taskPgBase}/${f.name}`, MONGODB_URI: `mongodb://127.0.0.1:27028/${f.name}?replicaSet=rs-test&directConnection=true`,
    JWT_SECRET: randomBytes(48).toString('hex'), CORS_ORIGINS: 'https://farm.example.com', TRACE_PUBLIC_BASE_URL: 'https://farm.example.com',
    // These notes must never provision production users, even when still present.
    AUTH_TEST_PHONE: '0900000098', AUTH_TEST_PASSWORD: 'UnusedReference123!',
    AUTH_TEST_ADMIN_PHONE: '0900000099', AUTH_TEST_ADMIN_PASSWORD: 'UnusedAdmin123!' };
  const before = (await f.pool.query('SELECT count(*) FROM public.users')).rows[0].count;
  const existingFarmer = (await f.pool.query('SELECT id FROM public.users WHERE phone_number=$1', [taskAuth.phoneNumber])).rows[0].id;
  let token = '';
  try {
    for (let restart = 0; restart < 2; restart++) {
      const app = await createApplication(readEnvironment(env), false);
      try {
        await app.listen(0, '127.0.0.1');
        const origin = await app.getUrl();
        assert.throws(() => app.get(MockUserStore));
        const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone_number: taskAuth.phoneNumber, password: taskAuth.password }) });
        assert.equal(login.status, 200);
        const body = await login.json() as { access_token: string; user: { id: string } };
        assert.equal(body.user.id, existingFarmer);
        if (!token) token = body.access_token;
        assert.equal((await fetch(`${origin}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
        assert.equal((await fetch(`${origin}/api/auth/test/sms?phone_number=${taskAuth.phoneNumber}`)).status, 404);
        assert.equal((await fetch(`${origin}/api/docs-json`)).status, 404);
        assert.equal((await fetch(`${origin}/api/docs`)).status, 404);
        assert.equal((await f.pool.query('SELECT count(*) FROM public.users')).rows[0].count, before);
        assert.equal((await f.pool.query('SELECT count(*) FROM public.users WHERE phone_number=$1', [env.AUTH_TEST_ADMIN_PHONE])).rows[0].count, '0');
      } finally { await app.close(); }
    }
  } finally { await f.close(); }
});
