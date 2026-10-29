import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskPersistenceFixture, taskAuth } from './helpers/task-persistence-fixture';

test('PostgreSQL Farmer search normalizes Vietnamese names/phone formats and excludes inactive accounts', async () => {
  const f = await taskPersistenceFixture();
  try {
    const hash = (await f.users.loadByPhone(taskAuth.phoneNumber))!.user.password;
    const farmer = await f.users.createRegisteredUser({ user_name: 'Đặng Thị Hòa', phone_number: '0949990123', passwordHash: hash, gmail: null, role: 'Farmer' });
    for (const q of ['dang thi hoa', 'ĐẶNG', '0949', '+84949', '0123']) {
      assert.deepEqual((await f.users.searchActiveFarmers(q)).items, [{ id: farmer.user.id, user_name: farmer.user.user_name, phone_number: farmer.user.phone_number }]);
    }
    assert.equal((await f.users.searchActiveFarmers("' OR 1=1 --")).items.length, 0);
  } finally { await f.close(); }
});
