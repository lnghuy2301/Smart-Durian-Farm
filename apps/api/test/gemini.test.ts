import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { readEnvironment } from '../src/config/environment';
import { readAiConfig, GeminiConfig } from '../src/ai/ai.config';
import { GeminiChatProvider } from '../src/ai/gemini.provider';
import { ChatProvider } from '../src/ai/ai.worker';
import { Citation } from '../src/ai/ai.types';
import { acceptanceFailure, geminiReadiness } from '../src/ai/pre-acceptance-cli';

const config: GeminiConfig = { provider: 'gemini', apiKey: 'fixture-gemini-key-never-real-12345', model: 'gemini-3.8-flash', timeoutMs: 1000, maxOutputTokens: 4096 };
const context: Citation = { document_id: 'private-mongo-id', filename: 'prepared.pdf', sha256: 'b'.repeat(64), page: 1, chunk_id: 'a'.repeat(64), excerpt: 'Theo dõi độ ẩm và thoát nước.',
  source: { filename: 'Nguồn dự thảo.pdf', sha256: 'c'.repeat(64), page: 265, is_draft: true } };
const input = { system: 'Server policy', question: 'Thoát nước thế nào?', history: [{ role: 'assistant' as const, content: 'Lịch sử riêng' }], contexts: [context] };
const envelope = (answer: unknown, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(answer) }] } }] });
const good = { text: 'Dự thảo hướng dẫn theo dõi độ ẩm và thoát nước.', used_chunk_ids: [context.chunk_id] };
const status = (expected: number) => (e: unknown) => e instanceof HttpException && e.getStatus() === expected;

test('Gemini configuration tolerates absent key, rejects unsafe model/config, and factory selects the real adapter', async () => {
  const empty = readAiConfig({ AI_CHAT_PROVIDER: 'gemini' });
  assert.equal(empty.chat!.model, 'gemini-3.1-flash-lite');
  assert.equal(new GeminiChatProvider(empty.chat!).configured(), false);
  assert.equal(geminiReadiness(empty).state, 'needs_setup');
  const configured = geminiReadiness({ ...empty, chat: { ...config, model: 'gemini-3.1-flash-lite' } });
  assert.equal(configured.state, 'ready'); assert(!JSON.stringify(configured).includes(config.apiKey));
  assert.equal((configured.details as { live_api_tested: boolean }).live_api_tested, false);
  for (const env of [{ AI_CHAT_PROVIDER: 'other' }, { GEMINI_MODEL: '../../evil' }, { GEMINI_API_KEY: 'line\nbreak' }, { GEMINI_TIMEOUT_MS: 'NaN' }, { GEMINI_MAX_OUTPUT_TOKENS: '9000' }]) assert.throws(() => readAiConfig(env));
  const env = readEnvironment({ NODE_ENV: 'test', AUTH_MODE: 'mock', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', MONGODB_URI: 'mongodb://127.0.0.1:1/test', AUTH_TEST_PHONE: '0900000000', AUTH_TEST_PASSWORD: 'FixturePassword!',
    AUTH_TEST_ADMIN_PHONE: '0900000001', AUTH_TEST_ADMIN_PASSWORD: 'FixtureAdminPassword!', JWT_SECRET: 'fixture-only-jwt-secret-at-least32chars', AI_CHAT_PROVIDER: 'gemini' });
  const module = await Test.createTestingModule({ imports: [AppModule.register(env)] }).compile();
  try { assert(module.get(ChatProvider) instanceof GeminiChatProvider); assert.equal(module.get(ChatProvider).configured(), false); }
  finally { await module.close(); }
});

