import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import { AuthModule } from '../src/auth/auth.module';
import { UserAccounts } from '../src/auth/user-accounts';
import { MaterialRecords, StandardRecords, StandardMaterialRecords } from '../src/catalog/catalog-records';
import { MaterialsModule } from '../src/materials/materials.module';
import { StandardsModule } from '../src/standards/standards.module';
import { StandardMaterialsModule } from '../src/standard-materials/standard-materials.module';
import { MaterialListDto } from '../src/materials/materials.dto';
import { StandardListDto } from '../src/standards/standards.dto';
import { AgriculturalMaterial, MaterialsService } from '../src/materials/materials.service';
import { FarmingStandard } from '../src/standards/standards.service';
import { PostgresCatalogRepository } from '../src/persistence/postgres-catalog.repository';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { runMigrations } from '../src/persistence/migrations';
import { readSeedConfig } from '../src/persistence/seed-config';
import { seedDemo } from '../src/persistence/seed';

const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const config = { mode: 'mock' as const, phoneNumber: '0900000000', password: 'CatalogFixturePassword!',
  jwtSecret: 'catalog-fixture-secret-at-least-32-bytes', sms: { provider: 'mock' as const },
  admin: { phoneNumber: '0900000001', password: 'CatalogAdminFixture!' } };
const material = { name: 'Phân hữu cơ demo', material_type: 'Fertilizer' as const, default_dosage: 'Theo hướng dẫn demo', unit: 'kg', quarantine_days: 0 };
const standard = { code: 'DEMO-GAP', name: 'Tiêu chuẩn demo', description: '', certifying_body: 'Tổ chức demo' };
const status = (expected: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === expected;

async function application(pool: Pool): Promise<INestApplication> {
  const users = new PostgresUsersRepository(pool), catalogs = new PostgresCatalogRepository(pool, users);
  const auth = AuthModule.forMock(config), materials = MaterialsModule.forMock(auth), standards = StandardsModule.forMock(auth);
  // Chỉ Auth/catalog controllers; chưa nối các domain còn đọc catalog RAM.
  const module = await Test.createTestingModule({ imports: [StandardMaterialsModule.forMock(auth, materials, standards)] })
    .overrideProvider(UserAccounts).useValue(users)
    .overrideProvider(MaterialRecords).useValue(catalogs.materials)
    .overrideProvider(StandardRecords).useValue(catalogs.standards)
    .overrideProvider(StandardMaterialRecords).useValue(catalogs.links).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); return app;
}

