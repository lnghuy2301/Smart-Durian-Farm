import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ObjectId } from 'mongodb';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { readEnvironment } from '../src/config/environment';
import { AiWorker, ChatProvider, DisabledChatProvider } from '../src/ai/ai.worker';
import { GeminiChatProvider } from '../src/ai/gemini.provider';
import { Citation } from '../src/ai/ai.types';
import { MongoAiStore } from '../src/ai/ai.store';
import { createDatabaseBackup, restoreIntoEmptyDatabase, sealBackup } from '../src/persistence/backup';
import { runMigrations } from '../src/persistence/migrations';
import { createAiAssetBackup, restoreAiAssetBackup, verifyAiAssetBackup } from '../src/persistence/ai-assets-backup';
import { taskAuth, taskPersistenceFixture, taskPgBase } from './helpers/task-persistence-fixture';

test('AI full database runtime shares users/Zone authority, retains private history and backs up new collections across restart', async (t) => {
  const f = await taskPersistenceFixture(), root = await mkdtemp(join(tmpdir(), 'sdf-ai-pg-'));
  const value = await f.deviceFixture();
  const config = readEnvironment({ NODE_ENV: 'test', BUSINESS_STORAGE: 'database', AUTH_MODE: 'mock', DATABASE_URL: `${taskPgBase}/${f.name}`,
    MONGODB_URI: `mongodb://127.0.0.1:27028/${f.name}?replicaSet=rs-test&directConnection=true`, AUTH_TEST_PHONE: taskAuth.phoneNumber, AUTH_TEST_PASSWORD: taskAuth.password,
    AUTH_TEST_ADMIN_PHONE: taskAuth.admin.phoneNumber, AUTH_TEST_ADMIN_PASSWORD: taskAuth.admin.password, JWT_SECRET: taskAuth.jwtSecret });
  config.ai = { ...config.ai!, enabled: true, root, token: 'ai-test-only-token'.repeat(3) };
  let app: INestApplication | undefined;
  let geminiEnabled = false, geminiFail = false;
  const gemini = new GeminiChatProvider({ provider: 'gemini', apiKey: 'fixture-only-gemini-integration-key', model: 'gemini-3.8-flash', timeoutMs: 1000, maxOutputTokens: 4096 }, async (_url, options) => {
    if (geminiFail) return new Response('sensitive provider failure', { status: 503 });
    const payload = JSON.parse(JSON.parse(String(options?.body)).contents[0].parts[0].text);
    const source = payload.contexts.find((c: { source: { is_draft: boolean } }) => c.source.is_draft) ?? payload.contexts[0];
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ text: 'Theo nguồn dự thảo: cần theo dõi thoát nước.', used_chunk_ids: [source.chunk_id] }) }] } }] });
  });
  const start = async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.register(config)] }).overrideProvider(AiWorker).useValue({
      classify: async () => ({ task: 'classify', model_sha256: 'b'.repeat(64), predictions: [{ class_id: 2, label: 'test-only', confidence: 0.8 }] }),
      extractPdf: async () => ({ page_count: 1, pages: [{ page: 1, text: 'Theo dõi độ ẩm đất và thoát nước cho cây sầu riêng.' }] }),
    }).overrideProvider(ChatProvider).useValue(geminiEnabled ? gemini : new DisabledChatProvider()).compile();
    app = module.createNestApplication({ logger: false }); configureApplication(app, config); await app.listen(0, '127.0.0.1');
  };
  const http = async (path: string, method = 'GET', body?: object, token?: string) => fetch(`${await app!.getUrl()}/api/${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async (phone: string, password: string) => { const r = await http('auth/login', 'POST', { phone_number: phone, password }); assert.equal(r.status, 200); return (await r.json() as { access_token: string }).access_token; };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  let diagnosis = '', conversation = '', document = '', farmerToken = '', adminToken = '';
  try {
    await start();
    farmerToken = await login(value.owner.phone, taskAuth.admin.password);
    adminToken = await login(taskAuth.admin.phoneNumber, taskAuth.admin.password);
    await t.test('authenticated image/PDF and conversations use migrated Mongo collections through AppModule', async () => {
      const form = new FormData(); form.set('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'leaf.png'); form.set('zone_id', value.zone.id);
      const r = await fetch(`${await app!.getUrl()}/api/ai/diagnoses`, { method: 'POST', headers: { Authorization: `Bearer ${farmerToken}` }, body: form });
      assert.equal(r.status, 201); diagnosis = (await r.json() as { id: string }).id;
      const chat = await http('ai/conversations', 'POST', { session_title: 'Hỏi về canh tác' }, farmerToken); assert.equal(chat.status, 201); conversation = (await chat.json() as { id: string }).id;
      const dir = join(root, 'data/rag/pdfs'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'fixture.pdf'), '%PDF-fixture only');
      const doc = await http('ai/rag/documents/import', 'POST', { filename: 'fixture.pdf' }, adminToken); assert.equal(doc.status, 201); document = (await doc.json() as { id: string }).id;
      assert.equal((await http('ai/rag/search', 'POST', { message: 'do am dat' }, adminToken)).status, 201);
    });
    await app!.close(); app = undefined;
    await start();
    await t.test('fresh app reads stored diagnosis/source/chat; other Farmer cannot read it and provider remains unconfigured', async () => {
      assert.equal((await http(`ai/diagnoses/${diagnosis}`, 'GET', undefined, farmerToken)).status, 200);
      assert.equal((await http(`ai/diagnoses/${diagnosis}/image`, 'GET', undefined, farmerToken)).status, 200);
      const other = await login(value.worker.phone, taskAuth.admin.password);
      assert.equal((await http(`ai/diagnoses/${diagnosis}`, 'GET', undefined, other)).status, 404);
      assert.equal((await http(`ai/conversations/${conversation}`, 'GET', undefined, other)).status, 404);
      assert.equal((await http(`ai/conversations/${conversation}/messages`, 'POST', { message: 'độ ẩm đất' }, farmerToken)).status, 503);
    });
    await app!.close(); app = undefined;
    await t.test('Mongo validators reject malformed predictions and optimistic append commits only one concurrent pair', async () => {
      const db = f.mongo.db(f.name), store = new MongoAiStore(db);
      await assert.rejects(db.collection('AI_DISEASE_DIAGNOSTICS').updateOne({ _id: new ObjectId(diagnosis) }, { $set: { 'ai_predictions.0.confidence': 2 } }), (e: unknown) => (e as { code: number }).code === 121);
      const now = new Date(), pair = [{ role: 'user' as const, content: 'Hỏi', citations: [], created_at: now }, { role: 'assistant' as const, content: 'Đáp', citations: [], created_at: now }];
      const race = await Promise.all([store.append(new ObjectId(conversation), value.owner.id, 0, pair, now), store.append(new ObjectId(conversation), value.owner.id, 0, pair, now)]);
      assert.equal(race.filter(Boolean).length, 1);
      assert.equal((await store.conversation(new ObjectId(conversation), value.owner.id))!.messages.length, 2);
      assert.equal((await store.documents())[0]._id.toHexString(), document);
    });
    await t.test('legacy017 archive restores with original validators then upgrades only018', async () => {
      const snapshot = await createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name));
      const archive = sealBackup({ ...snapshot, migrations: snapshot.migrations.slice(0, 17) });
      const name = `sdf_restore_${randomUUID().replaceAll('-', '')}`;
      await f.pool.query(`CREATE DATABASE "${name}"`);
      const pool = new Pool({ connectionString: `${taskPgBase}/${name}` });
      try {
        await restoreIntoEmptyDatabase(pool, f.mongo, f.mongo.db(name), archive);
        assert.equal((await createDatabaseBackup(pool, f.mongo, f.mongo.db(name))).data_sha256, archive.data_sha256);
        assert.deepEqual(await runMigrations(pool, f.mongo.db(name)), ['018_ai_source_provenance']);
      } finally { await pool.end(); await f.mongo.db(name).dropDatabase(); await f.pool.query(`DROP DATABASE "${name}"`); }
    });
    await t.test('prepared draft source survives storage, original-page retrieval and strict validation', async () => {
      await start();
      const dir = join(root, 'data/rag/prepared'), original = Buffer.from('%PDF-original new fixture'), derivative = Buffer.from('%PDF-prepared new fixture');
      const hash = (v: Buffer) => createHash('sha256').update(v).digest('hex');
      await mkdir(dir, { recursive: true }); await writeFile(join(root, 'data/rag/pdfs/source.pdf'), original); await writeFile(join(dir, 'prepared.pdf'), derivative);
      await writeFile(join(dir, 'manifest.json'), JSON.stringify({ format: 'smart-durian-prepared-v1', entries: [{ filename: 'prepared.pdf', title: '[Dự thảo] Sầu riêng', sha256: hash(derivative),
        source: { filename: 'source.pdf', sha256: hash(original), page_map: [265], is_draft: true } }] }));
      const imported = await http('ai/rag/documents/import-prepared', 'POST', { filename: 'prepared.pdf' }, adminToken);
      assert.equal(imported.status, 201);
      const id = (await imported.json() as { id: string }).id;
      const db = f.mongo.db(f.name), doc = await db.collection('AI_RAG_DOCUMENTS').findOne({ _id: new ObjectId(id) });
      assert.equal(doc!.source.is_draft, true);
      const found = await http('ai/rag/search', 'POST', { message: 'thoát nước' }, adminToken);
      const contexts = (await found.json() as { contexts: Citation[] }).contexts;
      assert(contexts.some((c) => c.source?.page === 265));
      const store = new MongoAiStore(db), current = await store.conversation(new ObjectId(conversation), value.owner.id), now = new Date();
      const citation = contexts.find((c) => c.source?.page === 265)!;
      assert(await store.append(current!._id, value.owner.id, current!.version, [
        { role: 'user', content: 'Fixture source question', citations: [], created_at: now },
        { role: 'assistant', content: 'Fixture source answer', citations: [citation], created_at: now },
      ], now));
      const saved = await store.conversation(current!._id, value.owner.id);
      assert.equal(saved!.messages.at(-1)!.citations[0].source?.is_draft, true);
      await assert.rejects(db.collection('AI_RAG_DOCUMENTS').updateOne({ _id: new ObjectId(id) }, { $set: { 'source.page_map': [0] } }), (e: unknown) => (e as { code: number }).code === 121);
      await app!.close(); app = undefined;
    });
    await t.test('Gemini protocol reply persists source citations after restart; upstream failure never appends partial history', async () => {
      geminiEnabled = true; await start();
      const sent = await http(`ai/conversations/${conversation}/messages`, 'POST', { message: 'thoát nước' }, farmerToken);
      assert.equal(sent.status, 201);
      const saved = await sent.json() as { messages: { citations: Citation[] }[] };
      assert.equal(saved.messages.at(-1)!.citations[0].source?.page, 265);
      geminiFail = true;
      assert.equal((await http(`ai/conversations/${conversation}/messages`, 'POST', { message: 'thoát nước' }, farmerToken)).status, 503);
      await app!.close(); app = undefined; await start();
      const restored = await (await http(`ai/conversations/${conversation}`, 'GET', undefined, farmerToken)).json() as { messages: unknown[] };
      assert.equal(restored.messages.length, saved.messages.length);
      await app!.close(); app = undefined;
    });
    await t.test('backup018 restores AI BSON records and metadata exactly into new databases', async () => {
      const archive = await createDatabaseBackup(f.pool, f.mongo, f.mongo.db(f.name));
      assert(archive.mongo.some((c) => c.name === 'AI_DISEASE_DIAGNOSTICS' && c.documents.length === 1));
      const file = join(root, 'database.json'); await writeFile(file, JSON.stringify(archive));
      assert.equal(createAiAssetBackup(archive, file, root).files, 3);
      assert.equal(verifyAiAssetBackup(archive, file).files, 3);
      const restoredFiles = join(root, 'restored-ai'); restoreAiAssetBackup(archive, file, restoredFiles);
      await writeFile(join(restoredFiles, 'storage/diagnostics', `${diagnosis}.png`), 'tampered');
      assert.throws(() => restoreAiAssetBackup(archive, file, restoredFiles), /AI_ASSET/);
      const targetName = `sdf_restore_${randomUUID().replaceAll('-', '')}`; let target: Pool | undefined;
      await f.pool.query(`CREATE DATABASE "${targetName}"`);
      try {
        target = new Pool({ connectionString: `${taskPgBase}/${targetName}` });
        await restoreIntoEmptyDatabase(target, f.mongo, f.mongo.db(targetName), archive);
        assert.equal((await createDatabaseBackup(target, f.mongo, f.mongo.db(targetName))).data_sha256, archive.data_sha256);
      } finally { await target?.end(); await f.mongo.db(targetName).dropDatabase(); await f.pool.query(`DROP DATABASE "${targetName}"`); }
    });
  } finally { await app?.close(); await f.close(); assert(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true }); }
});
