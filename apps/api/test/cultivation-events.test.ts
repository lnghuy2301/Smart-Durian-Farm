import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { zoneFixture } from '../integration/helpers/zone-fixture';
import { TreesService } from '../src/trees/trees.service';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { MockZoneAssignmentStore } from '../src/assignments/mock-zone-assignment.store';
import { MaterialsService } from '../src/materials/materials.service';
import { StandardMaterialsService } from '../src/standard-materials/standard-materials.service';
import { CultivationEventsService } from '../src/cultivation-events/cultivation-events.service';
import { CultivationEventsStore } from '../src/cultivation-events/cultivation-events.store';
import { CultivationEvent, EVENT_CAPACITY, LOCK_DELAY_MS } from '../src/cultivation-events/cultivation-events.types';
import { CreateEventDto } from '../src/cultivation-events/cultivation-events.dto';
import { canonicalJson, compareEvents, verifyEvents } from '../src/cultivation-events/cultivation-chain';

const page = { limit: 20, offset: 0 };
function at<T>(now: number, fn: () => T): T {
  const original = Date.now;
  Date.now = () => now;
  try { return fn(); } finally { Date.now = original; }
}

async function fixture() {
  const f = await zoneFixture();
  const events = f.app.get(CultivationEventsService);
  // Deterministic deadline tests exercise lazy lock catch-up, not wall-clock waits.
  events.onModuleDestroy();
  const store = f.app.get(CultivationEventsStore);
  const assignments = f.app.get(AssignmentsService);
  const accepted = f.app.get(MockZoneAssignmentStore);
  const trees = f.app.get(TreesService);
  const materials = f.app.get(MaterialsService);
  const bridge = f.app.get(StandardMaterialsService);
  const zone = f.zones.create(f.owner.id, f.input);
  const treeInput = { zone_id: zone.id, variety: 'Ri6', plant_date: '2024-05-01T00:00:00Z', longitude: 106, latitude: 10 };
  const tree = trees.create(f.owner.id, treeInput);
  const input: CreateEventDto = { target_type: 'Zone', target_id: zone.id, action_type: 'Watering', details: { duration_minutes: 5 } };
  const assign = () => assignments.approve(f.worker.id, assignments.createRequest(f.owner.id, zone.id, { user_id: f.worker.id }).id).assignment_id!;
  const material = () => materials.create({ name: 'Foliar fertilizer', material_type: 'Fertilizer', default_dosage: '1 ml/l', unit: 'ml', quarantine_days: 2 });
  return { ...f, zoneInput: f.input, events, store, assignments, accepted, trees, materials, bridge, zone, tree, treeInput, input, assign, material };
}

test('Cultivation HTTP rejects forged lifecycle/author/snapshot fields and malformed nested inputs', async () => {
  const f = await fixture();
  try {
    const token = await f.login(f.owner.phone_number);
    assert.equal((await f.http('cultivation-events')).status, 401);
    for (const change of [{ farmer_id: f.worker.id }, { status: 'Locked' }, { hash: 'a'.repeat(64) }, { _id: 'a'.repeat(24) },
      { assignment_id: randomUUID() }, { created_at: new Date().toISOString() }, { lock_at: new Date().toISOString() },
      { root_event_id: null }, { previous_hash: null }, { target_id: null }, { target_type: 'tree' }, { action_type: 'Harvest' },
      { details: null }, { details: [] }, { details: { duration_minutes: '5' } }, { details: { duration_minutes: 0 } },
      { details: { duration_minutes: 1.0001 } }, { details: { duration_minutes: 10081 } }, { details: { duration_minutes: 5, warnings: [] } },
      { details: { duration_minutes: 5, standard_snapshot: {} } }, { details: { duration_minutes: 5, note: null } }]) {
      assert.equal((await f.http('cultivation-events', 'POST', { ...f.input, ...change }, token)).status, 400, JSON.stringify(change));
    }
    const response = await f.http('cultivation-events', 'POST', { ...f.input, details: { duration_minutes: 5, note: ' Actual watering ' } }, token);
    assert.equal(response.status, 201);
    const event = await response.json() as CultivationEvent;
    assert.match(event._id, /^[a-f0-9]{24}$/);
    assert.equal(event.farmer_id, f.owner.id);
    assert.equal(event.details.note, 'Actual watering');
    assert.equal(Date.parse(event.lock_at) - Date.parse(event.created_at), LOCK_DELAY_MS);
    for (const key of ['root_event_id', 'reference_event_id', 'correction_reason', 'hash', 'previous_hash', 'locked_at'] as const) { assert.equal(event[key], null); }
    assert.equal((await f.http('cultivation-events/not-an-objectid', 'GET', undefined, token)).status, 400);
    for (const query of ['limit=101', 'offset=-1', 'zone_id=bad', 'status=Confirmed', 'target_type=bad', 'farmer_id=' + f.owner.id]) {
      assert.equal((await f.http('cultivation-events?' + query, 'GET', undefined, token)).status, 400);
    }
  } finally { await f.app.close(); }
});

