import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { hashPassword } from '../auth/password';
import { SeedConfig, phoneIdentity } from './seed-config';
import { inPostgresTransaction } from './transactions';
import { MIGRATIONS, migrationChecksum } from './migrations';

type Table = 'users' | 'cooperatives' | 'farming_standards' | 'agricultural_materials' | 'farms' | 'zones' | 'trees' | 'devices' | 'sensors' | 'actuators' | 'users_zones';
type Fields = Record<string, string | number | boolean | null>;
interface SeedResult { inserted: number; reused: number; real_device_id: string; real_zone_id: string; primary_farmer_id: string }
const PROFILE = 'durian-demo-v1';

class SeedWriter {
  inserted = 0;
  reused = 0;
  constructor(private readonly client: PoolClient, private readonly timestamp: string) {}

  async row(table: Table, key: string, fields: Fields, immutable: string[] = [], natural?: { sql: string; values: unknown[] }, extra: Record<string, unknown> = {}): Promise<string> {
    const seedKey = `${PROFILE}:${key}`;
    const metadata = await this.client.query('SELECT entity_key,data FROM technical.entity_metadata WHERE entity_type=$1 AND data->>\'seed_key\'=$2', [table, seedKey]);
    let existing: Fields | undefined;
    if (metadata.rowCount) {
      existing = (await this.client.query(`SELECT * FROM public.${table} WHERE id=$1`, [metadata.rows[0].entity_key])).rows[0];
      if (!existing) { throw new Error('Seed manifest points to missing record'); }
    } else if (natural) { existing = (await this.client.query(natural.sql, natural.values)).rows[0]; }
    if (existing) {
      for (const field of immutable) {
        if (String(existing[field]) !== String(fields[field])) { throw new Error(`Seed immutable conflict: ${table}.${field}`); }
      }
      this.reused++;
    } else {
      const id = randomUUID();
      const newFields = table === 'trees' ? { ...fields, tree_code: `DRN-${id}` } : fields;
      const entries = Object.entries({ id, ...newFields });
      // Identifiers xuất phát từ fixtures nội bộ, không từ HTTP/env. Mọi giá trị,
      // kể cả phone/hash/station, luôn là parameters, không nối vào câu SQL.
      await this.client.query(`INSERT INTO public.${table} (${entries.map(([column]) => column).join(',')}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(',')})`, entries.map(([, value]) => value));
      existing = { id, ...newFields };
      this.inserted++;
    }
    const id = String(existing.id);
    const previous = await this.client.query('SELECT data FROM technical.entity_metadata WHERE entity_type=$1 AND entity_key=$2', [table, id]);
    if (previous.rows[0]?.data.seed_key && previous.rows[0].data.seed_key !== seedKey) { throw new Error('Seed identity belongs to another profile key'); }
    const data = { ...extra, seed_key: seedKey, seed_origin: fields.station_id ? key === 'device-real' ? 'HardwareReal' : 'Simulated' : 'DemoFixture', seeded_at: this.timestamp };
    // existing.data thắng defaults: không reset token version, everConfirmed hay
    // context đã cập nhật. Rerun giữ password/status/nội dung bảng chính nguyên vẹn.
    await this.client.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ($1,$2,$3)
      ON CONFLICT (entity_type,entity_key) DO UPDATE SET data=EXCLUDED.data || technical.entity_metadata.data`, [table, id, JSON.stringify(data)]);
    return id;
  }

  async standardMaterial(key: string, standardId: string, materialId: string): Promise<void> {
    const entityKey = `${standardId}:${materialId}`;
    const seedKey = `${PROFILE}:${key}`;
    const metadata = await this.client.query("SELECT entity_key FROM technical.entity_metadata WHERE entity_type='standard_materials' AND data->>'seed_key'=$1", [seedKey]);
    const existing = await this.client.query('SELECT 1 FROM public.standard_materials WHERE standard_id=$1 AND material_id=$2', [standardId, materialId]);
    if (metadata.rowCount) {
      // Không dựng lại một liên kết người dùng đã chủ động bỏ trong API.
      if (metadata.rows[0].entity_key !== entityKey || !existing.rowCount) { throw new Error('Seed linked material conflict'); }
      return;
    }
    if (!existing.rowCount) { await this.client.query('INSERT INTO public.standard_materials(standard_id,material_id) VALUES ($1,$2)', [standardId, materialId]); }
    await this.client.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,data) VALUES ('standard_materials',$1,$2)
      ON CONFLICT (entity_type,entity_key) DO UPDATE SET data=EXCLUDED.data || technical.entity_metadata.data`, [entityKey, JSON.stringify({ seed_key: seedKey, seed_origin: 'DemoFixture', seeded_at: this.timestamp })]);
  }

  async account(key: string, phone: string, passwordHash: string, role: string, owner: boolean, status = 'Active', gmail: string | null = null): Promise<string> {
    const userId = await this.row('users', key, { user_name: key === 'primary-farmer' ? 'Chủ vườn demo' : key === 'admin' ? 'Admin demo' : key === 'sample-manager' ? 'Manager chờ duyệt (mẫu)' : 'Farmer mẫu',
      phone_number: phone, password: passwordHash, role, status, is_owner: owner, gmail, gmail_verify: false, created_at: this.timestamp }, ['role', 'is_owner'],
    { sql: `SELECT * FROM public.users WHERE (CASE WHEN ltrim(phone_number,'+') ~ '^0[0-9]{9}$' THEN '84' || substr(ltrim(phone_number,'+'),2) ELSE ltrim(phone_number,'+') END)=$1`, values: [phoneIdentity(phone)] },
    { token_version: 0 });
    // Manifest không được khiến một cấu hình phone mới âm thầm tái dùng account cũ.
    const stored = (await this.client.query('SELECT phone_number FROM public.users WHERE id=$1', [userId])).rows[0];
    if (phoneIdentity(stored.phone_number) !== phoneIdentity(phone)) { throw new Error('Seed primary identity changed'); }
    return userId;
  }
}

