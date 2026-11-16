import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { zoneFixture } from '../integration/helpers/zone-fixture';
import { TreesService } from '../src/trees/trees.service';
import { CultivationEventsService } from '../src/cultivation-events/cultivation-events.service';
import { LOCK_DELAY_MS } from '../src/cultivation-events/cultivation-events.types';
import { TreeHarvestsService } from '../src/tree-harvests/tree-harvests.service';
import { vietnamToday } from '../src/tree-harvests/harvest-date-policy';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { MaterialsService } from '../src/materials/materials.service';
import { StandardMaterialsService } from '../src/standard-materials/standard-materials.service';
import { TraceabilityService } from '../src/traceability/traceability.service';
import { PublicTrace, PublicVersion, PublicHarvest } from '../src/traceability/traceability.types';
import { readTraceabilityConfig } from '../src/traceability/traceability.config';

const page = { limit: 100, offset: 0 };
const privateKeys = new Set(['id', '_id', 'farmer_id', 'created_by', 'updated_by', 'owner_id', 'manager_id',
  'material_id', 'standard_id', 'zone_id', 'farm_id', 'tree_id', 'root_event_id', 'reference_event_id', 'assignment_id',
  'note', 'correction_reason', 'address', 'longitude', 'latitude', 'certificate_number', 'phone_number', 'gmail',
  'hash', 'previous_hash', 'proposed_changes', 'password', 'station_id', 'response_payload']);
function assertWhitelisted(value: unknown) {
  if (Array.isArray(value)) { value.forEach(assertWhitelisted); }
  else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) { assert.ok(!privateKeys.has(key), `Private field leaked: ${key}`); assertWhitelisted(child); }
  }
}
function at<T>(now: number, callback: () => T): T {
  const original = Date.now;
  Date.now = () => now;
  try { return callback(); } finally { Date.now = original; }
}
async function fixture() {
  const f = await zoneFixture();
  const zone = f.zones.create(f.owner.id, f.input);
  const trees = f.app.get(TreesService);
  const input = { zone_id: zone.id, variety: 'Ri6', plant_date: '2024-05-01T00:00:00Z', longitude: 106, latitude: 10 };
  const a = trees.create(f.owner.id, input);
  const b = trees.create(f.owner.id, input);
  const c = trees.create(f.owner.id, input);
  const cultivation = f.app.get(CultivationEventsService);
  cultivation.onModuleDestroy();
  const trace = f.app.get(TraceabilityService);
  const harvests = f.app.get(TreeHarvestsService);
  const assignments = f.app.get(AssignmentsService);
  const materials = f.app.get(MaterialsService);
  const bridge = f.app.get(StandardMaterialsService);
  const watering = { target_type: 'Tree' as const, target_id: a.id, action_type: 'Watering' as const, details: { duration_minutes: 5, note: 'PRIVATE-NOTE' } };
  const harvest = { tree_id: a.id, season_name: 'Vụ demo', harvest_date: vietnamToday(), fruit_count: 10, total_weight_kg: 30.5, batch_code: 'BATCH-01' };
  const path = `traceability/trees/${a.tree_code}`;
  return { ...f, zone, trees, a, b, c, cultivation, trace, harvests, assignments, materials, bridge, watering, harvest, path };
}

