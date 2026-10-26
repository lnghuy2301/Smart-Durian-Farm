import { createHash } from 'node:crypto';
import { Db } from 'mongodb';
import { Pool, PoolClient } from 'pg';
import { POSTGRES_SCHEMA_V1 } from './postgres-schema';
import { applyMongoSchema, MONGO_SCHEMA_V1 } from './mongo-schema';
import { COOPERATIVE_SCHEMA_V2 } from './cooperative-schema';
import { COOPERATIVE_WORKFLOW_SCHEMA } from './cooperative-workflow-schema';
import { FARM_WORKFLOW_SCHEMA } from './farm-workflow-schema';
import { SENSOR_TYPES_SCHEMA } from './sensor-types-schema';
import { ZONE_WORKFLOW_SCHEMA } from './zone-workflow-schema';
import { ASSIGNMENT_WORKFLOW_SCHEMA } from './assignment-workflow-schema';
import { TREE_WORKFLOW_SCHEMA } from './tree-workflow-schema';
import { HARVEST_WORKFLOW_SCHEMA } from './harvest-workflow-schema';
import { DEVICE_WORKFLOW_SCHEMA } from './device-workflow-schema';
import { SENSOR_WORKFLOW_SCHEMA } from './sensor-workflow-schema';
import { ACTUATOR_WORKFLOW_SCHEMA } from './actuator-workflow-schema';
import { applyCultivationStateSchema, CULTIVATION_STATE_SCHEMA } from './cultivation-state-schema';
import { applyCultivationOtherSchema, CULTIVATION_OTHER_SCHEMA } from './cultivation-other-schema';
import { MATERIAL_DOSAGE_SCHEMA } from './material-dosage-schema';
import { AI_MONGO_SCHEMA, applyAiSchema } from './ai-schema';
import { AI_SOURCE_SCHEMA } from './ai-source-schema';

export interface MigrationDefinition {
  id: string;
  store: 'postgres' | 'mongo';
  source: string;
  apply(client: PoolClient, db: Db): Promise<void>;
}
export const MIGRATIONS: MigrationDefinition[] = [
  { id: '001_postgres_core', store: 'postgres', source: POSTGRES_SCHEMA_V1,
    apply: async (client) => { await client.query(POSTGRES_SCHEMA_V1); } },
  { id: '002_mongo_core', store: 'mongo', source: JSON.stringify(MONGO_SCHEMA_V1),
    apply: async (_client, db) => { await applyMongoSchema(db); } },
  { id: '003_cooperative_certificate', store: 'postgres', source: COOPERATIVE_SCHEMA_V2,
    apply: async (client) => { await client.query(COOPERATIVE_SCHEMA_V2); } },
  { id: '004_cooperative_workflow', store: 'postgres', source: COOPERATIVE_WORKFLOW_SCHEMA,
    apply: async (client) => { await client.query(COOPERATIVE_WORKFLOW_SCHEMA); } },
  { id: '005_farm_workflow', store: 'postgres', source: FARM_WORKFLOW_SCHEMA,
    apply: async (client) => { await client.query(FARM_WORKFLOW_SCHEMA); } },
  { id: '006_sensor_types', store: 'postgres', source: SENSOR_TYPES_SCHEMA,
    apply: async (client) => { await client.query(SENSOR_TYPES_SCHEMA); } },
  { id: '007_zone_workflow', store: 'postgres', source: ZONE_WORKFLOW_SCHEMA,
    apply: async (client) => { await client.query(ZONE_WORKFLOW_SCHEMA); } },
  { id: '008_assignment_workflow', store: 'postgres', source: ASSIGNMENT_WORKFLOW_SCHEMA,
    apply: async (client) => { await client.query(ASSIGNMENT_WORKFLOW_SCHEMA); } },
  { id: '009_tree_workflow', store: 'postgres', source: TREE_WORKFLOW_SCHEMA,
    apply: async (client) => { await client.query(TREE_WORKFLOW_SCHEMA); } },
  { id: '010_harvest_workflow', store: 'postgres', source: HARVEST_WORKFLOW_SCHEMA,
    apply: async (client) => { await client.query(HARVEST_WORKFLOW_SCHEMA); } },
  { id: '011_device_workflow', store: 'postgres', source: DEVICE_WORKFLOW_SCHEMA,
    apply: async (client) => { await client.query(DEVICE_WORKFLOW_SCHEMA); } },
  { id: '012_sensor_workflow', store: 'postgres', source: SENSOR_WORKFLOW_SCHEMA,
    apply: async (client) => { await client.query(SENSOR_WORKFLOW_SCHEMA); } },
  { id: '013_actuator_workflow', store: 'postgres', source: ACTUATOR_WORKFLOW_SCHEMA,
    apply: async (client) => { await client.query(ACTUATOR_WORKFLOW_SCHEMA); } },
  { id: '014_cultivation_ledger', store: 'mongo', source: JSON.stringify(CULTIVATION_STATE_SCHEMA),
    apply: async (_client, db) => { await applyCultivationStateSchema(db); } },
  { id: '015_cultivation_other', store: 'mongo', source: JSON.stringify(CULTIVATION_OTHER_SCHEMA),
    apply: async (_client, db) => { await applyCultivationOtherSchema(db); } },
  { id: '016_material_dosage', store: 'postgres', source: MATERIAL_DOSAGE_SCHEMA,
    apply: async (client) => { await client.query(MATERIAL_DOSAGE_SCHEMA); } },
  { id: '017_ai_foundation', store: 'mongo', source: JSON.stringify(AI_MONGO_SCHEMA),
    apply: async (_client, db) => { await applyAiSchema(db); } },
  { id: '018_ai_source_provenance', store: 'mongo', source: JSON.stringify(AI_SOURCE_SCHEMA),
    apply: async (_client, db) => { await applyAiSchema(db, AI_SOURCE_SCHEMA); } },
];
export function migrationChecksum(source: string): string { return createHash('sha256').update(source).digest('hex'); }

