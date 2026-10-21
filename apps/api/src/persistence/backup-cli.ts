import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { BackupError, createDatabaseBackup, DatabaseBackup, restoreIntoEmptyDatabase, verifyBackup } from './backup';
import { demoReadiness } from './demo-readiness';

function projectRoot() {
  let directory = __dirname;
  while (true) {
    const manifest = resolve(directory, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'smart-durian-farm') return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new BackupError('PROJECT_ROOT_NOT_FOUND');
    directory = parent;
  }
}
const root = projectRoot();
const maxBytes = 128 * 1024 * 1024;
function readArchive(path: string) {
  const filename = resolve(root, path);
  if (!path || !statSync(filename).isFile() || statSync(filename).size > maxBytes) throw new BackupError('INVALID_BACKUP_FILE');
  return verifyBackup(JSON.parse(readFileSync(filename, 'utf8')));
}
function summary(archive: DatabaseBackup) {
  return { data_sha256: archive.data_sha256, postgres_rows: archive.postgres.reduce((sum, table) => sum + table.rows.length, 0),
    mongo_documents: archive.mongo.reduce((sum, collection) => sum + collection.documents.length, 0) };
}
export async function backupCommand(command: string, file: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (!['create', 'verify', 'restore-check', 'restore-new', 'demo-check'].includes(command)) throw new BackupError('USE_CREATE_VERIFY_RESTORE_CHECK_RESTORE_NEW_OR_DEMO_CHECK');
  if (command === 'verify') { console.log(JSON.stringify({ verified: true, ...summary(readArchive(file)) })); return; }
  const archive = command === 'create' || command === 'demo-check' ? undefined : readArchive(file);
  // Verification can restore only into the known disposable Compose fixture.
  // Real recovery creates a NEW random database, never replaces DATABASE_URL.
  const config = command === 'restore-check' ? {
    postgresUrl: 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432/sdf_persistence_test',
    mongoUri: 'mongodb://127.0.0.1:27028/sdf_persistence_test?replicaSet=rs-test&directConnection=true', timeoutMs: 30000,
  } : { postgresUrl: env.DATABASE_URL ?? '', mongoUri: env.MONGODB_URI ?? '', timeoutMs: 30000 };
  if (!/^postgres(ql)?:\/\//.test(config.postgresUrl) || !/^mongodb(\+srv)?:\/\//.test(config.mongoUri)) throw new BackupError('CONFIGURE_DATABASE_URL_AND_MONGODB_URI');
  const database = new DatabaseService(config);
  try {
    if (command === 'demo-check') {
      console.log(JSON.stringify({ database: await database.readiness(), demo: await demoReadiness(database.postgres, env) }));
      return;
    }
    if (command === 'create') {
      const snapshot = await createDatabaseBackup(database.postgres, database.mongo, database.mongo.db());
      const directory = resolve(root, 'backups');
      mkdirSync(directory, { recursive: true });
      if (lstatSync(directory).isSymbolicLink()) throw new BackupError('BACKUP_DIRECTORY_MUST_NOT_BE_LINK');
      const path = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
      const data = JSON.stringify(snapshot);
      if (Buffer.byteLength(data) > maxBytes) throw new BackupError('BACKUP_EXCEEDS_PROTOTYPE_LIMIT');
      writeFileSync(path, data, { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ created: true, file: path, ...summary(snapshot) }));
      return;
    }
    const name = `sdf_restore_${randomUUID().replaceAll('-', '')}`;
    let target: Pool | undefined, created = false, mongoOwned = false, success = false;
    console.log(JSON.stringify({ restore_target: name, temporary: command === 'restore-check' }));
    try {
      // Name is generated here, checked again by restoreIntoEmptyDatabase and
      // never accepted from CLI/archive input as an SQL identifier.
      await database.postgres.query(`CREATE DATABASE "${name}"`); created = true;
      const url = new URL(config.postgresUrl); url.pathname = `/${name}`;
      target = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 10000, statement_timeout: 30000 });
      const db = database.mongo.db(name);
      mongoOwned = (await db.listCollections({}, { nameOnly: true }).toArray()).length === 0;
      if (!mongoOwned) throw new BackupError('RESTORE_TARGET_NOT_EMPTY');
      await restoreIntoEmptyDatabase(target, database.mongo, db, archive);
      success = true;
      console.log(JSON.stringify({ restored: true, database: name, temporary: command === 'restore-check', ...summary(archive!) }));
    } finally {
      await target?.end();
      // Verification removes only its own random databases. Recovery retains
      // new data for inspection even on failure; it never drops existing DBs.
      if (command === 'restore-check' && created && /^sdf_restore_[0-9a-f]{32}$/.test(name)) {
        if (mongoOwned) await database.mongo.db(name).dropDatabase();
        await database.postgres.query(`DROP DATABASE "${name}"`);
      } else if (!success && created) console.error('RESTORE_NEW_TARGET_RETAINED_FOR_INSPECTION');
    }
  } finally { await database.onApplicationShutdown(); }
}
if (require.main === module) {
  loadEnv({ path: resolve(root, '.env') });
  void backupCommand(process.argv[2] ?? '', process.argv[3] ?? '', process.env).catch((error: unknown) => {
    // Driver errors/SQL details may contain credentials or row contents.
    console.error(error instanceof BackupError ? error.message : 'BACKUP_OPERATION_FAILED_CHECK_DATABASE_AND_GUIDE');
    process.exitCode = 1;
  });
}
