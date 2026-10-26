import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { RagSource } from './ai.types';

export interface PreparedEntry { filename: string; title: string; sha256: string; source: RagSource }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const basename = (v: unknown): v is string => typeof v === 'string' && v.length <= 255 && !/[/\\]/.test(v) && /\.pdf$/i.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
async function localFile(dir: string, name: string, limit: number) {
  const root = await realpath(dir).catch(() => { throw new NotFoundException('Chưa có thư mục PDF đã chuẩn bị'); });
  const path = await realpath(join(root, name)).catch(() => { throw new NotFoundException('Không tìm thấy file nguồn đã chuẩn bị'); });
  const delta = relative(root, path);
  if (delta.startsWith('..') || isAbsolute(delta)) throw new BadRequestException('File nằm ngoài thư mục cho phép');
  const info = await stat(path); if (!info.isFile() || info.size > limit) throw new BadRequestException('File nguồn vượt giới hạn');
  return readFile(path);
}
export async function preparedEntries(root: string): Promise<PreparedEntry[]> {
  let data: { format?: unknown; entries?: PreparedEntry[] };
  try { data = JSON.parse((await localFile(join(root, 'data/rag/prepared'), 'manifest.json', 512 * 1024)).toString('utf8')); }
  catch (error) { if (error instanceof NotFoundException) return []; throw new BadRequestException('Manifest PDF không hợp lệ'); }
  if (data.format !== 'smart-durian-prepared-v1' || !Array.isArray(data.entries) || data.entries.length > 100) throw new BadRequestException('Manifest PDF không hợp lệ');
  const names = new Set<string>();
  for (const entry of data.entries) {
    const s = entry?.source;
    if (!entry || !basename(entry.filename) || names.has(entry.filename) || !sha(entry.sha256) || typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 120
      || !s || !basename(s.filename) || !sha(s.sha256) || typeof s.is_draft !== 'boolean' || !Array.isArray(s.page_map) || !s.page_map.length || s.page_map.length > 100
      || s.page_map.some((n, i) => !Number.isInteger(n) || n < 1 || n > 1000 || (i > 0 && n <= s.page_map[i - 1]))) throw new BadRequestException('Nguồn/trang PDF chuẩn bị không hợp lệ');
    names.add(entry.filename);
  }
  return data.entries;
}
export async function loadPrepared(root: string, name: string) {
  if (!basename(name)) throw new BadRequestException('Tên PDF không hợp lệ');
  const entry = (await preparedEntries(root)).find((v) => v.filename === name);
  if (!entry) throw new NotFoundException('Không tìm thấy PDF trong manifest');
  // Bind both derivative and original bytes. Page mappings never come from a
  // client request and cannot silently survive replacing either local file.
  const original = await localFile(join(root, 'data/rag/pdfs'), entry.source.filename, 64 * 1024 * 1024);
  const bytes = await localFile(join(root, 'data/rag/prepared'), name, 10 * 1024 * 1024);
  if (hash(original) !== entry.source.sha256 || hash(bytes) !== entry.sha256) throw new ConflictException('PDF/nguồn đã thay đổi; chuẩn bị lại manifest trước khi nhập');
  return { entry, bytes };
}
