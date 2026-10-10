import 'reflect-metadata';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { DatabaseService } from '../database/database.service';
import { migrationStatus, runMigrations } from './migrations';
import { readSeedConfig } from './seed-config';
import { seedDemo } from './seed';

export async function persistenceCommand(command: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (!['status', 'migrate', 'seed'].includes(command)) { throw new Error('Use status, migrate or seed'); }
  const postgresUrl = env.DATABASE_URL ?? '';
  const mongoUri = env.MONGODB_URI ?? '';
  if (!/^postgres(ql)?:\/\//.test(postgresUrl) || !/^mongodb(\+srv)?:\/\//.test(mongoUri)) { throw new Error('Configure valid DATABASE_URL and MONGODB_URI'); }
  // Validate toàn bộ seed trước khi kết nối/ghi bất kỳ row nào.
  const seedConfig = command === 'seed' ? readSeedConfig(env) : undefined;
  const database = new DatabaseService({ postgresUrl, mongoUri, timeoutMs: 30000 });
  try {
    if (command === 'status') { console.log(JSON.stringify(await migrationStatus(database.postgres), null, 2)); }
    else if (command === 'migrate') { console.log(JSON.stringify({ applied: await runMigrations(database.postgres, database.mongo.db()) }, null, 2)); }
    else { console.log(JSON.stringify(await seedDemo(database.postgres, seedConfig!), null, 2)); }
  } finally { await database.onApplicationShutdown(); }
}

export function formatPersistenceError(error: unknown): string {
  // SQL detail/URI/driver errors có thể chứa phone/credentials. Không dump Error
  // hoặc nhận message có code từ driver làm thông báo preflight của ứng dụng.
  const value = error as { code?: unknown; message?: unknown };
  const code = typeof value?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(value.code) ? value.code :
    typeof value?.code === 'number' && Number.isSafeInteger(value.code) && value.code >= 0 ? String(value.code) : 'FAILED';
  const message = value?.code === undefined && typeof value?.message === 'string' && /^(Invalid AUTH_TEST_|Invalid DEMO_DEVICE_|Seed |Demo |Migration |Apply current|Configure valid|Use status|MongoDB writable)/.test(value.message) ? value.message : 'Persistence operation failed; check database availability and the implementation guide';
  return `${message} [${code}]`;
}

if (require.main === module) {
  loadEnv({ path: resolve(__dirname, '../../../../.env') });
  void persistenceCommand(process.argv[2] ?? '', process.env).catch((error: unknown) => {
    console.error(formatPersistenceError(error));
    process.exitCode = 1;
  });
}