test('Opaque dotted auth keys pass configuration while unsafe keys identify only the field without disclosing secrets', () => {
  const key = 'AQ.fixture-auth-key.with-dot=';
  assert.equal(readAiConfig({ GEMINI_API_KEY: key }).chat!.apiKey, key);
  assert.equal(readAiConfig({ GEMINI_API_KEY: 'AQ.' + 'x'.repeat(1000) }).chat!.apiKey.length, 1003);
  for (const bad of [key + '\r\nInjected: value', 'Bearer ' + key, key + ' inside', 'x'.repeat(4097)]) {
    try { readAiConfig({ GEMINI_API_KEY: bad }); assert.fail('unsafe key accepted'); }
    catch (error) {
      const report = acceptanceFailure(error);
      assert.equal(report.checks[0].details.field, 'GEMINI_API_KEY');
      assert(!JSON.stringify(report).includes(key)); assert(!JSON.stringify(report).includes(bad));
    }
  }
  assert(!JSON.stringify(acceptanceFailure(new Error('private ' + key))).includes(key));
});

test('Gemini Flash-Lite and Flash use fixed HTTPS host, secret header, bounded context and JSON source enum', async () => {
  for (const model of ['gemini-3.1-flash-lite', 'gemini-3.8-flash']) {
  let calls = 0;
  const authKey = model === 'gemini-3.1-flash-lite' ? 'AQ.fixture-opaque.auth-key=' : config.apiKey;
  const provider = new GeminiChatProvider({ ...config, model, apiKey: authKey }, async (url, options) => {
    calls++; assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error');
    assert.equal((options?.headers as Record<string, string>)['x-goog-api-key'], authKey);
    const raw = String(options?.body), body = JSON.parse(raw); assert(!raw.includes(authKey)); assert(!raw.includes(context.document_id));
    const data = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(data.contexts[0].source.page, 265); assert.equal(data.contexts[0].source.is_draft, true);
    assert.equal(data.history.length, 6); assert.equal(body.tools, undefined);
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
    assert.deepEqual(body.generationConfig.responseFormat.text.schema.properties.used_chunk_ids.items.enum, [context.chunk_id]);
    return Response.json(envelope(good));
  });
  assert.deepEqual(await provider.generate({ ...input, history: Array.from({ length: 20 }, () => input.history[0]) }), good); assert.equal(calls, 1);
  }
});

test('Gemini never calls with missing key and sanitizes quota/auth/upstream/timeout errors without retry', async () => {
  let calls = 0;
  const disabled = new GeminiChatProvider({ ...config, apiKey: '' }, async () => { calls++; throw new Error('must not run'); });
  await assert.rejects(disabled.generate(input), status(503)); assert.equal(calls, 0);
  for (const code of [400, 401, 403, 429, 500, 503]) {
    calls = 0;
    const provider = new GeminiChatProvider(config, async () => { calls++; return new Response(config.apiKey, { status: code }); });
    await assert.rejects(provider.generate(input), (error: unknown) => status(code === 429 ? 429 : 503)(error) && !String(error).includes(config.apiKey)); assert.equal(calls, 1);
  }
  const provider = new GeminiChatProvider(config, async () => { throw new Error('sensitive ' + config.apiKey); });
  await assert.rejects(provider.generate(input), (e: unknown) => status(503)(e) && !String(e).includes(config.apiKey));
});

test('Gemini rejects blocked, truncated, oversized, malformed or invented citations', async () => {
  const invalid = [
    { promptFeedback: { blockReason: 'SAFETY' } }, envelope(good, 'MAX_TOKENS'), { candidates: [] },
    envelope({ ...good, used_chunk_ids: ['invented'] }), envelope({ ...good, used_chunk_ids: [] }),
    envelope({ ...good, used_chunk_ids: [context.chunk_id, context.chunk_id] }), envelope({ ...good, extra: 'ignored?' }),
    envelope({ ...good, text: 'x'.repeat(8001) }), { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'pump_on' } }] } }] },
  ];
  for (const value of invalid) {
    const provider = new GeminiChatProvider(config, async () => Response.json(value));
    await assert.rejects(provider.generate(input), (e: unknown) => e instanceof HttpException && [400, 503].includes(e.getStatus()));
  }
  for (const content of ['not json', 'x'.repeat(128 * 1024 + 1)]) {
    await assert.rejects(new GeminiChatProvider(config, async () => new Response(content)).generate(input), status(503));
  }
});