test('Cultivation action details validation is strict and failed writes leave store unchanged', async () => {
  const f = await fixture();
  try {
    const material = f.material();
    const good = { materials: [{ material_id: material.id, quantity: 2 }] };
    for (const details of [{}, { water_volume_l: 3 }, { ...good, duration_minutes: 3 }, { ...good, water_volume_l: 4 },
      { materials: [] }, { materials: [good.materials[0], good.materials[0]] },
      { materials: [{ material_id: material.id, quantity: NaN }] }, { materials: [{ material_id: material.id, quantity: Infinity }] },
      { materials: [{ material_id: material.id, quantity: 2, unit: 'kg' }] },
      { materials: Array.from({ length: 21 }, () => good.materials[0]) }]) {
      assert.throws(() => f.events.create(f.owner.id, { ...f.input, action_type: 'Spraying', details }), BadRequestException);
    }
    assert.throws(() => f.events.create(f.owner.id, { ...f.input, details: { duration_minutes: 1, ...good } }), BadRequestException);
    assert.equal(f.events.list(f.owner.id, page).total, 0);
    for (const action_type of ['Spraying', 'Fertilizing'] as const) {
      const event = f.events.create(f.owner.id, { ...f.input, action_type, details: good });
      assert.equal(event.details.materials![0].unit, 'ml');
    }
  } finally { await f.app.close(); }
});

test('Cultivation owner bypasses self-assignment; only Accepted effective assignee can create', async () => {
  const f = await fixture();
  try {
    f.events.create(f.owner.id, f.input);
    assert.throws(() => f.events.create(f.worker.id, f.input), ForbiddenException);
    const request = f.assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id });
    assert.throws(() => f.events.create(f.worker.id, f.input), ForbiddenException);
    f.assignments.approve(f.worker.id, request.id);
    assert.equal(f.events.create(f.worker.id, { ...f.input, target_type: 'Tree', target_id: f.tree.id }).farmer_id, f.worker.id);
    const otherZone = f.zones.create(f.owner.id, { ...f.zoneInput, zone_name: 'B' });
    assert.throws(() => f.events.create(f.worker.id, { ...f.input, target_id: otherZone.id }), ForbiddenException);
    for (const actor of [f.admin, f.manager]) { assert.throws(() => f.events.create(actor.id, f.input), ForbiddenException); }
    f.worker.status = 'Locked';
    assert.throws(() => f.events.create(f.worker.id, f.input), ForbiddenException);
  } finally { await f.app.close(); }
});

test('Cultivation active assignee reads every Zone author; after end sees only own history', async () => {
  const f = await fixture();
  try {
    const ownerEvent = f.events.create(f.owner.id, f.input);
    const id = f.assign();
    const ownEvent = f.events.create(f.worker.id, f.input);
    assert.equal(f.events.get(f.worker.id, ownerEvent._id)._id, ownerEvent._id);
    assert.equal(f.events.list(f.worker.id, page).total, 2);
    f.assignments.end(f.owner.id, id);
    assert.equal(f.events.list(f.worker.id, page).total, 1);
    assert.equal(f.events.list(f.worker.id, page, true).items[0]._id, ownEvent._id);
    assert.equal(f.events.get(f.worker.id, ownEvent._id)._id, ownEvent._id);
    assert.throws(() => f.events.get(f.worker.id, ownerEvent._id), NotFoundException);
    assert.throws(() => f.events.verify(f.worker.id, f.zone.id), NotFoundException);
    assert.throws(() => f.events.create(f.worker.id, f.input), ForbiddenException);
  } finally { await f.app.close(); }
});

