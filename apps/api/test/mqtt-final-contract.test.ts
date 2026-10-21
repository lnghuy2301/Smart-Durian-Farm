import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildControlPublication, MQTT_RETURN_TOPIC, parseIncoming } from '../src/mqtt/mqtt.protocol';

const station = 'CONTRACT_TEST_STATION';
const upstream = `publish/station/${station}`;
const packet = (body: unknown) => Buffer.from(JSON.stringify(body), 'utf8');

test('Final hardware packet preserves six unordered streams, exact raw units and decimal values', () => {
  // Copy of the hardware-tested sample, with only the deployment station replaced.
  const sensorRecords = [
    { dataStreamId: 302, result: '81.22 %' },
    { dataStreamId: 301, result: '28.86 C' },
    { dataStreamId: 303, result: '4.40 %rH' },
    { dataStreamId: 304, result: '28.00 C' },
    { dataStreamId: 305, result: '8.50 H+' },
    { dataStreamId: 306, result: '0.00 µS/cm' },
  ];
  const result = parseIncoming(upstream, packet({ stationId: station, sensorRecords }));
  assert.equal(result.kind, 'Telemetry');
  if (result.kind !== 'Telemetry') assert.fail();
  assert.deepEqual(result.readings, sensorRecords.map((reading) => ({
    dataStreamId: String(reading.dataStreamId), value: Number(reading.result.split(' ')[0]),
    receivedUnit: reading.result.split(' ')[1], rawResult: reading.result,
  })));
  assert.equal(result.readings[5].receivedUnit.codePointAt(0), 0x00b5);
});

test('Protocol does not reinterpret unit case or Unicode variants from previous metadata', () => {
  const units = ['%rH', '%RH', 'µS/cm', 'μS/cm'];
  const result = parseIncoming(upstream, packet({ sensorRecords: units.map((unit, i) => ({ dataStreamId: 401 + i, result: `1 ${unit}` })) }));
  if (result.kind !== 'Telemetry') assert.fail();
  assert.deepEqual(result.readings.map((reading) => reading.receivedUnit), units);
});

test('Final command freezes topic, numeric action and correlation fields without adding backend fields', () => {
  assert.equal(MQTT_RETURN_TOPIC, 'publish/station/+');
  for (const action of [0, 1] as const) {
    const publication = buildControlPublication(station, [{ taskId: 9001, taskingCapabilityId: 2 }], action);
    assert.equal(publication.topic, `subscribe/station/${station}`);
    assert.deepEqual(JSON.parse(publication.payload), {
      targets: [{ taskId: 9001, taskingCapabilityId: 2 }], taskingParameters: { actionType: 'control', action },
    });
    assert.deepEqual(parseIncoming(upstream, packet({ taskId: 9001, status: 'ACK', action })),
      { kind: 'Ack', stationId: station, taskId: 9001, action });
  }
});

test('ACK-shaped packets with invalid status are diagnosed rather than treated as valid presence', () => {
  for (const status of ['ack', 'Confirmed', 'ON', '', null, 1, undefined]) {
    assert.throws(() => parseIncoming(upstream, packet({ taskId: 9001, status, action: 1 })), /INVALID_ACK_STATUS/);
  }
  assert.equal(parseIncoming(upstream, packet({ message: 'unsupported' })).kind, 'Unknown');
  assert.throws(() => parseIncoming(upstream, packet({ stationId: 'ANOTHER_STATION', taskId: 9001, status: 'ACK', action: 1 })), /STATION_MISMATCH/);
});
