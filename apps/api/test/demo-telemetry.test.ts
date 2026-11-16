import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { demoTelemetryReadings, DEMO_STREAMS } from '../src/persistence/demo-telemetry';
import { offlineTelemetryCommand } from '../src/persistence/demo-telemetry-cli';

test('offline trace has bounded, diverse six-stream history with exact units and past timestamps', () => {
  const ids = [randomUUID(), randomUUID()], now = new Date('2026-10-21T08:00:00.000Z');
  const rows = demoTelemetryReadings(ids, now);
  assert.equal(rows.length, 1440);
  assert.equal(new Set(rows.map((row) => row._id)).size, rows.length);
  for (const device of ids) for (const stream of DEMO_STREAMS) {
    const readings = rows.filter((row) => row.device_id === device && row.data_stream_id === stream.id);
    assert.equal(readings.length, 120);
    assert(new Set(readings.map((row) => row.value)).size > 10);
    for (const [index, row] of readings.entries()) {
      assert.equal(row.unit, stream.unit);
      assert(Number.isFinite(row.value));
      assert(Date.parse(row.measured_at) < Date.parse(row.received_at));
      assert(Date.parse(row.received_at) < now.getTime());
      if (index) assert.equal(Date.parse(row.measured_at) - Date.parse(readings[index - 1].measured_at), 15000);
    }
  }
});

test('offline demo rejects invalid scope and production before connecting to any services', async () => {
  assert.throws(() => demoTelemetryReadings([], new Date()), /INVALID_GENERATOR/);
  assert.throws(() => demoTelemetryReadings(['same', 'same'], new Date()), /INVALID_GENERATOR/);
  assert.throws(() => demoTelemetryReadings(['a', 'b'], new Date(NaN)), /INVALID_GENERATOR/);
  await assert.rejects(offlineTelemetryCommand({ NODE_ENV: 'production' }), /DISABLED_IN_PRODUCTION/);
  await assert.rejects(offlineTelemetryCommand({}), /CONFIGURE_DATABASE/);
});
