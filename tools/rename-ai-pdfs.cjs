// Explicit offline maintenance. Run preview first; apply requires a verified backup.
// PDF contents, source hashes, page mappings, chunks and historical chat citations stay intact.
const { config } = require('dotenv');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Pool } = require('pg');
const { MongoClient } = require('mongodb');

const root = path.resolve(__dirname, '..');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function safeFile(directory, name) {
  if (typeof name !== 'string' || path.basename(name) !== name || /[\\/]/.test(name) || !name.endsWith('.pdf') || name.length > 255) throw new Error('INVALID_PDF_NAME');
  const base = fs.realpathSync(directory), target = path.resolve(base, name);
  if (path.dirname(target) !== base || (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())) throw new Error('UNSAFE_PDF_PATH');
  return target;
}
function transition(directory, oldName, newName, expectedHash) {
  const from = safeFile(directory, oldName), to = safeFile(directory, newName);
  if (from !== to && fs.existsSync(from) && fs.existsSync(to)) throw new Error('BOTH_NAMES_EXIST_REVIEW_BEFORE_RENAME');
  const current = fs.existsSync(from) ? from : to;
  if (!fs.existsSync(current) || !fs.statSync(current).isFile() || fs.statSync(current).size > 64 * 1024 * 1024) throw new Error('SOURCE_NOT_AVAILABLE');
  if (expectedHash && sha(fs.readFileSync(current)) !== expectedHash) throw new Error('SOURCE_HASH_CHANGED');
  return { from, to, current };
}
function renamePlan() {
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'ai/corpus.sources.json'), 'utf8'));
  const directory = path.join(root, 'ai/data/rag/prepared');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const operations = [...plan.sources, ...plan.excluded].map((source) => transition(path.join(root, 'ai/data/rag/pdfs'), source.legacy_filename || source.filename, source.filename, source.sha256));
  const next = structuredClone(manifest);
  for (const entry of next.entries) {
    const source = plan.sources.find((item) => item.sha256 === entry.source.sha256);
    if (!source || ![source.filename, source.legacy_filename].includes(entry.source.filename)) throw new Error('UNKNOWN_MANIFEST_SOURCE');
    const first = String(entry.source.page_map[0]).padStart(3, '0');
    const last = String(entry.source.page_map.at(-1)).padStart(3, '0');
    const filename = `${source.filename.slice(0, -4)}__p${first}-${last}.pdf`;
    operations.push(transition(directory, entry.filename, filename, entry.sha256));
    entry.filename = filename;
    entry.source.filename = source.filename;
  }
  return { operations, next, manifestPath: path.join(directory, 'manifest.json') };
}
async function main() {
  const mode = process.argv[2] || 'preview';
  if (!['preview', 'apply'].includes(mode)) throw new Error('USE_PREVIEW_OR_APPLY');
  const plan = renamePlan();
  const pending = plan.operations.filter((item) => item.current !== item.to);
  if (mode === 'preview') { console.log(JSON.stringify({ mode, original_files: plan.operations.length - plan.next.entries.length, prepared_files: plan.next.entries.length, pending_renames: pending.length, changes_pdf_bytes: false })); return; }
  config({ path: path.join(root, '.env') });
  require('reflect-metadata');
  const { verifyBackup } = require('../apps/api/dist/persistence/backup');
  const { verifyAiAssetBackup } = require('../apps/api/dist/persistence/ai-assets-backup');
  const backupPath = path.resolve(process.argv[3] || '');
  if (!process.argv[3] || !fs.statSync(backupPath).isFile() || fs.statSync(backupPath).size > 128 * 1024 * 1024) throw new Error('VERIFIED_BACKUP_REQUIRED');
  const archive = verifyBackup(JSON.parse(fs.readFileSync(backupPath, 'utf8')));
  verifyAiAssetBackup(archive, backupPath);
  const originalDocs = archive.mongo.find((collection) => collection.name === 'AI_RAG_DOCUMENTS');
  if (!originalDocs) throw new Error('BACKUP_MISSING_CORPUS');
  const { BSON } = require('mongodb');
  const saved = originalDocs.documents.map((json) => BSON.EJSON.parse(json));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  const mongo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  let client;
  try {
    client = await pool.connect(); await client.query('BEGIN');
    for (const key of ['smart-durian:migrations', 'smart-durian:actuator-runtime']) {
      if (!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [key])).rows[0].locked) throw new Error('STOP_API_AND_MIGRATIONS_FIRST');
    }
    const docs = mongo.db().collection('AI_RAG_DOCUMENTS');
    const existing = await docs.find({}).toArray();
    const targets = existing.filter((doc) => plan.next.entries.some((entry) => entry.sha256 === doc.sha256));
    for (const doc of targets) {
      const before = saved.find((value) => value._id.equals(doc._id) && value.sha256 === doc.sha256);
      const entry = plan.next.entries.find((value) => value.sha256 === doc.sha256);
      if (!before || !doc.source || doc.source.sha256 !== entry.source.sha256 || JSON.stringify(doc.source.page_map) !== JSON.stringify(entry.source.page_map)) throw new Error('CORPUS_PROVENANCE_DIFFERS_FROM_BACKUP_OR_PLAN');
    }
    // Rename only prevalidated files in fixed directories; no recursive operation or overwrite.
    // If interrupted, already-renamed files are accepted by checksum on the next explicit run.
    for (const operation of pending) fs.renameSync(operation.from, operation.to);
    let updated = 0;
    const session = mongo.startSession();
    try {
      await session.withTransaction(async () => {
        updated = 0;
        for (const doc of targets) {
          const entry = plan.next.entries.find((value) => value.sha256 === doc.sha256);
          if (doc.filename === entry.filename && doc.source.filename === entry.source.filename) continue;
          const result = await docs.updateOne({ _id: doc._id, sha256: doc.sha256, filename: doc.filename, 'source.filename': doc.source.filename },
            { $set: { filename: entry.filename, 'source.filename': entry.source.filename, updated_at: new Date() } }, { session });
          if (result.matchedCount !== 1) throw new Error('CORPUS_CHANGED_DURING_MAINTENANCE');
          updated++;
        }
      });
    } finally { await session.endSession(); }
    if (fs.lstatSync(plan.manifestPath).isSymbolicLink()) throw new Error('UNSAFE_MANIFEST');
    fs.writeFileSync(plan.manifestPath, JSON.stringify(plan.next, null, 2) + '\n');
    await client.query('COMMIT');
    console.log(JSON.stringify({ mode, renamed_files: pending.length, updated_documents: updated, pdf_bytes_unchanged: true, historical_citations_unchanged: true }));
  } finally {
    if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    await Promise.allSettled([pool.end(), mongo.close()]);
  }
}
main().catch(() => { console.error('PDF_RENAME_FAILED: stop API, verify backup and inspect the source plan; rerun explicitly after resolving the cause. No credentials logged.'); process.exitCode = 1; });
