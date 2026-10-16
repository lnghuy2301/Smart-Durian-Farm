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
import { UsersModule } from '../src/users/users.module';
import { UserManagement } from '../src/users/user-management';
import { FarmsModule } from '../src/farms/farms.module';
import { FarmRecords } from '../src/farms/farm-records';
import { StandardsModule } from '../src/standards/standards.module';
import { StandardRecords } from '../src/catalog/catalog-records';
import { ZonesModule } from '../src/zones/zones.module';
import { ZoneRecords } from '../src/zones/zone-records';
import { TreesModule } from '../src/trees/trees.module';
import { TreeRecords } from '../src/trees/tree-records';
import { TreesService } from '../src/trees/trees.service';
import { TreeListDto } from '../src/trees/trees.dto';
import { TreeChangeRequest, TestTree } from '../src/trees/trees.types';
import { FarmPageDto, FarmRequestListDto } from '../src/farms/farms.dto';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { PostgresUserManagement } from '../src/persistence/postgres-user-management';
import { PostgresCooperativesRepository } from '../src/persistence/postgres-cooperatives.repository';
import { PostgresCatalogRepository } from '../src/persistence/postgres-catalog.repository';
import { PostgresFarmsRepository } from '../src/persistence/postgres-farms.repository';
import { PostgresZonesRepository } from '../src/persistence/postgres-zones.repository';
import { PostgresAssignmentsRepository } from '../src/persistence/postgres-assignments.repository';
import { PostgresTreesRepository } from '../src/persistence/postgres-trees.repository';
import { MIGRATIONS, runMigrations } from '../src/persistence/migrations';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';

const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const config = {
  mode: 'mock' as const,
  phoneNumber: '0900000000',
  password: 'TreeFixturePassword!',
  jwtSecret: 'tree-fixture-secret-at-least-32-bytes',
  sms: { provider: 'mock' as const },
  admin: { phoneNumber: '0900000001', password: 'TreeAdminFixture!' },
};
const details = {
  variety: 'Ri6',
  plant_date: '2024-05-01T08:00:00+07:00',
  longitude: 108.1234567,
  latitude: 12.7654321,
};
const status = (code: number) => (error: unknown) =>
  error instanceof HttpException && error.getStatus() === code;

