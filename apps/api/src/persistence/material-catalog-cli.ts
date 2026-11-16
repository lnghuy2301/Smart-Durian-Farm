import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { DatabaseService } from '../database/database.service';
import { createDatabaseBackup } from './backup';
import { expandMaterialCatalog } from './material-catalog-expansion';

export async function materialCatalogCommand(env: NodeJS.ProcessEnv) {
  if (!['development', 'test'].includes(env.NODE_ENV ?? '')) throw new Error('MATERIAL_LOCAL_ENVIRONMENT_REQUIRED');
  const root = resolve(__dirname, '../../../..');
  const database = new DatabaseService({ postgresUrl: env.DATABASE_URL ?? '', mongoUri: env.MONGODB_URI ?? '', timeoutMs: 30000 });
  const backup = async () => {
    const archive = await createDatabaseBackup(database.postgres, database.mongo, database.mongo.db());
    const directory = resolve(root, 'backups'); mkdirSync(directory, { recursive: true });
    if (lstatSync(directory).isSymbolicLink()) throw new Error('MATERIAL_BACKUP_LINK_REJECTED');
    const file = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify(archive), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ backup_file: file, data_sha256: archive.data_sha256 }));
  };
  try { await backup(); console.log(JSON.stringify(await expandMaterialCatalog(database.postgres))); await backup(); }
  finally { await database.onApplicationShutdown(); }
}
if (require.main === module) {
  loadEnv({ path: resolve(__dirname, '../../../../.env') });
  void materialCatalogCommand(process.env).catch(() => { console.error('MATERIAL_CATALOG_FAILED_STOP_API_CHECK_MIGRATIONS_AND_RETRY'); process.exitCode = 1; });
}
