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
import { AssignmentsModule } from '../src/assignments/assignments.module';
import { AssignmentRecords } from '../src/assignments/assignment-records';
import { MockZoneAssignmentStore } from '../src/assignments/mock-zone-assignment.store';
import { AssignmentListDto } from '../src/assignments/assignments.dto';
import { AssignmentRequest } from '../src/assignments/assignments.types';
import { FarmRequestListDto } from '../src/farms/farms.dto';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { PostgresUserManagement } from '../src/persistence/postgres-user-management';
import { PostgresCooperativesRepository } from '../src/persistence/postgres-cooperatives.repository';
import { PostgresCatalogRepository } from '../src/persistence/postgres-catalog.repository';
import { PostgresFarmsRepository } from '../src/persistence/postgres-farms.repository';
import { PostgresZonesRepository } from '../src/persistence/postgres-zones.repository';
import { PostgresAssignmentsRepository } from '../src/persistence/postgres-assignments.repository';
import { MIGRATIONS, runMigrations } from '../src/persistence/migrations';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';

const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const config = {
  mode: 'mock' as const,
  phoneNumber: '0900000000',
  password: 'AssignmentFixturePassword!',
  jwtSecret: 'assignment-fixture-secret-at-least-32-bytes',
  sms: { provider: 'mock' as const },
  admin: { phoneNumber: '0900000001', password: 'AssignmentAdminFixture!' },
};
const status = (expected: number) => (error: unknown) =>
  error instanceof HttpException && error.getStatus() === expected;