export async function seedDemo(pool: Pool, config: SeedConfig, now = new Date()): Promise<SeedResult> {
  const timestamp = now.toISOString();
  if (Date.parse(config.device.installedAt) > now.getTime()) { throw new Error('Demo installation date is in the future'); }
  // Hash trước transaction để không giữ khóa DB trong lúc scrypt. Password mẫu
  // cũng lấy cấu hình local, không tạo mật khẩu mặc định cố định trong source.
  const [farmerHash, adminHash] = await Promise.all([hashPassword(config.farmer.password), hashPassword(config.admin.password)]);
  return inPostgresTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smart-durian:migrations',0))");
    const migrations = await client.query('SELECT id,store,checksum FROM technical.schema_migrations');
    if (migrations.rows.length !== MIGRATIONS.length || !MIGRATIONS.every((migration) => migrations.rows.some((row) => row.id === migration.id && row.store === migration.store && row.checksum === migrationChecksum(migration.source)))) {
      throw new Error('Apply current migrations before seed');
    }
    const writer = new SeedWriter(client, timestamp);
    const admin = await writer.account('admin', config.admin.phone, adminHash, 'Admin', false);
    const farmer = await writer.account('primary-farmer', config.farmer.phone, farmerHash, 'Farmer', true);
    const sampleFarmer = await writer.account('sample-farmer', '0990000011', farmerHash, 'Farmer', true);
    await writer.account('sample-manager', '0990000012', farmerHash, 'Manager', false, 'Pending', 'manager.demo@example.invalid');
    await writer.row('cooperatives', 'cooperative-unmanaged', { manager_id: null, director: 'Ban quản trị mẫu', cooperative_name: 'HTX Sầu Riêng Demo', certificate_number: 'DEMO-HTX-001', address: 'Địa chỉ HTX minh họa — Đắk Lắk', contact_number: '0990000012' }, [], undefined, { created_at: timestamp });
    const standards: string[] = [];
    for (let i = 0; i < 3; i++) {
      standards.push(await writer.row('farming_standards', `standard-${i}`, { code: ['DEMO-VIETGAP', 'DEMO-IPM', 'DEMO-OLD'][i],
        name: ['Thực hành VietGAP (mẫu)', 'Quản lý dịch hại tổng hợp (mẫu)', 'Quy trình cũ (mẫu)'][i],
        description: 'Dữ liệu minh họa, không phải chứng nhận hoặc hướng dẫn liều dùng thực tế.', certifying_body: 'Đơn vị minh họa', status: i === 2 ? 'Inactive' : 'Active' }));
    }
    const materialNames = ['Phân hữu cơ vi sinh (mẫu)', 'NPK cho cây trưởng thành (mẫu)', 'Chế phẩm Trichoderma (mẫu)', 'Vật tư bảo vệ thực vật (mẫu)', 'Vật tư ngưng dùng (mẫu)'];
    for (let i = 0; i < materialNames.length; i++) {
      const material = await writer.row('agricultural_materials', `material-${i}`, { name: materialNames[i], material_type: ['Fertilizer', 'Fertilizer', 'Biological', 'Pesticide', 'Biological'][i],
        default_dosage: 'Theo nhãn sản phẩm; dữ liệu demo không chỉ định liều', unit: i === 3 ? 'ml' : 'kg', quarantine_days: i === 3 ? 14 : 0, status: i === 4 ? 'Inactive' : 'Active' });
      if (i < 4) { await writer.standardMaterial(`standard-material-${i}`, standards[i % 2], material); }
    }
    const zones: string[] = [];
    for (let farmIndex = 0; farmIndex < 3; farmIndex++) {
      const owner = farmIndex === 2 ? sampleFarmer : farmer;
      const farm = await writer.row('farms', `farm-${farmIndex}`, { owner_id: owner, cooperative_id: null, join_cooperative_date: null, area_size: [1.2, 1.8, 2.4][farmIndex],
        address: ['Vườn demo Krông Pắc, Đắk Lắk', 'Vườn demo Cái Bè, Tiền Giang', 'Vườn demo Đạ Huoai, Lâm Đồng'][farmIndex],
        certificate_number: `DEMO-FARM-00${farmIndex + 1}`, longitude: [108.3, 106.05, 107.64][farmIndex], latitude: [12.67, 10.33, 11.43][farmIndex] }, ['owner_id']);
      // Các hồ sơ tạo sẵn đã được cho phép ở profile demo; provenance nói rõ đây
      // là fixture, không giả chữ ký/email/SMS của một người dùng thực.
      const provenance = await client.query("SELECT 1 FROM technical.audit_events WHERE entity_type='farms' AND entity_key=$1 AND action='DemoSeedCreate'", [farm]);
      if (!provenance.rowCount) {
        await client.query(`INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ('farms',$1,$2,'DemoSeedCreate',$3,$4)`,
          [farm, admin, timestamp, JSON.stringify({ source: 'AuthorizedDemoFixture', owner_id: owner })]);
      }
      for (let zoneIndex = 0; zoneIndex < 2; zoneIndex++) {
        const index = farmIndex * 2 + zoneIndex;
        const zone = await writer.row('zones', `zone-${index}`, { farm_id: farm, standard_id: standards[index % 2],
          zone_name: index === 0 ? 'Khu A — trạm ESP32 thật' : `Khu ${index + 1} — dữ liệu mẫu`, area_size: [[0.5, 0.6], [0.8, 0.9], [1, 1.2]][farmIndex][zoneIndex],
          longitude: [108.3, 106.05, 107.64][farmIndex] + zoneIndex * 0.001, latitude: [12.67, 10.33, 11.43][farmIndex] + zoneIndex * 0.001 }, ['farm_id']);
        zones.push(zone);
        for (let treeIndex = 0; treeIndex < 9; treeIndex++) {
          const key = `tree-${index}-${treeIndex}`;
          // Mã cây dùng cùng format backend DRN-UUID, không dùng station làm mã.
          await writer.row('trees', key, { zone_id: zone, variety: treeIndex % 2 ? 'Monthong' : 'Ri6',
            plant_date: `${2018 + treeIndex % 3}-05-15T01:30:00.000Z`, longitude: [108.3, 106.05, 107.64][farmIndex] + treeIndex * 0.00001,
            latitude: [12.67, 10.33, 11.43][farmIndex] + zoneIndex * 0.001, status: treeIndex === 8 && index > 0 ? index % 2 ? 'Dead' : 'Removed' : 'Active' }, ['zone_id']);
        }
      }
    }
    // Chấp thuận phân công là fixture của cả chủ/assignee, giữ context Accepted
    // riêng ngoài USERS_ZONES; không giả phiên OTP. Hai khoảng liền kề [start,end).
    const pastEnd = new Date(now.getTime() - 86400000).toISOString();
    for (let i = 0; i < 2; i++) {
      const start = new Date(now.getTime() - (i === 0 ? 60 : 1) * 86400000).toISOString();
      const snapshot = (await client.query('SELECT * FROM public.zones WHERE id=$1', [zones[2]])).rows[0];
      await writer.row('users_zones', `assignment-${i}`, { user_id: sampleFarmer, zone_id: zones[2], start_date: start, end_date: i === 0 ? pastEnd : null }, ['user_id', 'zone_id'], undefined,
        { accepted_at: start, zone_snapshot: { ...snapshot, area_size: Number(snapshot.area_size), longitude: Number(snapshot.longitude), latitude: Number(snapshot.latitude) }, source: 'AuthorizedDemoFixture' });
    }
    const deviceIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const station = i === 0 ? config.device.stationId : `SIM_DEMO_00${i}`;
      const device = await writer.row('devices', i === 0 ? 'device-real' : `device-sim-${i}`, { zone_id: zones[i * 2], station_id: station,
        installed_at: i === 0 ? config.device.installedAt : `2026-08-${i === 1 ? '10' : '25'}T01:30:00.000Z`,
        cost: i === 0 ? config.device.cost : i === 1 ? 9847500 : 10682500, status: ['Active', 'Inactive', 'Maintenance'][i], last_seen_at: null }, ['station_id', 'zone_id'],
      { sql: 'SELECT * FROM public.devices WHERE station_id=$1', values: [station] });
      deviceIds.push(device);
      // Sensors và actuators có số lượng độc lập: thêm stream không tự tạo relay.
      for (let stream = 0; stream < 6; stream++) {
        const dataStream = String(301 + stream);
        await writer.row('sensors', `sensor-${i}-${stream}`, { device_id: device, name: ['Nhiệt độ không khí', 'Độ ẩm không khí', 'Độ ẩm đất', 'Nhiệt độ đất', 'pH đất', 'EC đất'][stream],
          sensor_type: ['air_temperature', 'air_humidity', 'soil_moisture', 'soil_temperature', 'soil_ph', 'soil_ec'][stream], data_stream_id: dataStream,
          // Final firmware spelling is significant: micro sign U+00B5 is not Greek mu U+03BC.
          // Seed only applies this default to new rows; existing configured units remain unchanged.
          unit: ['C', '%', '%rH', 'C', 'H+', 'µS/cm'][stream], min_threshold: null, max_threshold: null, status: i === 1 ? 'Inactive' : 'Active' }, ['device_id', 'data_stream_id', 'sensor_type'],
        { sql: 'SELECT * FROM public.sensors WHERE device_id=$1 AND data_stream_id=$2', values: [device, dataStream] }, { hardware_bundle: i === 0 ? 'Real' : 'Simulated' });
      }
      for (let stream = 0; stream < 3; stream++) {
        await writer.row('actuators', `actuator-${i}-${stream}`, { device_id: device, name: ['Bơm chung', 'Van tưới nước', 'Van phun thuốc'][stream],
          purpose: ['shared', 'watering', 'spraying'][stream], capability_id: 2 + stream, status: i === 1 ? 'Inactive' : 'Active' }, ['device_id', 'capability_id', 'purpose'],
        { sql: 'SELECT * FROM public.actuators WHERE device_id=$1 AND capability_id=$2', values: [device, 2 + stream] }, { hardware_bundle: i === 0 ? 'Real' : 'Simulated' });
      }
    }
    // Output chỉ IDs/counts, không phone/password/hash hay credentials cấu hình.
    return { inserted: writer.inserted, reused: writer.reused, real_device_id: deviceIds[0], real_zone_id: zones[0], primary_farmer_id: farmer };
  });
}
