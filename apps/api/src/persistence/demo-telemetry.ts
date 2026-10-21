import { ObjectId, Db, MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { TelemetryRecord } from '../telemetry/telemetry.types';
import { MIGRATIONS, migrationChecksum } from './migrations';
import { MongoTelemetryStore } from './mongo-telemetry.store';

export class DemoTelemetryError extends Error {}
export const DEMO_STREAMS = [
  { id: '301', type: 'air_temperature', unit: 'C' },
  { id: '302', type: 'air_humidity', unit: '%' },
  { id: '303', type: 'soil_moisture', unit: '%rH' },
  { id: '304', type: 'soil_temperature', unit: 'C' },
  { id: '305', type: 'soil_ph', unit: 'H+' },
  { id: '306', type: 'soil_ec', unit: 'µS/cm' },
] as const;

// A bounded, deliberately synthetic 30-minute trace, not firmware replay or
// agronomic advice. Two sites vary independently; soil responds more slowly.
export function demoTelemetryReadings(devices: string[], now: Date): TelemetryRecord[] {
  if (devices.length !== 2 || new Set(devices).size !== 2 || !Number.isFinite(now.getTime())) {
    throw new DemoTelemetryError('DEMO_INVALID_GENERATOR_INPUT');
  }
  const records: TelemetryRecord[] = [];
  const end = now.getTime() - 1000;
  for (let tick = 0; tick < 120; tick++) {
    for (const [site, device] of devices.entries()) {
      const phase = tick / 119 * Math.PI * 2;
      const air = 28.5 + site * 1.2 + 2 * Math.sin(phase);
      const values = [air, 79 - (air - 28.5) * 3 + Math.sin(phase * 3),
        53 + site * 7 + 3 * Math.sin(phase / 2) - tick * 0.025,
        26.8 + site * 0.5 + 0.6 * Math.sin(phase - 0.4),
        6.1 + site * 0.25 + 0.08 * Math.sin(phase),
        720 + site * 110 + 35 * Math.sin(phase + 0.5)];
      const measured = end - (119 - tick) * 15000;
      for (const [index, stream] of DEMO_STREAMS.entries()) {
        records.push({ _id: new ObjectId().toHexString(), device_id: device,
          data_stream_id: stream.id, value: Number(values[index].toFixed(2)), unit: stream.unit,
          measured_at: new Date(measured).toISOString(), received_at: new Date(measured + 20 + site * 5).toISOString() });
      }
    }
  }
  return records;
}

export async function seedOfflineTelemetry(pool: Pool, mongo: MongoClient, db: Db, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='30s'");
    for (const key of ['smart-durian:migrations', 'smart-durian:actuator-runtime']) {
      const result = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [key]);
      if (!result.rows[0].locked) throw new DemoTelemetryError('DEMO_STOP_API_AND_MIGRATIONS_FIRST');
    }
    // Lock the seed manifest/metadata while resolving exact synthetic stations.
    // No SQL business writes or fake connectivity updates are performed here.
    await client.query('LOCK TABLE public.devices,public.sensors,technical.entity_metadata,technical.schema_migrations IN SHARE MODE NOWAIT');
    const ledger = (await client.query('SELECT id,store,checksum FROM technical.schema_migrations ORDER BY id')).rows;
    if (JSON.stringify(ledger) !== JSON.stringify(MIGRATIONS.map((item) => ({ id: item.id, store: item.store, checksum: migrationChecksum(item.source) })))) {
      throw new DemoTelemetryError('DEMO_APPLY_CURRENT_MIGRATIONS_FIRST');
    }
    const devices: string[] = [];
    for (let i = 1; i <= 2; i++) {
      const result = await client.query(`SELECT d.id FROM public.devices d
        JOIN technical.entity_metadata m ON m.entity_type='devices' AND m.entity_key=d.id::text
        WHERE d.station_id=$1 AND m.data->>'seed_key'=$2 AND m.data->>'seed_origin'='Simulated'`,
      [`SIM_DEMO_00${i}`, `durian-demo-v1:device-sim-${i}`]);
      if (result.rowCount !== 1) throw new DemoTelemetryError('DEMO_SIMULATED_METADATA_REQUIRED');
      const id = result.rows[0].id as string;
      const sensors = (await client.query('SELECT data_stream_id,sensor_type,unit FROM public.sensors WHERE device_id=$1 ORDER BY data_stream_id', [id])).rows;
      if (sensors.length !== 6 || !DEMO_STREAMS.every((stream, index) => sensors[index].data_stream_id === stream.id && sensors[index].sensor_type === stream.type && sensors[index].unit === stream.unit)) {
        throw new DemoTelemetryError('DEMO_SIMULATED_SENSOR_MAPPING_MISMATCH');
      }
      devices.push(id);
    }
    const records = demoTelemetryReadings(devices, now);
    // Offline import intentionally does not pretend the Inactive/Maintenance
    // simulated hardware was connected. The live receiver's Active gates and
    // backend-arrival timestamp policy are unchanged. Mongo commits separately
    // from this read-only PG scope; a retry refuses nonempty Mongo after success.
    await new MongoTelemetryStore(mongo, db).initializeEmptyDemo(records);
    await client.query('COMMIT');
    return { profile: 'offline-telemetry-v1', inserted_readings: records.length, simulated_devices: devices.length,
      cadence_seconds: 15, samples_per_stream: 120, real_device_readings_inserted: 0 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
