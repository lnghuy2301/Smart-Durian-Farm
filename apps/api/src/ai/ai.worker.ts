import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AiConfig } from './ai.config';
import { Classification, PdfPages, Citation } from './ai.types';

export abstract class AiWorker {
  async model(): Promise<unknown> { throw new ServiceUnavailableException('Model chưa sẵn sàng'); }
  abstract classify(bytes: Buffer): Promise<Classification>;
  abstract extractPdf(bytes: Buffer): Promise<PdfPages>;
}
export abstract class ChatProvider {
  abstract configured(): boolean;
  abstract generate(input: { system: string; question: string; history: { role: 'user' | 'assistant'; content: string }[]; contexts: Citation[] }): Promise<{ text: string; used_chunk_ids: string[] }>;
}
export class DisabledChatProvider extends ChatProvider {
  configured() { return false; }
  async generate(): Promise<{ text: string; used_chunk_ids: string[] }> { throw new ServiceUnavailableException('Chưa cấu hình nhà cung cấp API chatbot'); }
}
export class HttpAiWorker extends AiWorker {
  constructor(private readonly config: AiConfig) { super(); }
  async model() { return this.request('/v1/model'); }
  async classify(bytes: Buffer) { return this.request('/v1/classify', bytes, 'application/octet-stream') as Promise<Classification>; }
  async extractPdf(bytes: Buffer) { return this.request('/v1/extract-pdf', bytes, 'application/pdf') as Promise<PdfPages>; }
  private async request(path: string, bytes?: Buffer, type?: string): Promise<unknown> {
    if (!this.config.enabled) throw new ServiceUnavailableException('AI service chưa được bật');
    try {
      const response = await fetch(this.config.url + path, { method: bytes ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: { Authorization: `Bearer ${this.config.token}`, ...(type ? { 'Content-Type': type } : {}) }, body: bytes ? new Uint8Array(bytes) : undefined });
      if (response.status === 422 || response.status === 413) throw new BadRequestException('Ảnh/PDF không hợp lệ hoặc vượt giới hạn xử lý');
      if (!response.ok) throw new Error('AI unavailable');
      const reader = response.body?.getReader(); if (!reader) throw new Error('Empty response');
      const parts: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 3_000_000) throw new Error('AI response limit'); parts.push(part.value); } }
      finally { await reader.cancel().catch(() => undefined); }
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException('AI service hoặc model chưa sẵn sàng; không tự gửi lại yêu cầu');
    }
  }
}
