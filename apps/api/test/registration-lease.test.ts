import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { MockUserStore } from '../src/auth/mock-user.store';
import { MemoryUserManagement } from '../src/users/memory-user-management';
import { MockCooperativeStore } from '../src/users/mock-cooperative.store';
import { EmailVerificationService } from '../src/users/email/email-verification.service';

const phone = '0900000002', gmail = 'lease@example.invalid';
async function fixture() {
  const users = await MockUserStore.create({ mode: 'mock', phoneNumber: '0900000000', password: 'LeaseFixturePassword!',
    jwtSecret: 'lease-fixture-secret-at-least-32-bytes', sms: { provider: 'mock' } });
  let code = '';
  const service = new EmailVerificationService({ async sendVerification(_to: string, otp: string) { code = otp; } },
    new MemoryUserManagement(users, new MockCooperativeStore()));
  const issued = await service.request(phone, gmail);
  const proof = service.verify({ phone_number: phone, gmail, verification_id: issued.verification_id, otp: code });
  return { service, token: proof.email_verification_token };
}

test('registration lease prevents proof replay/resend while a database commit awaits, even beyond expiry', async () => {
  const { service, token } = await fixture();
  const challenge = service.requireProof(phone, gmail, token);
  let resolve!: (value: string) => void;
  const write = new Promise<string>((done) => { resolve = done; });
  const creating = service.consumeForRegistrationAsync(phone, gmail, token, () => write);
  assert.equal(challenge.state, 'committing');
  await assert.rejects(service.consumeForRegistrationAsync(phone, gmail, token, async () => 'duplicate'));
  challenge.nextSendAt = 0; challenge.expiresAt = Date.now() - 1;
  await assert.rejects(service.request(phone, gmail), (error: unknown) => error instanceof HttpException && error.getStatus() === 429);
  resolve('committed');
  assert.equal(await creating, 'committed', 'must not return failure solely because deadline passed after reservation');
  assert.equal(challenge.state, 'consumed');
  assert.throws(() => service.requireProof(phone, gmail, token));
});

test('a known unique rejection releases an unexpired proof reservation without claiming verification again', async () => {
  const { service, token } = await fixture();
  await assert.rejects(service.consumeForRegistrationAsync(phone, gmail, token, async () => { throw new ConflictException('Duplicate account'); }));
  assert.equal(service.requireProof(phone, gmail, token).state, 'verified');
  assert.equal(await service.consumeForRegistrationAsync(phone, gmail, token, async () => 'created'), 'created');
});

test('uncertain database outcomes consume proof and never permit blind retry', async () => {
  const { service, token } = await fixture();
  await assert.rejects(service.consumeForRegistrationAsync(phone, gmail, token, async () => { throw new ServiceUnavailableException('Unknown commit outcome'); }));
  assert.throws(() => service.requireProof(phone, gmail, token));
  await assert.rejects(service.consumeForRegistrationAsync(phone, gmail, token, async () => 'replay'));
});

test('expired proof cannot reserve or call the database writer', async () => {
  const { service, token } = await fixture();
  service.requireProof(phone, gmail, token).expiresAt = Date.now() - 1;
  let calls = 0;
  await assert.rejects(service.consumeForRegistrationAsync(phone, gmail, token, async () => { calls++; }));
  assert.equal(calls, 0);
});

test('a freshly constructed email service cannot reuse proof from the previous instance', async () => {
  const old = await fixture(), fresh = await fixture();
  await assert.rejects(fresh.service.consumeForRegistrationAsync(phone, gmail, old.token, async () => 'replay'));
  assert.equal(fresh.service.requireProof(phone, gmail, fresh.token).state, 'verified');
});