test('Cultivation Manager scope follows own Cooperative; Admin reads but neither writes', async () => {
  const f = await fixture();
  try {
    const event = f.events.create(f.owner.id, f.input);
    assert.equal(f.events.list(f.manager.id, page).total, 0);
    assert.throws(() => f.events.get(f.manager.id, event._id), NotFoundException);
    f.join();
    assert.equal(f.events.get(f.manager.id, event._id)._id, event._id);
    assert.equal(f.events.get(f.admin.id, event._id)._id, event._id);
    const outsider = f.users.add({ ...f.users.publicUser(f.manager), phone_number: '0900000004', password: f.owner.password });
    assert.equal(f.events.list(outsider.id, page).total, 0);
    for (const actor of [f.manager, f.admin]) {
      assert.throws(() => f.events.update(actor.id, event._id, { details: { duration_minutes: 9 } }), ForbiddenException);
      assert.throws(() => f.events.remove(actor.id, event._id), ForbiddenException);
      assert.throws(() => f.events.correct(actor.id, event._id, { ...f.input, correction_reason: 'Wrong' }), ForbiddenException);
    }
  } finally { await f.app.close(); }
});

test('Cultivation pagination and target filters never expose hidden counts or other Tree targets', async () => {
  const f = await fixture();
  try {
    f.assign();
    f.events.create(f.owner.id, f.input);
    f.events.create(f.worker.id, { ...f.input, target_type: 'Tree', target_id: f.tree.id });
    const otherZone = f.zones.create(f.owner.id, { ...f.zoneInput, zone_name: 'Other' });
    f.events.create(f.owner.id, { ...f.input, target_id: otherZone.id });
    const result = f.events.list(f.worker.id, { limit: 1, offset: 1 });
    assert.equal(result.total, 2);
    assert.equal(result.items.length, 1);
    const treeEvents = f.events.list(f.owner.id, { ...page, target_id: f.tree.id, target_type: 'Tree' });
    assert.equal(treeEvents.total, 1);
    assert.equal(treeEvents.items[0].target_type, 'Tree');
    assert.equal(f.events.list(f.worker.id, { ...page, zone_id: otherZone.id }).total, 0);
    assert.equal(f.events.list(f.worker.id, { ...page, offset: 100 }).total, 2);
  } finally { await f.app.close(); }
});

test('Cultivation material and standard snapshots use shared bridge; warnings do not block foliar spraying', async () => {
  const f = await fixture();
  try {
    const m = f.material();
    const input: CreateEventDto = { ...f.input, action_type: 'Spraying', details: { materials: [{ material_id: m.id, quantity: 2 }] } };
    const outside = f.events.create(f.owner.id, input);
    assert.deepEqual(outside.details.warnings, [{ code: 'MATERIAL_OUTSIDE_STANDARD', material_id: m.id }]);
    f.bridge.add(f.standard.id, m.id);
    const linked = f.events.create(f.owner.id, input);
    assert.equal(linked.details.materials![0].standard_linked, true);
    assert.deepEqual(linked.details.warnings, []);
    f.materials.update(m.id, { name: 'Changed', unit: 'kg', quarantine_days: 20, status: 'Inactive' });
    f.standards.update(f.standard.id, { name: 'Changed standard' });
    f.bridge.remove(f.standard.id, m.id);
    assert.deepEqual(f.events.get(f.owner.id, linked._id).details, linked.details);
    assert.throws(() => f.events.create(f.owner.id, input), BadRequestException);
    // Changing target alone is not selecting material again: retain its snapshot.
    const patched = f.events.update(f.owner.id, linked._id, { target_type: 'Tree', target_id: f.tree.id });
    assert.deepEqual(patched.details, linked.details);
  } finally { await f.app.close(); }
});

