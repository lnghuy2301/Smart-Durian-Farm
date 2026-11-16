import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface ChatConfig { provider: 'disabled' | 'gemini' | 'groq'; apiKey: string; model: string; timeoutMs: number; maxOutputTokens: number }
export type GeminiConfig = ChatConfig;
export interface AiConfig { enabled: boolean; url: string; token: string; root: string; timeoutMs: number; chat?: ChatConfig }
export const AI_CONFIG = Symbol('AI_CONFIG');
export class AiConfigurationError extends Error {
  constructor(readonly field: string, readonly hint: string) { super(`${field}: ${hint}`); }
}
function workspaceRoot() {
  let dir = __dirname;
  for (let i = 0; i < 9; i++, dir = dirname(dir)) {
    const file = join(dir, 'package.json');
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name === 'smart-durian-farm') return dir;
  }
  throw new Error('AI workspace root not found');
}
export function readAiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const provider = env.AI_CHAT_PROVIDER ?? 'disabled';
  if (!['disabled', 'gemini', 'groq'].includes(provider)) throw new AiConfigurationError('AI_CHAT_PROVIDER', 'Chỉ dùng disabled, gemini hoặc groq.');
  const prefix = provider === 'groq' ? 'GROQ' : 'GEMINI';
  const apiKey = env[`${prefix}_API_KEY`]?.trim() ?? '', model = env[`${prefix}_MODEL`] ?? (provider === 'groq' ? 'openai/gpt-oss-20b' : 'gemini-3.1-flash-lite');
  const timeoutMs = Number(env[`${prefix}_TIMEOUT_MS`] ?? '30000'), maxOutputTokens = Number(env[`${prefix}_MAX_OUTPUT_TOKENS`] ?? '4096');
  // Keys are opaque header credentials, including Google's newer auth keys.
  // Validate transport safety, not a guessed prefix/alphabet/legacy length.
  if (apiKey && !/^[\x21-\x7e]{1,4096}$/.test(apiKey)) throw new AiConfigurationError(`${prefix}_API_KEY`, 'Dán nguyên key trên một dòng, không có khoảng trắng bên trong/ký tự điều khiển; không thêm Bearer.');
  if (!(provider === 'groq' ? /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$/ : /^gemini-[a-z0-9.-]{1,80}$/).test(model) || model.includes('..')) throw new AiConfigurationError(`${prefix}_MODEL`, 'Dùng mã model hợp lệ, không phải URL.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 40000) throw new AiConfigurationError(`${prefix}_TIMEOUT_MS`, 'Số nguyên từ 1000 đến 40000 mili giây.');
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 512 || maxOutputTokens > 8192) throw new AiConfigurationError(`${prefix}_MAX_OUTPUT_TOKENS`, 'Số nguyên từ 512 đến 8192.');
  const flag = env.AI_SERVICE_ENABLED ?? 'false', url = env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001';
  let target: URL;
  try { target = new URL(url); } catch { throw new AiConfigurationError('AI_SERVICE_URL', 'Dùng URL worker local, ví dụ http://127.0.0.1:8001.'); }
  const token = env.AI_INTERNAL_TOKEN ?? '';
  if (!['true', 'false'].includes(flag) || !['http:', 'https:'].includes(target.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
    || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new AiConfigurationError('AI_SERVICE_ENABLED/AI_SERVICE_URL', 'Enabled phải true/false; URL worker chỉ dùng loopback, không kèm tài khoản hoặc query.');
  if (flag === 'true' && token.length < 32) throw new AiConfigurationError('AI_INTERNAL_TOKEN', 'Cần token nội bộ ít nhất 32 ký tự khi bật worker.');
  return { enabled: flag === 'true', url: target.origin, token, root: resolve(workspaceRoot(), 'ai'), timeoutMs: 30000,
    chat: { provider: provider as ChatConfig['provider'], apiKey, model, timeoutMs, maxOutputTokens } };
}
