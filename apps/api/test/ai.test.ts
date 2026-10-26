import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { readEnvironment } from '../src/config/environment';
import { MockUserStore } from '../src/auth/mock-user.store';
import { AiWorker, ChatProvider } from '../src/ai/ai.worker';
import { AiStore } from '../src/ai/ai.store';
import { Classification, Citation } from '../src/ai/ai.types';
import { FarmsService } from '../src/farms/farms.service';
import { StandardsService } from '../src/standards/standards.service';
import { ZonesService } from '../src/zones/zones.service';
import { readAiConfig } from '../src/ai/ai.config';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const prediction: Classification = { task: 'classify', model_sha256: 'a'.repeat(64), predictions: [{ class_id: 0, label: 'healthy', confidence: 0.9 }] };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sdf-ai-'));
  const config = readEnvironment({ NODE_ENV: 'test', AUTH_MODE: 'mock', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', MONGODB_URI: 'mongodb://127.0.0.1:1/test',
    AUTH_TEST_PHONE: '0900000000', AUTH_TEST_PASSWORD: 'AiFixtureOnly123!', AUTH_TEST_ADMIN_PHONE: '0900000001', AUTH_TEST_ADMIN_PASSWORD: 'AiAdminFixtureOnly123!', JWT_SECRET: 'ai-fixture-secret-with-at-least-32-bytes' });
  config.ai = { ...config.ai!, enabled: true, token: 'test-only-internal-token'.repeat(2), root };
  const worker = { classify: async (): Promise<Classification> => structuredClone(prediction), extractPdf: async () => ({ page_count: 2, pages: [{ page: 2, text: 'Bệnh thối rễ sầu riêng cần thoát nước tốt. Theo dõi rễ cây và độ ẩm đất thường xuyên.' }] }) };
  const provider = { enabled: false, configured() { return this.enabled; }, generate: async (input: { contexts: Citation[] }) => ({ text: 'Tài liệu hướng dẫn thoát nước tốt và theo dõi độ ẩm đất.', used_chunk_ids: [input.contexts[0].chunk_id] }) };
  const module = await Test.createTestingModule({ imports: [AppModule.register(config)] }).overrideProvider(AiWorker).useValue(worker).overrideProvider(ChatProvider).useValue(provider).compile();
  const app = module.createNestApplication({ logger: false }); configureApplication(app, config); await app.listen(0, '127.0.0.1');
  const users = app.get(MockUserStore), owner = users.user, admin = users.findByPhone('0900000001')!;
  const other = users.add({ ...owner, phone_number: '0900000002' }), manager = users.add({ ...owner, phone_number: '0900000003', role: 'Manager' });
  const http = async (path: string, method = 'GET', body?: object, token?: string) => fetch(`${await app.getUrl()}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async (phone: string, password = 'AiFixtureOnly123!') => { const r = await http('auth/login', 'POST', { phone_number: phone, password }); assert.equal(r.status, 200); return (await r.json() as { access_token: string }).access_token; };
  const tokens = { owner: await login(owner.phone_number), other: await login(other.phone_number), manager: await login(manager.phone_number), admin: await login(admin.phone_number, 'AiAdminFixtureOnly123!') };
  const upload = async (token: string, zone?: string, bytes = png) => {
    const form = new FormData(); form.set('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'leaf.png'); if (zone) form.set('zone_id', zone);
    return fetch(`${await app.getUrl()}/api/ai/diagnoses`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  };
  const close = async () => { await app.close(); assert(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true }); };
  return { root, app, users, owner, admin, other, manager, worker, provider, http, tokens, upload, close };
}

test('AI diagnoses are private Farmer records, allow standalone images and enforce selected Zone scope', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.http('ai/diagnoses')).status, 401);
    assert.equal((await f.upload(f.tokens.admin)).status, 403);
    assert.equal((await f.upload(f.tokens.manager)).status, 403);
    assert.equal((await f.upload(f.tokens.owner, undefined, Buffer.from('<svg/>'))).status, 400);
    const created = await f.upload(f.tokens.owner); assert.equal(created.status, 201);
    const row = await created.json() as { id: string; zone_id: null; user_feedback: null; image_url: string; image_file?: string; ai_predictions: unknown[] };
    assert.equal(row.zone_id, null); assert.equal(row.user_feedback, null); assert.equal(row.image_file, undefined);
    assert.equal((await f.http(`ai/diagnoses/${row.id}`, 'GET', undefined, f.tokens.other)).status, 404);
    assert.equal((await f.http(`ai/diagnoses/${row.id}/image`, 'GET', undefined, f.tokens.other)).status, 404);
    const image = await f.http(`ai/diagnoses/${row.id}/image`, 'GET', undefined, f.tokens.owner); assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const feedback = await f.http(`ai/diagnoses/${row.id}/feedback`, 'PATCH', { user_feedback: false }, f.tokens.owner); assert.equal(feedback.status, 200); assert.equal((await feedback.json() as { user_feedback: boolean }).user_feedback, false);
    assert.equal((await f.http(`ai/diagnoses/${row.id}/feedback`, 'PATCH', { user_feedback: true, farmer_id: f.other.id }, f.tokens.owner)).status, 400);
    const farms = f.app.get(FarmsService), standards = f.app.get(StandardsService), zones = f.app.get(ZonesService);
    const proposal = farms.createRequest(f.owner.id, { area_size: 1, address: 'AI fixture', certificate_number: 'AI-FARM', longitude: 106, latitude: 10 });
    const farm = farms.approve(f.admin.id, proposal.id).farm_id!;
    const standard = standards.create({ code: 'AI-STD', name: 'AI fixture', description: '', certifying_body: 'Fixture' });
    const zone = zones.create(f.owner.id, { farm_id: farm, standard_id: standard.id, zone_name: 'Khu AI', area_size: 0.3, longitude: 106, latitude: 10 });
    assert.equal((await f.upload(f.tokens.other, zone.id)).status, 404);
    assert.equal((await f.upload(f.tokens.owner, zone.id)).status, 201);
    assert.equal((await f.http('ai/diagnoses?farmer_id=anything', 'GET', undefined, f.tokens.owner)).status, 400);
  } finally { await f.close(); }
});

test('Admin imports bounded PDFs with page citations; Farmer cannot manage sources and disabled provider never invents replies', async () => {
  const f = await fixture();
  try {
    const dir = join(f.root, 'data/rag/pdfs'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'guide.pdf'), '%PDF-fixture only');
    assert.equal((await f.http('ai/rag/inbox', 'GET', undefined, f.tokens.owner)).status, 403);
    assert.equal((await f.http('ai/rag/documents/import', 'POST', { filename: '../guide.pdf' }, f.tokens.admin)).status, 400);
    const imported = await f.http('ai/rag/documents/import', 'POST', { filename: 'guide.pdf' }, f.tokens.admin); assert.equal(imported.status, 201);
    const doc = await imported.json() as { id: string; chunk_count: number; chunks?: unknown }; assert.equal(doc.chunks, undefined); assert.equal(doc.chunk_count, 1);
    assert.equal((await f.http('ai/rag/documents/import', 'POST', { filename: 'guide.pdf' }, f.tokens.admin)).status, 409);
    const found = await f.http('ai/rag/search', 'POST', { message: 'benh thoi re' }, f.tokens.admin);
    assert.equal(found.status, 201); const sources = await found.json() as { contexts: Citation[] }; assert.equal(sources.contexts[0].page, 2); assert.equal(sources.contexts[0].filename, 'guide.pdf');
    const conversation = await f.http('ai/conversations', 'POST', { session_title: 'Hỏi về rễ' }, f.tokens.owner); const chat = await conversation.json() as { id: string };
    assert.equal((await f.http(`ai/conversations/${chat.id}/messages`, 'POST', { message: 'thối rễ' }, f.tokens.owner)).status, 503);
    const history = await f.http(`ai/conversations/${chat.id}`, 'GET', undefined, f.tokens.owner); assert.deepEqual((await history.json() as { messages: unknown[] }).messages, []);
    assert.equal((await f.http(`ai/conversations/${chat.id}`, 'GET', undefined, f.tokens.other)).status, 404);
    assert.equal((await f.http(`ai/conversations/${chat.id}`, 'GET', undefined, f.tokens.admin)).status, 403);
    assert.equal((await f.http('ai/rag/documents', 'GET', undefined, f.tokens.manager)).status, 403);
    await f.http(`ai/rag/documents/${doc.id}/status`, 'PATCH', { status: 'Inactive' }, f.tokens.admin);
    const inactive = await f.http('ai/rag/search', 'POST', { message: 'thối rễ' }, f.tokens.admin); assert.deepEqual((await inactive.json() as { contexts: unknown[] }).contexts, []);
  } finally { await f.close(); }
});

test('grounded chat atomically appends pairs, rejects invented sources and detects simultaneous conversation writes', async () => {
  const f = await fixture();
  try {
    f.provider.enabled = true;
    const dir = join(f.root, 'data/rag/pdfs'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'guide.pdf'), '%PDF-fixture only');
    assert.equal((await f.http('ai/rag/documents/import', 'POST', { filename: 'guide.pdf' }, f.tokens.admin)).status, 201);
    const chat = await (await f.http('ai/conversations', 'POST', { session_title: 'Nguồn RAG' }, f.tokens.owner)).json() as { id: string };
    const send = () => f.http(`ai/conversations/${chat.id}/messages`, 'POST', { message: 'Bệnh thối rễ xử lý thế nào?' }, f.tokens.owner);
    const success = await send(); assert.equal(success.status, 201);
    const history = await success.json() as { messages: { citations: Citation[] }[] }; assert.equal(history.messages.length, 2); assert.equal(history.messages[1].citations[0].page, 2);
    let release!: () => void, started!: () => void, calls = 0;
    const waiting = new Promise<void>((r) => { release = r; }), both = new Promise<void>((r) => { started = r; });
    f.provider.generate = async (input) => { if (++calls === 2) started(); await waiting; return { text: 'Nguồn hướng dẫn theo dõi rễ.', used_chunk_ids: [input.contexts[0].chunk_id] }; };
    const a = send(), b = send(); await both; release(); assert.deepEqual((await Promise.all([a, b])).map((r) => r.status).sort(), [201, 409]);
    f.provider.generate = async () => ({ text: 'Không hợp lệ', used_chunk_ids: ['made-up-source'] });
    assert.equal((await send()).status, 503);
    const after = await (await f.http(`ai/conversations/${chat.id}`, 'GET', undefined, f.tokens.owner)).json() as { messages: unknown[] }; assert.equal(after.messages.length, 4);
  } finally { await f.close(); }
});

test('a token version revoked during inference cannot save files or diagnosis; invalid config blocks remote workers', async () => {
  const f = await fixture();
  try {
    assert.throws(() => readAiConfig({ AI_SERVICE_URL: 'https://external.example' }));
    assert.throws(() => readAiConfig({ AI_SERVICE_ENABLED: 'true' }));
    let started!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => { started = r; }), waiting = new Promise<void>((r) => { release = r; });
    f.worker.classify = async () => { started(); await waiting; return prediction; };
    const pending = f.upload(f.tokens.owner); await ready;
    await f.users.replacePassword(f.owner.id, 0, f.owner.password); release(); assert.equal((await pending).status, 403);
    assert.equal((await f.app.get(AiStore).diagnoses(f.owner.id, 0, 10)).total, 0);
    assert.deepEqual(await readdir(join(f.root, 'storage/diagnostics')).catch(() => []), []);
  } finally { await f.close(); }
});
