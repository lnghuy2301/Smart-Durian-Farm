import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zoneFixture } from '../integration/helpers/zone-fixture';
import { AssignmentRecords } from '../src/assignments/assignment-records';

test('assignment search scopes contacts to owner/Admin, folds Vietnamese names and phone aliases, and returns a strict projection', async () => {
  const f = await zoneFixture();
  try {
    const zone = f.zones.create(f.owner.id, f.input), port = f.app.get(AssignmentRecords);
    f.worker.user_name = 'Nguyễn Văn An';
    const duplicate = f.users.add({ ...f.worker, phone_number: '0900000044' });
    f.users.add({ ...f.worker, phone_number: '0900000045', status: 'Locked' });
    f.manager.user_name = f.worker.user_name;
    assert.deepEqual(await port.candidates(f.owner.id, zone.id), { items: [], has_more: false });
    const matches = await port.candidates(f.owner.id, zone.id, 'NGUYEN');
    assert.equal(matches.items.length, 2);
    assert.deepEqual(new Set(matches.items.map((u) => u.id)), new Set([f.worker.id, duplicate.id]));
    assert.deepEqual(Object.keys(matches.items[0]).sort(), ['id', 'phone_number', 'previously_assigned', 'user_name']);
    assert.equal(matches.items[0].previously_assigned, false);
    for (const q of ['0900000002', '84900000002', '+84 900 000 002', '0002']) {
      assert.equal((await port.candidates(f.owner.id, zone.id, q)).items[0].id, f.worker.id);
    }
    assert.equal((await port.candidates(f.admin.id, zone.id, 'Nguyễn')).items.length, 2);
    await assert.rejects(port.candidates(f.manager.id, zone.id, 'Nguyen'));
    await assert.rejects(port.candidates(f.worker.id, zone.id, 'Nguyen'));
    await assert.rejects(port.candidates(f.owner.id, zone.id, 'N'));
    await assert.rejects(port.candidates(f.owner.id, zone.id, '090'));
    const ownerToken = await f.login(f.owner.phone_number);
    assert.equal((await f.http(`zones/${zone.id}/assignment-candidates?q=Nguyen`)).status, 401);
    assert.equal((await f.http(`zones/${zone.id}/assignment-candidates?q=Nguyen&role=Admin`, 'GET', undefined, ownerToken)).status, 400);
    for (let i = 0; i < 20; i++) assert.equal((await f.http(`zones/${zone.id}/assignment-candidates?q=Nguyen`, 'GET', undefined, ownerToken)).status, 200);
    assert.equal((await f.http(`zones/${zone.id}/assignment-candidates?q=Nguyen`, 'GET', undefined, ownerToken)).status, 429);
  } finally { await f.app.close(); }
});

test('recent suggestions use accepted Farm history, preserve acceptance requirement, and cap common-name results', async () => {
  const f = await zoneFixture();
  try {
    const zone = f.zones.create(f.owner.id, f.input), port = f.app.get(AssignmentRecords);
    const invite = await port.createRequest(f.owner.id, zone.id, { user_id: f.worker.id });
    assert.equal((await port.candidates(f.owner.id, zone.id)).items.length, 0);
    await assert.rejects(port.assertCanWork(f.worker.id, zone.id));
    const accepted = await port.approve(f.worker.id, invite.id);
    await port.end(f.owner.id, accepted.assignment_id!);
    const zoneB = f.zones.create(f.owner.id, { ...f.input, zone_name: 'Khu B' });
    const recent = await port.candidates(f.owner.id, zoneB.id);
    assert.equal(recent.items[0].id, f.worker.id);
    assert.equal(recent.items[0].previously_assigned, true);
    for (let i = 0; i < 24; i++) f.users.add({ ...f.worker, user_name: 'Tên trùng phổ biến', phone_number: `09100000${i.toString().padStart(2, '0')}` });
    const many = await port.candidates(f.owner.id, zone.id, 'ten trung');
    assert.equal(many.items.length, 20);
    assert.equal(many.has_more, true);
    assert.deepEqual((await port.candidates(f.owner.id, zone.id, "%' OR 1=1")).items, []);
    f.owner.status = 'Locked';
    await assert.rejects(port.candidates(f.admin.id, zone.id, 'ten trung'));
  } finally { await f.app.close(); }
});
