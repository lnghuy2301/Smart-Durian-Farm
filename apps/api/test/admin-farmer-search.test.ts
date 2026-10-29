import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { readEnvironment } from '../src/config/environment';
import { MockUserStore } from '../src/auth/mock-user.store';

test('Admin searches active Farmer names/phones; other roles and unbounded/short queries are rejected', async () => {
  const config = readEnvironment({ NODE_ENV: 'test', AUTH_MODE: 'mock', DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/fixture', MONGODB_URI: 'mongodb://127.0.0.1:1/fixture', AUTH_TEST_PHONE: '0900000000', AUTH_TEST_PASSWORD: 'FixtureOnly123!', AUTH_TEST_ADMIN_PHONE: '0900000001', AUTH_TEST_ADMIN_PASSWORD: 'FixtureAdmin123!', JWT_SECRET: 'farmer-search-fixture-secret-32-chars' });
  const module = await Test.createTestingModule({ imports: [AppModule.register(config)] }).compile();
  const app = module.createNestApplication({ logger: false }); configureApplication(app, config); await app.listen(0, '127.0.0.1');
  try {
    const users = app.get(MockUserStore), farmer = users.add({ ...users.user, user_name: 'Đặng Thị Hòa', phone_number: '0949990123' });
    users.add({ ...users.user, user_name: 'Đặng Locked', phone_number: '0949990124', status: 'Locked' });
    const login = async (phone: string, password: string) => (await (await fetch(`${await app.getUrl()}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone_number: phone, password }) })).json()).access_token;
    const admin = await login('0900000001', 'FixtureAdmin123!'), owner = await login('0900000000', 'FixtureOnly123!');
    const get = async (q: string, token: string) => fetch(`${await app.getUrl()}/api/users/farmers?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await get('dang', owner)).status, 403);
    assert.equal((await get('a', admin)).status, 400); assert.equal((await get('123', admin)).status, 400);
    for (const q of ['dang thi hoa', 'ĐẶNG', '0949', '+84949', '0123']) {
      const response = await get(q, admin); assert.equal(response.status, 200);
      const result = await response.json(); assert.deepEqual(result.items, [{ id: farmer.id, user_name: farmer.user_name, phone_number: farmer.phone_number }]);
      assert.equal(result.has_more, false); assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  } finally { await app.close(); }
});
