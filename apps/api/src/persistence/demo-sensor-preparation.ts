import { Pool } from 'pg';
import { DEMO_STREAMS, DemoTelemetryError } from './demo-telemetry';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresCatalogRepository } from './postgres-catalog.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresTreesRepository } from './postgres-trees.repository';
import { PostgresDevicesRepository } from './postgres-devices.repository';
import { PostgresSensorsRepository } from './postgres-sensors.repository';
import { MIGRATIONS, migrationChecksum } from './migrations';

// Repair only the known old demo profile, through the normal owner repository.
// Each operation commits its audit/version independently: retries reuse it;
// this is deliberately not a bulk SQL update or an all-or-nothing transaction.
export async function prepareOfflineSensors(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const key of ['smart-durian:migrations', 'smart-durian:actuator-runtime']) {
      const result = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [key]);
      if (!result.rows[0].locked) throw new DemoTelemetryError('DEMO_STOP_API_AND_MIGRATIONS_FIRST');
    }
    const ledger = (await client.query('SELECT id,store,checksum FROM technical.schema_migrations ORDER BY id')).rows;
    if (JSON.stringify(ledger) !== JSON.stringify(MIGRATIONS.map((item) => ({ id: item.id, store: item.store, checksum: migrationChecksum(item.source) })))) {
      throw new DemoTelemetryError('DEMO_APPLY_CURRENT_MIGRATIONS_FIRST');
    }
    const users = new PostgresUsersRepository(pool), farms = new PostgresFarmsRepository(pool, users);
    const catalogs = new PostgresCatalogRepository(pool, users), zones = new PostgresZonesRepository(pool, users, farms, catalogs);
    const trees = new PostgresTreesRepository(pool, users, farms, zones);
    const devices = new PostgresDevicesRepository(pool, users, farms, zones, trees);
    const sensors = new PostgresSensorsRepository(pool, users, farms, zones, devices);
    const planned: { owner: string; device: string; stream: typeof DEMO_STREAMS[number]; sensorId?: string }[] = [];
    // Preflight every intended change first; unknown/custom units or stream
    // types are user configuration and must be discussed, never overwritten.
    for (let i = 1; i <= 2; i++) {
      const result = await client.query(`SELECT d.id,f.owner_id FROM public.devices d
        JOIN public.zones z ON z.id=d.zone_id JOIN public.farms f ON f.id=z.farm_id
        JOIN technical.entity_metadata m ON m.entity_type='devices' AND m.entity_key=d.id::text
        WHERE d.station_id=$1 AND m.data->>'seed_key'=$2 AND m.data->>'seed_origin'='Simulated'`,
      [`SIM_DEMO_00${i}`, `durian-demo-v1:device-sim-${i}`]);
      if (result.rowCount !== 1) throw new DemoTelemetryError('DEMO_SIMULATED_METADATA_REQUIRED');
      const device = result.rows[0];
      const existing = (await client.query('SELECT id,data_stream_id,sensor_type,unit FROM public.sensors WHERE device_id=$1', [device.id])).rows;
      if (existing.some((row) => !DEMO_STREAMS.some((stream) => stream.id === row.data_stream_id))) throw new DemoTelemetryError('DEMO_CUSTOM_SENSOR_CONFIGURATION');
      for (const stream of DEMO_STREAMS) {
        const row = existing.find((row) => row.data_stream_id === stream.id);
        if (row && (row.sensor_type !== stream.type || (row.unit !== stream.unit && !(stream.id === '303' && row.unit === '%') && !(stream.id === '306' && row.unit === '\u03bcS/cm')))) {
          throw new DemoTelemetryError('DEMO_CUSTOM_SENSOR_CONFIGURATION');
        }
        if (!row || row.unit !== stream.unit) planned.push({ owner: device.owner_id, device: device.id, stream, sensorId: row?.id });
      }
    }
    let created = 0, updated = 0;
    for (const item of planned) {
      if (item.sensorId) { await sensors.update(item.owner, item.sensorId, { unit: item.stream.unit }); updated++; }
      else {
        await sensors.create(item.owner, { device_id: item.device, data_stream_id: item.stream.id,
          sensor_type: item.stream.type, name: `Demo ${item.stream.type}`, unit: item.stream.unit });
        created++;
      }
    }
    await client.query('COMMIT');
    return { created_sensors: created, updated_sensor_units: updated, real_device_changes: 0 };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}
