import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendRichLoginReferences } from '../src/persistence/rich-data-cli';

test('seed account references stay in private Markdown, preserve operator notes and never repopulate env', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sdf-local-login-guide-'));
  try {
    const env = join(directory, '.env'), guide = join(directory, 'accounts.private.md');
    const original = 'MQTT_ENABLED=false\r\nAUTH_TEST_PASSWORD=ExistingFixtureValue!\r\n';
    writeFileSync(env, original);
    assert.throws(() => appendRichLoginReferences(env, 'UnverifiedFixturePassword!'), /PRIVATE_MARKDOWN/);
    assert.equal(readFileSync(env, 'utf8'), original);
    writeFileSync(guide, '# Operator checklist\n\n- [x] Existing manual result\n');
    appendRichLoginReferences(guide, 'ConfirmedFixturePassword!', new Set([5]));
    const first = readFileSync(guide, 'utf8');
    assert(first.includes('- [x] Existing manual result'));
    assert.equal((first.match(/login-reference:/g) ?? []).length, 11);
    assert.equal((first.match(/ConfirmedFixturePassword!/g) ?? []).length, 1);
    assert.equal((first.match(/"password": null/g) ?? []).length, 10);
    appendRichLoginReferences(guide, 'DifferentPasswordMustNotOverwrite!', new Set(Array.from({ length: 11 }, (_, i) => i)));
    assert.equal(readFileSync(guide, 'utf8'), first);
    assert.equal(readFileSync(env, 'utf8'), original);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('new private reference document defaults to unverified passwords', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sdf-local-login-guide-'));
  try {
    const guide = join(directory, 'accounts.private.md');
    writeFileSync(join(directory, 'MODULE_ACCEPTANCE_CHECKLIST.md'), '# Public checklist\n\n## 0. Prepare\n\n- [ ] Verify the current account\n');
    appendRichLoginReferences(guide, 'NeverPublishUnverifiedPassword!');
    const content = readFileSync(guide, 'utf8');
    assert(content.startsWith('# Tài khoản kiểm tra local'));
    assert(!content.includes('NeverPublishUnverifiedPassword!'));
    assert.equal((content.match(/"password": null/g) ?? []).length, 11);
    assert(content.includes('- [ ] Verify the current account'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
