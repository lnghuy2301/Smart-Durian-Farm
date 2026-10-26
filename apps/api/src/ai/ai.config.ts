import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface AiConfig { enabled: boolean; url: string; token: string; root: string; timeoutMs: number }
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
  if ((env.AI_CHAT_PROVIDER ?? 'disabled') !== 'disabled') throw new Error('Chat API adapter has not been selected; keep AI_CHAT_PROVIDER=disabled');
  const flag = env.AI_SERVICE_ENABLED ?? 'false', url = env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001';
  const target = new URL(url), token = env.AI_INTERNAL_TOKEN ?? '';
  if (!['true', 'false'].includes(flag) || !['http:', 'https:'].includes(target.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
    || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('Invalid local AI service configuration');
  if (flag === 'true' && token.length < 32) throw new Error('AI_INTERNAL_TOKEN requires at least32 characters');
  return { enabled: flag === 'true', url: target.origin, token, root: resolve(workspaceRoot(), 'ai'), timeoutMs: 30000 };
}