async function application(pool: Pool): Promise<INestApplication> {
  const users = new PostgresUsersRepository(pool),
    farms = new PostgresFarmsRepository(pool, users),
    catalogs = new PostgresCatalogRepository(pool, users),
    registry = new PostgresCooperativesRepository(pool, users);
  const zones = new PostgresZonesRepository(pool, users, farms, catalogs),
    auth = AuthModule.forMock(config),
    userModule = UsersModule.forMock(config, auth);
  const farmModule = FarmsModule.forMock(auth, userModule),
    zoneModule = ZonesModule.forMock(auth, farmModule, StandardsModule.forMock(auth));
  const module = await Test.createTestingModule({
    imports: [TreesModule.forMock(auth, farmModule, zoneModule)],
  })
    .overrideProvider(UserAccounts)
    .useValue(users)
    .overrideProvider(UserManagement)
    .useValue(new PostgresUserManagement(users, registry))
    .overrideProvider(FarmRecords)
    .useValue(farms)
    .overrideProvider(StandardRecords)
    .useValue(catalogs.standards)
    .overrideProvider(ZoneRecords)
    .useValue(zones)
    .overrideProvider(TreeRecords)
    .useValue(new PostgresTreesRepository(pool, users, farms, zones))
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

test('PostgreSQL Tree metadata, scoped reads, durable proposals and append-only version snapshots', async (t) => {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`,
    adminPool = new Pool({
      connectionString: `${postgresBase}/sdf_persistence_test`,
      connectionTimeoutMillis: 5000,
    });
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  let pool: Pool | undefined,
    created = false;
  try {
    await adminPool.query(`CREATE DATABASE "${name}"`);
    created = true;
    pool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 10, connectionTimeoutMillis: 5000 });
    const sql = pool;
    await mongo.connect();
    await t.test(
      'migration009 refuses duplicate Pending keys, retains rows and old ledger, then applies without data rewrites',
      async () => {
        await runMigrations(sql, mongo.db(name), MIGRATIONS.slice(0, 8));
        const user = (
          await sql.query(
            `INSERT INTO public.users(user_name,phone_number,password,role,status) VALUES ('Migration fixture','0900000087','unused-fixture','Farmer','Active') RETURNING id`,
          )
        ).rows[0].id;
        const rows = await sql.query(
          `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at) VALUES ('trees','Update','Pending',$1,$2,'{}',now()),('trees','Update','Pending',upper($1),$2,'{}',now()) RETURNING id`,
          [randomUUID(), user],
        );
        await assert.rejects(
          runMigrations(sql, mongo.db(name)),
          (error: unknown) => (error as { code: string }).code === '23505',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count,
          '8',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.workflow_requests')).rows[0].count,
          '2',
        );
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[1].id]);
        assert.deepEqual(await runMigrations(sql, mongo.db(name)), ['009_tree_workflow', '010_harvest_workflow']);
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[0].id]);
        await sql.query('DELETE FROM public.users WHERE id=$1', [user]);
      },
    );
    await seedDemo(
      sql,
      readSeedConfig({
        NODE_ENV: 'test',
        AUTH_TEST_PHONE: config.phoneNumber,
        AUTH_TEST_PASSWORD: config.password,
        AUTH_TEST_ADMIN_PHONE: config.admin.phoneNumber,
        AUTH_TEST_ADMIN_PASSWORD: config.admin.password,
        DEMO_DEVICE_STATION_ID: 'TREE_TEST_ESP32',
        DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00',
        DEMO_DEVICE_COST: '10237500',
      }),
    );
    const users = new PostgresUsersRepository(sql),
      farms = new PostgresFarmsRepository(sql, users),
      catalogs = new PostgresCatalogRepository(sql, users),
      zones = new PostgresZonesRepository(sql, users, farms, catalogs);
    const trees = new PostgresTreesRepository(sql, users, farms, zones),
      assignments = new PostgresAssignmentsRepository(sql, users, farms, zones),
      registry = new PostgresCooperativesRepository(sql, users);
    const admin = (await users.loadByPhone(config.admin.phoneNumber))!.user.id,
      hash = (await users.loadById(admin))!.user.password;
    const standard = await catalogs.standards.create(admin, {
      code: 'TREE-STD',
      name: 'VietGAP fixture',
      description: '',
      certifying_body: 'Fixture',
    });
    let n = 10;
    const farmer = async () => {
      const phone = `09000000${n++}`,
        u = await users.createRegisteredUser({
          user_name: 'Farmer fixture',
          phone_number: phone,
          gmail: null,
          passwordHash: hash,
          role: 'Farmer',
        });
      return { id: u.user.id, phone };
    };
    const fixture = async () => {
      const owner = await farmer(),
        worker = await farmer(),
        r = await farms.createRequest(owner.id, {
          area_size: 1,
          address: 'Vườn Đắk Lắk',
          certificate_number: 'TREE-FIXTURE',
          longitude: 108,
          latitude: 12,
        });
      const farm = (await farms.approve(admin, r.id)).farm_id!;
      const zone = await zones.create(owner.id, {
        farm_id: farm,
        standard_id: standard.id,
        zone_name: 'Khu trồng',
        area_size: 0.3,
        longitude: 108,
        latitude: 12,
      });
      return { owner, worker, farm, zone, input: { zone_id: zone.id, ...details } };
    };
    const meta = async (type: string, id: string) =>
      (
        await sql.query(
          'SELECT version,data FROM technical.entity_metadata WHERE entity_type=$1 AND entity_key=$2',
          [type, id],
        )
      ).rows[0];

    await t.test(
      'owner direct write generates immutable code, UTC date and history snapshots without mutating status on PATCH',
      async () => {
        const f = await fixture(),
          tree = await trees.create(f.owner.id, f.input);
        assert.equal(tree.tree_code, `DRN-${tree.id}`);
        assert.equal(tree.plant_date, '2024-05-01T01:00:00.000Z');
        assert.equal(tree.status, 'Active');
        assert.equal(tree.longitude, details.longitude);
        await assert.rejects(trees.create(admin, f.input), status(403));
        await assert.rejects(trees.update(f.worker.id, tree.id, { status: 'Dead' }), status(403));
        await trees.update(f.owner.id, tree.id, { status: 'Dead' });
        assert.equal((await trees.update(f.owner.id, tree.id, { variety: 'Monthong' })).status, 'Dead');
        const history = await trees.history(f.owner.id, tree.id, new FarmPageDto());
        assert.equal(history.total, 3);
        assert.deepEqual(
          history.items.map((x) => x.version),
          [1, 2, 3],
        );
        assert.equal(history.items[0].before, null);
        assert.deepEqual(history.items[1].before, tree);
        assert.equal(history.items[2].actor_id, f.owner.id);
        assert.equal((await trees.getByCode(admin, tree.tree_code)).id, tree.id);
        assert.deepEqual(await trees.getRecord(tree.id), await trees.getTraceRecordByCode(tree.tree_code));
        history.items[0].after.variety = 'Caller mutation';
        assert.equal((await trees.history(admin, tree.id, new FarmPageDto())).items[0].after.variety, 'Ri6');
      },
    );
    await t.test(
      'Admin Create waits for owner, competing approvals create one tree/code and record real proposer/reviewer',
      async () => {
        const f = await fixture(),
          r = await trees.createRequest(admin, f.input);
        assert.equal(r.tree_id, null);
        assert.equal((await trees.list(f.owner.id, new TreeListDto())).total, 0);
        await assert.rejects(trees.approve(admin, r.id), status(403));
        await assert.rejects(trees.approve(f.worker.id, r.id), status(403));
        const results = await Promise.allSettled([
          trees.approve(f.owner.id, r.id),
          trees.approve(f.owner.id, r.id),
        ]);
        assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
        assert.ok(results.some((x) => x.status === 'rejected' && status(409)(x.reason)));
        const accepted = await trees.getRequest(admin, r.id),
          history = await trees.history(f.owner.id, accepted.tree_id!, new FarmPageDto());
        assert.equal(history.total, 1);
        assert.equal(history.items[0].actor_id, f.owner.id);
        assert.equal(history.items[0].proposed_by, admin);
        assert.equal(history.items[0].request_id, r.id);
        assert.equal((await meta('tree_requests', r.id)).version, '2');
      },
    );
    await t.test(
      'one Pending update slot and stale version; rejection frees slot without history, rejected proposer can be cleared',
      async () => {
        const f = await fixture(),
          tree = await trees.create(f.owner.id, f.input);
        const proposals = await Promise.allSettled([
          trees.updateRequest(admin, tree.id, { variety: 'A' }),
          trees.updateRequest(admin, tree.id, { variety: 'B' }),
        ]);
        assert.equal(proposals.filter((x) => x.status === 'fulfilled').length, 1);
        assert.ok(proposals.some((x) => x.status === 'rejected' && status(409)(x.reason)));
        const r = (
          proposals.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<TreeChangeRequest>
        ).value;
        await trees.update(f.owner.id, tree.id, { status: 'Removed' });
        await assert.rejects(trees.approve(f.owner.id, r.id), status(409));
        await trees.reject(f.owner.id, r.id, '🌱'.repeat(500));
        assert.equal((await trees.history(f.owner.id, tree.id, new FarmPageDto())).total, 2);
        const next = await trees.updateRequest(admin, tree.id, { status: 'Active' });
        await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [admin]);
        try {
          await assert.rejects(trees.approve(f.owner.id, next.id), status(403));
          assert.equal((await trees.reject(f.owner.id, next.id)).status, 'Rejected');
        } finally {
          await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [admin]);
        }
      },
    );
    await t.test(
      'accepted assignment grants read/code/history only during interval, former worker keeps assignment history only',
      async () => {
        const f = await fixture(),
          tree = await trees.create(f.owner.id, f.input);
        await assert.rejects(trees.get(f.worker.id, tree.id), status(404));
        const r = await assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id });
        await assert.rejects(trees.getByCode(f.worker.id, tree.tree_code), status(404));
        const accepted = await assignments.approve(f.worker.id, r.id);
        assert.equal((await trees.getByCode(f.worker.id, tree.tree_code)).id, tree.id);
        assert.equal((await trees.history(f.worker.id, tree.id, new FarmPageDto())).total, 1);
        await assert.rejects(trees.update(f.worker.id, tree.id, { variety: 'Denied' }), status(403));
        await assignments.end(f.owner.id, accepted.assignment_id!);
        await assert.rejects(trees.get(f.worker.id, tree.id), status(404));
        await assert.rejects(trees.history(f.worker.id, tree.id, new FarmPageDto()), status(404));
        assert.equal((await assignments.get(f.worker.id, accepted.assignment_id!)).active, false);
      },
    );
    await t.test(
      'Manager follows current HTX, never sees proposals or writes tree; Leave removes history scope too',
      async () => {
        const f = await fixture(),
          tree = await trees.create(f.owner.id, f.input),
          phone = `09000000${n++}`,
          gmail = `tree-manager${n}@example.invalid`;
        const account = await users.createRegisteredUser(
          { user_name: 'Manager fixture', phone_number: phone, gmail, passwordHash: hash, role: 'Manager' },
          gmail,
        );
        const c = await registry.approve(admin, account.user.id, {
          cooperative: {
            cooperative_name: 'HTX cây',
            director: 'Ban quản trị',
            certificate_number: 'TREE-COOP',
            address: 'Đắk Lắk',
            contact_number: phone,
          },
        });
        await assert.rejects(trees.get(account.user.id, tree.id), status(404));
        const join = await farms.joinRequest(f.owner.id, f.farm, c.cooperative.id);
        await farms.approve(admin, join.id);
        await farms.approve(account.user.id, join.id);
        assert.equal((await trees.history(account.user.id, tree.id, new FarmPageDto())).total, 1);
        await assert.rejects(trees.update(account.user.id, tree.id, { status: 'Dead' }), status(403));
        const r = await trees.updateRequest(admin, tree.id, { variety: 'Proposal' });
        await assert.rejects(trees.getRequest(account.user.id, r.id), status(404));
        assert.equal((await trees.listRequests(account.user.id, new FarmRequestListDto())).total, 0);
        const leave = await farms.leaveRequest(f.owner.id, f.farm);
        await farms.approve(admin, leave.id);
        await assert.rejects(trees.history(account.user.id, tree.id, new FarmPageDto()), status(404));
      },
    );
    await t.test(
      'strict immutable fields/null/no-op/canonical UUID validation and literal search work outside HTTP too',
      async () => {
        const f = await fixture(),
          tree = await trees.create(f.owner.id.toUpperCase(), {
            ...f.input,
            zone_id: f.zone.id.toUpperCase(),
          });
        for (const input of [
          { zone_id: f.zone.id },
          { tree_code: tree.tree_code },
          { id: tree.id },
          { status: null },
          { longitude: '108' },
          { latitude: 91 },
          { variety: ' ' },
          { plant_date: '2024-02-30T00:00:00Z' },
          { longitude: 108.12345678 },
        ]) {
          await assert.rejects(trees.update(f.owner.id, tree.id, input as never), status(400));
        }
        await assert.rejects(trees.update(f.owner.id, tree.id, {}), status(400));
        await assert.rejects(
          trees.updateRequest(admin, tree.id, { plant_date: details.plant_date }),
          status(400),
        );
        await assert.rejects(trees.getByCode(admin, tree.tree_code.toLowerCase()), status(400));
        await assert.rejects(
          trees.list(admin, Object.assign(new TreeListDto(), { limit: 101 })),
          status(400),
        );
        await trees.update(f.owner.id, tree.id, { variety: "GIỐNG 100%_O'Brien" });
        const page = await trees.list(
          f.owner.id,
          Object.assign(new TreeListDto(), { q: "%_o'BRIEN", offset: 500 }),
        );
        assert.equal(page.total, 1);
        assert.deepEqual(page.items, []);
        assert.equal(await meta('trees', tree.id.toUpperCase()), undefined);
      },
    );
    await t.test(
      'UUID collisions retry exactly three times without overwriting existing code/metadata/history',
      async () => {
        const f = await fixture(),
          tree = await trees.create(f.owner.id, f.input);
        let attempts = 0;
        const collision = new PostgresTreesRepository(
          sql,
          users,
          farms,
          zones,
          () => new Date(),
          () => {
            attempts++;
            return tree.id;
          },
        );
        await assert.rejects(collision.create(f.owner.id, f.input), status(409));
        assert.equal(attempts, 3);
        assert.deepEqual(await trees.get(admin, tree.id), tree);
        assert.equal((await trees.history(admin, tree.id, new FarmPageDto())).total, 1);
      },
    );
    await t.test(
      'audit failure rolls back data/history/version/request terminal and does not lose prior snapshots',
      async () => {
        const f = await fixture(),
          tree = await trees.create(f.owner.id, f.input),
          r = await trees.updateRequest(admin, tree.id, { variety: 'Rollback' }),
          before = await meta('trees', tree.id);
        await sql.query(
          `CREATE FUNCTION technical.fail_tree_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='trees' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_tree_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW EXECUTE FUNCTION technical.fail_tree_audit()`,
        );
        try {
          await assert.rejects(trees.approve(f.owner.id, r.id), status(503));
          await assert.rejects(trees.create(f.owner.id, f.input), status(503));
          assert.deepEqual(await trees.get(admin, tree.id), tree);
          assert.deepEqual(await meta('trees', tree.id), before);
          assert.equal((await trees.getRequest(admin, r.id)).status, 'Pending');
          assert.equal((await trees.history(admin, tree.id, new FarmPageDto())).total, 1);
        } finally {
          await sql.query(
            'DROP TRIGGER fail_tree_audit ON technical.audit_events; DROP FUNCTION technical.fail_tree_audit()',
          );
        }
        await trees.approve(f.owner.id, r.id);
        assert.equal((await trees.history(admin, tree.id, new FarmPageDto())).total, 2);
      },
    );
    await t.test('unsafe/missing metadata, malformed requests and corrupt history fail closed', async () => {
      const f = await fixture(),
        tree = await trees.create(f.owner.id, f.input);
      await sql.query(
        "UPDATE technical.entity_metadata SET version=9007199254740991 WHERE entity_type='trees' AND entity_key=$1",
        [tree.id],
      );
      await assert.rejects(trees.update(f.owner.id, tree.id, { status: 'Dead' }), status(503));
      assert.deepEqual(await trees.get(admin, tree.id), tree);
      await sql.query(
        "UPDATE technical.entity_metadata SET version=1 WHERE entity_type='trees' AND entity_key=$1",
        [tree.id],
      );
      const r = await trees.updateRequest(admin, tree.id, { variety: 'Valid' });
      await sql.query(
        'UPDATE technical.workflow_requests SET payload=jsonb_set(payload,\'{proposed_changes}\',\'{"zone_id":"invalid"}\') WHERE id=$1',
        [r.id],
      );
      await assert.rejects(trees.approve(f.owner.id, r.id), status(503));
      await assert.rejects(
        sql.query(
          "UPDATE technical.audit_events SET payload=jsonb_set(payload,'{after,tree_code}','\"invalid\"') WHERE entity_type='trees' AND entity_key=$1",
          [tree.id],
        ),
        (error: unknown) => (error as { code: string }).code === '23514',
      );
      // Trigger append-only phải giữ nguyên. Chỉ INSERT một audit malformed
      // trong fixture để kiểm tra mapper fail closed, không tắt trigger.
      await sql.query(
        "INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ('trees',$1,$2,'TreeUpdated',now(),$3)",
        [
          tree.id,
          admin,
          JSON.stringify({
            proposed_by: null,
            request_id: null,
            version: 2,
            before: tree,
            after: { ...tree, tree_code: 'invalid' },
          }),
        ],
      );
      await assert.rejects(trees.history(admin, tree.id, new FarmPageDto()), status(503));
      await sql.query("DELETE FROM technical.entity_metadata WHERE entity_type='trees' AND entity_key=$1", [
        tree.id,
      ]);
      await assert.rejects(trees.get(admin, tree.id), status(503));
    });
    await t.test(
      'owner revoked while waiting for lock cannot write Tree or append a history entry',
      async () => {
        const f = await fixture(),
          tree = await trees.create(f.owner.id, f.input);
        const waitingPool = new Pool({
          connectionString: `${postgresBase}/${name}`,
          max: 1,
          application_name: 'tree-owner-revocation',
          connectionTimeoutMillis: 5000,
        });
        const blocker = await sql.connect();
        let done: Promise<PromiseSettledResult<unknown>> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.owner.id]);
          const writer = new PostgresTreesRepository(
            waitingPool,
            new PostgresUsersRepository(waitingPool),
            farms,
            zones,
          );
          done = writer.update(f.owner.id, tree.id, { status: 'Dead' }).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason) => ({ status: 'rejected' as const, reason }),
          );
          let blocked = false;
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            blocked = Boolean(
              (
                await sql.query(
                  "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='tree-owner-revocation' AND wait_event_type='Lock'",
                  [name],
                )
              ).rowCount,
            );
            if (blocked) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(blocked, true);
          await blocker.query('COMMIT');
          const result = await done;
          assert.ok(result.status === 'rejected' && status(403)(result.reason));
          assert.deepEqual(await trees.get(admin, tree.id), tree);
          assert.equal((await trees.history(admin, tree.id, new FarmPageDto())).total, 1);
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await done;
          await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [f.owner.id]);
          await waitingPool.end();
        }
      },
    );

    await t.test(
      'fresh HTTP app and pool preserve pending request, accepted update and metadata history, unused RAM remains empty',
      async () => {
        const f = await fixture(),
          tree = await trees.create(f.owner.id, f.input),
          r = await trees.updateRequest(admin, tree.id, { variety: 'Khôi phục' });
        let app = await application(sql),
          freshPool: Pool | undefined;
        const http = async (path: string, method = 'GET', body?: object, token?: string) =>
          fetch(`${await app.getUrl()}/api/${path}`, {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        const login = async (phone: string) => {
          const response = await http('auth/login', 'POST', {
            phone_number: phone,
            password: config.admin.password,
          });
          assert.equal(response.status, 200);
          return ((await response.json()) as { access_token: string }).access_token;
        };
        try {
          assert.equal((await http('trees')).status, 401);
          const token = await login(f.owner.phone);
          assert.equal((await http(`trees/${tree.id}`, 'PATCH', { zone_id: f.zone.id }, token)).status, 400);
          await app.close();
          freshPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 5,
            connectionTimeoutMillis: 5000,
          });
          app = await application(freshPool);
          assert.throws(() => app.get(TreesService).getRecord(tree.id), status(404));
          const owner = await login(f.owner.phone);
          assert.equal((await http(`tree-requests/${r.id}`, 'GET', undefined, owner)).status, 200);
          assert.equal((await http(`tree-requests/${r.id}/approve`, 'PATCH', {}, owner)).status, 200);
          await app.close();
          app = await application(freshPool);
          const restored = await http(
            `trees/by-code/${tree.tree_code}`,
            'GET',
            undefined,
            await login(f.owner.phone),
          );
          assert.equal(((await restored.json()) as TestTree).variety, 'Khôi phục');
          const history = await http(
            `trees/${tree.id}/history`,
            'GET',
            undefined,
            await login(config.admin.phoneNumber),
          );
          assert.equal(((await history.json()) as { total: number }).total, 2);
        } finally {
          await app.close();
          await freshPool?.end();
        }
      },
    );
  } finally {
    await pool?.end();
    if (created && /^sdf_persistence_test_[0-9a-f]{32}$/.test(name)) {
      await mongo.db(name).dropDatabase();
      await adminPool.query(`DROP DATABASE "${name}"`);
    }
    await mongo.close();
    await adminPool.end();
  }
});
