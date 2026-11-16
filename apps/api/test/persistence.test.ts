import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { readSeedConfig } from '../src/persistence/seed-config';
import { decimalNumber, safeInteger, toMongoRecord, fromMongoRecord } from '../src/persistence/mappers';
import { CultivationEvent } from '../src/cultivation-events/cultivation-events.types';
import { eventHash } from '../src/cultivation-events/cultivation-chain';
import { migrationChecksum } from '../src/persistence/migrations';
import { formatPersistenceError } from '../src/persistence/cli';

export const seedTestEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test', AUTH_TEST_PHONE: '0900000000', AUTH_TEST_PASSWORD: 'FixtureFarmerPassword!',
  AUTH_TEST_ADMIN_PHONE: '0900000001', AUTH_TEST_ADMIN_PASSWORD: 'FixtureAdminPassword!',
  DEMO_DEVICE_STATION_ID: 'TEST_ESP32_001', DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00', DEMO_DEVICE_COST: '10237500',
};

test('seed preflight normalizes timestamp and keeps hardware mapping config', () => {
  const config = readSeedConfig(seedTestEnvironment);
  assert.equal(config.device.installedAt, '2026-09-01T01:30:00.000Z');
  assert.equal(config.device.cost, 10237500);
  assert.equal(config.device.stationId, 'TEST_ESP32_001');
});
test('seed rejects each missing installation field without placeholder fallbacks', () => {
  for (const key of ['DEMO_DEVICE_STATION_ID', 'DEMO_DEVICE_INSTALLED_AT', 'DEMO_DEVICE_COST']) {
    assert.throws(() => readSeedConfig({ ...seedTestEnvironment, [key]: '' }), new RegExp(key));
  }
});
test('seed validates strict dates, finite cost, precision and station MQTT segment', () => {
  for (const [key, values] of Object.entries({
    DEMO_DEVICE_INSTALLED_AT: ['2026-02-30T08:30:00+07:00', '2026-09-01T08:30:00', 'yesterday'],
    DEMO_DEVICE_COST: ['NaN', '-1', '100000000', '10.123', '1e7'],
    DEMO_DEVICE_STATION_ID: ['station/other', '#', 'SIM_DEMO_001'],
  })) {
    for (const value of values) { assert.throws(() => readSeedConfig({ ...seedTestEnvironment, [key]: value })); }
  }
});
test('seed rejects normalized identity collisions and synthetic phones in real SMS allowlist', () => {
  assert.throws(() => readSeedConfig({ ...seedTestEnvironment, AUTH_TEST_ADMIN_PHONE: '+84900000000' }), /collide/);
  assert.throws(() => readSeedConfig({ ...seedTestEnvironment, SMS_ALLOWED_PHONE: '+84990000011' }), /allowlisted/);
  assert.throws(() => readSeedConfig({ ...seedTestEnvironment, NODE_ENV: 'production' }), /NODE_ENV/);
});
test('SQL decimal and bigint mappings reject imprecise JSON integers', () => {
  assert.equal(decimalNumber('10.237'), 10.237);
  assert.equal(safeInteger('9007199254740991'), Number.MAX_SAFE_INTEGER);
  for (const value of ['9007199254740992', '1.5', 'Infinity', '']) { assert.throws(() => safeInteger(value)); }
});
test('Mongo BSON roundtrip preserves exact cultivation canonical hash and snapshots', () => {
  const event: CultivationEvent = { _id: new ObjectId().toHexString(), farmer_id: randomUUID(), target_id: randomUUID(),
    target_type: 'Tree', action_type: 'Watering', details: { standard_snapshot: { standard_id: randomUUID(), code: 'DEMO', name: 'Mẫu' }, note: null, duration_minutes: 20, warnings: [] },
    status: 'Locked', is_correction: false, reference_event_id: null, root_event_id: null, correction_reason: null,
    created_at: '2026-10-10T01:00:00.000Z', lock_at: '2026-10-10T01:15:00.000Z', locked_at: '2026-10-10T01:15:01.000Z',
    previous_hash: null, hash: null };
  event.hash = eventHash(event);
  const ids = ['_id', 'reference_event_id', 'root_event_id'];
  const dates = ['created_at', 'locked_at', 'lock_at'];
  const stored = toMongoRecord({ ...event }, ids, dates);
  assert.ok(stored._id instanceof ObjectId);
  assert.ok(stored.lock_at instanceof Date);
  const wire = fromMongoRecord(stored, ids, dates);
  assert.deepEqual(wire, event);
  assert.equal(eventHash(wire as unknown as CultivationEvent), event.hash);
});
test('Mongo mapper refuses timezone strings that would silently change hash payload', () => {
  assert.throws(() => toMongoRecord({ created_at: '2026-10-10T08:00:00+07:00' }, [], ['created_at']), /canonical/);
  assert.throws(() => toMongoRecord({ _id: 'wrong' }, ['_id'], []), /ObjectId/);
});
test('migration checksum detects byte-level source changes', () => {
  assert.equal(migrationChecksum('SELECT 1'), migrationChecksum('SELECT 1'));
  assert.notEqual(migrationChecksum('SELECT 1'), migrationChecksum('SELECT 1;'));
});
test('CLI errors preserve safe codes and field names while hiding driver details and secrets', () => {
  const secret = 'fixture-secret-not-for-logs';
  for (const error of [{ code: '23505', message: `Seed ${secret}`, detail: secret },
    { code: 121, message: secret }, new Error(`mongodb://user:${secret}@example.invalid/db`)]) {
    assert.equal(formatPersistenceError(error).includes(secret), false);
  }
  assert.match(formatPersistenceError({ code: 121, message: secret }), /\[121\]/);
  assert.match(formatPersistenceError(new Error('Invalid DEMO_DEVICE_COST')), /DEMO_DEVICE_COST/);
});
