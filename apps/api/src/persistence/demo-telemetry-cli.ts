import 'reflect-metadata';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { DatabaseService } from '../database/database.service';
import { DemoTelemetryError, seedOfflineTelemetry } from './demo-telemetry';
import { DemoTelemetryOccupiedError } from './mongo-telemetry.store';
import { prepareOfflineSensors } from './demo-sensor-preparation';

export async function offlineTelemetryCommand(env: NodeJS.ProcessEnv, mode = 'seed') {
  if (!['seed', 'prepare'].includes(mode)) throw new DemoTelemetryError('DEMO_USE_SEED_OR_PREPARE');
  if (env.NODE_ENV === 'production') throw new DemoTelemetryError('DEMO_DISABLED_IN_PRODUCTION');
  const postgresUrl = env.DATABASE_URL ?? '', mongoUri = env.MONGODB_URI ?? '';
  if (!/^postgres(ql)?:\/\//.test(postgresUrl) || !/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
    throw new DemoTelemetryError('DEMO_CONFIGURE_DATABASE_URL_AND_MONGODB_URI');
  }
  const database = new DatabaseService({ postgresUrl, mongoUri, timeoutMs: 30000 });
  try {
    if ((await database.readiness()).status !== 'ok') throw new DemoTelemetryError('DEMO_DATABASE_UNAVAILABLE');
    console.log(JSON.stringify(mode === 'prepare' ? await prepareOfflineSensors(database.postgres) :
      await seedOfflineTelemetry(database.postgres, database.mongo, database.mongo.db())));
  } finally { await database.onApplicationShutdown(); }
}
if (require.main === module) {
  loadEnv({ path: resolve(__dirname, '../../../../.env') });
  void offlineTelemetryCommand(process.env, process.argv[2] ?? 'seed').catch((error: unknown) => {
    // Never print driver errors or URIs: they can contain credentials/row data.
    console.error(error instanceof DemoTelemetryOccupiedError ? 'DEMO_JOURNAL_ALREADY_USED_NO_DATA_CHANGED' :
      error instanceof DemoTelemetryError ? error.message : 'DEMO_IMPORT_FAILED_CHECK_DATABASE_AND_GUIDE');
    process.exitCode = 1;
  });
}
