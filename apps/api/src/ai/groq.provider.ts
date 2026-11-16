import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ChatConfig } from './ai.config';
import { ChatProvider } from './ai.worker';
import { chatOutputPolicy } from './chat-policy';

export class GroqChatProvider extends ChatProvider {
  constructor(private readonly config: ChatConfig, private readonly fetcher: typeof fetch = fetch) { super(); }
  configured() { return this.config.provider === 'groq' && !!this.config.apiKey; }
  async generate(input: Parameters<ChatProvider['generate']>[0]): Promise<{ text: string; used_chunk_ids: string[] }> {
    if (!this.configured()) throw new ServiceUnavailableException('Chưa cấu hình GROQ_API_KEY; điền key phía server và khởi động lại API');
    // Only source excerpts and bounded conversation text leave the server, never
    // account/Zone IDs, JWT, images or complete private PDFs.
    const contexts = input.contexts.slice(0, 5).map((c) => ({ chunk_id: c.chunk_id, excerpt: c.excerpt,
      source: { filename: c.source?.filename ?? c.filename, page: c.source?.page ?? c.page, is_draft: c.source?.is_draft ?? null } }));
    const ids = contexts.map((c) => c.chunk_id);
    const body = JSON.stringify({ model: this.config.model, stream: false, max_completion_tokens: this.config.maxOutputTokens,
      response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: input.system + '\n' + chatOutputPolicy },
        { role: 'user', content: JSON.stringify({ question: input.question,
          history: input.history.slice(-6).map(({ role, content }) => ({ role, content })), contexts }) },
      ] });
    if (Buffer.byteLength(body) > 128 * 1024) throw new BadRequestException('Nội dung hội thoại vượt giới hạn gửi Groq');
    try {
      const response = await this.fetcher('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` }, body,
      });
      // No retries/fallback: a response lost in transit may already be billed.
      // Return only fixed messages, never upstream bodies or credential details.
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new HttpException('Groq đang giới hạn lượt dùng hoặc quota; kiểm tra hạn mức rồi thử lại', 429);
        if ([401, 403].includes(response.status)) throw new ServiceUnavailableException('Groq từ chối key hoặc quyền truy cập; kiểm tra key và quyền project/model, rồi khởi động lại API nếu đổi key');
        if ([400, 404].includes(response.status)) throw new ServiceUnavailableException('Groq không chấp nhận model hoặc cấu hình yêu cầu; kiểm tra GROQ_MODEL');
        throw new Error('provider_unavailable');
      }
      const reader = response.body?.getReader(); if (!reader) throw new Error('empty_body');
      const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
        if (size > 128 * 1024) throw new Error('response_limit'); chunks.push(part.value); } }
      finally { await reader.cancel().catch(() => undefined); }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const choice = value.choices?.[0], message = choice?.message;
      if (value.choices?.length !== 1 || choice.finish_reason !== 'stop' || message?.role !== 'assistant'
        || typeof message.content !== 'string' || message.tool_calls?.length || message.function_call || message.refusal) throw new Error('incomplete_answer');
      // JSON mode guarantees syntax, not schema or citation validity. Reject
      // malformed/invented sources rather than repair or silently accept them.
      const answer = JSON.parse(message.content);
      if (!answer || Object.keys(answer).sort().join(',') !== 'text,used_chunk_ids' || typeof answer.text !== 'string' || !answer.text.trim() || answer.text.length > 8000
        || !Array.isArray(answer.used_chunk_ids) || answer.used_chunk_ids.length > 5
        || new Set(answer.used_chunk_ids).size !== answer.used_chunk_ids.length || answer.used_chunk_ids.some((id: unknown) => typeof id !== 'string' || !ids.includes(id))) throw new Error('invalid_answer');
      return { text: answer.text.trim(), used_chunk_ids: answer.used_chunk_ids };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Groq chưa trả lời thành công hoặc phản hồi không hợp lệ. Chưa lưu tin nhắn, không tự gửi lại');
    }
  }
}
