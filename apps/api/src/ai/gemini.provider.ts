import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { GeminiConfig } from './ai.config';
import { ChatProvider } from './ai.worker';
import { chatOutputPolicy } from './chat-policy';

export class GeminiChatProvider extends ChatProvider {
  constructor(private readonly config: GeminiConfig, private readonly fetcher: typeof fetch = fetch) { super(); }
  configured() { return this.config.provider === 'gemini' && !!this.config.apiKey; }
  async generate(input: Parameters<ChatProvider['generate']>[0]): Promise<{ text: string; used_chunk_ids: string[] }> {
    if (!this.configured()) throw new ServiceUnavailableException('Chưa cấu hình GEMINI_API_KEY; điền key phía server và khởi động lại API');
    const contexts = input.contexts.slice(0, 5).map((c) => ({ chunk_id: c.chunk_id, excerpt: c.excerpt,
      source: { filename: c.source?.filename ?? c.filename, page: c.source?.page ?? c.page, is_draft: c.source?.is_draft ?? null } }));
    const ids = [...new Set(contexts.map((c) => c.chunk_id))];
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: input.system + '\n' + chatOutputPolicy }] },
      // Whitelist content only: no JWT, user/Zone UUID, private image or full PDF
      // enters the provider request. Prior replies remain untrusted input data.
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ question: input.question,
        history: input.history.slice(-6).map(({ role, content }) => ({ role, content })), contexts }) }] }],
      generationConfig: { maxOutputTokens: this.config.maxOutputTokens,
        ...(this.config.model.startsWith('gemini-3.') ? { thinkingConfig: { thinkingLevel: 'LOW' } } : {}),
        responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: {
          type: 'object', additionalProperties: false, required: ['text', 'used_chunk_ids'], properties: {
            text: { type: 'string' }, used_chunk_ids: { type: 'array', minItems: 0, maxItems: 5, items: { type: 'string', ...(ids.length ? { enum: ids } : {}) } },
          },
        } } } },
    });
    if (Buffer.byteLength(body) > 128 * 1024) throw new BadRequestException('Nội dung hội thoại vượt giới hạn gửi Gemini');
    try {
      const response = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.apiKey }, body,
      });
      // Never retry a billable generation or expose Google's body/key in errors.
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new HttpException('Gemini đang giới hạn lượt dùng; đợi rồi thử lại', 429);
        throw new Error('provider_unavailable');
      }
      const reader = response.body?.getReader(); if (!reader) throw new Error('empty_body');
      const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
        if (size > 128 * 1024) throw new Error('response_limit'); chunks.push(part.value); } }
      finally { await reader.cancel().catch(() => undefined); }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (value.promptFeedback?.blockReason) throw new BadRequestException('Gemini không thể trả lời nội dung này; hãy diễn đạt lại câu hỏi');
      const candidate = value.candidates?.[0];
      if (value.candidates?.length !== 1 || candidate?.finishReason !== 'STOP' || !Array.isArray(candidate?.content?.parts)) throw new Error('incomplete_answer');
      const parts = candidate.content.parts.filter((p: { thought?: boolean }) => p.thought !== true);
      if (!parts.length || parts.some((p: { text?: unknown; functionCall?: unknown }) => typeof p.text !== 'string' || p.functionCall)) throw new Error('invalid_parts');
      const answer = JSON.parse(parts.map((p: { text: string }) => p.text).join(''));
      if (!answer || Object.keys(answer).sort().join(',') !== 'text,used_chunk_ids' || typeof answer.text !== 'string' || !answer.text.trim() || answer.text.length > 8000
        || !Array.isArray(answer.used_chunk_ids) || answer.used_chunk_ids.length > 5
        || new Set(answer.used_chunk_ids).size !== answer.used_chunk_ids.length || answer.used_chunk_ids.some((id: unknown) => typeof id !== 'string' || !ids.includes(id))) throw new Error('invalid_answer');
      return { text: answer.text.trim(), used_chunk_ids: answer.used_chunk_ids };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Gemini chưa trả lời thành công; kiểm tra key, model hoặc kết nối. Chưa lưu tin nhắn, không tự gửi lại');
    }
  }
}
