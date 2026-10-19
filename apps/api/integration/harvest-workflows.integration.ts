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
import { TreeHarvestsModule } from '../src/tree-harvests/tree-harvests.module';
import { TreeHarvestsService } from '../src/tree-harvests/tree-harvests.service';
import { HarvestRecords } from '../src/tree-harvests/harvest-records';
import { HarvestListDto, HarvestRequestListDto } from '../src/tree-harvests/tree-harvests.dto';
import { TestTreeHarvest } from '../src/tree-harvests/tree-harvests.types';
import { FarmPageDto } from '../src/farms/farms.dto';
import { vietnamToday } from '../src/tree-harvests/harvest-date-policy';
import { PostgresUsersRepository } from '../src/persistence/postgres-users.repository';
import { PostgresUserManagement } from '../src/persistence/postgres-user-management';
import { PostgresCooperativesRepository } from '../src/persistence/postgres-cooperatives.repository';
import { PostgresCatalogRepository } from '../src/persistence/postgres-catalog.repository';
import { PostgresFarmsRepository } from '../src/persistence/postgres-farms.repository';
import { PostgresZonesRepository } from '../src/persistence/postgres-zones.repository';
import { PostgresAssignmentsRepository } from '../src/persistence/postgres-assignments.repository';
import { PostgresTreesRepository } from '../src/persistence/postgres-trees.repository';
import { PostgresHarvestsRepository } from '../src/persistence/postgres-harvests.repository';
import { MIGRATIONS, runMigrations } from '../src/persistence/migrations';
import { seedDemo } from '../src/persistence/seed';
import { readSeedConfig } from '../src/persistence/seed-config';

const postgresBase = 'postgresql://persistence_test:persistence_test_only@127.0.0.1:15432';
const mongoUri = 'mongodb://127.0.0.1:27028/?replicaSet=rs-test&directConnection=true';
const config = {
  mode: 'mock' as const,
  phoneNumber: '0900000000',
  password: 'HarvestFixturePassword!',
  jwtSecret: 'harvest-fixture-secret-at-least-32-bytes',
  sms: { provider: 'mock' as const },
  admin: { phoneNumber: '0900000001', password: 'HarvestAdminFixture!' },
};
const status = (code: number) => (error: unknown) =>
  error instanceof HttpException && error.getStatus() === code;

