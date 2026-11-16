import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { readEnvironment } from '../src/config/environment';
import { AuthModule } from '../src/auth/auth.module';
import { DisabledSmsGateway } from '../src/auth/sms/sms.gateway';

const config = () => ({ NODE_ENV: 'production', AUTH_MODE: 'database', BUSINESS_STORAGE: 'database',
  DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/fixture', MONGODB_URI: 'mongodb://127.0.0.1:1/fixture',
  JWT_SECRET: randomBytes(48).toString('hex'), CORS_ORIGINS: 'https://farm.example.com', TRACE_PUBLIC_BASE_URL: 'https://farm.example.com' });

test('production uses database accounts without reading or bootstrapping test credentials', () => {
  const result = readEnvironment({ ...config(), AUTH_TEST_PHONE: 'not-a-phone', AUTH_TEST_PASSWORD: 'x', AUTH_TEST_ADMIN_PHONE: 'x' });
  assert.equal(result.auth?.mode, 'database');
  assert.equal(result.auth?.phoneNumber, '');
  assert.equal(result.auth?.password, '');
  assert.equal(result.auth?.admin, undefined);
  assert.equal(result.auth?.sms.provider, 'disabled');
  assert.equal(result.host, '127.0.0.1');
  assert.equal(result.production, true);
  assert.throws(() => AuthModule.forMock(result.auth!), /Memory Auth/);
});

test('production rejects RAM, disabled/mock Auth, mock OTP, insecure origins and sample JWT secrets', () => {
  for (const override of [{ BUSINESS_STORAGE: 'memory' }, { AUTH_MODE: 'mock' }, { AUTH_MODE: 'disabled' },
    { SMS_PROVIDER: 'mock' }, { CORS_ORIGINS: 'http://farm.example.com' }, { CORS_ORIGINS: '' },
    { TRACE_PUBLIC_BASE_URL: 'http://farm.example.com' }, { JWT_SECRET: 'local-test-only-secret-change-this-32-bytes-minimum' }]) {
    assert.throws(() => readEnvironment({ ...config(), ...override }));
  }
});

test('container binding is explicit and never allowed for the mock runtime', () => {
  assert.equal(readEnvironment({ ...config(), API_HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.throws(() => readEnvironment({ ...config(), NODE_ENV: 'test', AUTH_MODE: 'mock', API_HOST: '0.0.0.0' }), /loopback/);
  assert.throws(() => readEnvironment({ ...config(), API_HOST: 'untrusted-host' }));
});

test('production Twilio keeps explicit allowlists independent of retained demo account notes', () => {
  const result = readEnvironment({ ...config(), SMS_PROVIDER: 'twilio', SMS_ALLOWED_PHONE: '0900000000',
    AUTH_TEST_PHONE: '0900000002', TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'b'.repeat(32),
    TWILIO_VERIFY_SERVICE_SID: `VA${'c'.repeat(32)}`, HTX_SMS_ALLOWED_PHONES: '0900000001' });
  assert.equal(result.auth?.cooperativeSms?.serviceSid, `VA${'c'.repeat(32)}`);
  assert.equal(result.auth?.sms.provider, 'twilio');
  assert.equal(result.auth?.phoneNumber, '');
});

test('disabled SMS never stores or exposes a local OTP', async () => {
  const gateway = new DisabledSmsGateway();
  await assert.rejects(gateway.send(), /SMS/);
  assert.deepEqual(gateway.messages(), []);
  assert.equal(gateway.mode, 'disabled');
});
