import { Db, MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { hashPassword } from '../auth/password';
import { SeedWriter } from './seed';
import { inPostgresTransaction } from './transactions';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresCatalogRepository } from './postgres-catalog.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresTreesRepository } from './postgres-trees.repository';
import { PostgresAssignmentsRepository } from './postgres-assignments.repository';
import { PostgresHarvestsRepository } from './postgres-harvests.repository';
import { MongoCultivationStore } from './mongo-cultivation.store';
import { DatabaseCultivationRecords } from './database-cultivation-records';
import { CreateEventDto } from '../cultivation-events/cultivation-events.dto';

export const RICH_PROFILE = 'operational-month-v1';
const DAY = 86400000;
export const RICH_PEOPLE = [
  'Võ Thành Nam', 'Trần Văn Hòa', 'Nguyễn Hữu Tín', 'Phạm Quốc Dũng', 'Lê Minh Thành',
  'Nguyễn Văn An', 'Trần Hoàng Phúc', 'Võ Quốc Bảo',
];
export const RICH_MANAGERS = ['Lê Thanh Sơn', 'Nguyễn Thị Ngọc', 'Trần Minh Khánh'];
export const richPhone = (index: number) => `0990000${String(101 + index).padStart(3, '0')}`;
export class RichDataError extends Error {}
interface ZonePlan { id: string; owner: string; author: string; farm: string; trees: string[]; label: string }
interface Graph { anchor: string; generated_at: string; status: string; users: string[]; managers: string[]; cooperatives: string[]; farms: string[]; zones: ZonePlan[]; materials: string[] }
const locations = [
  ['Ngũ Hiệp, Cai Lậy', 106.1, 10.32], ['Long Tiên, Cai Lậy', 106.12, 10.35],
  ['Quới Sơn, Châu Thành', 106.35, 10.29], ['Thanh Bình, Vũng Liêm', 106.17, 10.08],
  ["Đạ M’ri, Lâm Đồng", 107.55, 11.43],
] as const;

