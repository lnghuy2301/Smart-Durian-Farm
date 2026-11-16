import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { MockUserStore } from '../src/auth/mock-user.store';
import { LocalOtpProvider } from '../src/auth/sms/otp.provider';
import { MockSmsGateway } from '../src/auth/sms/sms.gateway';

const config = { mode: 'mock' as const, phoneNumber: '0900000000', password: 'AccountFixturePassword!', sms: { provider: 'mock' as const },
  jwtSecret: 'account-fixture-secret-at-least-32-bytes' };
const status = (value: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === value;

async function fixture() {
  const store = await MockUserStore.create(config);
  const otp = new LocalOtpProvider(new MockSmsGateway());
  return { store, auth: new AuthService(store, new JwtService({ secret: config.jwtSecret }), otp) };
}

test('async account snapshots are detached from later RAM edits and versions', async () => {
  const { store } = await fixture();
  const snapshot = (await store.loadById(store.user.id))!;
  store.user.status = 'Locked';
  store.revokeTokens(store.user.id);
  assert.equal(snapshot.user.status, 'Active');
  assert.equal(snapshot.tokenVersion, 0);
  snapshot.user.user_name = 'Detached';
  assert.notEqual(store.user.user_name, 'Detached');
});

test('login rechecks detached account after password verification before issuing JWT', async (t) => {
  const { store, auth } = await fixture();
  const load = store.loadByPhone.bind(store);
  t.mock.method(store, 'loadByPhone', async (phone: string) => {
    const snapshot = await load(phone);
    store.revokeTokens(store.user.id);
    return snapshot;
  });
  await assert.rejects(auth.login(config.phoneNumber, config.password), status(401));
});

test('OTP bound to old token version cannot reset a subsequently changed account', async () => {
  const { store, auth } = await fixture();
  await auth.forgotPassword(config.phoneNumber);
  const code = auth.testSms(config.phoneNumber).messages[0].otp;
  store.revokeTokens(store.user.id);
  await assert.rejects(auth.resetPassword(config.phoneNumber, code, 'NewFixturePassword!'), status(400));
  assert.equal(store.version, 1);
  assert.ok((await auth.login(config.phoneNumber, config.password)).access_token);
});

test('reset rechecks state at write boundary after OTP provider awaits', async (t) => {
  const { store, auth } = await fixture();
  await auth.forgotPassword(config.phoneNumber);
  const code = auth.testSms(config.phoneNumber).messages[0].otp;
  t.mock.method(store, 'replacePassword', async () => { store.user.status = 'Locked'; return false; });
  const originalHash = store.user.password;
  await assert.rejects(auth.resetPassword(config.phoneNumber, code, 'NewFixturePassword!'), status(400));
  assert.equal(store.user.password, originalHash);
  assert.equal(store.version, 0);
  await assert.rejects(auth.resetPassword(config.phoneNumber, code, 'NewFixturePassword!'), status(400));
});

test('verified OTP is consumed when database commit fails; retry requires new verification', async (t) => {
  const { store, auth } = await fixture();
  await auth.forgotPassword(config.phoneNumber);
  const code = auth.testSms(config.phoneNumber).messages[0].otp;
  const originalHash = store.user.password;
  t.mock.method(store, 'replacePassword', async () => { throw new ServiceUnavailableException('Database unavailable'); });
  await assert.rejects(auth.resetPassword(config.phoneNumber, code, 'NewFixturePassword!'), status(503));
  assert.equal(store.user.password, originalHash);
  assert.equal(store.version, 0);
  await assert.rejects(auth.resetPassword(config.phoneNumber, code, 'NewFixturePassword!'), status(400));
});