test('Cultivation author can change target/action in Pending only within original Zone', async () => {
  const f = await fixture();
  try {
    f.assign();
    const original = f.events.create(f.worker.id, f.input);
    const m = f.material();
    const changed = f.events.update(f.worker.id, original._id, { target_type: 'Tree', target_id: f.tree.id,
      action_type: 'Fertilizing', details: { materials: [{ material_id: m.id, quantity: 1 }] } });
    assert.equal(changed.target_id, f.tree.id);
    assert.equal(changed.created_at, original.created_at);
    assert.equal(changed.lock_at, original.lock_at);
    assert.equal(changed.hash, null);
    const other = f.zones.create(f.owner.id, { ...f.zoneInput, zone_name: 'Other' });
    assert.throws(() => f.events.update(f.worker.id, original._id, { target_type: 'Zone', target_id: other.id }), BadRequestException);
    assert.throws(() => f.events.update(f.worker.id, original._id, { action_type: 'Watering' }), BadRequestException);
    assert.throws(() => f.events.update(f.worker.id, original._id, {}), BadRequestException);
    assert.throws(() => f.events.update(f.owner.id, original._id, { details: { duration_minutes: 2 } }), ForbiddenException);
    assert.deepEqual(f.events.get(f.owner.id, original._id), changed);
  } finally { await f.app.close(); }
});

test('Cultivation exact lock_at rejects edits/deletes without worker; lazy read locks atomically', async () => {
  const f = await fixture();
  try {
    const event = f.events.create(f.owner.id, f.input);
    const deadline = Date.parse(event.lock_at);
    at(deadline - 1, () => assert.equal(f.events.update(f.owner.id, event._id, { details: { duration_minutes: 6 } }).status, 'Pending'));
    at(deadline, () => {
      assert.throws(() => f.events.update(f.owner.id, event._id, { details: { duration_minutes: 7 } }), ConflictException);
      assert.throws(() => f.events.remove(f.owner.id, event._id), ConflictException);
      const locked = f.events.get(f.owner.id, event._id);
      assert.equal(locked.status, 'Locked');
      assert.equal(locked.locked_at, event.lock_at);
      assert.match(locked.hash!, /^[a-f0-9]{64}$/);
      assert.equal(f.store.lockDue(), 0);
      assert.equal(f.events.verify(f.owner.id, f.zone.id).locked_events, 1);
    });
  } finally { await f.app.close(); }
});

test('Cultivation delayed worker records actual lock processing time without extending edit deadline', async () => {
  const f = await fixture();
  try {
    const event = f.events.create(f.owner.id, f.input);
    const delayed = Date.parse(event.lock_at) + 100000;
    at(delayed, () => {
      const locked = f.events.get(f.owner.id, event._id);
      assert.equal(locked.locked_at, new Date(delayed).toISOString());
      assert.equal(locked.lock_at, event.lock_at);
      assert.throws(() => f.events.remove(f.owner.id, event._id), ConflictException);
    });
  } finally { await f.app.close(); }
});

test('Cultivation Pending deletion requires author and releases the record without chaining it', async () => {
  const f = await fixture();
  try {
    f.assign();
    const event = f.events.create(f.worker.id, f.input);
    assert.throws(() => f.events.remove(f.owner.id, event._id), ForbiddenException);
    const token = await f.login(f.worker.phone_number);
    assert.equal((await f.http(`cultivation-events/${event._id}`, 'DELETE', undefined, token)).status, 204);
    assert.throws(() => f.events.get(f.worker.id, event._id), NotFoundException);
    at(Date.parse(event.lock_at), () => assert.equal(f.events.verify(f.owner.id, f.zone.id).locked_events, 0));
  } finally { await f.app.close(); }
});

test('Cultivation corrections preserve original, inherit root, allow same-Zone target/action changes and enforce linear history', async () => {
  const f = await fixture();
  try {
    const base = f.events.create(f.owner.id, f.input);
    const m = f.material();
    const correction = { target_type: 'Tree' as const, target_id: f.tree.id, action_type: 'Spraying' as const,
      details: { materials: [{ material_id: m.id, quantity: 2 }] }, correction_reason: 'Wrong target and work' };
    assert.throws(() => f.events.correct(f.owner.id, base._id, correction), ConflictException);
    const t = Date.parse(base.lock_at);
    at(t, () => {
      const lockedBase = f.events.get(f.owner.id, base._id);
      const first = f.events.correct(f.owner.id, base._id, correction);
      assert.equal(first.root_event_id, base._id);
      assert.equal(first.reference_event_id, base._id);
      assert.equal(first.is_correction, true);
      assert.equal(first.status, 'Pending');
      assert.deepEqual(f.events.get(f.owner.id, base._id), lockedBase);
      assert.throws(() => f.events.correct(f.owner.id, base._id, correction), ConflictException);
      at(Date.parse(first.lock_at), () => {
        assert.throws(() => f.events.correct(f.owner.id, base._id, correction), ConflictException);
        const second = f.events.correct(f.owner.id, first._id, { ...f.input, correction_reason: 'Second correction' });
        assert.equal(second.root_event_id, base._id);
        assert.equal(second.reference_event_id, first._id);
        assert.deepEqual(f.events.corrections(f.owner.id, second._id, page).items.map((e) => e._id), [base._id, first._id, second._id]);
        assert.equal(f.events.verify(f.owner.id, f.zone.id).valid, true);
      });
    });
  } finally { await f.app.close(); }
});

