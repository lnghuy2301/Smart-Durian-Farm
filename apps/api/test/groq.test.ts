import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { readEnvironment } from '../src/config/environment';
import { ChatConfig, readAiConfig } from '../src/ai/ai.config';
import { GroqChatProvider } from '../src/ai/groq.provider';
import { ChatProvider } from '../src/ai/ai.worker';
import { geminiReadiness } from '../src/ai/pre-acceptance-cli';

const config: ChatConfig = { provider: 'groq', apiKey: 'fixture-secret-groq-key', model: 'openai/gpt-oss-20b', timeoutMs: 1000, maxOutputTokens: 4096 };
const input = { system: 'Server policy', question: 'Chăm sóc sau thu hoạch?', history: [{ role: 'user' as const, content: 'Câu hỏi cũ' }],
  contexts: [{ document_id: 'private-database-id', filename: 'prepared.pdf', sha256: 'b'.repeat(64), page: 1, chunk_id: 'a'.repeat(64), excerpt: 'Tỉa cành khô.',
    source: { filename: 'original.pdf', sha256: 'c'.repeat(64), page: 265, is_draft: true } }] };
const good = { text: 'Nguồn dự thảo hướng dẫn tỉa cành khô.', used_chunk_ids: [input.contexts[0].chunk_id] };
const envelope = (answer: unknown, finish = 'stop') => ({ choices: [{ finish_reason: finish, message: { role: 'assistant', content: JSON.stringify(answer) } }] });

test('Groq selects only its own key/settings and factory; readiness does not assert a live call', async () => {
  const empty = readAiConfig({ AI_CHAT_PROVIDER: 'groq', GEMINI_API_KEY: 'must-not-fallback' });
  assert.equal(empty.chat!.apiKey, ''); assert.equal(new GroqChatProvider(empty.chat!).configured(), false);
  assert.equal(empty.chat!.model, config.model); assert.equal(geminiReadiness(empty).state, 'needs_setup');
  const cfg = readAiConfig({ AI_CHAT_PROVIDER: 'groq', GROQ_API_KEY: config.apiKey, GROQ_MODEL: 'openai/gpt-oss-20b', GEMINI_MODEL: 'bad ignored' });
  assert.equal(cfg.chat!.model, 'openai/gpt-oss-20b');
  const ready = geminiReadiness(cfg); assert.equal(ready.name, 'groq_configuration'); assert.equal(ready.state, 'ready');
  assert(!JSON.stringify(ready).includes(config.apiKey)); assert.equal((ready.details as { live_api_tested: boolean }).live_api_tested, false);
  for (const bad of [{ GROQ_API_KEY: 'line\nbreak' }, { GROQ_MODEL: 'https://evil' }, { GROQ_MODEL: '../path' }, { GROQ_TIMEOUT_MS: '40001' }, { GROQ_MAX_OUTPUT_TOKENS: 'NaN' }]) {
    assert.throws(() => readAiConfig({ AI_CHAT_PROVIDER: 'groq', ...bad }));
  }
  const env = readEnvironment({ NODE_ENV: 'test', AUTH_MODE: 'mock', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', MONGODB_URI: 'mongodb://127.0.0.1:1/test', AUTH_TEST_PHONE: '0900000000', AUTH_TEST_PASSWORD: 'FixturePassword!',
    AUTH_TEST_ADMIN_PHONE: '0900000001', AUTH_TEST_ADMIN_PASSWORD: 'FixtureAdminPassword!', JWT_SECRET: 'fixture-only-jwt-secret-at-least32chars', AI_CHAT_PROVIDER: 'groq' });
  const module = await Test.createTestingModule({ imports: [AppModule.register(env)] }).compile();
  try { assert(module.get(ChatProvider) instanceof GroqChatProvider); } finally { await module.close(); }
});

test('Groq sends bounded whitelisted RAG context, Bearer header and JSON mode to fixed host', async () => {
  let calls = 0;
  const provider = new GroqChatProvider(config, async (url, options) => {
    calls++; assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options?.redirect, 'error'); assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer ' + config.apiKey);
    const raw = String(options?.body), body = JSON.parse(raw);
    assert(!raw.includes(config.apiKey)); assert(!raw.includes('private-database-id'));
    assert.equal(body.model, config.model); assert.equal(body.stream, false); assert.equal(body.max_completion_tokens, 4096);
    assert.deepEqual(body.response_format, { type: 'json_object' }); assert.equal(body.tools, undefined);
    const data = JSON.parse(body.messages[1].content); assert.equal(data.history.length, 6); assert.equal(data.contexts.length, 5);
    assert.equal(data.contexts[0].source.page, 265); assert.equal(data.contexts[0].source.is_draft, true);
    return Response.json(envelope(good));
  });
  assert.deepEqual(await provider.generate({ ...input, history: Array(20).fill(input.history[0]), contexts: Array(8).fill(input.contexts[0]) }), good);
  assert.equal(calls, 1);
});

test('Groq rejects absent key and HTTP/network failures without retries or leaked credentials', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error(config.apiKey); };
  await assert.rejects(new GroqChatProvider({ ...config, apiKey: '' }, fetcher).generate(input));
  assert.equal(calls, 0);
  for (const code of [400, 401, 403, 404, 429, 500, 503]) {
    calls = 0;
    await assert.rejects(new GroqChatProvider(config, async () => { calls++; return new Response(config.apiKey, { status: code }); }).generate(input),
      (e: unknown) => e instanceof HttpException && e.getStatus() === (code === 429 ? 429 : 503) && !String(e).includes(config.apiKey));
    assert.equal(calls, 1);
  }
  await assert.rejects(new GroqChatProvider(config, fetcher).generate(input), (e: unknown) => e instanceof HttpException && e.getStatus() === 503 && !String(e).includes(config.apiKey));
});

test('Groq rejects truncated, malformed, oversized, tool calls and invented/duplicate citations', async () => {
  const invalid = [envelope(good, 'length'), { choices: [] }, envelope({ ...good, used_chunk_ids: ['invented'] }),
    envelope({ ...good, used_chunk_ids: [good.used_chunk_ids[0], good.used_chunk_ids[0]] }),
    envelope({ ...good, extra: 1 }), envelope({ ...good, text: 'x'.repeat(8001) }), envelope({ ...good, text: ' ' }),
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(good), tool_calls: [{ function: { name: 'pump' } }] } }] }];
  for (const body of invalid) await assert.rejects(new GroqChatProvider(config, async () => Response.json(body)).generate(input));
  for (const body of ['not json', 'x'.repeat(128 * 1024 + 1)]) await assert.rejects(new GroqChatProvider(config, async () => new Response(body)).generate(input));
});

test('Groq accepts general answers with no citations, with or without retrieved context', async () => {
  const answer = { text: '**Xin chào!** Tôi có thể giúp gì?', used_chunk_ids: [] };
  for (const contexts of [[], input.contexts]) {
    const provider = new GroqChatProvider(config, async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.match(body.messages[0].content, /used_chunk_ids.*\[\]/);
      return Response.json(envelope(answer));
    });
    assert.deepEqual(await provider.generate({ ...input, contexts }), answer);
  }
  await assert.rejects(new GroqChatProvider(config, async () => Response.json(envelope(good))).generate({ ...input, contexts: [] }));
});
