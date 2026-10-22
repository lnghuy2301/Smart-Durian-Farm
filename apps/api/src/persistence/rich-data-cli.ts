import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv, parse } from 'dotenv';
import { DatabaseService } from '../database/database.service';
import { BackupError, createDatabaseBackup } from './backup';
import { RICH_MANAGERS, RICH_PEOPLE, RichDataError, richPhone, seedRichOperationalData } from './rich-operational-data';
import { verifyPassword } from '../auth/password';

const root = resolve(__dirname, '../../../..');
export function appendRichLoginReferences(filename: string, password: string, confirmed = new Set(Array.from({ length: 11 }, (_, i) => i))) {
  const before = readFileSync(filename), values = parse(before), nl = before.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const lines = ['', '# Generated initial accounts; registration/OTP for your real Manager stays separate.'];
  const assigned: Record<string, string> = { REFERENCE_ASSIGNED_FARMER_NAME: RICH_PEOPLE[5], REFERENCE_ASSIGNED_FARMER_PHONE: richPhone(5) };
  if (confirmed.has(5)) assigned.REFERENCE_ASSIGNED_FARMER_PASSWORD = password;
  for (const [key, value] of Object.entries(assigned)) if (!Object.hasOwn(values, key)) lines.push(`${key}=${JSON.stringify(value)}`);
  for (let i = 0; i < 11; i++) {
    const manager = i >= 8, n = manager ? i - 7 : i + 1, prefix = manager ? `REFERENCE_SEEDED_MANAGER_${n}` : `REFERENCE_EXTRA_FARMER_${n}`;
    const fields: Record<string, string> = { NAME: manager ? RICH_MANAGERS[i - 8] : RICH_PEOPLE[i], PHONE: richPhone(i), PASSWORD: password };
    if (manager) { fields.EMAIL = `quanly${n}@phuocan.example.invalid`; fields.STATUS = i === 10 ? 'Pending' : 'Active'; }
    for (const [key, value] of Object.entries(fields)) if ((key !== 'PASSWORD' || confirmed.has(i)) && !Object.hasOwn(values, `${prefix}_${key}`)) lines.push(`${prefix}_${key}=${JSON.stringify(value)}`);
  }
  if (lines.length > 2) appendFileSync(filename, (before.length && before[before.length - 1] !== 10 ? nl : '') + lines.join(nl) + nl);
}
export async function richDataCommand(env: NodeJS.ProcessEnv) {
  if (!['development', 'test'].includes(env.NODE_ENV ?? '')) throw new RichDataError('RICH_LOCAL_ENVIRONMENT_REQUIRED');
  const password = env.REFERENCE_FARMER_PASSWORD || env.AUTH_TEST_PASSWORD || '';
  if (password.length < 8 || password.length > 128) throw new RichDataError('RICH_ACCOUNT_PASSWORD_REQUIRED');
  // Generated numbers must never be reused as operator identities or OTP targets.
  const phones = new Set(Array.from({ length: 11 }, (_, i) => richPhone(i)));
  for (const item of [env.AUTH_TEST_PHONE, env.AUTH_TEST_ADMIN_PHONE, env.REFERENCE_MANAGER_PHONE, ...(env.HTX_SMS_ALLOWED_PHONES ?? '').split(','), env.SMS_ALLOWED_PHONE]) {
    if (!item) continue;
    const digits = item.trim().replace(/^\+/, '').replace(/^84/, '0');
    if (phones.has(digits)) throw new RichDataError('RICH_GENERATED_PHONE_IS_OPERATOR_OR_SMS_TARGET');
  }
  const database = new DatabaseService({ postgresUrl: env.DATABASE_URL ?? '', mongoUri: env.MONGODB_URI ?? '', timeoutMs: 30000 });
  const backup = async () => {
    const archive = await createDatabaseBackup(database.postgres, database.mongo, database.mongo.db());
    const directory = resolve(root, 'backups'); mkdirSync(directory, { recursive: true });
    if (lstatSync(directory).isSymbolicLink()) throw new RichDataError('RICH_BACKUP_DIRECTORY_MUST_NOT_BE_LINK');
    const file = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`), data = JSON.stringify(archive);
    if (Buffer.byteLength(data) > 128 * 1024 * 1024) throw new RichDataError('RICH_BACKUP_EXCEEDS_LIMIT');
    writeFileSync(file, data, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ backup_file: file, data_sha256: archive.data_sha256, postgres_rows: archive.postgres.reduce((sum, t) => sum + t.rows.length, 0), mongo_documents: archive.mongo.reduce((sum, c) => sum + c.documents.length, 0) }));
  };
  try {
    await backup();
    const lease = await database.postgres.connect();
    try {
      await lease.query('BEGIN');
      for (const key of ['smart-durian:migrations', 'smart-durian:actuator-runtime']) {
        const result = await lease.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [key]);
        if (!result.rows[0].locked) throw new RichDataError('RICH_STOP_API_AND_MIGRATIONS_FIRST');
      }
      console.log(JSON.stringify(await seedRichOperationalData(database.postgres, database.mongo, database.mongo.db(), password)));
      await lease.query('COMMIT');
    } catch (error) { await lease.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { lease.release(); }
    await backup();
    const confirmed = new Set<number>();
    for (let i = 0; i < 11; i++) {
      const row = (await database.postgres.query('SELECT password FROM public.users WHERE phone_number=$1', [richPhone(i)])).rows[0];
      if (row && await verifyPassword(password, row.password)) confirmed.add(i);
    }
    appendRichLoginReferences(resolve(root, '.env'), password, confirmed);
    console.log(JSON.stringify({ local_login_references_ready: true, matching_initial_passwords: confirmed.size, provider_messages_sent: 0, mqtt_commands_sent: 0 }));
  } finally { await database.onApplicationShutdown(); }
}
if (require.main === module) {
  loadEnv({ path: resolve(root, '.env') });
  void richDataCommand(process.env).catch((error: unknown) => {
    console.error(error instanceof RichDataError || error instanceof BackupError ? error.message : 'RICH_DATA_FAILED_PARTIAL_PROGRESS_RETAINED_RETRY_AFTER_FIX');
    process.exitCode = 1;
  });
}
