import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { DatabaseService } from '../database/database.service';
import { BackupError, createDatabaseBackup } from './backup';
import { RICH_MANAGERS, RICH_PEOPLE, RichDataError, richPhone, seedRichOperationalData } from './rich-operational-data';
import { verifyPassword } from '../auth/password';

const root = resolve(__dirname, '../../../..');
export function appendRichLoginReferences(filename: string, password: string, confirmed = new Set<number>()) {
  // Credentials are a private operator document, not runtime configuration.
  // In particular a rerun must never repopulate the cleaned .env file.
  if (!filename.endsWith('.private.md')) throw new RichDataError('RICH_LOGIN_REFERENCES_REQUIRE_PRIVATE_MARKDOWN');
  if (existsSync(filename) && lstatSync(filename).isSymbolicLink()) throw new RichDataError('RICH_LOGIN_REFERENCES_MUST_NOT_BE_LINK');
  const before = existsSync(filename) ? readFileSync(filename, 'utf8') : '';
  const nl = before.includes('\r\n') ? '\r\n' : '\n', lines: string[] = [];
  for (let i = 0; i < 11; i++) {
    const manager = i >= 8, n = manager ? i - 7 : i + 1, prefix = manager ? `REFERENCE_SEEDED_MANAGER_${n}` : `REFERENCE_EXTRA_FARMER_${n}`;
    const marker = `<!-- login-reference:${prefix} -->`;
    if (before.includes(marker)) continue;
    const fields = { name: manager ? RICH_MANAGERS[i - 8] : RICH_PEOPLE[i], phone: richPhone(i),
      password: confirmed.has(i) ? password : null, role: manager ? 'Manager' : 'Farmer',
      ...(manager ? { email: `quanly${n}@phuocan.example.invalid`, status: i === 10 ? 'Pending' : 'Active' } : {}) };
    lines.push('', marker, `### ${fields.name}`, '', '```json', JSON.stringify(fields, null, 2), '```');
  }
  if (!lines.length) return;
  if (!before) {
    writeFileSync(filename, '# Tài khoản kiểm tra local — không chia sẻ\n\nĐọc MODULE_ACCEPTANCE_CHECKLIST.md để kiểm tra từng module. Mật khẩu null nghĩa là chưa xác nhận khớp database.\n', { flag: 'wx', mode: 0o600 });
    const checklist = resolve(dirname(filename), 'MODULE_ACCEPTANCE_CHECKLIST.md');
    if (existsSync(checklist)) {
      const template = readFileSync(checklist, 'utf8'), start = template.indexOf('## 0.');
      if (start >= 0) lines.push('', '---', '', template.slice(start));
    }
  }
  appendFileSync(filename, lines.join(nl) + nl);
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
    appendRichLoginReferences(resolve(root, 'docs/LOCAL_MODULE_ACCEPTANCE.private.md'), password, confirmed);
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
