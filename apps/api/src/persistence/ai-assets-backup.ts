import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BSON, ObjectId } from 'mongodb';
import { BackupError, DatabaseBackup, verifyBackup } from './backup';

interface Asset { path: string; sha256: string; limit: number }
interface Manifest { format: string; database_sha256: string; files: { path: string; sha256: string; size: number }[] }
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function fail(): never { throw new BackupError('AI_ASSET_BUNDLE_MISSING_OR_MISMATCH'); }
function plans(archive: DatabaseBackup): Asset[] {
  verifyBackup(archive); const result: Asset[] = [];
  for (const collection of archive.mongo) {
    if (!['AI_DISEASE_DIAGNOSTICS', 'AI_RAG_DOCUMENTS'].includes(collection.name)) continue;
    for (const json of collection.documents) {
      const row = BSON.EJSON.parse(json), id = row._id;
      if (!(id instanceof ObjectId)) fail();
      const image = collection.name === 'AI_DISEASE_DIAGNOSTICS';
      const name = image ? row.image_file : `${id.toHexString()}.pdf`, expected = image ? row.image_sha256 : row.sha256;
      if (typeof name !== 'string' || !new RegExp(`^${id.toHexString()}\\.${image ? '(png|jpg)' : 'pdf'}$`).test(name) || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) fail();
      result.push({ path: `storage/${image ? 'diagnostics' : 'rag-documents'}/${name}`, sha256: expected, limit: (image ? 5 : 10) * 1024 * 1024 });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
function directory(path: string) {
  if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) fail();
  mkdirSync(path, { recursive: true });
}
function asset(root: string, entry: Asset) {
  const base = resolve(root), parts = entry.path.split('/'); let path = base;
  // Paths come exclusively from the fixed plan, never from a manifest field.
  if (existsSync(base) && lstatSync(base).isSymbolicLink()) fail();
  for (const part of parts) { path = join(path, part); if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail(); }
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size > entry.limit) fail();
  const bytes = readFileSync(path); if (hash(bytes) !== entry.sha256) fail(); return bytes;
}
export function createAiAssetBackup(archive: DatabaseBackup, archiveFile: string, aiRoot: string) {
  const entries = plans(archive); if (!entries.length) return { files: 0 };
  const dir = resolve(`${archiveFile}.assets`); if (existsSync(dir)) fail(); directory(dir);
  const manifest: Manifest = { format: 'smart-durian-ai-assets-v1', database_sha256: archive.data_sha256, files: [] };
  for (const entry of entries) {
    const bytes = asset(aiRoot, entry), target = join(dir, entry.path); directory(dirname(target)); writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    manifest.files.push({ path: entry.path, sha256: entry.sha256, size: bytes.length });
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  return { files: entries.length, directory: dir };
}
export function verifyAiAssetBackup(archive: DatabaseBackup, archiveFile: string) {
  const entries = plans(archive); if (!entries.length) return { files: 0 };
  const dir = resolve(`${archiveFile}.assets`), manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath) || lstatSync(dir).isSymbolicLink() || lstatSync(manifestPath).isSymbolicLink()) fail();
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  if (manifest.format !== 'smart-durian-ai-assets-v1' || manifest.database_sha256 !== archive.data_sha256 || !Array.isArray(manifest.files) || manifest.files.length !== entries.length) fail();
  entries.forEach((entry, index) => {
    const actual = manifest.files[index], bytes = asset(dir, entry);
    if (actual.path !== entry.path || actual.sha256 !== entry.sha256 || actual.size !== bytes.length) fail();
  });
  return { files: entries.length };
}
export function restoreAiAssetBackup(archive: DatabaseBackup, archiveFile: string, aiRoot: string) {
  verifyAiAssetBackup(archive, archiveFile);
  for (const entry of plans(archive)) {
    const bytes = asset(resolve(`${archiveFile}.assets`), entry), target = resolve(aiRoot, entry.path);
    if (existsSync(target)) { asset(aiRoot, entry); continue; }
    directory(aiRoot); directory(join(aiRoot, 'storage')); directory(dirname(target)); writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  }
}
