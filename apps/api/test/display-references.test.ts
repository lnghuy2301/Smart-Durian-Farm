import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from '../src/application';
import { readEnvironment } from '../src/config/environment';
import { MockUserStore } from '../src/auth/mock-user.store';
import { FarmsService } from '../src/farms/farms.service';

test('Display names require the source record permission and never return contacts, hashes or a user directory', async () => {
  const env = {
    NODE_ENV: 'test', AUTH_MODE: 'mock', AUTH_TEST_PHONE: '0900000000', AUTH_TEST_PASSWORD: 'LocalTestOnly123!',
    AUTH_TEST_ADMIN_PHONE: '0900000001', AUTH_TEST_ADMIN_PASSWORD: 'LocalAdminOnly123!',
    JWT_SECRET: 'test-only-secret-with-at-least-32-bytes',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', MONGODB_URI: 'mongodb://127.0.0.1:1/test',
  };
  const app = await createApplication(readEnvironment(env), false);
  try {
    await app.listen(0, '127.0.0.1');
    const users = app.get(MockUserStore), owner = users.user;
    owner.user_name = 'Nguyễn Văn Chủ';
    const admin = users.findByPhone(env.AUTH_TEST_ADMIN_PHONE)!;
    const outsider = users.add({ ...owner, phone_number: '0900000002', user_name: 'Không liên quan' });
    const farms = app.get(FarmsService);
    const proposal = farms.createRequest(owner.id, { address: 'Vườn Ngũ Hiệp', area_size: 2, certificate_number: 'GCN-123', longitude: 106, latitude: 10 });
    const accepted = farms.approve(admin.id, proposal.id);
    const base = `${await app.getUrl()}/api`;
    const login = async (phone: string) => {
      const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone_number: phone, password: env.AUTH_TEST_PASSWORD }) });
      assert.equal(response.status, 200);
      return (await response.json() as { access_token: string }).access_token;
    };
    const token = await login(owner.phone_number), other = await login(outsider.phone_number);
    const get = (path: string, jwt?: string) => fetch(`${base}/display-references/${path}`, { headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} });
    assert.equal((await get(`farms/${accepted.farm_id}`)).status, 401);
    const result = await get(`farms/${accepted.farm_id}`, token);
    assert.equal(result.status, 200);
    const body = await result.json() as { labels: Record<string, string> };
    assert.equal(body.labels[owner.id], owner.user_name);
    assert.equal(body.labels[accepted.farm_id!], 'Vườn Ngũ Hiệp');
    assert.equal(body.labels[outsider.id], undefined);
    assert.deepEqual(Object.keys(body), ['labels']);
    assert.equal(JSON.stringify(body).includes(owner.phone_number), false);
    assert.equal(JSON.stringify(body).includes(owner.password), false);
    assert.ok([403, 404].includes((await get(`farms/${accepted.farm_id}`, other)).status));
    assert.ok([403, 404].includes((await get(`farm-requests/${proposal.id}`, other)).status));
    assert.equal((await get(`farm-requests/${proposal.id}`, token)).status, 200);
    assert.equal((await get(`users/${outsider.id}`, token)).status, 400);
    assert.equal((await get('farms/not-a-valid-id', token)).status, 400);
  } finally { await app.close(); }
});