test('Cultivation delete Pending correction keeps root and permits another proposal', async () => {
  const f = await fixture();
  try {
    const base = f.events.create(f.owner.id, f.input);
    at(Date.parse(base.lock_at), () => {
      const input = { ...f.input, correction_reason: 'Wrong duration' };
      const first = f.events.correct(f.owner.id, base._id, input);
      f.events.remove(f.owner.id, first._id);
      const second = f.events.correct(f.owner.id, base._id, input);
      assert.notEqual(second._id, first._id);
      assert.equal(f.events.corrections(f.owner.id, base._id, page).total, 2);
      assert.equal(f.events.get(f.owner.id, base._id).status, 'Locked');
    });
  } finally { await f.app.close(); }
});

test('Cultivation correction retains original assignment grace; new assignment cannot extend it', async () => {
  const f = await fixture();
  try {
    const now = Date.now();
    const end = now + 60000;
    f.accepted.accept(f.worker.id, f.zone, new Date(now - 60000).toISOString(), new Date(end).toISOString(), new Date(now).toISOString());
    const base = at(now, () => f.events.create(f.worker.id, f.input));
    const input = { ...f.input, correction_reason: 'Correct entered duration' };
    const deadline = end + 15 * 86400000;
    // A new valid assignment exists at the deadline, but the root remains bound
    // to its ended assignment. This is the regression that a fresh ID bypasses.
    f.accepted.accept(f.worker.id, f.zone, new Date(end).toISOString(), null, new Date(end).toISOString());
    const first = at(deadline - LOCK_DELAY_MS - 1, () => f.events.correct(f.worker.id, base._id, input));
    at(deadline - 1, () => {
      const second = f.events.correct(f.worker.id, first._id, input);
      assert.equal(second.root_event_id, base._id);
      assert.equal(f.events.update(f.worker.id, second._id, { details: { duration_minutes: 8 } }).details.duration_minutes, 8);
      at(deadline, () => {
        assert.throws(() => f.events.update(f.worker.id, second._id, { details: { duration_minutes: 9 } }), ForbiddenException);
        assert.throws(() => f.events.remove(f.worker.id, second._id), ForbiddenException);
      });
    });
    at(deadline + LOCK_DELAY_MS, () => {
      const latest = f.events.corrections(f.worker.id, base._id, page).items.at(-1)!;
      assert.throws(() => f.events.correct(f.worker.id, latest._id, input), ForbiddenException);
      assert.equal(f.events.create(f.worker.id, f.input).status, 'Pending');
    });
  } finally { await f.app.close(); }
});

test('Cultivation original owner may correct later without self-assignment; nonauthor owner cannot', async () => {
  const f = await fixture();
  try {
    f.assign();
    const owner = f.events.create(f.owner.id, f.input);
    const worker = f.events.create(f.worker.id, f.input);
    at(Date.parse(owner.lock_at) + 30 * 86400000, () => {
      assert.equal(f.events.correct(f.owner.id, owner._id, { ...f.input, correction_reason: 'Correct own log' }).status, 'Pending');
      assert.throws(() => f.events.correct(f.owner.id, worker._id, { ...f.input, correction_reason: 'Owner takeover' }), ForbiddenException);
    });
  } finally { await f.app.close(); }
});

test('Cultivation no cross-Zone correction even when author owns both Zones', async () => {
  const f = await fixture();
  try {
    const base = f.events.create(f.owner.id, f.input);
    const other = f.zones.create(f.owner.id, { ...f.zoneInput, zone_name: 'Other' });
    const tree = f.trees.create(f.owner.id, { ...f.treeInput, zone_id: other.id });
    at(Date.parse(base.lock_at), () => {
      for (const target of [{ target_type: 'Zone' as const, target_id: other.id }, { target_type: 'Tree' as const, target_id: tree.id }]) {
        assert.throws(() => f.events.correct(f.owner.id, base._id, { ...f.input, ...target, correction_reason: 'Wrong Zone' }), BadRequestException);
      }
      assert.equal(f.events.corrections(f.owner.id, base._id, page).total, 1);
    });
  } finally { await f.app.close(); }
});