async function bootstrap(pool: Pool, password: string, now: Date): Promise<Graph> {
  const hash = await hashPassword(password);
  return inPostgresTransaction(pool, async (client) => {
    const old = await client.query("SELECT data FROM technical.entity_metadata WHERE entity_type='dataset_profiles' AND entity_key=$1 FOR UPDATE", [RICH_PROFILE]);
    if (old.rowCount) return old.rows[0].data as Graph;
    const anchorDate = new Date(now.getTime() - 29 * DAY); anchorDate.setUTCHours(2, 0, 0, 0);
    const anchor = anchorDate.toISOString(), timestamp = new Date(anchorDate.getTime() - DAY).toISOString();
    const writer = new SeedWriter(client, timestamp, RICH_PROFILE);
    const auditActor = (await client.query("SELECT entity_key FROM technical.entity_metadata WHERE entity_type='users' AND data->>'seed_key'='durian-demo-v1:admin'")).rows[0]?.entity_key;
    if (!auditActor) throw new RichDataError('RICH_PRIMARY_ADMIN_REQUIRED');
    const users: string[] = [], managers: string[] = [];
    const provenance = { dataset_profile: RICH_PROFILE, initialization_origin: 'GeneratedOperationalHistory' };
    for (let i = 0; i < 11; i++) {
      const phone = richPhone(i);
      if ((await client.query("SELECT 1 FROM public.users WHERE ltrim(phone_number,'+') IN ($1,$2)", [phone, `84${phone.slice(1)}`])).rowCount) throw new RichDataError('RICH_ACCOUNT_PHONE_COLLISION');
      const manager = i >= 8, index = i - 8;
      const id = await writer.row('users', `account-${i}`, { user_name: manager ? RICH_MANAGERS[index] : RICH_PEOPLE[i],
        phone_number: phone, password: hash, role: manager ? 'Manager' : 'Farmer', status: manager && index === 2 ? 'Pending' : 'Active',
        gmail: manager ? `quanly${index + 1}@phuocan.example.invalid` : null, gmail_verify: manager,
        is_owner: !manager && i < 5, created_at: timestamp }, ['phone_number', 'role'], undefined,
        { ...provenance, token_version: 0, ...(manager ? { verification_origin: 'AuthorizedGeneratedInitializationNotProviderProof' } : {}) });
      (manager ? managers : users).push(id);
    }
    const cooperatives: string[] = [];
    for (let i = 0; i < 3; i++) cooperatives.push(await writer.row('cooperatives', `cooperative-${i}`, {
      manager_id: i < 2 ? managers[i] : null, cooperative_name: ['HTX Sầu Riêng Ngũ Hiệp', 'HTX Trái Cây Quới Sơn', 'HTX Sầu Riêng Thanh Bình'][i],
      director: RICH_MANAGERS[i], certificate_number: `HS-HTX-2026-10${i}`, address: ['Vùng trồng Ngũ Hiệp, Cai Lậy', 'Vùng trồng Quới Sơn, Châu Thành', 'Vùng trồng Thanh Bình, Vũng Liêm'][i], contact_number: richPhone(8 + i),
    }, ['manager_id'], undefined, { ...provenance, created_at: i < 2 ? anchor : now.toISOString() }));
    const standard = (await client.query("SELECT id FROM public.farming_standards WHERE status='Active' ORDER BY code,id LIMIT 1")).rows[0]?.id;
    const materials: string[] = [];
    for (const type of ['Fertilizer', 'Pesticide']) {
      const material = (await client.query("SELECT id FROM public.agricultural_materials WHERE status='Active' AND material_type=$1 ORDER BY name,id LIMIT 1", [type])).rows[0];
      if (material) materials.push(material.id);
    }
    if (!standard || materials.length < 2) throw new RichDataError('RICH_ACTIVE_CATALOGS_REQUIRED');
    const farms: string[] = [], zones: ZonePlan[] = [];
    for (let f = 0; f < 5; f++) {
      const [address, longitude, latitude] = locations[f], cooperative = f < 2 ? cooperatives[0] : f === 2 ? cooperatives[1] : null;
      const farm = await writer.row('farms', `farm-${f}`, { owner_id: users[f], cooperative_id: cooperative,
        join_cooperative_date: cooperative ? anchor : null, area_size: [1.2, 1.4, 1.6, 1.1, 1.8][f], address: `Vùng trồng ${address}`,
        certificate_number: `HS-SR-2026-10${f}`, longitude, latitude }, ['owner_id'], undefined, provenance);
      farms.push(farm);
      for (let z = 0; z < 2; z++) {
        const name = `${z ? 'Khu Monthong' : 'Khu Ri6'} ${['ven mương', 'phía Đông', 'trung tâm', 'phía Nam', 'sườn đồi'][f]}`;
        const zone = await writer.row('zones', `zone-${f}-${z}`, { farm_id: farm, standard_id: standard, zone_name: name,
          area_size: [1.2, 1.4, 1.6, 1.1, 1.8][f] * (z ? 0.45 : 0.5), longitude: longitude + z * 0.001, latitude }, ['farm_id'], undefined, provenance);
        const trees: string[] = [];
        for (let t = 0; t < 36; t++) {
          const id = await writer.row('trees', `tree-${f}-${z}-${t}`, { zone_id: zone, variety: z ? 'Monthong' : 'Ri6',
            plant_date: `${2019 + t % 3}-06-12T02:00:00.000Z`, longitude: longitude + z * 0.001 + (t % 6) * 0.00008,
            latitude: latitude + Math.floor(t / 6) * 0.00008, status: t === 34 ? 'Dead' : t === 35 ? 'Removed' : 'Active' }, ['zone_id'], undefined, provenance);
          if (t < 34) trees.push(id);
        }
        const author = z === 0 ? users[5 + f % 3] : users[f];
        if (z === 0) {
          const start = new Date(anchorDate.getTime() + DAY).toISOString();
          const snapshot = (await client.query('SELECT * FROM public.zones WHERE id=$1', [zone])).rows[0];
          await writer.row('users_zones', `assignment-${f}`, { user_id: author, zone_id: zone, start_date: start, end_date: null }, ['user_id', 'zone_id'], undefined,
            { ...provenance, accepted_at: start, source: 'AuthorizedGeneratedInitialization', zone_snapshot: { ...snapshot, area_size: Number(snapshot.area_size), longitude: Number(snapshot.longitude), latitude: Number(snapshot.latitude) } });
        }
        zones.push({ id: zone, owner: users[f], author, farm, trees, label: `F${f + 1}Z${z + 1}` });
      }
    }
    const graph: Graph = { anchor, generated_at: now.toISOString(), status: 'GraphReady', users, managers, cooperatives, farms, zones, materials };
    await client.query("INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('dataset_profiles',$1,$2)", [RICH_PROFILE, JSON.stringify(graph)]);
    await client.query(`INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload)
      VALUES ('dataset_profiles',$1,$2,'GeneratedHistoryInitialized',$3,$4)`, [RICH_PROFILE, auditActor, now, JSON.stringify({ source: 'AuthorizedGeneratedInitialization', accounts: 11, farms: 5, zones: 10, trees: 360, month: anchor })]);
    return graph;
  });
}

