import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve, join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { migrationStatus } from '../persistence/migrations';
import { assertAiSourceSchema } from '../persistence/ai-source-schema';
import { demoReadiness } from '../persistence/demo-readiness';
import { AiConfig, readAiConfig } from './ai.config';
import { MongoAiStore } from './ai.store';
import { HttpAiWorker } from './ai.worker';
import { retrieve } from './ai.rag';

export interface AcceptanceCheck { name: string; state: 'ready' | 'needs_setup' | 'not_running'; details?: unknown }
export function geminiReadiness(config: AiConfig): AcceptanceCheck {
  return { name: 'gemini_configuration', state: config.chat?.provider === 'gemini' && !!config.chat.apiKey ? 'ready' : 'needs_setup',
    details: { provider: config.chat?.provider ?? 'disabled', model: config.chat?.model, key_present: !!config.chat?.apiKey, live_api_tested: false } };
}
export async function preAcceptanceCheck(env: NodeJS.ProcessEnv, config = readAiConfig(env)) {
  const checks: AcceptanceCheck[] = [geminiReadiness(config)];
  const database = new DatabaseService({ postgresUrl: env.DATABASE_URL ?? '', mongoUri: env.MONGODB_URI ?? '', timeoutMs: 5000 });
  try {
    const ready = await database.readiness();
    checks.push({ name: 'databases', state: ready.status === 'ok' ? 'ready' : 'needs_setup', details: ready.databases });
    if (ready.status === 'ok') {
      const migrations = await migrationStatus(database.postgres);
      checks.push({ name: 'migration_ledger', state: migrations.every((m) => m.state === 'Applied') ? 'ready' : 'needs_setup',
        details: { applied: migrations.filter((m) => m.state === 'Applied').length, total: migrations.length } });
      try {
        await assertAiSourceSchema(database.mongo.db());
        const hello = await database.mongo.db().admin().command({ hello: 1 });
        if (!hello.setName || !hello.isWritablePrimary) throw new Error();
        checks.push({ name: 'ai_mongo_schema_and_replica', state: 'ready' });
        const documents = await new MongoAiStore(database.mongo.db()).documents(true);
        let snapshots = 0;
        for (const doc of documents) {
          // Filenames come from ObjectId, never from client-supplied paths.
          const file = join(config.root, 'storage/rag-documents', `${doc._id.toHexString()}.pdf`);
          if ((await stat(file)).size > 10 * 1024 * 1024) throw new Error();
          if (createHash('sha256').update(await readFile(file)).digest('hex') !== doc.sha256) throw new Error();
          if (doc.source && doc.source.page_map.length !== doc.page_count) throw new Error();
          snapshots++;
        }
        const queries = ['than thu', 'rep sap', 'bon phan sau rieng', 'thu hoach sau rieng'];
        const found = queries.filter((q) => retrieve(documents, q).length > 0).length;
        checks.push({ name: 'rag_corpus_and_files', state: snapshots > 0 && found === queries.length ? 'ready' : 'needs_setup',
          details: { documents: documents.length, chunks: documents.reduce((n, d) => n + d.chunks.length, 0), verified_snapshots: snapshots, retrieval_checks_passed: found, retrieval_checks_total: queries.length } });
      } catch { checks.push({ name: 'ai_mongo_and_corpus', state: 'needs_setup', details: 'Kiểm tra schema018, replica set và snapshot PDF; không tự nhập hoặc sửa dữ liệu.' }); }
      const data = await demoReadiness(database.postgres, env);
      checks.push({ name: 'primary_accounts_and_device_metadata', state: data.primary_farmer_ready && data.primary_admin_ready && data.control_metadata_ready ? 'ready' : 'needs_setup',
        details: { primary_farmer_ready: data.primary_farmer_ready, primary_admin_ready: data.primary_admin_ready, control_metadata_ready: data.control_metadata_ready,
          hardware_farm_in_cooperative: data.hardware_farm_in_cooperative, manager_for_hardware_farm: data.hardware_farm_in_cooperative ? data.hardware_manager_ready : 'not_applicable_independent_farm' } });
    }
    if (!config.enabled) checks.push({ name: 'local_image_worker', state: 'needs_setup', details: 'Đặt AI_SERVICE_ENABLED=true và chạy npm run dev:ai để kiểm thử ảnh.' });
    else try {
      const info = await new HttpAiWorker(config).model() as { task: string; model_sha256: string; classes: unknown[] };
      if (info.task !== 'classify' || !/^[a-f\d]{64}$/.test(info.model_sha256) || !Array.isArray(info.classes) || !info.classes.length) throw new Error();
      checks.push({ name: 'local_image_worker', state: 'ready', details: { task: info.task, classes: info.classes.length, model_sha256: info.model_sha256 } });
    } catch { checks.push({ name: 'local_image_worker', state: 'not_running', details: 'Chạy npm run dev:ai; không cần worker Python riêng cho chat.' }); }
    return { scope: 'read_only_local_pre_acceptance', can_start_full_manual_acceptance: checks.every((c) => c.state === 'ready'), checks,
      manual_checks_not_performed: ['Gemini key/quota and answer quality', 'Physical ESP32/pump/valve behavior', 'Labelled-image accuracy', 'Four-role acceptance with real OTP/email'] };
  } finally { await database.onApplicationShutdown(); }
}
if (require.main === module) {
  loadEnv({ path: resolve(__dirname, '../../../../.env') });
  void preAcceptanceCheck(process.env).then((result) => { console.log(JSON.stringify(result, null, 2)); if (!result.can_start_full_manual_acceptance) process.exitCode = 1; })
    .catch(() => { console.error('Pre-acceptance check failed; verify local configuration/services. No credentials or provider response logged.'); process.exitCode = 1; });
}
