import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { readEnvironment } from '../src/config/environment';
import { EmailSender } from '../src/users/email/email.sender';
import { MockUserStore } from '../src/auth/mock-user.store';
import { AuthService } from '../src/auth/auth.service';

async function fixture() {
  const config = readEnvironment({ NODE_ENV: 'test', AUTH_MODE: 'mock', AUTH_TEST_PHONE: '0900000000', AUTH_TEST_PASSWORD: 'PdfAccountFixture123!',
    AUTH_TEST_ADMIN_PHONE: '0900000001', AUTH_TEST_ADMIN_PASSWORD: 'PdfAdminFixture123!', JWT_SECRET: 'pdf-account-test-secret-at-least-32-bytes',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', MONGODB_URI: 'mongodb://127.0.0.1:1/test' });
  const codes = new Map<string, string>();
  const module = await Test.createTestingModule({ imports: [AppModule.register(config)] }).overrideProvider(EmailSender)
    .useValue({ async sendVerification(email: string, code: string) { codes.set(email, code); } }).compile();
  const app = module.createNestApplication({ logger: false }); configureApplication(app, config); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const http = (path: string, method = 'GET', body?: object, token?: string) => fetch(`${base}/${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async (phone = '0900000000', password = 'PdfAccountFixture123!') => {
    const response = await http('auth/login', 'POST', { phone_number: phone, password }); assert.equal(response.status, 200);
    return await response.json() as { access_token: string; user: { id: string } };
  };
  return { app, http, login, codes, store: app.get(MockUserStore), auth: app.get(AuthService) };
}

test('0/84/+84 share login and OTP cooldown; provider destination remains the stored phone', async () => {
  const f = await fixture();
  try {
    const a = await f.login(), b = await f.login('+84900000000'), c = await f.login('84900000000');
    assert.equal(a.user.id, b.user.id); assert.equal(a.user.id, c.user.id);
    await f.http('auth/forgot-password', 'POST', { phone_number: '+84900000000' });
    await f.http('auth/forgot-password', 'POST', { phone_number: '0900000000' });
    const messages = f.auth.testSms('+84900000000').messages;
    assert.equal(messages.length, 1); assert.equal(messages[0].phone_number, '0900000000');
    assert.equal((await f.http('auth/reset-password', 'POST', { phone_number: '84900000000', otp: messages[0].otp, new_password: 'PdfChangedFixture123!' })).status, 200);
    assert.equal((await f.http('auth/refresh', 'POST', {}, a.access_token)).status, 401);
    await f.login('+84900000000', 'PdfChangedFixture123!');
  } finally { await f.app.close(); }
});

test('profile name/email only update permitted fields; email proof belongs to current user and is one-use', async () => {
  const f = await fixture();
  try {
    const { access_token: token } = await f.login();
    assert.equal((await f.http('account/profile', 'PATCH', { user_name: 'Tên mới', role: 'Admin' }, token)).status, 400);
    const renamed = await f.http('account/profile', 'PATCH', { user_name: '  Nguyễn Văn An  ' }, token);
    assert.equal((await renamed.json()).user_name, 'Nguyễn Văn An');
    assert.equal((await f.http('account/email/request', 'POST', { gmail: 'new@fixture.invalid', gmail_verify: true }, token)).status, 400);
    const response = await f.http('account/email/request', 'POST', { gmail: 'NEW@fixture.invalid' }, token);
    assert.equal(response.status, 202); const proof = await response.json();
    assert.equal(f.store.user.gmail, null);
    const otp = f.codes.get('new@fixture.invalid'); assert(otp);
    const body = { verification_id: proof.verification_id, otp };
    assert.equal((await f.http('account/email/verify', 'POST', body, token)).status, 200);
    assert.equal(f.store.user.gmail, 'new@fixture.invalid'); assert.equal(f.store.user.gmail_verify, true);
    assert.equal((await f.http('account/email/verify', 'POST', body, token)).status, 400);
    const admin = await f.login('0900000001', 'PdfAdminFixture123!');
    assert.equal((await f.http('account/email/request', 'POST', { gmail: 'new@fixture.invalid' }, admin.access_token)).status, 409);
  } finally { await f.app.close(); }
});

test('authenticated password change requires old password AND its own SMS challenge, then revokes all old JWTs', async () => {
  const f = await fixture();
  try {
    const { access_token: token } = await f.login();
    assert.equal((await f.http('account/password/request', 'POST', { current_password: 'WrongFixture123!' }, token)).status, 400);
    assert.equal(f.auth.testSms('0900000000').messages.length, 0);
    assert.equal((await f.http('account/password/request', 'POST', { current_password: 'PdfAccountFixture123!' }, token)).status, 202);
    assert.equal((await f.http('account/password/request', 'POST', { current_password: 'PdfAccountFixture123!' }, token)).status, 429);
    const otp = f.auth.testSms('0900000000').messages[0].otp;
    assert.equal((await f.http('auth/reset-password', 'POST', { phone_number: '0900000000', otp, new_password: 'WrongPurposeFixture123!' })).status, 400);
    const body = { current_password: 'PdfAccountFixture123!', new_password: 'NewAccountFixture123!', otp };
    const outcomes = await Promise.all([f.http('account/password/confirm', 'POST', body, token), f.http('account/password/confirm', 'POST', body, token)]);
    assert.equal(outcomes.filter((response) => response.status === 200).length, 1);
    assert.equal((await f.http('auth/me', 'GET', undefined, token)).status, 401);
    await f.login('+84900000000', body.new_password);
  } finally { await f.app.close(); }
});

test('email proof cannot overwrite an address changed between verification and the write boundary', async () => {
  const f = await fixture();
  try {
    const { access_token: token } = await f.login();
    const issued = await f.http('account/email/request', 'POST', { gmail: 'pending@fixture.invalid' }, token);
    assert.equal(issued.status, 202); const proof = await issued.json();
    const original = f.store.updateProfile.bind(f.store);
    f.store.updateProfile = async (...args) => {
      f.store.user.gmail = 'changed-while-waiting@fixture.invalid'; f.store.user.gmail_verify = true;
      return original(...args);
    };
    assert.equal((await f.http('account/email/verify', 'POST', { verification_id: proof.verification_id, otp: f.codes.get('pending@fixture.invalid') }, token)).status, 400);
    assert.equal(f.store.user.gmail, 'changed-while-waiting@fixture.invalid');
  } finally { await f.app.close(); }
});

test('explicit activity renews a valid JWT; reads do not renew and expired JWT cannot refresh', async (t) => {
  const f = await fixture();
  try {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const { access_token: token } = await f.login();
    t.mock.timers.tick(14 * 60000);
    assert.equal((await f.http('auth/me', 'GET', undefined, token)).status, 200);
    const refreshed = await f.http('auth/refresh', 'POST', {}, token); assert.equal(refreshed.status, 200);
    const next = await refreshed.json();
    t.mock.timers.tick(2 * 60000);
    assert.equal((await f.http('auth/me', 'GET', undefined, token)).status, 401);
    assert.equal((await f.http('auth/me', 'GET', undefined, next.access_token)).status, 200);
    assert.equal((await f.http('auth/refresh', 'POST', {}, token)).status, 401);
  } finally { t.mock.timers.reset(); await f.app.close(); }
});