test('Trace public metadata requires no JWT, whitelists nested fields and leaves management protected', async () => {
  const f = await fixture();
  try {
    const response = await f.http(f.path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const data = await response.json() as PublicTrace;
    assertWhitelisted(data);
    assert.deepEqual(Object.keys(data).sort(), ['cooperative', 'standard', 'trace_url', 'tree', 'zone']);
    assert.equal(data.tree.tree_code, f.a.tree_code);
    assert.equal(data.cooperative, null);
    assert.equal(data.trace_url, `http://localhost:5173/trace/${f.a.tree_code}`);
    for (const id of [f.owner.id, f.farm.id, f.zone.id, f.standard.id]) { assert.ok(!JSON.stringify(data).includes(id)); }
    for (const path of ['trees/' + f.a.id, 'cultivation-events', 'tree-harvests', 'farms']) { assert.equal((await f.http(path)).status, 401); }
    // Public projection stays anonymous even when a caller sends an invalid JWT.
    assert.equal((await f.http(f.path, 'GET', undefined, 'invalid-token')).status, 200);
  } finally { await f.app.close(); }
});

test('Trace validates tree codes and bounded pagination without allowing arbitrary private filters', async () => {
  const f = await fixture();
  try {
    for (const code of ['bad', f.a.id, f.a.tree_code.toLowerCase()]) { assert.equal((await f.http('traceability/trees/' + code)).status, 400); }
    assert.equal((await f.http('traceability/trees/DRN-' + randomUUID())).status, 404);
    for (const endpoint of ['cultivation', 'harvests']) {
      for (const query of ['limit=0', 'limit=101', 'offset=-1', 'offset=100001', 'limit=1.1', 'farmer_id=' + f.owner.id, 'status=Pending']) {
        assert.equal((await f.http(`${f.path}/${endpoint}?${query}`)).status, 400, query);
      }
      const response = await f.http(`${f.path}/${endpoint}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { items: [], total: 0, limit: 20, offset: 0 });
    }
    assert.throws(() => f.trace.cultivationHistory(f.a.tree_code, { limit: 101, offset: 0 }), BadRequestException);
    assert.equal((await f.http(f.path, 'POST', {})).status, 404);
  } finally { await f.app.close(); }
});

test('Trace Pending originals/corrections remain hidden; first GET catches up due locks', async () => {
  const f = await fixture();
  try {
    const base = f.cultivation.create(f.owner.id, f.watering);
    assert.equal(f.trace.cultivationHistory(f.a.tree_code, page).total, 0);
    at(Date.parse(base.lock_at), () => {
      const original = f.trace.cultivationHistory(f.a.tree_code, page).items[0];
      assert.equal(original.version, 1);
      assert.equal(original.is_latest, true);
      const correction = f.cultivation.correct(f.owner.id, base._id, { ...f.watering, target_id: f.b.id, correction_reason: 'PRIVATE-REASON' });
      assert.equal(f.trace.cultivationHistory(f.b.tree_code, page).total, 0);
      assert.equal(f.trace.cultivationHistory(f.a.tree_code, page).items[0].latest_version, 1);
      f.cultivation.remove(f.owner.id, correction._id);
      assert.equal(f.trace.cultivationHistory(f.a.tree_code, page).total, 1);
    });
  } finally { await f.app.close(); }
});

test('Trace A to B correction shows complete Locked lineage on both Trees with current applicability labels', async () => {
  const f = await fixture();
  try {
    const base = f.cultivation.create(f.owner.id, f.watering);
    at(Date.parse(base.lock_at), () => {
      const correction = f.cultivation.correct(f.owner.id, base._id, { ...f.watering, target_id: f.b.id, correction_reason: 'PRIVATE-REASON' });
      at(Date.parse(correction.lock_at), () => {
        const a = f.trace.cultivationHistory(f.a.tree_code, page).items;
        const b = f.trace.cultivationHistory(f.b.tree_code, page).items;
        assert.equal(a.length, 2);
        assert.equal(b.length, 2);
        assert.deepEqual(a.map((v) => v.is_latest), [false, true]);
        assert.deepEqual(a.map((v) => v.applies_to_tree), [true, false]);
        assert.deepEqual(b.map((v) => v.applies_to_tree), [false, true]);
        assert.equal(a[0].latest_target.label, f.b.tree_code);
        assert.ok(a.every((v) => !v.latest_applies_to_tree));
        assert.ok(b.every((v) => v.latest_applies_to_tree));
        assert.equal(a[0].history_key, b[0].history_key);
        assertWhitelisted(a);
        assert.ok(!JSON.stringify(a).includes('PRIVATE-'));
        assert.ok(!JSON.stringify(a).includes(base._id));
        assert.equal(f.trace.cultivationHistory(f.c.tree_code, page).total, 0);
      });
    });
  } finally { await f.app.close(); }
});

test('Trace multiple corrections and Tree to Zone targets preserve all versions and expose Zone-wide applicability', async () => {
  const f = await fixture();
  try {
    const base = f.cultivation.create(f.owner.id, f.watering);
    at(Date.parse(base.lock_at), () => {
      const toB = f.cultivation.correct(f.owner.id, base._id, { ...f.watering, target_id: f.b.id, correction_reason: 'Wrong Tree' });
      at(Date.parse(toB.lock_at), () => {
        const toZone = f.cultivation.correct(f.owner.id, toB._id, { ...f.watering, target_type: 'Zone', target_id: f.zone.id, correction_reason: 'Whole Zone' });
        at(Date.parse(toZone.lock_at), () => {
          const c = f.trace.cultivationHistory(f.c.tree_code, page).items;
          assert.deepEqual(c.map((v) => v.version), [1, 2, 3]);
          assert.deepEqual(c.map((v) => v.applies_to_tree), [false, false, true]);
          assert.ok(c.every((v) => v.latest_applies_to_tree));
          assert.equal(c[2].latest_target.type, 'Zone');
          assert.equal(c[2].target.label, f.zone.zone_name);
        });
      });
    });
  } finally { await f.app.close(); }
});

test('Trace excludes unrelated Trees/Zones but includes all relevant versions after pagination splits a lineage', async () => {
  const f = await fixture();
  try {
    const now = Date.now();
    const base = at(now - LOCK_DELAY_MS - 1000, () => f.cultivation.create(f.owner.id, f.watering));
    f.cultivation.create(f.owner.id, { ...f.watering, target_id: f.c.id });
    const otherZone = f.zones.create(f.owner.id, { ...f.input, zone_name: 'Other' });
    f.cultivation.create(f.owner.id, { ...f.watering, target_type: 'Zone', target_id: otherZone.id });
    const correction = f.cultivation.correct(f.owner.id, base._id, { ...f.watering, target_id: f.b.id, correction_reason: 'Wrong Tree' });
    at(Date.parse(correction.lock_at), () => {
      const secondPage = f.trace.cultivationHistory(f.a.tree_code, { limit: 1, offset: 1 });
      assert.equal(secondPage.total, 2);
      assert.equal(secondPage.items[0].version, 2);
      assert.equal(secondPage.items[0].latest_version, 2);
      assert.equal(secondPage.items[0].latest_applies_to_tree, false);
      assert.equal(f.trace.cultivationHistory(f.a.tree_code, { limit: 1, offset: 100 }).total, 2);
    });
  } finally { await f.app.close(); }
});

test('Trace public materials use original snapshots and flags, never raw notes/reasons or catalog UUIDs', async () => {
  const f = await fixture();
  try {
    const m = f.materials.create({ name: 'Public fertilizer', material_type: 'Fertilizer', unit: 'ml', default_dosage: 'PRIVATE-DOSAGE', quarantine_days: 3 });
    const spraying = { ...f.watering, action_type: 'Spraying' as const, details: { materials: [{ material_id: m.id, quantity: 2 }], note: 'PRIVATE-NOTE' } };
    const base = f.cultivation.create(f.owner.id, spraying);
    f.bridge.add(f.standard.id, m.id);
    at(Date.parse(base.lock_at), () => {
      const correction = f.cultivation.correct(f.owner.id, base._id, { ...spraying, action_type: 'Fertilizing', correction_reason: 'PRIVATE-REASON' });
      f.materials.update(m.id, { name: 'Changed material', unit: 'kg', status: 'Inactive' });
      at(Date.parse(correction.lock_at), () => {
        const versions = f.trace.cultivationHistory(f.a.tree_code, page).items;
        assert.equal(versions[0].details.materials![0].standard_linked, false);
        assert.equal(versions[1].details.materials![0].standard_linked, true);
        assert.equal(versions[0].details.materials![0].name, 'Public fertilizer');
        assert.equal(versions[1].details.materials![0].unit, 'ml');
        assertWhitelisted(versions);
        assert.ok(!JSON.stringify(versions).includes('PRIVATE-'));
        assert.ok(!JSON.stringify(versions).includes(m.id));
      });
    });
  } finally { await f.app.close(); }
});

test('Trace first confirmation Pending/Draft remain hidden, Confirmed contents appear only for correct Tree', async () => {
  const f = await fixture();
  try {
    const request = f.assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id });
    f.assignments.approve(f.worker.id, request.id);
    const record = f.harvests.create(f.worker.id, f.harvest);
    assert.equal(f.trace.harvestHistory(f.a.tree_code, page).total, 0);
    const submitted = f.harvests.submit(f.worker.id, record.id);
    assert.equal(submitted.status, 'Pending');
    assert.equal(f.trace.harvestHistory(f.a.tree_code, page).total, 0);
    const confirmation = f.harvests.listRequests(f.owner.id, page).items[0];
    f.harvests.approve(f.owner.id, confirmation.id);
    const result = f.trace.harvestHistory(f.a.tree_code, page);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].confirmation_state, 'Confirmed');
    assert.equal(f.trace.harvestHistory(f.b.tree_code, page).total, 0);
    assertWhitelisted(result);
  } finally { await f.app.close(); }
});

test('Trace keeps approved harvest data during Pending correction, updates only at review acceptance', async () => {
  const f = await fixture();
  try {
    const record = f.harvests.create(f.owner.id, f.harvest);
    f.harvests.submit(f.owner.id, record.id);
    const correction = f.harvests.correction(f.owner.id, record.id, { reason: 'PRIVATE-REASON', changes: { fruit_count: 99, total_weight_kg: 300 } });
    assert.equal(f.harvests.get(f.owner.id, record.id).status, 'Pending');
    const pending = f.trace.harvestHistory(f.a.tree_code, page);
    assert.equal(pending.items[0].fruit_count, 10);
    assert.equal(pending.items[0].confirmation_state, 'Confirmed');
    assertWhitelisted(pending);
    assert.ok(!JSON.stringify(pending).includes('PRIVATE-'));
    f.harvests.approve(f.admin.id, correction.id);
    assert.equal(f.trace.harvestHistory(f.a.tree_code, page).items[0].fruit_count, 99);
  } finally { await f.app.close(); }
});

test('Trace rejected harvest correction retains original approved contents and no reviewer identity', async () => {
  const f = await fixture();
  try {
    const record = f.harvests.create(f.owner.id, f.harvest);
    f.harvests.submit(f.owner.id, record.id);
    const correction = f.harvests.correction(f.owner.id, record.id, { reason: 'PRIVATE-REASON', changes: { fruit_count: 90 } });
    f.harvests.reject(f.admin.id, correction.id, 'PRIVATE-REJECTION');
    const result = f.trace.harvestHistory(f.a.tree_code, page);
    assert.equal(result.items[0].fruit_count, 10);
    assertWhitelisted(result);
    assert.ok(!JSON.stringify(result).includes(f.admin.id));
  } finally { await f.app.close(); }
});

test('Trace current Cooperative/standard and Dead/Removed Tree state remain readable with historical records', async () => {
  const f = await fixture();
  try {
    f.join();
    assert.equal(f.trace.get(f.a.tree_code).cooperative!.name, 'HTX');
    const base = f.cultivation.create(f.owner.id, f.watering);
    f.standards.update(f.standard.id, { status: 'Inactive', name: 'Current renamed standard' });
    for (const status of ['Dead', 'Removed'] as const) {
      f.trees.update(f.owner.id, f.a.id, { status });
      assert.equal(f.trace.get(f.a.tree_code).tree.status, status);
      assert.equal(f.trace.get(f.a.tree_code).standard.status, 'Inactive');
    }
    at(Date.parse(base.lock_at), () => {
      const version = f.trace.cultivationHistory(f.a.tree_code, page).items[0];
      assert.equal(version.details.standard_snapshot.name, f.standard.name);
    });
  } finally { await f.app.close(); }
});

test('Trace returned public snapshots cannot mutate private data or legacy author history rights', async () => {
  const f = await fixture();
  try {
    const assignmentId = f.assignments.approve(f.worker.id, f.assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id }).id).assignment_id!;
    const base = f.cultivation.create(f.owner.id, f.watering);
    f.assignments.end(f.owner.id, assignmentId);
    const publicMetadata = f.trace.get(f.a.tree_code);
    publicMetadata.tree.variety = 'Changed client snapshot';
    assert.equal(f.trees.get(f.owner.id, f.a.id).variety, 'Ri6');
    const workerToken = await f.login(f.worker.phone_number);
    assert.equal((await f.http('cultivation-events/' + base._id, 'GET', undefined, workerToken)).status, 404);
    assert.equal((await f.http(f.path, 'GET', undefined, workerToken)).status, 200);
    at(Date.parse(base.lock_at), () => {
      const versions = f.trace.cultivationHistory(f.a.tree_code, page);
      versions.items[0].details.duration_minutes = 100;
      assert.equal(f.cultivation.get(f.owner.id, base._id).details.duration_minutes, 5);
    });
  } finally { await f.app.close(); }
});

test('Trace configured QR origin validates input and errors never echo a credential-bearing URL', () => {
  assert.equal(readTraceabilityConfig({}).publicBaseUrl, 'http://localhost:5173');
  assert.equal(readTraceabilityConfig({ TRACE_PUBLIC_BASE_URL: 'https://trace.example.test/' }).publicBaseUrl, 'https://trace.example.test');
  for (const value of ['', 'bad', 'javascript:alert(1)', 'http://user:PRIVATE-PASS@example.test', 'https://example.test/path',
    'https://example.test?token=PRIVATE-TOKEN', 'https://example.test#secret', 'https://' + 'a'.repeat(201) + '.test']) {
    assert.throws(() => readTraceabilityConfig({ TRACE_PUBLIC_BASE_URL: value }), (error: unknown) => error instanceof Error
      && error.message.includes('TRACE_PUBLIC_BASE_URL') && !error.message.includes('PRIVATE-'));
  }
});

test('Trace public SVG uses safe headers and trusted config, ignores hostile Host/URL overrides', async () => {
  const f = await fixture();
  try {
    const response = await fetch(`${await f.app.getUrl()}/api/${f.path}/qr.svg?url=https://evil.example`, { headers: { Host: 'evil.example' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /^image\/svg\+xml/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const svg = await response.text();
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('<path'));
    assert.ok(!svg.includes('script') && !svg.includes('foreignObject') && !svg.includes('PRIVATE-'));
    assert.equal(svg, await f.trace.qrSvg(f.a.tree_code));
  } finally { await f.app.close(); }
});

test('Trace OpenAPI contains explicit public schemas and no bearer security requirements', async () => {
  const f = await fixture();
  try {
    const docs = await (await fetch(`${await f.app.getUrl()}/api/docs-json`)).json() as {
      paths: Record<string, { get: { security?: unknown[]; responses: Record<string, { content: Record<string, { schema: { properties?: Record<string, unknown> } }> }> } }>;
    };
    const metadata = docs.paths['/api/traceability/trees/{treeCode}'].get;
    assert.ok(!metadata.security?.length);
    assert.ok(metadata.responses['200'].content['application/json'].schema.properties!.tree);
    const versions = await (await f.http(f.path + '/cultivation')).json() as { items: PublicVersion[] };
    const harvests = await (await f.http(f.path + '/harvests')).json() as { items: PublicHarvest[] };
    assertWhitelisted(versions);
    assertWhitelisted(harvests);
    const name = 'docs/postman/QR-Traceability-Local-Test.postman_collection.json';
    const collectionPath = [resolve(process.cwd(), name), resolve(process.cwd(), '../..', name)].find(existsSync);
    assert.ok(collectionPath, 'Manual QR collection must be available');
    const raw = readFileSync(collectionPath, 'utf8');
    assert.ok(!raw.includes('{{'), 'No Postman environment variables');
    const collection = JSON.parse(raw) as { auth: { type: string }; event?: unknown; variable?: unknown;
      item: { event?: unknown; request: { method: string; url: string; body?: unknown } }[] };
    assert.equal(collection.auth.type, 'noauth');
    assert.ok(!collection.event && !collection.variable);
    assert.equal(collection.item.length, 15);
    const routes = Object.keys(docs.paths).map((path) => new RegExp('^' + path.split('/').map((segment) =>
      segment.startsWith('{') ? '[^/]+' : segment.replace(/\./g, '\\.')).join('/') + '$'));
    for (const item of collection.item) {
      assert.ok(!item.event && !item.request.body, 'Read-only requests with no scripts or body');
      assert.equal(item.request.method, 'GET');
      const path = new URL(item.request.url).pathname;
      assert.ok(routes.some((route) => route.test(path)), `Postman route missing from runtime OpenAPI: ${path}`);
    }
  } finally { await f.app.close(); }
});