test('PostgreSQL catalogs keep API rules, atomic audits, concurrency and fresh-instance durability', async (t) => {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString: `${postgresBase}/sdf_persistence_test`, connectionTimeoutMillis: 5000 });
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  let pool: Pool | undefined, created = false;
  try {
    await adminPool.query(`CREATE DATABASE "${name}"`); created = true;
    pool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 8, connectionTimeoutMillis: 5000 });
    const sql = pool; await mongo.connect(); await runMigrations(sql, mongo.db(name));
    const seedConfig = readSeedConfig({ NODE_ENV: 'test', AUTH_TEST_PHONE: config.phoneNumber, AUTH_TEST_PASSWORD: config.password,
      AUTH_TEST_ADMIN_PHONE: config.admin.phoneNumber, AUTH_TEST_ADMIN_PASSWORD: config.admin.password,
      DEMO_DEVICE_STATION_ID: 'CATALOG_TEST_ESP32', DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00', DEMO_DEVICE_COST: '10237500' });
    const seed = await seedDemo(sql, seedConfig);
    const users = new PostgresUsersRepository(sql), catalogs = new PostgresCatalogRepository(sql, users);
    const adminId = (await users.loadByPhone(config.admin.phoneNumber))!.user.id;
    const hash = (await users.loadById(adminId))!.user.password;
    const account = async (role: string, phone: string) => {
      const id = (await sql.query(`INSERT INTO public.users(user_name,phone_number,password,role,status)
        VALUES ('Catalog fixture',$1,$2,$3,'Active') RETURNING id`, [phone, hash, role])).rows[0].id as string;
      await sql.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('users',$1,'{"token_version":0}')`, [id]); return id;
    };
    const admin2 = await account('Admin', '0900000099'), manager = await account('Manager', '0900000098');
    let m: AgriculturalMaterial, s: FarmingStandard;
    const metadata = async (table: string, key: string) => (await sql.query('SELECT version,data FROM technical.entity_metadata WHERE entity_type=$1 AND entity_key=$2', [table, key])).rows[0];

    await t.test('seed catalogs are readable without cache, allow repeated names/codes and return documented catalog fields', async () => {
      assert.equal((await catalogs.materials.list(seed.primary_farmer_id, new MaterialListDto())).total, 5);
      assert.equal((await catalogs.standards.list(manager, new StandardListDto())).total, 3);
      m = await catalogs.materials.create(adminId, material); s = await catalogs.standards.create(adminId, standard);
      assert.equal(m.status, 'Active'); assert.equal(s.status, 'Active');
      const duplicate = await catalogs.materials.create(adminId, material);
      assert.notEqual(duplicate.id, m.id);
      assert.notEqual((await catalogs.standards.create(adminId, standard)).id, s.id);
      assert.deepEqual(Object.keys(m).sort(), ['id', 'name', 'material_type', 'default_dosage', 'default_dosage_value', 'dosage_basis', 'unit', 'quarantine_days', 'status'].sort());
      m.name = 'Mutated response';
      assert.equal((await catalogs.materials.get(adminId, m.id)).name, material.name);
      m = await catalogs.materials.get(adminId, m.id);
    });

    await t.test('PATCH preserves omitted fields, defaults, strings, identity and seed metadata', async () => {
      await catalogs.materials.update(adminId, m.id, { quarantine_days: 2147483647, status: 'Inactive' });
      const current = await catalogs.materials.get(manager, m.id);
      assert.equal(current.default_dosage, material.default_dosage); assert.equal(current.unit, 'kg');
      assert.equal(current.quarantine_days, 2147483647); assert.equal(current.status, 'Inactive');
      await catalogs.standards.update(adminId, s.id, { description: '', name: '  Tiêu chuẩn đã sửa  ' });
      assert.equal((await catalogs.standards.get(manager, s.id)).name, 'Tiêu chuẩn đã sửa');
      const seeded = (await sql.query("SELECT entity_key FROM technical.entity_metadata WHERE entity_type='agricultural_materials' AND data->>'seed_key' LIKE '%:material-0'")).rows[0].entity_key as string;
      const before = await metadata('agricultural_materials', seeded);
      await catalogs.materials.update(adminId, seeded, { name: 'Vật tư seed đã sửa' });
      const after = await metadata('agricultural_materials', seeded);
      assert.deepEqual(after.data, before.data); assert.equal(Number(after.version), Number(before.version) + 1);
      assert.equal((await seedDemo(sql, seedConfig)).inserted, 0);
      assert.equal((await catalogs.materials.get(adminId, seeded)).name, 'Vật tư seed đã sửa');
    });

    await t.test('search is case-insensitive literal substring and pagination total survives empty pages', async () => {
      const special = await catalogs.materials.create(adminId, { ...material, name: "MẪU 100%_O'Brien", material_type: 'Biological', status: 'Inactive' });
      const page = await catalogs.materials.list(manager, Object.assign(new MaterialListDto(), { q: "%_o'bRIEN", status: 'Inactive', material_type: 'Biological', limit: 1 }));
      assert.equal(page.total, 1); assert.equal(page.items[0].id, special.id);
      const empty = await catalogs.materials.list(manager, Object.assign(new MaterialListDto(), { q: "%_o'brien", offset: 500 }));
      assert.equal(empty.total, 1); assert.deepEqual(empty.items, []);
      assert.equal((await catalogs.materials.list(manager, Object.assign(new MaterialListDto(), { q: "' OR 1=1 --" }))).total, 0);
      const codes = await catalogs.standards.list(manager, Object.assign(new StandardListDto(), { q: 'demo-gap', limit: 1 }));
      assert.equal(codes.total, 2); assert.equal(codes.items.length, 1);
      const first = await catalogs.materials.list(manager, Object.assign(new MaterialListDto(), { limit: 2 }));
      const second = await catalogs.materials.list(manager, Object.assign(new MaterialListDto(), { limit: 2, offset: 2 }));
      assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 4);
    });

    await t.test('bridge permits Inactive and N:N, scopes server-side and shows live material updates', async () => {
      await catalogs.standards.update(adminId, s.id, { status: 'Inactive' });
      assert.deepEqual(await catalogs.links.add(adminId, s.id, m.id), { standard_id: s.id, material_id: m.id });
      const another = await catalogs.standards.create(adminId, { ...standard, code: 'OTHER' });
      await catalogs.links.add(adminId, another.id, m.id);
      await catalogs.materials.update(adminId, m.id, { name: 'Vật tư bridge sửa' });
      const list = await catalogs.links.list(manager, s.id, Object.assign(new MaterialListDto(), { status: 'Inactive' }));
      assert.equal(list.total, 1); assert.equal(list.items[0].name, 'Vật tư bridge sửa');
      assert.equal(await catalogs.links.has(manager, s.id, m.id), true);
      await catalogs.links.remove(adminId, s.id, m.id);
      assert.equal(await catalogs.links.has(manager, s.id, m.id), false);
      assert.equal(await catalogs.links.has(manager, another.id, m.id), true);
      assert.equal((await catalogs.materials.get(manager, m.id)).status, 'Inactive');
      assert.equal((await catalogs.standards.get(manager, s.id)).status, 'Inactive');
      await assert.rejects(catalogs.links.remove(adminId, s.id, m.id), status(404));
      assert.equal((await metadata('standard_materials', `${s.id}:${m.id}`)).data.linked, false);
    });

    await t.test('two Admins adding/deleting same pair resolve once; re-link retains version and audit', async () => {
      const key = `${s.id}:${m.id}`, before = Number((await metadata('standard_materials', key)).version);
      const adding = await Promise.allSettled([catalogs.links.add(adminId, s.id, m.id), catalogs.links.add(admin2, s.id, m.id)]);
      assert.equal(adding.filter((result) => result.status === 'fulfilled').length, 1);
      assert.ok(adding.some((result) => result.status === 'rejected' && status(409)(result.reason)));
      assert.equal(Number((await metadata('standard_materials', key)).version), before + 1);
      const deleting = await Promise.allSettled([catalogs.links.remove(adminId, s.id, m.id), catalogs.links.remove(admin2, s.id, m.id)]);
      assert.equal(deleting.filter((result) => result.status === 'fulfilled').length, 1);
      assert.ok(deleting.some((result) => result.status === 'rejected' && status(404)(result.reason)));
      assert.equal(Number((await metadata('standard_materials', key)).version), before + 2);
      const audits = await sql.query('SELECT action,actor_id,payload FROM technical.audit_events WHERE entity_type=$1 AND entity_key=$2', ['standard_materials', key]);
      assert.equal(audits.rows.length, 4); assert.ok(audits.rows.every((row) => [adminId, admin2].includes(row.actor_id)));
    });

    await t.test('concurrent PATCH on different fields preserves both changes and increments version twice', async () => {
      const before = Number((await metadata('agricultural_materials', m.id)).version);
      await Promise.all([catalogs.materials.update(adminId, m.id, { name: 'Tên sau race' }), catalogs.materials.update(admin2, m.id, { quarantine_days: 7 })]);
      const row = await catalogs.materials.get(manager, m.id);
      assert.equal(row.name, 'Tên sau race'); assert.equal(row.quarantine_days, 7);
      assert.equal(Number((await metadata('agricultural_materials', m.id)).version), before + 2);
    });

    await t.test('uppercase UUID inputs share canonical metadata/audit and bridge keys', async () => {
      const before = Number((await metadata('agricultural_materials', m.id)).version);
      await catalogs.materials.update(adminId.toUpperCase(), m.id.toUpperCase(), { unit: 'kg' });
      assert.equal(Number((await metadata('agricultural_materials', m.id)).version), before + 1);
      assert.equal(await metadata('agricultural_materials', m.id.toUpperCase()), undefined);
      const link = await catalogs.links.add(adminId, s.id.toUpperCase(), m.id.toUpperCase());
      assert.deepEqual(link, { standard_id: s.id, material_id: m.id });
      assert.equal((await catalogs.links.list(manager, s.id.toUpperCase(), new MaterialListDto())).standard_id, s.id);
      await catalogs.links.remove(adminId, s.id.toUpperCase(), m.id.toUpperCase());
      assert.equal(await metadata('standard_materials', `${s.id.toUpperCase()}:${m.id.toUpperCase()}`), undefined);
    });

    await t.test('repository boundary validates DTO/UUID/null/extra fields and preserves 404/400 semantics', async () => {
      for (const changes of [{ status: 'Unknown' }, { unit: null }, { quarantine_days: -1 }, { quarantine_days: 2147483648 }, { name: '' }, { id: randomUUID() }]) {
        await assert.rejects(catalogs.materials.update(adminId, m.id, changes as never), status(400));
      }
      await assert.rejects(catalogs.materials.update(adminId, m.id, {}), status(400));
      await assert.rejects(catalogs.materials.create(adminId, null as never), status(400));
      await assert.rejects(catalogs.standards.update(adminId, s.id, { description: null } as never), status(400));
      await assert.rejects(catalogs.standards.create(adminId, { ...standard, code: 'x'.repeat(41) }), status(400));
      await assert.rejects(catalogs.materials.list(adminId, Object.assign(new MaterialListDto(), { limit: 101 })), status(400));
      await assert.rejects(catalogs.materials.get(adminId, 'invalid'), status(400));
      await assert.rejects(catalogs.materials.get(adminId, randomUUID()), status(404));
      await assert.rejects(catalogs.links.add(adminId, s.id, randomUUID()), status(404));
      await assert.rejects(catalogs.links.list(adminId, randomUUID(), new MaterialListDto()), status(404));
    });

    await t.test('direct repository calls require current Active role; Farmer/Manager can only read', async () => {
      for (const actor of [seed.primary_farmer_id, manager]) {
        await assert.rejects(catalogs.materials.create(actor, material), status(403));
        await assert.rejects(catalogs.standards.update(actor, s.id, { name: 'Forbidden' }), status(403));
        await assert.rejects(catalogs.links.add(actor, s.id, m.id), status(403));
        assert.equal((await catalogs.materials.get(actor, m.id)).id, m.id);
      }
      await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [manager]);
      try { await assert.rejects(catalogs.materials.list(manager, new MaterialListDto()), status(403)); }
      finally { await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [manager]); }
    });

    await t.test('waiting write rechecks revoked Admin after acquiring user row lock', async () => {
      const waiterPool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 1, application_name: 'catalog-revocation-fixture', connectionTimeoutMillis: 5000 });
      const blocker = await sql.connect();
      let finished: Promise<PromiseSettledResult<unknown>> | undefined;
      try {
        await blocker.query('BEGIN'); await blocker.query("UPDATE public.users SET status='Locked' WHERE id=$1", [admin2]);
        const waiter = new PostgresCatalogRepository(waiterPool, new PostgresUsersRepository(waiterPool));
        finished = waiter.materials.update(admin2, m.id, { name: 'Must not commit' }).then(
          (value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }));
        const deadline = Date.now() + 5000;
        let blocked = false;
        while (Date.now() < deadline) {
          blocked = Boolean((await sql.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='catalog-revocation-fixture' AND wait_event_type='Lock'", [name])).rowCount);
          if (blocked) { break; } await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(blocked, true); await blocker.query('COMMIT');
        const result = await finished; assert.equal(result.status, 'rejected');
        assert.ok(result.status === 'rejected' && status(403)(result.reason));
        assert.equal((await catalogs.materials.get(adminId, m.id)).name, 'Tên sau race');
      } finally {
        await blocker.query('ROLLBACK'); blocker.release(); await finished;
        await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [admin2]); await waiterPool.end();
      }
    });

    await t.test('audit failure rolls back create/PATCH/link/unlink and returns sanitized errors', async () => {
      const before = await catalogs.materials.get(adminId, m.id), meta = await metadata('agricultural_materials', m.id);
      const count = (await sql.query('SELECT count(*) FROM public.agricultural_materials')).rows[0].count;
      await catalogs.links.add(adminId, s.id, m.id);
      await sql.query(`CREATE FUNCTION technical.fail_catalog_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'private catalog driver details'; END $$;
        CREATE TRIGGER fail_catalog_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW
        WHEN (NEW.entity_type IN ('agricultural_materials','farming_standards','standard_materials')) EXECUTE FUNCTION technical.fail_catalog_audit();`);
      try {
        await assert.rejects(catalogs.materials.create(adminId, material), (error: unknown) => status(503)(error) && !String(error).includes('private catalog'));
        await assert.rejects(catalogs.materials.update(adminId, m.id, { name: 'Rollback' }), status(503));
        await assert.rejects(catalogs.links.remove(adminId, s.id, m.id), status(503));
        const other = (await sql.query(`SELECT s.id FROM public.farming_standards s WHERE NOT EXISTS
          (SELECT 1 FROM public.standard_materials b WHERE b.standard_id=s.id AND b.material_id=$1) ORDER BY s.id LIMIT 1`, [m.id])).rows[0];
        await assert.rejects(catalogs.links.add(adminId, other.id, m.id), status(503));
        assert.equal((await sql.query('SELECT count(*) FROM public.agricultural_materials')).rows[0].count, count);
        assert.deepEqual(await catalogs.materials.get(adminId, m.id), before);
        assert.deepEqual(await metadata('agricultural_materials', m.id), meta);
        assert.equal(await catalogs.links.has(adminId, s.id, m.id), true);
        assert.equal(await catalogs.links.has(adminId, other.id, m.id), false);
      } finally { await sql.query('DROP TRIGGER fail_catalog_audit ON technical.audit_events; DROP FUNCTION technical.fail_catalog_audit()'); }
    });

    await t.test('unsafe metadata version blocks write and unlink seed retains manifest instead of silently reseeding', async () => {
      const meta = await metadata('agricultural_materials', m.id), row = await catalogs.materials.get(adminId, m.id);
      await sql.query("UPDATE technical.entity_metadata SET version=9007199254740991 WHERE entity_type='agricultural_materials' AND entity_key=$1", [m.id]);
      try {
        await assert.rejects(catalogs.materials.update(adminId, m.id, { name: 'Overflow' }), status(503));
        assert.deepEqual(await catalogs.materials.get(adminId, m.id), row);
      } finally { await sql.query("UPDATE technical.entity_metadata SET version=$2 WHERE entity_type='agricultural_materials' AND entity_key=$1", [m.id, meta.version]); }
      const link = (await sql.query('SELECT standard_id,material_id FROM public.standard_materials b JOIN technical.entity_metadata m ON m.entity_type=$1 AND m.entity_key=b.standard_id::text || $2 || b.material_id::text WHERE m.data ? $3 LIMIT 1', ['standard_materials', ':', 'seed_key'])).rows[0];
      const key = `${link.standard_id}:${link.material_id}`, before = await metadata('standard_materials', key);
      await catalogs.links.remove(adminId, link.standard_id, link.material_id);
      await assert.rejects(seedDemo(sql, seedConfig), /Seed linked material conflict/);
      assert.equal(await catalogs.links.has(adminId, link.standard_id, link.material_id), false);
      assert.equal((await metadata('standard_materials', key)).data.seed_key, before.data.seed_key);
      await catalogs.links.add(adminId, link.standard_id, link.material_id);
      assert.equal((await seedDemo(sql, seedConfig)).inserted, 0);
      assert.equal(Number((await metadata('standard_materials', key)).version), Number(before.version) + 2);
    });

    await t.test('HTTP DTO/auth/pair responses and fresh app+pool retain records without RAM catalog authority', async () => {
      let app = await application(sql), freshPool: Pool | undefined;
      const http = async (path: string, method = 'GET', body?: object, token?: string) => fetch(`${await app.getUrl()}/api/${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const login = async (phone: string, password: string) => {
        const response = await http('auth/login', 'POST', { phone_number: phone, password }); assert.equal(response.status, 200);
        return (await response.json() as { access_token: string }).access_token;
      };
      try {
        const admin = await login(config.admin.phoneNumber, config.admin.password), farmer = await login(config.phoneNumber, config.password);
        assert.equal((await http('materials')).status, 401);
        assert.equal((await http('materials', 'POST', material, farmer)).status, 403);
        assert.equal((await http('materials', 'POST', { ...material, created_by: adminId }, admin)).status, 400);
        assert.equal((await http(`standards/${s.id}`, 'PATCH', { description: null }, admin)).status, 400);
        assert.equal((await http('materials?limit=101', 'GET', undefined, farmer)).status, 400);
        assert.equal((await http('materials/not-uuid', 'GET', undefined, farmer)).status, 400);
        const createdMaterial = await http('materials', 'POST', { ...material, name: 'HTTP durable' }, admin);
        assert.equal(createdMaterial.status, 201); const createdRow = await createdMaterial.json() as AgriculturalMaterial;
        const createdStandard = await http('standards', 'POST', standard, admin);
        assert.equal(createdStandard.status, 201); const standardRow = await createdStandard.json() as FarmingStandard;
        const path = `standards/${standardRow.id}/materials`;
        assert.equal((await http(path, 'POST', { material_id: createdRow.id }, admin)).status, 201);
        assert.equal((await http(path, 'POST', { material_id: createdRow.id }, admin)).status, 409);
        await app.close();
        freshPool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 4, connectionTimeoutMillis: 5000 });
        app = await application(freshPool);
        // The unused memory providers are empty; HTTP must hit PostgreSQL.
        assert.throws(() => app.get(MaterialsService).get(createdRow.id), status(404));
        const freshFarmer = await login(config.phoneNumber, config.password);
        const detail = await http(`materials/${createdRow.id}`, 'GET', undefined, freshFarmer);
        assert.equal(detail.status, 200); assert.deepEqual(await detail.json(), createdRow);
        const list = await http(path, 'GET', undefined, freshFarmer);
        assert.equal((await list.json() as { total: number }).total, 1);
        const removed = await http(`${path}/${createdRow.id}`, 'DELETE', undefined, await login(config.admin.phoneNumber, config.admin.password));
        assert.equal(removed.status, 204); assert.equal(await removed.text(), '');
        assert.equal((await http(`materials/${createdRow.id}`, 'GET', undefined, freshFarmer)).status, 200);
        assert.equal((await http(`materials/${createdRow.id}`, 'DELETE', undefined, freshFarmer)).status, 404);
      } finally { await app.close(); await freshPool?.end(); }
    });
  } finally {
    await pool?.end();
    if (created && /^sdf_persistence_test_[0-9a-f]{32}$/.test(name)) { await mongo.db(name).dropDatabase(); await adminPool.query(`DROP DATABASE "${name}"`); }
    await mongo.close(); await adminPool.end();
  }
});