export async function runMigrations(pool: Pool, db: Db, definitions = MIGRATIONS): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  let locked = false;
  try {
    // Session lock tồn tại xuyên các transaction và Mongo DDL; hai CLI không chạy song song.
    await client.query("SELECT pg_advisory_lock(hashtextextended('smart-durian:migrations',0))");
    locked = true;
    await client.query('CREATE SCHEMA IF NOT EXISTS technical');
    await client.query(`CREATE TABLE IF NOT EXISTS technical.schema_migrations
      (id text PRIMARY KEY, store text NOT NULL, checksum varchar(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const previous = await client.query<{ id: string; store: string; checksum: string }>('SELECT id,store,checksum FROM technical.schema_migrations ORDER BY id');
    if (new Set(definitions.map((entry) => entry.id)).size !== definitions.length) { throw new Error('Duplicate migration ID'); }
    for (const row of previous.rows) {
      const definition = definitions.find((entry) => entry.id === row.id);
      if (!definition || row.store !== definition.store || row.checksum !== migrationChecksum(definition.source)) {
        throw new Error('Migration history mismatch; use the correct source revision');
      }
    }
    let gap = false;
    for (const definition of definitions) {
      if (previous.rows.some((row) => row.id === definition.id)) {
        if (gap) { throw new Error('Migration history contains a gap'); }
        continue;
      }
      gap = true;
      await client.query('BEGIN');
      try {
        await definition.apply(client, db);
        await client.query('INSERT INTO technical.schema_migrations(id,store,checksum) VALUES ($1,$2,$3)',
          [definition.id, definition.store, migrationChecksum(definition.source)]);
        await client.query('COMMIT');
        applied.push(definition.id);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    return applied;
  } finally {
    if (locked) { await client.query("SELECT pg_advisory_unlock(hashtextextended('smart-durian:migrations',0))").catch(() => undefined); }
    client.release();
  }
}

export async function migrationStatus(pool: Pool) {
  const exists = await pool.query("SELECT to_regclass('technical.schema_migrations') AS name");
  const rows = exists.rows[0].name ? (await pool.query('SELECT id,store,checksum,applied_at FROM technical.schema_migrations ORDER BY id')).rows : [];
  const result = MIGRATIONS.map((definition) => {
    const stored = rows.find((row) => row.id === definition.id);
    return { id: definition.id, store: definition.store, state: !stored ? 'Pending' :
      stored.checksum === migrationChecksum(definition.source) && stored.store === definition.store ? 'Applied' : 'Mismatch' };
  });
  return [...result, ...rows.filter((row) => !MIGRATIONS.some((definition) => definition.id === row.id))
    .map((row) => ({ id: row.id as string, store: row.store as string, state: 'Unknown' }))];
}
