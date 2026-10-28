import { Db, MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { CreateEventDto } from '../cultivation-events/cultivation-events.dto';
import { LOCK_DELAY_MS } from '../cultivation-events/cultivation-events.types';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresCatalogRepository } from './postgres-catalog.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresTreesRepository } from './postgres-trees.repository';
import { PostgresAssignmentsRepository } from './postgres-assignments.repository';
import { DatabaseCultivationRecords } from './database-cultivation-records';
import { MongoCultivationStore } from './mongo-cultivation.store';

export const CULTIVATION_ENRICHMENT = 'cultivation-diversity-month-v1';
const DAY = 86400000;
interface Entry { zone: string; owner: string; at: string; input: CreateEventDto }
interface Plan { entries: Entry[]; generated_at: string; origin: 'GeneratedOperationalHistory'; complete: boolean }

export async function planCultivationEnrichment(pool: Pool, db: Db, now = new Date()): Promise<Plan> {
  const existing = (await pool.query("SELECT data FROM technical.entity_metadata WHERE entity_type='dataset_profiles' AND entity_key=$1", [CULTIVATION_ENRICHMENT])).rows[0];
  if (existing) return existing.data;
  const zones = (await pool.query(`SELECT z.id,z.standard_id,f.owner_id,u.created_at FROM public.zones z
    JOIN public.farms f ON f.id=z.farm_id JOIN public.users u ON u.id=f.owner_id
    JOIN public.farming_standards s ON s.id=z.standard_id WHERE u.role='Farmer' AND u.status='Active' AND s.status='Active' ORDER BY z.id`)).rows;
  const materials = (await pool.query("SELECT id,unit,material_type FROM public.agricultural_materials WHERE status='Active' ORDER BY name,id")).rows;
  const fertilizer = materials.filter((m) => m.material_type === 'Fertilizer'), spray = materials.filter((m) => m.material_type === 'Biological');
  if (!fertilizer.length || !spray.length) throw new Error('CULTIVATION_ACTIVE_FERTILIZER_AND_BIOLOGICAL_REQUIRED');
  const entries: Entry[] = [];
  for (const [zi, zone] of zones.entries()) {
    const contexts = await db.collection('PERSISTENCE_STATE').find({ kind: 'CultivationContext', 'payload.zone_id': zone.id }, { projection: { key: 1 } }).toArray();
    const ids = contexts.map((c) => c.key);
    const rows = await db.collection('CULTIVATION_EVENTS').find({}).toArray();
    const tail = rows.filter((r) => ids.includes(r._id.toString())).reduce((v, r) => Math.max(v, new Date(r.lock_at).getTime()), 0);
    const treeRows = (await pool.query("SELECT id FROM public.trees WHERE zone_id=$1 AND status='Active' ORDER BY id LIMIT 5", [zone.id])).rows;
    if (!treeRows.length) continue;
    // Never insert ahead of an existing hash-chain tail or pending deadline.
    // Existing Locked documents and hashes are never rewritten to make room.
    const earliest = Math.max(now.getTime() - 28 * DAY, tail + 1, new Date(zone.created_at).getTime());
    const slots: number[] = [];
    for (let day = 28; day >= 1; day--) for (const hour of [0, 9]) {
      const at = new Date(now.getTime() - day * DAY); at.setUTCHours(hour, zi % 40, 0, 0);
      if (at.getTime() >= earliest && at.getTime() + LOCK_DELAY_MS < now.getTime()) slots.push(at.getTime());
    }
    const count = Math.min(10, slots.length);
    for (let i = 0; i < count; i++) {
      const action = ['Other', 'Watering', 'Fertilizing', 'Spraying', 'Other', 'Watering', 'Fertilizing', 'Spraying', 'Other', 'Watering'][i] as CreateEventDto['action_type'];
      const tree = action === 'Spraying' || (action === 'Fertilizing' && i === 6) || (action === 'Other' && i !== 0);
      const material = (action === 'Spraying' ? spray : fertilizer)[zi % (action === 'Spraying' ? spray : fertilizer).length];
      const quantity = material.unit === 'kg' ? (tree ? 0.4 : 24 + zi) : material.unit === 'g' ? (tree ? 15 : 240) : (tree ? 20 : 350);
      const input: CreateEventDto = { target_type: tree ? 'Tree' : 'Zone', target_id: tree ? treeRows[i % treeRows.length].id : zone.id, action_type: action,
        details: action === 'Other' ? { activity_name: i === 0 ? 'Tỉa cành, vệ sinh tán lá' : i === 4 ? 'Tỉa hoa, giữ chùm phân bố đều' : 'Tỉa trái, kiểm tra cuống và tán', note: i === 0 ? 'Thu gom cành khô, dọn lá dưới gốc và kiểm tra rãnh thoát nước.' : 'Chăm sóc riêng cây được chọn, ghi nhận tình trạng sau khi hoàn tất.' }
          : action === 'Watering' ? { duration_minutes: 20 + zi % 5 * 4, water_volume_l: 540 + zi * 25, note: 'Tưới buổi mát, kiểm tra độ ẩm quanh vùng rễ và các đầu tưới cuối tuyến.' }
            : { materials: [{ material_id: material.id, quantity }], note: action === 'Spraying' ? 'Phun chế phẩm sinh học riêng cây được chọn; kiểm tra hai mặt lá sau chăm sóc.' : tree ? 'Bổ sung dinh dưỡng riêng cây có tán phát triển chậm, rải đều quanh vùng rễ.' : 'Bón bổ sung quanh vùng rễ, kết hợp kiểm tra lớp phủ và tình trạng đất.' } };
      entries.push({ zone: zone.id, owner: zone.owner_id, at: new Date(slots[Math.floor(i * slots.length / count)]).toISOString(), input });
    }
  }
  return { entries: entries.sort((a, b) => a.at.localeCompare(b.at) || a.zone.localeCompare(b.zone)), generated_at: now.toISOString(), origin: 'GeneratedOperationalHistory', complete: false };
}