export async function seedRichOperationalData(pool: Pool, mongo: MongoClient, db: Db, password: string, now = new Date()) {
  if (password.length < 8 || password.length > 128) throw new RichDataError('RICH_ACCOUNT_PASSWORD_REQUIRED');
  const graph = await bootstrap(pool, password, now);
  if (graph.status === 'Complete') return { already_complete: true, new_cultivation: 0, new_harvests: 0 };
  let time = Date.parse(graph.anchor), newCultivation = 0, newHarvests = 0;
  const clock = () => new Date(time);
  const users = new PostgresUsersRepository(pool), farms = new PostgresFarmsRepository(pool, users, clock);
  const catalogs = new PostgresCatalogRepository(pool, users, clock), zones = new PostgresZonesRepository(pool, users, farms, catalogs, clock);
  const trees = new PostgresTreesRepository(pool, users, farms, zones, clock), assignments = new PostgresAssignmentsRepository(pool, users, farms, zones, clock);
  const store = new MongoCultivationStore(mongo, db, () => time);
  const cultivation = new DatabaseCultivationRecords(pool, users, farms, zones, trees, assignments, catalogs, store, () => time);
  const harvests = new PostgresHarvestsRepository(pool, users, farms, zones, trees, assignments, clock);
  const mark = async (key: string, id: string) => {
    await pool.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('dataset_steps',$1,$2)
      ON CONFLICT(entity_type,entity_key) DO NOTHING`, [`${RICH_PROFILE}:${key}`, JSON.stringify({ resource_id: id, profile: RICH_PROFILE })]);
  };
  const done = async (key: string) => (await pool.query("SELECT data->>'resource_id' AS id FROM technical.entity_metadata WHERE entity_type='dataset_steps' AND entity_key=$1", [`${RICH_PROFILE}:${key}`])).rows[0]?.id;
  // Clock is injected only in this offline repository bundle. No Date.now mock,
  // server config change or public timestamp input. Work is chronological so
  // each new Zone chain locks before its next historical event is appended.
  for (let day = 1; day <= 28; day++) {
    time = Date.parse(graph.anchor) + day * DAY;
    for (const [zi, zone] of graph.zones.entries()) {
      time = Date.parse(graph.anchor) + day * DAY + zi * 60000;
      const action = day % 3 === 1 ? 'Watering' : day === 8 || day === 20 ? 'Fertilizing' : day === 14 ? 'Spraying' : undefined;
      if (action) {
        const key = `event-${day}-${zi}`;
        if (!await done(key)) {
          const at = new Date(time).toISOString();
          const matches = await db.collection('CULTIVATION_EVENTS').find({ farmer_id: zone.author, created_at: new Date(at) }).toArray();
          if (matches.length > 1) throw new RichDataError('RICH_AMBIGUOUS_EVENT_RESUME');
          let id = matches[0]?._id.toString();
          if (!id) {
            const input: CreateEventDto = { target_type: action === 'Spraying' ? 'Tree' : 'Zone', target_id: action === 'Spraying' ? zone.trees[day % zone.trees.length] : zone.id, action_type: action,
              details: action === 'Watering' ? { duration_minutes: 18 + zi % 5 * 3, water_volume_l: 480 + zi * 35, note: 'Kiểm tra độ ẩm và tình trạng thoát nước sau tưới.' } :
                { materials: [{ material_id: graph.materials[action === 'Spraying' ? 1 : 0], quantity: action === 'Spraying' ? 120 : 18 + zi }], note: action === 'Spraying' ? 'Xử lý riêng cây có dấu hiệu cần theo dõi, ghi nhận vật tư đã dùng.' : 'Bổ sung dinh dưỡng theo kế hoạch chăm sóc của khu vực.' } };
            id = (await cultivation.create(zone.author, input))._id; newCultivation++;
          }
          await mark(key, id!);
        }
      }
      if (day === 12 || day === 24) for (let i = 0; i < 8; i++) {
        time = Date.parse(graph.anchor) + day * DAY + zi * 60000 + i * 1000;
        const key = `harvest-${day}-${zi}-${i}`, known = await done(key);
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock());
        let id = known;
        if (!id) {
          const existing = (await pool.query('SELECT id,created_at,created_by FROM public.tree_harvests WHERE tree_id=$1 AND harvest_date=$2', [zone.trees[i], date])).rows[0];
          if (existing && (existing.created_at.toISOString() !== clock().toISOString() || existing.created_by !== zone.author)) throw new RichDataError('RICH_HARVEST_CONFLICT');
          id = existing?.id;
          if (!id) {
            const count = 20 + i * 3 + zi;
            id = (await harvests.create(zone.author, { tree_id: zone.trees[i], harvest_date: date, season_name: 'Vụ thu hoạch 2026',
              batch_code: `TH-${date.replaceAll('-', '')}-${zone.label}`, fruit_count: count, total_weight_kg: Number((count * (2.35 + i % 3 * 0.2)).toFixed(2)) })).id;
            newHarvests++;
          }
          await mark(key, id);
        }
        let record = await harvests.get(zone.author, id);
        if (i < 7 && record.status === 'Draft') { await harvests.submit(zone.author, id); record = await harvests.get(zone.author, id); }
        if (i < 6 && record.status === 'Pending') {
          const request = (await pool.query("SELECT id FROM technical.workflow_requests WHERE target_key=$1 AND action='Confirm' AND status='Pending'", [id])).rows[0];
          if (!request) throw new RichDataError('RICH_CONFIRM_REQUEST_REQUIRED');
          await harvests.approve(zone.owner, request.id);
        }
      }
    }
  }
  time = now.getTime(); await store.lockDue();
  for (const zone of graph.zones) {
    const check = await cultivation.verify(zone.owner, zone.id);
    if (!check.valid) throw new RichDataError('RICH_CHAIN_VERIFICATION_FAILED');
  }
  await pool.query("UPDATE technical.entity_metadata SET data=jsonb_set(data,'{status}','\"Complete\"'),version=version+1 WHERE entity_type='dataset_profiles' AND entity_key=$1", [RICH_PROFILE]);
  return { already_complete: false, new_cultivation: newCultivation, new_harvests: newHarvests, added_farms: graph.farms.length, added_zones: graph.zones.length, added_accounts: 11 };
}