async function application(pool: Pool): Promise<INestApplication> {
  const users = new PostgresUsersRepository(pool),
    farms = new PostgresFarmsRepository(pool, users);
  const catalogs = new PostgresCatalogRepository(pool, users),
    registry = new PostgresCooperativesRepository(pool, users);
  const zones = new PostgresZonesRepository(pool, users, farms, catalogs);
  const auth = AuthModule.forMock(config),
    userModule = UsersModule.forMock(config, auth);
  const farmModule = FarmsModule.forMock(auth, userModule),
    zoneModule = ZonesModule.forMock(auth, farmModule, StandardsModule.forMock(auth));
  // Không import AppModule hoặc các consumers IoT/Tree/QR đang RAM.
  const module = await Test.createTestingModule({
    imports: [AssignmentsModule.forMock(auth, farmModule, zoneModule)],
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
    .overrideProvider(AssignmentRecords)
    .useValue(new PostgresAssignmentsRepository(pool, users, farms, zones))
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

test('PostgreSQL assignments retain invitations, signatures, temporal access and original correction evidence', async (t) => {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({
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
      'migration008 refuses duplicate Pending End keys and preserves old ledger/history',
      async () => {
        await runMigrations(sql, mongo.db(name), MIGRATIONS.slice(0, 7));
        const user = (
          await sql.query(
            `INSERT INTO public.users(user_name,phone_number,password,role,status) VALUES ('Migration fixture','0900000087','unused-fixture','Farmer','Active') RETURNING id`,
          )
        ).rows[0].id;
        const requests = await sql.query(
          `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at)
        VALUES ('assignments','End','Pending',$1,$2,'{}',now()),('assignments','End','Pending',upper($1),$2,'{}',now()) RETURNING id`,
          [randomUUID(), user],
        );
        await assert.rejects(
          runMigrations(sql, mongo.db(name)),
          (error: unknown) => (error as { code: string }).code === '23505',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count,
          '7',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.workflow_requests')).rows[0].count,
          '2',
        );
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [requests.rows[1].id]);
        assert.deepEqual(await runMigrations(sql, mongo.db(name)), MIGRATIONS.filter((entry) => entry.id >= '008_assignment_workflow').map((entry) => entry.id));
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [requests.rows[0].id]);
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
        DEMO_DEVICE_STATION_ID: 'ASSIGNMENT_TEST_ESP32',
        DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00',
        DEMO_DEVICE_COST: '10237500',
      }),
    );
    const users = new PostgresUsersRepository(sql);
    let now = new Date('2026-10-16T02:00:00.000Z');
    const farms = new PostgresFarmsRepository(sql, users, () => now),
      catalogs = new PostgresCatalogRepository(sql, users, () => now);
    const zones = new PostgresZonesRepository(sql, users, farms, catalogs, () => now),
      registry = new PostgresCooperativesRepository(sql, users, () => now);
    const assignments = new PostgresAssignmentsRepository(sql, users, farms, zones, () => now);
    const admin = (await users.loadByPhone(config.admin.phoneNumber))!.user.id,
      hash = (await users.loadById(admin))!.user.password;
    let next = 10;
    const farmer = async () => {
      const phone = `09000000${next++}`,
        account = await users.createRegisteredUser({
          user_name: 'Farmer fixture',
          phone_number: phone,
          gmail: null,
          passwordHash: hash,
          role: 'Farmer',
        });
      return { id: account.user.id, phone };
    };
    const standard = await catalogs.standards.create(admin, {
      code: 'ASSIGNMENT-STD',
      name: 'VietGAP fixture',
      description: '',
      certifying_body: 'Fixture',
    });
    const fixture = async () => {
      const owner = await farmer(),
        worker = await farmer(),
        request = await farms.createRequest(owner.id, {
          area_size: 1,
          address: 'Vườn Đắk Lắk',
          certificate_number: 'ASSIGNMENT',
          longitude: 108,
          latitude: 12,
        });
      const farm = (await farms.approve(admin, request.id)).farm_id!;
      const zone = await zones.create(owner.id, {
        farm_id: farm,
        standard_id: standard.id,
        zone_name: 'Khu được phân công',
        area_size: 0.3,
        longitude: 108,
        latitude: 12,
      });
      return { owner, worker, farm, zone };
    };
    const accept = async (f: Awaited<ReturnType<typeof fixture>>, end: string | null = null) => {
      const r = await assignments.createRequest(f.owner.id, f.zone.id, {
        user_id: f.worker.id,
        end_date: end,
      });
      return assignments.approve(f.worker.id, r.id);
    };
    const metadata = async (type: string, id: string) =>
      (
        await sql.query(
          'SELECT version,data FROM technical.entity_metadata WHERE entity_type=$1 AND entity_key=$2',
          [type, id],
        )
      ).rows[0];

    await t.test(
      'owner invitation grants no access until assignee accepts; snapshot and five business fields persist',
      async () => {
        const f = await fixture(),
          r = await assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id });
        await assert.rejects(assignments.assertCanWork(f.worker.id, f.zone.id), status(403));
        await assert.rejects(zones.get(f.worker.id, f.zone.id), status(404));
        await assert.rejects(assignments.approve(f.owner.id, r.id), status(403));
        await assert.rejects(
          assignments.createRequest(f.worker.id, f.zone.id, { user_id: f.owner.id }),
          status(403),
        );
        const accepted = await assignments.approve(f.worker.id, r.id);
        assert.equal(accepted.status, 'Accepted');
        assert.ok(accepted.assignment_id);
        const entry = await assignments.get(f.worker.id, accepted.assignment_id!);
        assert.deepEqual(
          Object.keys(entry.assignment).sort(),
          ['id', 'user_id', 'zone_id', 'start_date', 'end_date'].sort(),
        );
        assert.equal(entry.active, true);
        assert.equal(entry.accepted_at, now.toISOString());
        assert.equal(entry.correction_deadline, null);
        assert.deepEqual(entry.zone_snapshot, f.zone);
        await assignments.assertCanWork(f.worker.id, f.zone.id);
        assert.equal((await zones.get(f.worker.id, f.zone.id)).id, f.zone.id);
        await assert.rejects(farms.get(f.worker.id, f.farm), status(404));
        await assert.rejects(assignments.approve(f.worker.id, r.id), status(409));
      },
    );

    await t.test(
      'Admin needs both signatures in either order, simultaneous reviewers commit one assignment',
      async () => {
        const f = await fixture(),
          r = await assignments.createRequest(admin, f.zone.id, { user_id: f.worker.id });
        const results = await Promise.all([
          assignments.approve(f.worker.id, r.id),
          assignments.approve(f.owner.id, r.id),
        ]);
        assert.deepEqual(results.map((result) => result.status).sort(), ['Accepted', 'Pending']);
        const restored = await assignments.getRequest(admin, r.id);
        assert.ok(restored.required_approvals.every((a) => a.approved_at !== null));
        assert.equal(
          (await sql.query('SELECT count(*) FROM public.users_zones WHERE zone_id=$1', [f.zone.id])).rows[0]
            .count,
          '1',
        );
        assert.equal((await metadata('assignment_requests', r.id)).version, '3');
        const self = await fixture(),
          selfRequest = await assignments.createRequest(admin, self.zone.id, { user_id: self.owner.id });
        assert.equal((await assignments.approve(self.owner.id, selfRequest.id)).status, 'Accepted');
        const direct = await fixture(),
          directRequest = await assignments.createRequest(direct.owner.id, direct.zone.id, {
            user_id: direct.owner.id,
          });
        assert.equal(directRequest.status, 'Pending');
        assert.equal((await assignments.approve(direct.owner.id, directRequest.id)).status, 'Accepted');
      },
    );

    await t.test(
      'Pending intervals reserve a Zone, rejection releases it, accepted adjacent intervals are allowed',
      async () => {
        const f = await fixture(),
          start = new Date(now.getTime() + 60000).toISOString(),
          end = new Date(now.getTime() + 120000).toISOString();
        const attempts = await Promise.allSettled([
          assignments.createRequest(f.owner.id, f.zone.id, {
            user_id: f.worker.id,
            start_date: start,
            end_date: end,
          }),
          assignments.createRequest(admin, f.zone.id, {
            user_id: f.worker.id,
            start_date: start,
            end_date: end,
          }),
        ]);
        assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
        assert.ok(attempts.some((r) => r.status === 'rejected' && status(409)(r.reason)));
        const pending = (
          attempts.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<AssignmentRequest>
        ).value;
        await assignments.reject(f.worker.id, pending.id, 'Đổi lịch');
        const first = await assignments.createRequest(f.owner.id, f.zone.id, {
          user_id: f.worker.id,
          start_date: start,
          end_date: end,
        });
        await assignments.approve(f.worker.id, first.id);
        const second = await assignments.createRequest(f.owner.id, f.zone.id, {
          user_id: f.worker.id,
          start_date: end,
          end_date: null,
        });
        await assignments.approve(f.worker.id, second.id);
        await assert.rejects(
          assignments.createRequest(admin, f.zone.id, {
            user_id: f.worker.id,
            start_date: start,
            end_date: null,
          }),
          status(409),
        );
        await assert.rejects(assignments.assertCanWork(f.worker.id, f.zone.id), status(403));
      },
    );

    await t.test(
      'late acceptance starts at final approval, expired invitation and changed Zone keep signatures uncommitted',
      async () => {
        const f = await fixture(),
          original = now.toISOString(),
          r = await assignments.createRequest(f.owner.id, f.zone.id, {
            user_id: f.worker.id,
            start_date: original,
          });
        now = new Date(now.getTime() + 60000);
        const accepted = await assignments.approve(f.worker.id, r.id);
        assert.equal(
          (await assignments.get(f.worker.id, accepted.assignment_id!)).assignment.start_date,
          now.toISOString(),
        );
        assert.equal(accepted.start_date, original);
        const stale = await fixture(),
          s = await assignments.createRequest(admin, stale.zone.id, { user_id: stale.worker.id });
        await assignments.approve(stale.owner.id, s.id);
        await zones.update(stale.owner.id, stale.zone.id, { zone_name: 'Zone đã sửa' });
        await assert.rejects(assignments.approve(stale.worker.id, s.id), status(409));
        assert.equal((await assignments.getRequest(admin, s.id)).required_approvals[1].approved_at, null);
        const expired = await fixture(),
          e = await assignments.createRequest(expired.owner.id, expired.zone.id, {
            user_id: expired.worker.id,
            end_date: new Date(now.getTime() + 1000).toISOString(),
          });
        now = new Date(now.getTime() + 1000);
        await assert.rejects(assignments.approve(expired.worker.id, e.id), status(409));
        assert.equal((await assignments.getRequest(admin, e.id)).status, 'Pending');
      },
    );

    await t.test(
      'end direct or Admin proposal keeps snapshots/history, locked assignee does not block revocation',
      async () => {
        const f = await fixture(),
          r = await accept(f);
        now = new Date(now.getTime() + 1000);
        await assert.rejects(assignments.end(admin, r.assignment_id!), status(403));
        const ends = await Promise.allSettled([
          assignments.endRequest(admin, r.assignment_id!),
          assignments.endRequest(admin, r.assignment_id!),
        ]);
        assert.equal(ends.filter((e) => e.status === 'fulfilled').length, 1);
        assert.ok(ends.some((e) => e.status === 'rejected' && status(409)(e.reason)));
        const end = (ends.find((e) => e.status === 'fulfilled') as PromiseFulfilledResult<AssignmentRequest>)
          .value;
        await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.worker.id]);
        try {
          assert.equal((await assignments.approve(f.owner.id, end.id)).status, 'Accepted');
        } finally {
          await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [f.worker.id]);
        }
        await assert.rejects(zones.get(f.worker.id, f.zone.id), status(404));
        await assert.rejects(assignments.assertCanWork(f.worker.id, f.zone.id), status(403));
        const history = await assignments.get(f.worker.id, r.assignment_id!);
        assert.equal(history.active, false);
        assert.deepEqual(history.zone_snapshot, f.zone);
        await assert.rejects(assignments.end(f.owner.id, r.assignment_id!), status(409));
        const direct = await fixture(),
          d = await accept(direct);
        now = new Date(now.getTime() + 1000);
        await assignments.end(direct.owner.id, d.assignment_id!);
        assert.equal((await assignments.list(direct.worker.id, new AssignmentListDto(), true)).total, 1);
      },
    );

    await t.test(
      'original assignment controls 15-day correction; new assignment never extends old event rights',
      async () => {
        const f = await fixture(),
          r = await accept(f),
          created = now.toISOString();
        const event = {
          assignment_id: r.assignment_id!,
          zone_id: f.zone.id,
          author_id: f.worker.id,
          created_at: created,
        };
        await assignments.assertCanCorrect(f.worker.id, event);
        now = new Date(now.getTime() + 1000);
        await assignments.end(f.owner.id, r.assignment_id!);
        const ended = now.getTime();
        now = new Date(ended + 15 * 86400000 - 1);
        await assignments.assertCanCorrect(f.worker.id, event);
        now = new Date(ended + 15 * 86400000);
        await assert.rejects(assignments.assertCanCorrect(f.worker.id, event), status(403));
        await accept(f);
        await assignments.assertCanWork(f.worker.id, f.zone.id);
        await assert.rejects(assignments.assertCanCorrect(f.worker.id, event), status(403));
        await assert.rejects(assignments.assertCanCorrect(f.owner.id, event), status(403));
        await assert.rejects(
          assignments.assertCanCorrect(f.worker.id, { ...event, zone_id: randomUUID() }),
          status(403),
        );
        await assert.rejects(
          assignments.assertCanCorrect(f.worker.id, {
            ...event,
            created_at: new Date(ended + 1).toISOString(),
          }),
          status(403),
        );
      },
    );

    await t.test(
      'revoked Owner signature is rechecked before final approval, cancellation remains possible',
      async () => {
        const f = await fixture(),
          r = await assignments.createRequest(admin, f.zone.id, { user_id: f.worker.id });
        await assignments.approve(f.owner.id, r.id);
        await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.owner.id]);
        try {
          await assert.rejects(assignments.approve(f.worker.id, r.id), status(403));
          assert.equal((await assignments.getRequest(admin, r.id)).required_approvals[1].approved_at, null);
          assert.equal((await assignments.reject(admin, r.id)).status, 'Rejected');
        } finally {
          await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [f.owner.id]);
        }
      },
    );

    await t.test('Manager current HTX scope, outside users and mine-only history are enforced', async () => {
      const f = await fixture(),
        r = await accept(f),
        outsider = await farmer();
      const phone = `09000000${next++}`,
        gmail = `assignment-manager${next}@example.invalid`;
      const manager = await users.createRegisteredUser(
        { user_name: 'Manager fixture', phone_number: phone, gmail, passwordHash: hash, role: 'Manager' },
        gmail,
      );
      const c = await registry.approve(admin, manager.user.id, {
        cooperative: {
          cooperative_name: 'HTX fixture',
          director: 'Ban quản trị',
          certificate_number: 'ASSIGNMENT-COOP',
          address: 'Đắk Lắk',
          contact_number: phone,
        },
      });
      await assert.rejects(assignments.get(manager.user.id, r.assignment_id!), status(404));
      const join = await farms.joinRequest(f.owner.id, f.farm, c.cooperative.id);
      await farms.approve(admin, join.id);
      await farms.approve(manager.user.id, join.id);
      assert.equal((await assignments.get(manager.user.id, r.assignment_id!)).assignment.id, r.assignment_id);
      assert.equal((await assignments.getRequest(manager.user.id, r.id)).id, r.id);
      await assert.rejects(assignments.approve(manager.user.id, r.id), status(403));
      await assert.rejects(assignments.get(outsider.id, r.assignment_id!), status(404));
      await assert.rejects(assignments.getRequest(outsider.id, r.id), status(404));
      assert.equal((await assignments.list(f.owner.id, new AssignmentListDto(), true)).total, 0);
      const leave = await farms.leaveRequest(f.owner.id, f.farm);
      await farms.approve(admin, leave.id);
      await assert.rejects(assignments.get(manager.user.id, r.assignment_id!), status(404));
      const page = await assignments.list(
        f.worker.id,
        Object.assign(new AssignmentListDto(), { offset: 1000 }),
        true,
      );
      assert.equal(page.total, 1);
      assert.deepEqual(page.items, []);
      assert.equal(
        (
          await assignments.listRequests(
            f.worker.id,
            Object.assign(new FarmRequestListDto(), { status: 'Accepted' }),
          )
        ).total,
        1,
      );
    });

    await t.test(
      'audit failure rolls back final signature, assignment, metadata and history atomically',
      async () => {
        const f = await fixture(),
          r = await assignments.createRequest(admin, f.zone.id, { user_id: f.worker.id });
        await assignments.approve(f.owner.id, r.id);
        const before = await metadata('assignment_requests', r.id);
        await sql.query(`CREATE FUNCTION technical.fail_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.entity_type='users_zones' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_assignment_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW EXECUTE FUNCTION technical.fail_assignment_audit()`);
        try {
          await assert.rejects(assignments.approve(f.worker.id, r.id), status(503));
          assert.equal(
            (await sql.query('SELECT count(*) FROM public.users_zones WHERE zone_id=$1', [f.zone.id])).rows[0]
              .count,
            '0',
          );
          assert.equal((await assignments.getRequest(admin, r.id)).required_approvals[1].approved_at, null);
          assert.deepEqual(await metadata('assignment_requests', r.id), before);
        } finally {
          await sql.query(
            'DROP TRIGGER fail_assignment_audit ON technical.audit_events; DROP FUNCTION technical.fail_assignment_audit()',
          );
        }
        assert.equal((await assignments.approve(f.worker.id, r.id)).status, 'Accepted');
      },
    );

    await t.test(
      'strict input/canonical IDs and malformed persisted evidence fail closed without fallback',
      async () => {
        const f = await fixture();
        for (const input of [
          { user_id: null },
          { user_id: admin },
          { user_id: f.worker.id, start_date: null },
          { user_id: f.worker.id, start_date: '2026-10-10' },
          { user_id: f.worker.id, owner_id: f.owner.id },
        ]) {
          await assert.rejects(
            assignments.createRequest(f.owner.id, f.zone.id, input as never),
            status(input.user_id === admin ? 403 : 400),
          );
        }
        const r = await assignments.createRequest(f.owner.id.toUpperCase(), f.zone.id.toUpperCase(), {
          user_id: f.worker.id.toUpperCase(),
        });
        const accepted = await assignments.approve(f.worker.id.toUpperCase(), r.id.toUpperCase());
        assert.equal(accepted.user_id, f.worker.id);
        assert.equal(await metadata('assignment_requests', r.id.toUpperCase()), undefined);
        const saved = await metadata('users_zones', accepted.assignment_id!);
        await sql.query(
          "UPDATE technical.entity_metadata SET data=jsonb_set(data,'{accepted_at}','\"invalid\"') WHERE entity_type='users_zones' AND entity_key=$1",
          [accepted.assignment_id],
        );
        try {
          await assert.rejects(assignments.get(f.worker.id, accepted.assignment_id!), status(503));
          await assert.rejects(assignments.assertCanWork(f.worker.id, f.zone.id), status(503));
          await assert.rejects(zones.get(f.worker.id, f.zone.id), status(404));
        } finally {
          await sql.query(
            "UPDATE technical.entity_metadata SET data=$2 WHERE entity_type='users_zones' AND entity_key=$1",
            [accepted.assignment_id, JSON.stringify(saved.data)],
          );
        }
        const nextFixture = await fixture(),
          p = await assignments.createRequest(nextFixture.owner.id, nextFixture.zone.id, {
            user_id: nextFixture.worker.id,
          });
        await sql.query(
          "UPDATE technical.entity_metadata SET version=9007199254740991 WHERE entity_type='assignment_requests' AND entity_key=$1",
          [p.id],
        );
        await assert.rejects(assignments.approve(nextFixture.worker.id, p.id), status(503));
        assert.equal((await assignments.getRequest(admin, p.id)).status, 'Pending');
      },
    );

    await t.test(
      'scheduled [start,end) rights and multiple Zones use live clock, while history snapshot remains original',
      async () => {
        const f = await fixture(),
          start = new Date(now.getTime() + 60000).toISOString(),
          end = new Date(now.getTime() + 120000).toISOString();
        const zone2 = await zones.create(f.owner.id, {
          farm_id: f.farm,
          standard_id: standard.id,
          zone_name: 'Khu thứ hai',
          area_size: 0.2,
          longitude: 108,
          latitude: 12,
        });
        const r = await assignments.createRequest(f.owner.id, f.zone.id, {
          user_id: f.worker.id,
          start_date: start,
          end_date: end,
        });
        const first = await assignments.approve(f.worker.id, r.id);
        const other = await assignments.createRequest(f.owner.id, zone2.id, {
          user_id: f.worker.id,
          start_date: start,
        });
        await assignments.approve(f.worker.id, other.id);
        await assert.rejects(assignments.end(f.owner.id, first.assignment_id!), status(409));
        await assert.rejects(assignments.assertCanWork(f.worker.id, f.zone.id), status(403));
        now = new Date(start);
        await assignments.assertCanWork(f.worker.id, f.zone.id);
        await assignments.assertCanWork(f.worker.id, zone2.id);
        await zones.update(f.owner.id, f.zone.id, { zone_name: 'Tên Zone hiện tại' });
        assert.equal(
          (await assignments.get(f.worker.id, first.assignment_id!)).zone_snapshot.zone_name,
          f.zone.zone_name,
        );
        now = new Date(end);
        await assert.rejects(assignments.assertCanWork(f.worker.id, f.zone.id), status(403));
        await assignments.assertCanWork(f.worker.id, zone2.id);
        assert.equal((await assignments.get(f.worker.id, first.assignment_id!)).active, false);
      },
    );

    await t.test(
      'approval waiting for assignee lock rechecks revocation without committing a signature',
      async () => {
        const f = await fixture(),
          r = await assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id });
        const waitingPool = new Pool({
          connectionString: `${postgresBase}/${name}`,
          max: 1,
          application_name: 'assignment-revocation-fixture',
          connectionTimeoutMillis: 5000,
        });
        const blocker = await sql.connect();
        let done: Promise<PromiseSettledResult<unknown>> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query("UPDATE public.users SET status='Locked' WHERE id=$1", [f.worker.id]);
          const repository = new PostgresAssignmentsRepository(
            waitingPool,
            new PostgresUsersRepository(waitingPool),
            farms,
            zones,
            () => now,
          );
          done = repository.approve(f.worker.id, r.id).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason) => ({ status: 'rejected' as const, reason }),
          );
          let blocked = false;
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            blocked = Boolean(
              (
                await sql.query(
                  "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='assignment-revocation-fixture' AND wait_event_type='Lock'",
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
          assert.equal((await assignments.getRequest(admin, r.id)).required_approvals[0].approved_at, null);
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await done;
          await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [f.worker.id]);
          await waitingPool.end();
        }
      },
    );

    await t.test(
      'fresh HTTP app/pool restores partial signature, final accepted state and ended history',
      async () => {
        now = new Date(); // HTTP dùng clock thật; các cases deadline phía trên dùng clock fixture.
        const f = await fixture(),
          r = await assignments.createRequest(admin, f.zone.id, { user_id: f.worker.id });
        await assignments.approve(f.owner.id, r.id);
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
          assert.equal((await http('zone-assignments')).status, 401);
          const owner = await login(f.owner.phone);
          assert.equal(
            (
              await http(
                `zones/${f.zone.id}/assignment-requests`,
                'POST',
                { user_id: f.worker.id, approved_at: now.toISOString() },
                owner,
              )
            ).status,
            400,
          );
          await app.close();
          freshPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 5,
            connectionTimeoutMillis: 5000,
          });
          app = await application(freshPool);
          assert.equal(app.get(MockZoneAssignmentStore).list().length, 0);
          const token = await login(f.worker.phone),
            pending = await http(`assignment-requests/${r.id}`, 'GET', undefined, token);
          assert.equal(
            ((await pending.json()) as AssignmentRequest).required_approvals[0].user_id,
            f.owner.id,
          );
          const response = await http(`assignment-requests/${r.id}/approve`, 'PATCH', {}, token);
          assert.equal(response.status, 200);
          const accepted = (await response.json()) as AssignmentRequest;
          assert.equal((await http(`zones/${f.zone.id}`, 'GET', undefined, token)).status, 200);
          assert.equal(
            (
              await http(
                `zone-assignments/${accepted.assignment_id}/end`,
                'PATCH',
                {},
                await login(f.owner.phone),
              )
            ).status,
            200,
          );
          await app.close();
          app = await application(freshPool);
          const history = await http(
            `zone-assignments/${accepted.assignment_id}`,
            'GET',
            undefined,
            await login(f.worker.phone),
          );
          assert.equal(history.status, 200);
          assert.equal(((await history.json()) as { active: boolean }).active, false);
          assert.equal(
            (await http(`zones/${f.zone.id}`, 'GET', undefined, await login(f.worker.phone))).status,
            404,
          );
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