test('Cultivation Zone chain interleaves Tree/Zone targets by lock_at then ObjectId, independently from other Zones', async () => {
  const f = await fixture();
  try {
    const now = Date.now();
    const a = at(now, () => f.events.create(f.owner.id, f.input));
    const b = at(now, () => f.events.create(f.owner.id, { ...f.input, target_type: 'Tree', target_id: f.tree.id }));
    const other = f.zones.create(f.owner.id, { ...f.zoneInput, zone_name: 'Other' });
    const c = at(now, () => f.events.create(f.owner.id, { ...f.input, target_id: other.id }));
    at(now + LOCK_DELAY_MS + 30000, () => {
      const locked = [a, b].map((e) => f.events.get(f.owner.id, e._id)).sort(compareEvents);
      assert.equal(locked[0].previous_hash, null);
      assert.equal(locked[1].previous_hash, locked[0].hash);
      assert.equal(f.events.get(f.owner.id, c._id).previous_hash, null);
      assert.equal(f.events.verify(f.owner.id, f.zone.id).locked_events, 2);
      assert.equal(f.events.verify(f.owner.id, other.id).locked_events, 1);
      assert.equal(f.events.verify(f.owner.id, f.zone.id).valid, true);
    });
  } finally { await f.app.close(); }
});

test('Cultivation canonical hash ignores object insertion order, detects changed payload/link and removed head', async () => {
  const f = await fixture();
  try {
    const first = f.events.create(f.owner.id, f.input);
    const second = f.events.create(f.owner.id, f.input);
    at(Math.max(Date.parse(first.lock_at), Date.parse(second.lock_at)), () => {
      const events = [first, second].map((e) => f.events.get(f.owner.id, e._id)).sort(compareEvents);
      const expected = { count: 2, hash: events[1].hash };
      assert.equal(verifyEvents(events, expected).valid, true);
      const mutated = structuredClone(events);
      mutated[0].details.duration_minutes = 99;
      assert.equal(verifyEvents(mutated, expected).failure!.code, 'HASH_MISMATCH');
      const link = structuredClone(events);
      link[1].previous_hash = null;
      assert.equal(verifyEvents(link, expected).failure!.code, 'LINK_MISMATCH');
      assert.equal(verifyEvents(events.slice(0, 1), expected).failure!.code, 'HEAD_MISMATCH');
      assert.equal(verifyEvents(events.slice(1), expected).failure!.code, 'LINK_MISMATCH');
      assert.equal(canonicalJson({ z: [1, { b: 2, a: 3 }], a: 'text' }), canonicalJson({ a: 'text', z: [1, { a: 3, b: 2 }] }));
      assert.throws(() => canonicalJson({ value: Infinity }), TypeError);
    });
  } finally { await f.app.close(); }
});

test('Cultivation returned snapshots and contexts cannot mutate store or authorization evidence', async () => {
  const f = await fixture();
  try {
    f.assign();
    const event = f.events.create(f.worker.id, f.input);
    event.details.duration_minutes = 100;
    const context = f.store.context(event._id);
    context.assignment_id = null;
    context.author_id = f.owner.id;
    assert.equal(f.events.get(f.worker.id, event._id).details.duration_minutes, 5);
    assert.notEqual(f.store.context(event._id).assignment_id, null);
    assert.equal(f.store.context(event._id).author_id, f.worker.id);
  } finally { await f.app.close(); }
});

test('Cultivation RAM capacity refuses new writes without evicting Locked history', async () => {
  const f = await fixture();
  try {
    const base = f.events.create(f.owner.id, f.input);
    const context = f.store.context(base._id);
    for (let i = 1; i < EVENT_CAPACITY; i++) {
      const id = i.toString(16).padStart(24, '0');
      f.store.add({ ...base, _id: id }, { ...context, root_id: id });
    }
    at(Date.parse(base.lock_at), () => {
      assert.equal(f.events.verify(f.owner.id, f.zone.id).locked_events, EVENT_CAPACITY);
      assert.throws(() => f.events.create(f.owner.id, f.input), (error: unknown) => error instanceof HttpException && error.getStatus() === 429);
      assert.equal(f.events.list(f.owner.id, page).total, EVENT_CAPACITY);
      assert.equal(f.events.get(f.owner.id, base._id).status, 'Locked');
    });
  } finally { await f.app.close(); }
});

