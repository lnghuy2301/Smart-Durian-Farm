import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface GeminiConfig { provider: 'disabled' | 'gemini'; apiKey: string; model: string; timeoutMs: number; maxOutputTokens: number }
export interface AiConfig { enabled: boolean; url: string; token: string; root: string; timeoutMs: number; chat?: GeminiConfig }
export const AI_CONFIG = Symbol('AI_CONFIG');
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
  if (provider !== 'disabled' && provider !== 'gemini') throw new Error('Invalid AI_CHAT_PROVIDER');
  const apiKey = env.GEMINI_API_KEY?.trim() ?? '', model = env.GEMINI_MODEL ?? 'gemini-3.8-flash';
  const timeoutMs = Number(env.GEMINI_TIMEOUT_MS ?? '30000'), maxOutputTokens = Number(env.GEMINI_MAX_OUTPUT_TOKENS ?? '4096');
  if ((apiKey && !/^[a-zA-Z0-9_-]{20,256}$/.test(apiKey)) || !/^gemini-[a-z0-9.-]{1,80}$/.test(model)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 40000 || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 512 || maxOutputTokens > 8192) throw new Error('Invalid Gemini configuration');
  const flag = env.AI_SERVICE_ENABLED ?? 'false', url = env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001';
  const target = new URL(url), token = env.AI_INTERNAL_TOKEN ?? '';
  if (!['true', 'false'].includes(flag) || !['http:', 'https:'].includes(target.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
    || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('Invalid local AI service configuration');
  if (flag === 'true' && token.length < 32) throw new Error('AI_INTERNAL_TOKEN requires at least32 characters');
  return { enabled: flag === 'true', url: target.origin, token, root: resolve(workspaceRoot(), 'ai'), timeoutMs: 30000,
    chat: { provider, apiKey, model, timeoutMs, maxOutputTokens } };
}
