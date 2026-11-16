import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatSystemPrompt } from '../src/ai/chat-policy';

test('chat receives the correct Vietnam weekday/date across UTC midnight and year boundaries', () => {
  const before = chatSystemPrompt(new Date('2026-10-27T16:59:59.000Z'));
  const after = chatSystemPrompt(new Date('2026-10-27T17:00:00.000Z'));
  assert.match(before, /27\/10\/2026/);
  assert.match(after, /28\/10\/2026/);
  assert.match(after.toLocaleLowerCase('vi'), /thứ tư/);
  assert.match(after, /00:00:00/);
  assert.match(after, /Asia\/Ho_Chi_Minh/);
  assert.match(after, /không yêu cầu người dùng cung cấp lại ngày/);
  assert.match(chatSystemPrompt(new Date('2026-12-31T17:00:00.000Z')), /01\/01\/2027/);
  assert.notEqual(before, after);
});
