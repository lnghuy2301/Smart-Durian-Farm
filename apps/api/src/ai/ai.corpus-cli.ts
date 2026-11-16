import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { DatabaseService } from '../database/database.service';
import { migrationStatus } from '../persistence/migrations';
import { PostgresUsersRepository } from '../persistence/postgres-users.repository';
import { PostgresFarmsRepository } from '../persistence/postgres-farms.repository';
import { PostgresZonesRepository } from '../persistence/postgres-zones.repository';
import { PostgresCatalogRepository } from '../persistence/postgres-catalog.repository';
import { readAiConfig } from './ai.config';
import { AiService } from './ai.service';
import { MongoAiStore } from './ai.store';
import { DisabledChatProvider, HttpAiWorker } from './ai.worker';
import { loadPrepared, preparedEntries } from './ai.prepared';
import { makeChunks } from './ai.rag';
import { assertAiSourceSchema } from '../persistence/ai-source-schema';

export async function corpusCommand(command: string, env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV === 'production' || !['check', 'import'].includes(command)) throw new Error('Use check/import only in local maintenance mode');
  const config = readAiConfig(env);
  const database = new DatabaseService({ postgresUrl: env.DATABASE_URL ?? '', mongoUri: env.MONGODB_URI ?? '', timeoutMs: 30000 });
  const client = await database.postgres.connect();
  try {
    await client.query('BEGIN');
    // Reuse the runtime/migration locks for the entire batch, not just a
    // preflight snapshot. No live API can race corpus admission limits.
    for (const key of ['smart-durian:migrations', 'smart-durian:actuator-runtime']) {
      const result = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [key]);
      if (!result.rows[0].locked) throw new Error('Stop API/migrations before corpus maintenance');
    }
    if ((await migrationStatus(database.postgres)).some((m) => m.state !== 'Applied')) throw new Error('Apply migrations before corpus maintenance');
    await assertAiSourceSchema(database.mongo.db());
    const users = new PostgresUsersRepository(database.postgres);
    const admin = await users.loadByPhone(env.AUTH_TEST_ADMIN_PHONE ?? '');
    if (!admin || admin.user.role !== 'Admin' || admin.user.status !== 'Active') throw new Error('Configure the existing Active Admin account');
    const farms = new PostgresFarmsRepository(database.postgres, users), catalogs = new PostgresCatalogRepository(database.postgres, users);
    const zones = new PostgresZonesRepository(database.postgres, users, farms, catalogs);
    const store = new MongoAiStore(database.mongo.db()), worker = new HttpAiWorker(config);
    const service = new AiService(users, zones, store, worker, new DisabledChatProvider(), config);
    const entries = await preparedEntries(config.root);
    if (!entries.length) throw new Error('Prepare the corpus manifest first');
    const existing = await store.documents();
    if (existing.length + entries.filter((e) => !existing.some((v) => v.sha256 === e.sha256)).length > 100) throw new Error('Corpus admission limit exceeded');
    const activeChunks = existing.filter((v) => v.status === 'Active').reduce((n, v) => n + v.chunks.length, 0);
    let imported = 0, skipped = 0, chunks = 0;
    for (const entry of entries) {
      const prepared = await loadPrepared(config.root, entry.filename);
      const found = existing.find((v) => v.sha256 === entry.sha256);
      if (found) {
        if (JSON.stringify(found.source) !== JSON.stringify(entry.source)) throw new Error('Existing source provenance differs; review before import');
        skipped++; continue;
      }
      if (command === 'check') {
        const extracted = await worker.extractPdf(prepared.bytes);
        if (extracted.page_count !== entry.source.page_map.length) throw new Error('Prepared page map mismatch');
        chunks += makeChunks(extracted).length;
        if (activeChunks + chunks > 5000) throw new Error('Corpus admission limit exceeded');
      } else {
        await service.importPrepared(admin.user.id, entry.filename); imported++;
      }
    }
    await client.query('COMMIT');
    return { command, prepared: entries.length, imported, skipped, checked_chunks: command === 'check' ? chunks : undefined };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); await database.onApplicationShutdown(); }
}
if (require.main === module) {
  loadEnv({ path: resolve(__dirname, '../../../../.env') });
  void corpusCommand(process.argv[2] ?? '', process.env).then((result) => console.log(JSON.stringify(result)))
    .catch(() => { console.error('Corpus operation failed; check worker, Active Admin, manifest, migration and maintenance locks. No automatic rollback of already imported PDFs; rerun resumes by checksum.'); process.exitCode = 1; });
}
