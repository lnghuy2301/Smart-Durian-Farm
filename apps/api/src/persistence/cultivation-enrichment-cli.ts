import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { DatabaseService } from '../database/database.service';
import { backupCommand } from './backup-cli';
import { applyCultivationEnrichment, planCultivationEnrichment } from './cultivation-enrichment';

export async function cultivationEnrichmentCommand(command: string, env: NodeJS.ProcessEnv) {
  if (!['development', 'test'].includes(env.NODE_ENV ?? '') || !['preview', 'apply'].includes(command)) throw new Error('CULTIVATION_ENRICHMENT_LOCAL_PREVIEW_OR_APPLY_REQUIRED');
  const database = new DatabaseService({ postgresUrl: env.DATABASE_URL ?? '', mongoUri: env.MONGODB_URI ?? '', timeoutMs: 30000 });
  try {
    if (command === 'preview') {
      const plan = await planCultivationEnrichment(database.postgres, database.mongo.db());
      const actions: Record<string, number> = {};
      for (const e of plan.entries) actions[e.input.action_type] = (actions[e.input.action_type] ?? 0) + 1;
      console.log(JSON.stringify({ complete: plan.complete, planned: plan.entries.length, zones: new Set(plan.entries.map((e) => e.zone)).size, actions })); return;
    }
    await backupCommand('create', '', env);
    const lease = await database.postgres.connect();
    try {
      await lease.query('BEGIN');
      for (const key of ['smart-durian:migrations', 'smart-durian:actuator-runtime']) {
        if (!(await lease.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked', [key])).rows[0].locked) throw new Error('CULTIVATION_ENRICHMENT_STOP_API_FIRST');
      }
      console.log(JSON.stringify(await applyCultivationEnrichment(database.postgres, database.mongo, database.mongo.db())));
      await lease.query('COMMIT');
    } catch (error) { await lease.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { lease.release(); }
    await backupCommand('create', '', env);
  } finally { await database.onApplicationShutdown(); }
}
if (require.main === module) {
  loadEnv({ path: resolve(__dirname, '../../../../.env') });
  void cultivationEnrichmentCommand(process.argv[2] ?? 'preview', process.env).catch(() => {
    console.error('CULTIVATION_ENRICHMENT_FAILED_STOP_API_CHECK_DATABASE_AND_RETRY_NO_DATA_RESET'); process.exitCode = 1;
  });
}
