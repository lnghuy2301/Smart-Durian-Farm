import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { DatabaseService } from '../database/database.service';
import { createDatabaseBackup, BackupError } from './backup';
import { refreshOperationalData, OperationalDataError } from './operational-data-refresh';

const root = resolve(__dirname, '../../../..');
export async function operationalDataCommand(mode: string, env: NodeJS.ProcessEnv) {
  if (!['preview', 'apply'].includes(mode)) throw new OperationalDataError('OPERATIONAL_USE_PREVIEW_OR_APPLY');
  if (!['development', 'test'].includes(env.NODE_ENV ?? '')) throw new OperationalDataError('OPERATIONAL_LOCAL_ENVIRONMENT_REQUIRED');
  const postgresUrl = env.DATABASE_URL ?? '', mongoUri = env.MONGODB_URI ?? '';
  if (!/^postgres(ql)?:\/\//.test(postgresUrl) || !/^mongodb(\+srv)?:\/\//.test(mongoUri)) throw new OperationalDataError('OPERATIONAL_CONFIGURE_DATABASES');
  const database = new DatabaseService({ postgresUrl, mongoUri, timeoutMs: 30000 });
  try {
    const snapshot = await createDatabaseBackup(database.postgres, database.mongo, database.mongo.db());
    const directory = resolve(root, 'backups');
    mkdirSync(directory, { recursive: true });
    if (lstatSync(directory).isSymbolicLink()) throw new OperationalDataError('OPERATIONAL_BACKUP_DIRECTORY_MUST_NOT_BE_LINK');
    const file = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
    const data = JSON.stringify(snapshot);
    if (Buffer.byteLength(data) > 128 * 1024 * 1024) throw new OperationalDataError('OPERATIONAL_BACKUP_EXCEEDS_LIMIT');
    writeFileSync(file, data, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ backup_file: file, data_sha256: snapshot.data_sha256 }));
    console.log(JSON.stringify(await refreshOperationalData(database.postgres, snapshot, mode === 'preview')));
  } finally { await database.onApplicationShutdown(); }
}
if (require.main === module) {
  loadEnv({ path: resolve(root, '.env') });
  void operationalDataCommand(process.argv[2] ?? 'preview', process.env).catch((error: unknown) => {
    console.error(error instanceof OperationalDataError || error instanceof BackupError ? error.message : 'OPERATIONAL_REFRESH_FAILED_CHECK_DATABASE_AND_GUIDE');
    process.exitCode = 1;
  });
}