export async function applyCultivationEnrichment(pool: Pool, mongo: MongoClient, db: Db, now = new Date()) {
  const plan = await planCultivationEnrichment(pool, db, now);
  if (plan.complete) return { already_complete: true, created: 0, planned: plan.entries.length };
  await pool.query("INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('dataset_profiles',$1,$2) ON CONFLICT DO NOTHING", [CULTIVATION_ENRICHMENT, JSON.stringify(plan)]);
  let time = now.getTime(), created = 0;
  const clock = () => new Date(time), users = new PostgresUsersRepository(pool), farms = new PostgresFarmsRepository(pool, users, clock);
  const catalogs = new PostgresCatalogRepository(pool, users, clock), zones = new PostgresZonesRepository(pool, users, farms, catalogs, clock);
  const trees = new PostgresTreesRepository(pool, users, farms, zones, clock), assignments = new PostgresAssignmentsRepository(pool, users, farms, zones, clock);
  const store = new MongoCultivationStore(mongo, db, () => time);
  const records = new DatabaseCultivationRecords(pool, users, farms, zones, trees, assignments, catalogs, store, () => time);
  for (const [index, entry] of plan.entries.entries()) {
    const key = `${CULTIVATION_ENRICHMENT}:${index}`;
    if ((await pool.query("SELECT 1 FROM technical.entity_metadata WHERE entity_type='dataset_steps' AND entity_key=$1", [key])).rowCount) continue;
    time = Date.parse(entry.at);
    // Mongo and PG do not share a transaction. Recover a committed event after
    // a lost PG checkpoint by exact author/time/target, never create it twice.
    const matches = await db.collection('CULTIVATION_EVENTS').find({ farmer_id: entry.owner, created_at: new Date(entry.at), target_id: entry.input.target_id, action_type: entry.input.action_type }).toArray();
    if (matches.length > 1) throw new Error('CULTIVATION_ENRICHMENT_AMBIGUOUS_RESUME');
    const id = matches[0]?._id.toString() ?? (await records.create(entry.owner, entry.input))._id;
    if (!matches.length) created++;
    await pool.query("INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('dataset_steps',$1,$2)", [key, JSON.stringify({ resource_id: id, profile: CULTIVATION_ENRICHMENT, origin: plan.origin })]);
  }
  time = now.getTime(); await store.lockDue();
  for (const zone of new Set(plan.entries.map((e) => e.zone))) {
    if (!(await records.verify(plan.entries.find((e) => e.zone === zone)!.owner, zone)).valid) throw new Error('CULTIVATION_ENRICHMENT_CHAIN_FAILED');
  }
  await pool.query("UPDATE technical.entity_metadata SET data=jsonb_set(data,'{complete}','true'),version=version+1 WHERE entity_type='dataset_profiles' AND entity_key=$1", [CULTIVATION_ENRICHMENT]);
  return { already_complete: false, created, planned: plan.entries.length };
}
