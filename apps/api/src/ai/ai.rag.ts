import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Citation, PdfPages, RagDocument, Chunk } from './ai.types';

export function makeChunks(input: PdfPages): Chunk[] {
  if (!input || !Number.isInteger(input.page_count) || input.page_count < 1 || input.page_count > 100 || !Array.isArray(input.pages) || input.pages.length > 100) throw new BadRequestException('PDF vượt giới hạn trang');
  const chunks: Chunk[] = []; let total = 0; const pages = new Set<number>();
  for (const page of input.pages) {
    if (!Number.isInteger(page.page) || page.page < 1 || page.page > input.page_count || pages.has(page.page) || typeof page.text !== 'string') throw new BadRequestException('Dữ liệu PDF không hợp lệ');
    pages.add(page.page); total += page.text.length;
    if (total > 400000) throw new BadRequestException('PDF vượt giới hạn nội dung');
    const text = page.text.replace(/\s+/gu, ' ').trim();
    for (let start = 0; start < text.length; start += 680) {
      const part = text.slice(start, start + 800);
      chunks.push({ id: createHash('sha256').update(`${page.page}:${start}:${part}`).digest('hex'), page: page.page, text: part });
      if (chunks.length > 700) throw new BadRequestException('PDF quá nhiều đoạn nội dung');
      if (start + 800 >= text.length) break;
    }
  }
  if (!chunks.length) throw new BadRequestException('PDF không có văn bản; cần OCR trước khi nhập');
  return chunks;
}
const tokens = (text: string) => (text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 1500);
export function retrieve(documents: RagDocument[], question: string): Citation[] {
  const chunks = documents.flatMap((doc) => doc.chunks.map((chunk) => ({ doc, chunk })));
  if (documents.length > 100 || chunks.length > 5000) throw new ServiceUnavailableException('Vượt dung lượng chỉ mục RAG hiện tại');
  const query = [...new Set(tokens(question))].slice(0, 100), corpus = chunks.map(({ chunk }) => {
    const row = tokens(chunk.text), counts = new Map<string, number>();
    for (const token of row) counts.set(token, (counts.get(token) ?? 0) + 1);
    return { counts, length: row.length };
  });
  const average = corpus.reduce((sum, row) => sum + row.length, 0) / Math.max(1, corpus.length);
  const df = query.map((term) => corpus.filter((row) => row.counts.has(term)).length);
  return chunks.map(({ doc, chunk }, index) => {
    const row = corpus[index]; let score = 0;
    query.forEach((term, n) => {
      const tf = row.counts.get(term) ?? 0;
      if (tf) score += Math.log(1 + (chunks.length - df[n] + 0.5) / (df[n] + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * row.length / (average || 1)));
    });
    return { score, citation: { document_id: doc._id.toHexString(), filename: doc.filename, sha256: doc.sha256, page: chunk.page, chunk_id: chunk.id, excerpt: chunk.text } };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.citation.chunk_id.localeCompare(b.citation.chunk_id)).slice(0, 5).map((item) => item.citation);
}