async function application(pool: Pool): Promise<INestApplication> {
  const users = new PostgresUsersRepository(pool),
    farms = new PostgresFarmsRepository(pool, users),
    catalogs = new PostgresCatalogRepository(pool, users),
    registry = new PostgresCooperativesRepository(pool, users);
  const zones = new PostgresZonesRepository(pool, users, farms, catalogs),
    trees = new PostgresTreesRepository(pool, users, farms, zones),
    assignments = new PostgresAssignmentsRepository(pool, users, farms, zones);
  const auth = AuthModule.forMock(config),
    userModule = UsersModule.forMock(config, auth),
    farmModule = FarmsModule.forMock(auth, userModule),
    zoneModule = ZonesModule.forMock(auth, farmModule, StandardsModule.forMock(auth)),
    treeModule = TreesModule.forMock(auth, farmModule, zoneModule);
  const module = await Test.createTestingModule({
    imports: [TreeHarvestsModule.forMock(auth, userModule, farmModule, zoneModule, treeModule)],
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
    .useValue(trees)
    .overrideProvider(HarvestRecords)
    .useValue(new PostgresHarvestsRepository(pool, users, farms, zones, trees, assignments))
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

test('PostgreSQL Harvest durable review/backdates, batch locks, approved trace and correction date policy', async (t) => {
  const name = `sdf_persistence_test_${randomUUID().replaceAll('-', '')}`,
    adminPool = new Pool({
      connectionString: `${postgresBase}/sdf_persistence_test`,
      connectionTimeoutMillis: 5000,
    }),
    mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  let pool: Pool | undefined,
    created = false;
  try {
    await adminPool.query(`CREATE DATABASE "${name}"`);
    created = true;
    pool = new Pool({ connectionString: `${postgresBase}/${name}`, max: 10, connectionTimeoutMillis: 5000 });
    const sql = pool;
    await mongo.connect();
    await t.test(
      'migration010 rejects duplicate Pending Harvest keys including case, keeps rows/old ledger',
      async () => {
        await runMigrations(sql, mongo.db(name), MIGRATIONS.slice(0, 9));
        const u = (
          await sql.query(
            `INSERT INTO public.users(user_name,phone_number,password,role,status) VALUES ('Migration fixture','0900000087','unused-fixture','Farmer','Active') RETURNING id`,
          )
        ).rows[0].id;
        const rows = await sql.query(
          `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at) VALUES ('harvests','Confirm','Pending',$1,$2,'{}',now()),('harvests','Correct','Pending',upper($1),$2,'{}',now()) RETURNING id`,
          [randomUUID(), u],
        );
        await assert.rejects(
          runMigrations(sql, mongo.db(name)),
          (e: unknown) => (e as { code: string }).code === '23505',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.schema_migrations')).rows[0].count,
          '9',
        );
        assert.equal(
          (await sql.query('SELECT count(*) FROM technical.workflow_requests')).rows[0].count,
          '2',
        );
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[1].id]);
        assert.deepEqual(await runMigrations(sql, mongo.db(name)), ['010_harvest_workflow', '011_device_workflow', '012_sensor_workflow']);
        await sql.query('DELETE FROM technical.workflow_requests WHERE id=$1', [rows.rows[0].id]);
        await sql.query('DELETE FROM public.users WHERE id=$1', [u]);
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
        DEMO_DEVICE_STATION_ID: 'HARVEST_TEST_ESP32',
        DEMO_DEVICE_INSTALLED_AT: '2026-09-01T08:30:00+07:00',
        DEMO_DEVICE_COST: '10237500',
      }),
    );
    let now = new Date();
    const day = (before = 0) =>
      new Date(Date.parse(vietnamToday(now.getTime()) + 'T00:00:00Z') - before * 86400000)
        .toISOString()
        .slice(0, 10);
    const users = new PostgresUsersRepository(sql),
      farms = new PostgresFarmsRepository(sql, users, () => now),
      catalogs = new PostgresCatalogRepository(sql, users, () => now),
      zones = new PostgresZonesRepository(sql, users, farms, catalogs, () => now),
      trees = new PostgresTreesRepository(sql, users, farms, zones, () => now),
      assignments = new PostgresAssignmentsRepository(sql, users, farms, zones, () => now),
      registry = new PostgresCooperativesRepository(sql, users, () => now);
    const harvests = new PostgresHarvestsRepository(sql, users, farms, zones, trees, assignments, () => now),
      admin = (await users.loadByPhone(config.admin.phoneNumber))!.user.id,
      hash = (await users.loadById(admin))!.user.password;
    let n = 10,
      batch = 0;
    const farmer = async () => {
      const phone = `0900000${String(n++).padStart(3, '0')}`,
        u = await users.createRegisteredUser({
          user_name: 'Farmer fixture',
          phone_number: phone,
          gmail: null,
          passwordHash: hash,
          role: 'Farmer',
        });
      return { id: u.user.id, phone };
    };
    const standard = await catalogs.standards.create(admin, {
      code: 'HARVEST-STD',
      name: 'VietGAP fixture',
      description: '',
      certifying_body: 'Fixture',
    });
    const treeInput = {
      variety: 'Ri6',
      plant_date: '2024-05-01T08:00:00+07:00',
      longitude: 108,
      latitude: 12,
    };
    const fixture = async () => {
      const owner = await farmer(),
        worker = await farmer(),
        r = await farms.createRequest(owner.id, {
          area_size: 1,
          address: 'Vườn Đắk Lắk',
          certificate_number: 'HARVEST-FIXTURE',
          longitude: 108,
          latitude: 12,
        });
      const farm = (await farms.approve(admin, r.id)).farm_id!,
        zone = await zones.create(owner.id, {
          farm_id: farm,
          standard_id: standard.id,
          zone_name: 'Khu thu hoạch',
          area_size: 0.3,
          longitude: 108,
          latitude: 12,
        }),
        tree = await trees.create(owner.id, { zone_id: zone.id, ...treeInput });
      return {
        owner,
        worker,
        farm,
        zone,
        tree,
        input: {
          tree_id: tree.id,
          season_name: 'Vụ chính',
          harvest_date: day(),
          fruit_count: 10,
          total_weight_kg: 30.5,
          batch_code: `HARVEST-${batch++}`,
        },
      };
    };
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const assign = async (f: Fixture) =>
      assignments.approve(
        f.worker.id,
        (await assignments.createRequest(f.owner.id, f.zone.id, { user_id: f.worker.id })).id,
      );
    const confirmed = async (f: Fixture) =>
      harvests.submit(f.owner.id, (await harvests.create(f.owner.id, f.input)).id);
    const meta = async (type: string, id: string) =>
      (
        await sql.query(
          'SELECT version,data FROM technical.entity_metadata WHERE entity_type=$1 AND entity_key=$2',
          [type, id],
        )
      ).rows[0];
    const cooperative = async () => {
      const phone = `0900000${String(n++).padStart(3, '0')}`,
        gmail = `harvest-manager${n}@example.invalid`,
        u = await users.createRegisteredUser(
          { user_name: 'Manager fixture', phone_number: phone, gmail, passwordHash: hash, role: 'Manager' },
          gmail,
        );
      const c = await registry.approve(admin, u.user.id, {
        cooperative: {
          cooperative_name: 'HTX thu hoạch',
          director: 'Ban quản trị',
          certificate_number: `HARVEST-COOP-${n}`,
          address: 'Đắk Lắk',
          contact_number: phone,
        },
      });
      return { id: c.cooperative.id, manager: u.user.id };
    };

    await t.test(
      'owner Draft edits keep update fields null, submit auto-confirms one record and trace whitelists fields',
      async () => {
        const f = await fixture(),
          record = await harvests.create(f.owner.id, f.input);
        assert.equal(record.status, 'Draft');
        assert.equal(record.harvest_date, day());
        assert.equal(record.updated_by, null);
        const edit = await harvests.updateDraft(f.owner.id, record.id, {
          fruit_count: 11,
          total_weight_kg: 33.25,
        });
        assert.equal(edit.updated_at, null);
        assert.deepEqual(await harvests.confirmedForTrace(f.tree.id), []);
        const accepted = await harvests.submit(f.owner.id, record.id);
        assert.equal(accepted.status, 'Confirmed');
        assert.equal(accepted.updated_by, null);
        assert.equal(accepted.updated_at, null);
        const trace = await harvests.confirmedForTrace(f.tree.id);
        assert.deepEqual(
          Object.keys(trace[0]).sort(),
          ['season_name', 'harvest_date', 'fruit_count', 'total_weight_kg', 'batch_code'].sort(),
        );
        assert.equal(trace[0].total_weight_kg, 33.25);
        await assert.rejects(harvests.updateDraft(f.owner.id, record.id, { fruit_count: 12 }), status(409));
        await assert.rejects(harvests.removeDraft(f.owner.id, record.id), status(409));
      },
    );
    await t.test(
      'Assigned author submits, owner confirms once; first Pending never public, other actors cannot submit',
      async () => {
        const f = await fixture();
        await assign(f);
        const record = await harvests.create(f.worker.id, f.input);
        await assert.rejects(harvests.submit(f.owner.id, record.id), status(403));
        await harvests.submit(f.worker.id, record.id);
        assert.deepEqual(await harvests.confirmedForTrace(f.tree.id), []);
        const r = (
          await harvests.listRequests(
            f.owner.id,
            Object.assign(new HarvestRequestListDto(), { harvest_id: record.id }),
          )
        ).items[0];
        await assert.rejects(harvests.approve(admin, r.id), status(403));
        const results = await Promise.allSettled([
          harvests.approve(f.owner.id, r.id),
          harvests.approve(f.owner.id, r.id),
        ]);
        assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
        assert.ok(results.some((x) => x.status === 'rejected' && status(409)(x.reason)));
        const saved = await harvests.get(f.worker.id, record.id);
        assert.equal(saved.status, 'Confirmed');
        assert.equal(saved.updated_at, null);
        assert.equal((await harvests.confirmedForTrace(f.tree.id)).length, 1);
      },
    );
    await t.test(
      'tree/day duplicates conflict, same Zone/day shares non-unique batch, confirmed row does not seal entire batch',
      async () => {
        const f = await fixture(),
          record = await confirmed(f),
          other = await trees.create(f.owner.id, { zone_id: f.zone.id, ...treeInput });
        const second = await harvests.create(f.owner.id, { ...f.input, tree_id: other.id });
        assert.equal(second.batch_code, record.batch_code);
        await assert.rejects(
          harvests.create(f.owner.id, { ...f.input, batch_code: 'DIFFERENT' }),
          status(409),
        );
        await assert.rejects(
          harvests.create(f.owner.id, { ...f.input, tree_id: other.id, harvest_date: day(1) }),
          status(409),
        );
        const differentDay = await harvests.create(f.owner.id, {
          ...f.input,
          harvest_date: day(1),
          batch_code: 'DIFFERENT-DAY',
        });
        assert.notEqual(differentDay.id, record.id);
      },
    );
    await t.test(
      'concurrent same tree/day writes and cross-Zone shared batch serialize to one valid winner',
      async () => {
        const f = await fixture(),
          same = await Promise.allSettled([
            harvests.create(f.owner.id, f.input),
            harvests.create(f.owner.id, f.input),
          ]);
        assert.equal(same.filter((x) => x.status === 'fulfilled').length, 1);
        assert.ok(same.some((x) => x.status === 'rejected' && status(409)(x.reason)));
        const a = await fixture(),
          b = await fixture(),
          code = `SHARED-${batch++}`;
        const cross = await Promise.allSettled([
          harvests.create(a.owner.id, { ...a.input, batch_code: code }),
          harvests.create(b.owner.id, { ...b.input, batch_code: code }),
        ]);
        assert.equal(cross.filter((x) => x.status === 'fulfilled').length, 1);
        assert.ok(cross.some((x) => x.status === 'rejected' && status(409)(x.reason)));
        assert.equal(
          (
            await sql.query(
              'SELECT count(DISTINCT t.zone_id) FROM public.tree_harvests h JOIN public.trees t ON t.id=h.tree_id WHERE h.batch_code=$1',
              [code],
            )
          ).rows[0].count,
          '1',
        );
      },
    );
    await t.test(
      'Pending correction preserves approved contents, independent Farm Admin applies actual editor/time once',
      async () => {
        const f = await fixture(),
          record = await confirmed(f),
          r = await harvests.correction(f.owner.id, record.id, {
            reason: 'Cân lại',
            changes: { total_weight_kg: 36.75 },
          });
        assert.equal((await harvests.get(f.owner.id, record.id)).status, 'Pending');
        assert.equal((await harvests.get(f.owner.id, record.id)).total_weight_kg, 30.5);
        assert.equal((await harvests.confirmedForTrace(f.tree.id))[0].total_weight_kg, 30.5);
        await assert.rejects(harvests.approve(f.owner.id, r.id), status(403));
        await assert.rejects(harvests.removeDraft(f.owner.id, record.id), status(409));
        await harvests.approve(admin, r.id);
        const corrected = await harvests.get(f.owner.id, record.id);
        assert.equal(corrected.status, 'Confirmed');
        assert.equal(corrected.updated_by, f.owner.id);
        assert.equal(corrected.updated_at, now.toISOString());
        assert.equal(corrected.created_at, record.created_at);
        assert.equal((await harvests.confirmedForTrace(f.tree.id))[0].total_weight_kg, 36.75);
        const reject = await harvests.correction(f.owner.id, record.id, {
          reason: 'Hủy sửa',
          changes: { fruit_count: 99 },
        });
        await harvests.reject(f.owner.id, reject.id);
        assert.deepEqual(await harvests.get(f.owner.id, record.id), corrected);
      },
    );
    await t.test(
      'former author reads own history/reason only; owner prepares and Admin applies, without 15-day Cultivation policy',
      async () => {
        const f = await fixture(),
          a = await assign(f),
          record = await harvests.create(f.worker.id, f.input);
        await harvests.submit(f.worker.id, record.id);
        const confirm = (
          await harvests.listRequests(
            f.owner.id,
            Object.assign(new HarvestRequestListDto(), { harvest_id: record.id }),
          )
        ).items[0];
        await harvests.approve(f.owner.id, confirm.id);
        now = new Date(now.getTime() + 1000);
        await assignments.end(f.owner.id, a.assignment_id!);
        await assert.rejects(zones.get(f.worker.id, f.zone.id), status(404));
        assert.equal((await harvests.get(f.worker.id, record.id)).id, record.id);
        await assert.rejects(
          harvests.correction(f.worker.id, record.id, { reason: 'Sai', changes: { fruit_count: 20 } }),
          status(403),
        );
        const r = await harvests.correction(f.worker.id, record.id, { reason: 'Nhờ chủ sửa' });
        await assert.rejects(harvests.approve(admin, r.id), status(409));
        await harvests.prepareCorrection(f.owner.id, r.id, { fruit_count: 20 });
        await harvests.approve(admin, r.id);
        assert.equal((await harvests.get(f.worker.id, record.id)).updated_by, f.owner.id);
        assert.equal((await harvests.getRequest(f.worker.id, r.id)).requested_by, f.worker.id);
      },
    );
    await t.test(
      'Manager reviews only current HTX; membership change leaves proposal stale and safely withdrawable',
      async () => {
        const f = await fixture(),
          record = await confirmed(f),
          c = await cooperative(),
          join = await farms.joinRequest(f.owner.id, f.farm, c.id);
        await farms.approve(admin, join.id);
        await farms.approve(c.manager, join.id);
        const r = await harvests.correction(f.owner.id, record.id, {
          reason: 'Chỉnh số',
          changes: { fruit_count: 12 },
        });
        await assert.rejects(harvests.approve(admin, r.id), status(403));
        await harvests.approve(c.manager, r.id);
        const stale = await harvests.correction(f.owner.id, record.id, {
            reason: 'Chờ sửa',
            changes: { fruit_count: 13 },
          }),
          leave = await farms.leaveRequest(f.owner.id, f.farm);
        await farms.approve(admin, leave.id);
        await assert.rejects(harvests.get(c.manager, record.id), status(404));
        await assert.rejects(harvests.approve(admin, stale.id), status(409));
        await harvests.reject(f.owner.id, stale.id);
        assert.equal((await harvests.get(f.owner.id, record.id)).fruit_count, 12);
      },
    );
    await t.test(
      'backdate7-day boundary, exact user/Zone/day grants, expiry/revocation and current Admin role are enforced',
      async () => {
        const f = await fixture();
        await harvests.create(f.owner.id, { ...f.input, harvest_date: day(7) });
        await assert.rejects(
          harvests.create(f.owner.id, { ...f.input, harvest_date: day(8), batch_code: 'BACKDATE' }),
          status(403),
        );
        const p = await harvests.grantBackdate(admin, {
          user_id: f.owner.id,
          zone_id: f.zone.id,
          harvest_date: day(8),
          expires_at: new Date(now.getTime() + 60000).toISOString(),
          reason: 'Nhập dữ liệu cũ',
        });
        const backdated = await harvests.create(f.owner.id, {
          ...f.input,
          harvest_date: day(8),
          batch_code: 'BACKDATE',
        });
        assert.equal(backdated.harvest_date, day(8));
        await assign(f);
        const wrongUserTree = await trees.create(f.owner.id, { zone_id: f.zone.id, ...treeInput });
        await assert.rejects(
          harvests.create(f.worker.id, {
            ...f.input,
            tree_id: wrongUserTree.id,
            harvest_date: day(8),
            batch_code: 'BACKDATE',
          }),
          status(403),
        );
        await assert.rejects(
          harvests.create(f.owner.id, {
            ...f.input,
            tree_id: wrongUserTree.id,
            harvest_date: day(9),
            batch_code: 'WRONG-DAY',
          }),
          status(403),
        );
        const otherZone = await zones.create(f.owner.id, {
          farm_id: f.farm,
          standard_id: standard.id,
          zone_name: 'Khu khác',
          area_size: 0.2,
          longitude: 108,
          latitude: 12,
        });
        const wrongZoneTree = await trees.create(f.owner.id, { zone_id: otherZone.id, ...treeInput });
        await assert.rejects(
          harvests.create(f.owner.id, {
            ...f.input,
            tree_id: wrongZoneTree.id,
            harvest_date: day(8),
            batch_code: 'WRONG-ZONE',
          }),
          status(403),
        );
        await harvests.revokeBackdate(admin, p.id);
        const tree = await trees.create(f.owner.id, { zone_id: f.zone.id, ...treeInput });
        await assert.rejects(
          harvests.create(f.owner.id, {
            ...f.input,
            tree_id: tree.id,
            harvest_date: day(8),
            batch_code: 'BACKDATE',
          }),
          status(403),
        );
        await assert.rejects(harvests.revokeBackdate(admin, p.id), status(409));
        assert.equal((await harvests.listBackdates(f.owner.id, new FarmPageDto())).total, 1);
        const next = await harvests.grantBackdate(admin, {
          user_id: f.owner.id,
          zone_id: f.zone.id,
          harvest_date: day(9),
          expires_at: new Date(now.getTime() + 1000).toISOString(),
          reason: 'Hết hạn',
        });
        now = new Date(now.getTime() + 1000);
        await assert.rejects(
          harvests.create(f.owner.id, { ...f.input, harvest_date: next.harvest_date, batch_code: 'EXPIRED' }),
          status(403),
        );
        const alive = await harvests.grantBackdate(admin, {
          user_id: f.owner.id,
          zone_id: f.zone.id,
          harvest_date: day(10),
          expires_at: new Date(now.getTime() + 60000).toISOString(),
          reason: 'Kiểm tra grantor',
        });
        await sql.query("UPDATE public.users SET status='Locked' WHERE id=$1", [admin]);
        try {
          await assert.rejects(
            harvests.create(f.owner.id, {
              ...f.input,
              harvest_date: alive.harvest_date,
              batch_code: 'LOCKED-GRANTOR',
            }),
            status(403),
          );
        } finally {
          await sql.query("UPDATE public.users SET status='Active' WHERE id=$1", [admin]);
        }
        await sql.query("UPDATE public.users SET role='Farmer' WHERE id=$1", [admin]);
        try {
          await assert.rejects(
            harvests.create(f.owner.id, {
              ...f.input,
              harvest_date: alive.harvest_date,
              batch_code: 'WRONG-GRANTOR-ROLE',
            }),
            status(403),
          );
        } finally {
          await sql.query("UPDATE public.users SET role='Admin' WHERE id=$1", [admin]);
        }
      },
    );
    await t.test(
      'changing an old date rechecks editor backdate grant at apply; unchanged content/date does not need renewed grant',
      async () => {
        const f = await fixture(),
          record = await confirmed(f),
          p = await harvests.grantBackdate(admin, {
            user_id: f.owner.id,
            zone_id: f.zone.id,
            harvest_date: day(8),
            expires_at: new Date(now.getTime() + 60000).toISOString(),
            reason: 'Sửa ngày',
          });
        const r = await harvests.correction(f.owner.id, record.id, {
          reason: 'Đổi ngày',
          changes: { harvest_date: p.harvest_date, batch_code: 'OLDER-DAY' },
        });
        await harvests.revokeBackdate(admin, p.id);
        await assert.rejects(harvests.approve(admin, r.id), status(403));
        assert.equal((await harvests.get(f.owner.id, record.id)).harvest_date, record.harvest_date);
        await harvests.reject(f.owner.id, r.id);
        const active = await harvests.correction(f.owner.id, record.id, {
          reason: 'Sửa cân',
          changes: { total_weight_kg: 31 },
        });
        now = new Date(now.getTime() + 9 * 86400000);
        await harvests.approve(admin, active.id);
        assert.equal((await harvests.get(f.owner.id, record.id)).total_weight_kg, 31);
      },
    );
    await t.test(
      'Dead/Removed date-change blocked at propose/prepare/apply, stored same day remains editable even today',
      async () => {
        for (const treeStatus of ['Dead', 'Removed'] as const) {
          const f = await fixture(),
            record = await harvests.create(f.owner.id, { ...f.input, harvest_date: day(1) });
          await harvests.submit(f.owner.id, record.id);
          await trees.update(f.owner.id, f.tree.id, { status: treeStatus });
          const change = { harvest_date: day(), batch_code: `TODAY-${batch++}` };
          await assert.rejects(
            harvests.correction(f.owner.id, record.id, { reason: 'Đổi ngày', changes: change }),
            status(400),
          );
          const pending = await harvests.correction(f.owner.id, record.id, { reason: 'Chuẩn bị sau' });
          await assert.rejects(harvests.prepareCorrection(f.owner.id, pending.id, change), status(400));
          await harvests.reject(f.owner.id, pending.id);
          await trees.update(f.owner.id, f.tree.id, { status: 'Active' });
          const beforeDead = await harvests.correction(f.owner.id, record.id, {
            reason: 'Còn Active lúc đề xuất',
            changes: change,
          });
          await trees.update(f.owner.id, f.tree.id, { status: treeStatus });
          await assert.rejects(harvests.approve(admin, beforeDead.id), status(400));
          await harvests.reject(f.owner.id, beforeDead.id);
          const other = await trees.create(f.owner.id, { zone_id: f.zone.id, ...treeInput }),
            current = await harvests.create(f.owner.id, {
              ...f.input,
              tree_id: other.id,
              batch_code: `CURRENT-${batch++}`,
            });
          await harvests.submit(f.owner.id, current.id);
          await trees.update(f.owner.id, other.id, { status: treeStatus });
          const keep = await harvests.correction(f.owner.id, current.id, {
            reason: 'Giữ ngày',
            changes: { harvest_date: day(), fruit_count: 12 },
          });
          await harvests.approve(admin, keep.id);
          assert.equal((await harvests.get(f.owner.id, current.id)).harvest_date, day());
          assert.equal((await harvests.get(f.owner.id, current.id)).fruit_count, 12);
        }
      },
    );
    await t.test(
      'only never-confirmed Draft deletes; rejected Confirm request history survives main row deletion',
      async () => {
        const f = await fixture();
        await assign(f);
        const record = await harvests.create(f.worker.id, f.input);
        await harvests.submit(f.worker.id, record.id);
        const r = (
          await harvests.listRequests(
            f.owner.id,
            Object.assign(new HarvestRequestListDto(), { harvest_id: record.id }),
          )
        ).items[0];
        await assert.rejects(harvests.removeDraft(f.owner.id, record.id), status(409));
        await harvests.reject(f.owner.id, r.id);
        assert.equal((await harvests.removeDraft(f.owner.id, record.id)).deleted, true);
        await assert.rejects(harvests.get(f.owner.id, record.id), status(404));
        assert.equal((await harvests.getRequest(f.worker.id, r.id)).status, 'Rejected');
        assert.equal(
          (
            await harvests.listRequests(
              f.owner.id,
              Object.assign(new HarvestRequestListDto(), { harvest_id: record.id }),
            )
          ).total,
          1,
        );
        await assert.rejects(harvests.approve(f.owner.id, r.id), status(409));
        await assert.rejects(harvests.reject(f.owner.id, r.id), status(409));
      },
    );
    await t.test(
      'correction approval rechecks tree/day and batch conflicts introduced after proposal',
      async () => {
        const f = await fixture(),
          record = await confirmed(f),
          r = await harvests.correction(f.owner.id, record.id, {
            reason: 'Đổi ngày',
            changes: { harvest_date: day(1), batch_code: 'CONFLICT-AT-APPROVAL' },
          });
        await harvests.create(f.owner.id, {
          ...f.input,
          harvest_date: day(1),
          batch_code: 'CONFLICT-AT-APPROVAL',
        });
        await assert.rejects(harvests.approve(admin, r.id), status(409));
        assert.equal((await harvests.getRequest(f.owner.id, r.id)).status, 'Pending');
        await harvests.reject(f.owner.id, r.id);
        assert.equal((await harvests.get(f.owner.id, record.id)).harvest_date, record.harvest_date);
      },
    );
    await t.test(
      'audit failure rolls back record/version/review terminal and preserves public approved contents',
      async () => {
        const f = await fixture(),
          record = await confirmed(f),
          r = await harvests.correction(f.owner.id, record.id, {
            reason: 'Rollback',
            changes: { fruit_count: 22 },
          }),
          before = await meta('tree_harvests', record.id);
        await sql.query(
          `CREATE FUNCTION technical.fail_harvest_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='tree_harvests' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_harvest_audit BEFORE INSERT ON technical.audit_events FOR EACH ROW EXECUTE FUNCTION technical.fail_harvest_audit()`,
        );
        try {
          await assert.rejects(harvests.approve(admin, r.id), status(503));
          assert.equal((await harvests.getRequest(f.owner.id, r.id)).status, 'Pending');
          assert.equal((await harvests.get(f.owner.id, record.id)).fruit_count, 10);
          assert.deepEqual(await meta('tree_harvests', record.id), before);
          assert.equal((await harvests.confirmedForTrace(f.tree.id))[0].fruit_count, 10);
        } finally {
          await sql.query(
            'DROP TRIGGER fail_harvest_audit ON technical.audit_events; DROP FUNCTION technical.fail_harvest_audit()',
          );
        }
        await harvests.approve(admin, r.id);
        assert.equal((await harvests.get(f.owner.id, record.id)).fruit_count, 22);
      },
    );
    await t.test(
      'strict DTO/null/immutable IDs/no-op/precision/canonical UUID and scoped offset totals work',
      async () => {
        const f = await fixture(),
          record = await harvests.create(f.owner.id.toUpperCase(), {
            ...f.input,
            tree_id: f.tree.id.toUpperCase(),
          });
        for (const input of [
          { tree_id: f.tree.id },
          { created_by: f.owner.id },
          { status: 'Confirmed' },
          { fruit_count: 0 },
          { total_weight_kg: 1.001 },
          { batch_code: null },
          { harvest_date: '2026-02-30' },
          { updated_at: now.toISOString() },
        ]) {
          await assert.rejects(harvests.updateDraft(f.owner.id, record.id, input as never), status(400));
        }
        await assert.rejects(harvests.updateDraft(f.owner.id, record.id, {}), status(400));
        await assert.rejects(harvests.updateDraft(f.owner.id, record.id, { fruit_count: 10 }), status(400));
        await harvests.updateDraft(f.owner.id, record.id, { season_name: "VỤ 100%_O'Brien" });
        const page = await harvests.list(
          f.owner.id,
          Object.assign(new HarvestListDto(), { q: "%_o'BRIEN", offset: 1000 }),
        );
        assert.equal(page.total, 1);
        assert.deepEqual(page.items, []);
        await assert.rejects(harvests.get(f.worker.id, record.id), status(404));
        assert.equal(await meta('tree_harvests', record.id.toUpperCase()), undefined);
      },
    );
    await t.test(
      'DATE projection survives session timezone change without shifting the business day',
      async () => {
        const f = await fixture(),
          record = await harvests.create(f.owner.id, f.input),
          client = await sql.connect();
        try {
          await client.query('BEGIN');
          await client.query("SET LOCAL TIME ZONE 'Pacific/Kiritimati'");
          assert.equal(
            (await harvests.loadOnClient(client, record.id)).record.harvest_date,
            record.harvest_date,
          );
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      },
    );
    await t.test(
      'unsafe metadata and malformed proposals/acceptance fail closed with no RAM fallback',
      async () => {
        const f = await fixture(),
          record = await confirmed(f);
        await sql.query(
          "UPDATE technical.entity_metadata SET version=9007199254740991 WHERE entity_type='tree_harvests' AND entity_key=$1",
          [record.id],
        );
        await assert.rejects(
          harvests.correction(f.owner.id, record.id, { reason: 'Overflow', changes: { fruit_count: 11 } }),
          status(503),
        );
        assert.equal((await harvests.get(f.owner.id, record.id)).status, 'Confirmed');
        await sql.query(
          "UPDATE technical.entity_metadata SET version=2 WHERE entity_type='tree_harvests' AND entity_key=$1",
          [record.id],
        );
        const r = await harvests.correction(f.owner.id, record.id, {
          reason: 'Corrupt',
          changes: { fruit_count: 11 },
        });
        await sql.query(
          'UPDATE technical.workflow_requests SET payload=jsonb_set(payload,\'{proposed_changes}\',\'{"status":"Draft"}\') WHERE id=$1',
          [r.id],
        );
        await assert.rejects(harvests.approve(admin, r.id), status(503));
        await assert.rejects(harvests.getRequest(f.owner.id, r.id), status(503));
        await sql.query(
          "UPDATE technical.entity_metadata SET data='{}' WHERE entity_type='tree_harvests' AND entity_key=$1",
          [record.id],
        );
        await assert.rejects(harvests.get(f.owner.id, record.id), status(503));
      },
    );
    await t.test(
      'grant appearing while writer waits restarts user lock context before validating Admin authority',
      async () => {
        const f = await fixture(),
          date = day(8),
          waitingPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 1,
            application_name: 'harvest-new-grant-context',
            connectionTimeoutMillis: 5000,
          });
        const blocker = await sql.connect();
        let done: Promise<PromiseSettledResult<TestTreeHarvest>> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query('SELECT id FROM public.users WHERE id=$1 FOR UPDATE', [f.owner.id]);
          const writer = new PostgresHarvestsRepository(
            waitingPool,
            new PostgresUsersRepository(waitingPool),
            farms,
            zones,
            trees,
            assignments,
            () => now,
          );
          done = writer.create(f.owner.id, { ...f.input, harvest_date: date }).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason) => ({ status: 'rejected' as const, reason }),
          );
          let blocked = false;
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            blocked = Boolean(
              (
                await sql.query(
                  "SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='harvest-new-grant-context' AND wait_event_type='Lock'",
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
          // Fixture supplies a valid, concurrent Admin grant while the writer
          // already selected its initial (empty) grantor set and waits on owner.
          const row = await blocker.query<{ id: string }>(
            "INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,payload,created_at) VALUES ('harvest_backdates','Grant','Active',$1,$2,$3,$4) RETURNING id",
            [
              f.zone.id,
              admin,
              JSON.stringify({
                user_id: f.owner.id,
                harvest_date: date,
                expires_at: new Date(now.getTime() + 60000).toISOString(),
                reason: 'Fixture concurrent grant',
                revoked_at: null,
              }),
              now,
            ],
          );
          await blocker.query(
            "INSERT INTO technical.entity_metadata(entity_type,entity_key) VALUES ('harvest_backdates',$1)",
            [row.rows[0].id],
          );
          await blocker.query('COMMIT');
          const result = await done;
          assert.equal(result.status, 'fulfilled');
          if (result.status === 'fulfilled') {
            assert.equal(result.value.harvest_date, date);
          }
          assert.equal(
            (await sql.query('SELECT count(*) FROM public.tree_harvests WHERE tree_id=$1', [f.tree.id]))
              .rows[0].count,
            '1',
          );
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await done;
          await waitingPool.end();
        }
      },
    );

    await t.test(
      'fresh HTTP app/pool retains Pending contents/proposal/backdate grant and accepted correction after another restart',
      async () => {
        now = new Date();
        const f = await fixture(),
          record = await confirmed(f),
          r = await harvests.correction(f.owner.id, record.id, {
            reason: 'Bền vững',
            changes: { total_weight_kg: 40.25 },
          }),
          p = await harvests.grantBackdate(admin, {
            user_id: f.owner.id,
            zone_id: f.zone.id,
            harvest_date: day(8),
            expires_at: new Date(now.getTime() + 3600000).toISOString(),
            reason: 'Phiên sau',
          });
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
          assert.equal((await http('tree-harvests')).status, 401);
          const owner = await login(f.owner.phone);
          assert.equal(
            (await http(`tree-harvests/${record.id}`, 'PATCH', { updated_by: f.owner.id }, owner)).status,
            400,
          );
          await app.close();
          freshPool = new Pool({
            connectionString: `${postgresBase}/${name}`,
            max: 5,
            connectionTimeoutMillis: 5000,
          });
          app = await application(freshPool);
          assert.throws(() => app.get(TreeHarvestsService).confirmedForTrace(f.tree.id), status(404));
          const pending = await http(
            `tree-harvests/${record.id}`,
            'GET',
            undefined,
            await login(f.owner.phone),
          );
          const original = (await pending.json()) as TestTreeHarvest;
          assert.equal(original.status, 'Pending');
          assert.equal(original.total_weight_kg, 30.5);
          const grants = await http(
            'harvest-backdate-permissions',
            'GET',
            undefined,
            await login(f.owner.phone),
          );
          assert.ok(((await grants.json()) as { items: { id: string }[] }).items.some((x) => x.id === p.id));
          assert.equal(
            (
              await http(
                `harvest-requests/${r.id}/approve`,
                'PATCH',
                {},
                await login(config.admin.phoneNumber),
              )
            ).status,
            200,
          );
          await app.close();
          app = await application(freshPool);
          const accepted = await http(
            `tree-harvests/${record.id}`,
            'GET',
            undefined,
            await login(f.owner.phone),
          );
          const result = (await accepted.json()) as TestTreeHarvest;
          assert.equal(result.status, 'Confirmed');
          assert.equal(result.total_weight_kg, 40.25);
          assert.equal(result.updated_by, f.owner.id);
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