test('Cultivation HTTP mine/lineage/verify and Swagger schemas provide manual frontend contract', async () => {
  const f = await fixture();
  try {
    const token = await f.login(f.owner.phone_number);
    const created = await f.http('cultivation-events', 'POST', f.input, token);
    const event = await created.json() as CultivationEvent;
    assert.equal((await f.http(`cultivation-events/${event._id}`, 'PATCH', { details: { duration_minutes: 2 } }, token)).status, 200);
    assert.equal((await f.http(`cultivation-events/${event._id}`, 'PATCH', { status: 'Locked' }, token)).status, 400);
    assert.equal((await f.http(`cultivation-events/${event._id}/corrections`, 'POST', { ...f.input, correction_reason: ' ' }, token)).status, 400);
    assert.equal((await f.http(`cultivation-events/${event._id}/corrections`, 'GET', undefined, token)).status, 200);
    assert.equal((await f.http('cultivation-events/mine', 'GET', undefined, token)).status, 200);
    const verify = await f.http(`cultivation-events/zones/${f.zone.id}/chain/verify`, 'GET', undefined, token);
    assert.equal(verify.status, 200);
    assert.equal((await verify.json() as { valid: boolean }).valid, true);
    const swagger = await (await fetch(`${await f.app.getUrl()}/api/docs-json`)).json() as {
      paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: { properties: Record<string, unknown> } }> }>; security: unknown[] }>>;
    };
    const post = swagger.paths['/api/cultivation-events'].post;
    assert.ok(post.responses['201'].content!['application/json'].schema.properties.details);
    assert.ok(post.security.length);
  } finally { await f.app.close(); }
});

test('Cultivation concurrent HTTP corrections produce one Pending and one conflict, with no original rewrite', async () => {
  const f = await fixture();
  try {
    const base = at(Date.now() - LOCK_DELAY_MS - 1000, () => f.events.create(f.owner.id, f.input));
    const original = f.events.get(f.owner.id, base._id);
    const token = await f.login(f.owner.phone_number);
    const input = { ...f.input, correction_reason: 'Wrong duration', details: { duration_minutes: 10 } };
    const responses = await Promise.all([f.http(`cultivation-events/${base._id}/corrections`, 'POST', input, token),
      f.http(`cultivation-events/${base._id}/corrections`, 'POST', input, token)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.deepEqual(f.events.get(f.owner.id, base._id), original);
    assert.equal(f.events.corrections(f.owner.id, base._id, page).total, 2);
    assert.equal(f.events.verify(f.owner.id, f.zone.id).locked_events, 1);
  } finally { await f.app.close(); }
});

test('Cultivation future Accepted assignment has no creation or read permission before start', async () => {
  const f = await fixture();
  try {
    const now = Date.now();
    f.accepted.accept(f.worker.id, f.zone, new Date(now + 3600000).toISOString(), null, new Date(now).toISOString());
    const event = f.events.create(f.owner.id, f.input);
    assert.throws(() => f.events.create(f.worker.id, f.input), ForbiddenException);
    assert.throws(() => f.events.get(f.worker.id, event._id), NotFoundException);
    at(now + 3600000, () => assert.equal(f.events.create(f.worker.id, f.input).status, 'Pending'));
  } finally { await f.app.close(); }
});

test('Cultivation clock rollback cannot append before existing Locked tail', async () => {
  const f = await fixture();
  try {
    const base = f.events.create(f.owner.id, f.input);
    const future = Date.parse(base.lock_at) + LOCK_DELAY_MS;
    at(future, () => f.events.create(f.owner.id, f.input));
    at(future + LOCK_DELAY_MS, () => f.events.get(f.owner.id, base._id));
    assert.throws(() => f.events.create(f.owner.id, f.input), ConflictException);
    assert.equal(f.events.list(f.owner.id, page).total, 2);
    assert.equal(f.events.verify(f.owner.id, f.zone.id).valid, true);
  } finally { await f.app.close(); }
});
