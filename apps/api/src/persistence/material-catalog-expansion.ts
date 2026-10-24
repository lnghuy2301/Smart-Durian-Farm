import { Pool } from 'pg';
import { SeedWriter } from './seed';
import { inPostgresTransaction } from './transactions';
import { OPERATIONAL_DOSAGE, OPERATIONAL_MATERIALS } from './operational-data-profile';
import { materialDosage } from '../materials/material-dosage';

// Generated initialization quantities for the project dataset, not a treatment
// recommendation. No dosage is sent to hardware or applied to existing logs.
export const MATERIAL_VARIETY = [
  ['Phân hữu cơ hoai mục', 'Fertilizer', 3, 'kg', 'cây/lần', 0],
  ['Phân trùn quế', 'Fertilizer', 2, 'kg', 'cây/lần', 0],
  ['NPK 16-16-8', 'Fertilizer', 0.5, 'kg', 'cây/lần', 0],
  ['Kali sulfat', 'Fertilizer', 0.2, 'kg', 'cây/lần', 0],
  ['Chế phẩm Trichoderma dạng bột', 'Biological', 20, 'g', 'cây/lần', 0],
  ['Chế phẩm Bacillus dạng lỏng', 'Biological', 2, 'ml', 'lít nước/lần', 0],
  ['Vi sinh cải tạo đất', 'Biological', 50, 'g', 'cây/lần', 0],
  ['Chế phẩm nấm đối kháng', 'Biological', 25, 'g', 'cây/lần', 0],
  ['Vật tư quản lý nấm gốc', 'Pesticide', 1, 'g', 'lít nước/lần', 14],
  ['Vật tư quản lý côn trùng chích hút', 'Pesticide', 1.5, 'ml', 'lít nước/lần', 14],
  ['Dầu khoáng nông nghiệp', 'Pesticide', 5, 'ml', 'lít nước/lần', 7],
  ['Vật tư quản lý sâu ăn lá', 'Pesticide', 0.5, 'g', 'lít nước/lần', 7],
] as const;
const PROFILE = 'material-dosage-v1';

export async function expandMaterialCatalog(pool: Pool) {
  return inPostgresTransaction(pool, async (client) => {
    for (const key of ['smart-durian:migrations', 'smart-durian:actuator-runtime']) {
      if (!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [key])).rows[0].locked) throw new Error('MATERIAL_STOP_API_FIRST');
    }
    const admin = (await client.query(`SELECT u.id FROM public.users u JOIN technical.entity_metadata m ON m.entity_type='users' AND m.entity_key=u.id::text
      WHERE m.data->>'seed_key'='durian-demo-v1:admin' AND u.role='Admin' AND u.status='Active' FOR UPDATE OF u,m`)).rows[0]?.id;
    if (!admin) throw new Error('MATERIAL_PRIMARY_ADMIN_REQUIRED');
    const writer = new SeedWriter(client, new Date().toISOString(), PROFILE);
    let normalized = 0, skippedCustomized = 0;
    const audit = async (id: string, action: string, payload: object) => client.query(`INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload)
      VALUES ('agricultural_materials',$1,$2,$3,clock_timestamp(),$4)`, [id, admin, action, JSON.stringify(payload)]);
    for (let i = 0; i < MATERIAL_VARIETY.length; i++) {
      const [name, material_type, value, unit, basis, quarantine_days] = MATERIAL_VARIETY[i];
      const dosage = materialDosage({ default_dosage_value: value, unit, dosage_basis: basis });
      const inserted = writer.inserted;
      const id = await writer.row('agricultural_materials', `material-${i}`, { name, material_type, default_dosage: dosage.default_dosage!,
        default_dosage_value: value, dosage_basis: basis, unit, quarantine_days, status: 'Active' }, [], undefined,
      { initialization_origin: 'GeneratedOperationalCatalog', dosage_profile: PROFILE });
      if (writer.inserted > inserted) await audit(id, 'CatalogInitialized', { initialization_origin: 'GeneratedOperationalCatalog', dosage_profile: PROFILE });
    }
    // Normalize ONLY untouched original initialization labels. Never parse an
    // ambiguous description, change units/status, or overwrite an operator edit.
    const rows = (await client.query(`SELECT a.*,m.data FROM public.agricultural_materials a JOIN technical.entity_metadata m
      ON m.entity_type='agricultural_materials' AND m.entity_key=a.id::text
      WHERE m.data->>'seed_key' LIKE 'durian-demo-v1:material-%' ORDER BY a.id FOR UPDATE OF a,m`)).rows;
    const values = [2, 0.5, 0.05, 1.5, 0.1];
    for (const row of rows) {
      if (row.default_dosage_value !== null || row.data.dosage_profile === PROFILE) continue;
      const index = Number(/^durian-demo-v1:material-(\d+)$/.exec(row.data.seed_key)?.[1]);
      if (!Number.isInteger(index) || index < 0 || index >= values.length || row.name !== OPERATIONAL_MATERIALS[index] ||
        row.default_dosage !== OPERATIONAL_DOSAGE || row.unit !== (index === 3 ? 'ml' : 'kg')) { skippedCustomized++; continue; }
      const basis = index === 3 ? 'lít nước/lần' : 'cây/lần';
      const dosage = materialDosage({ default_dosage_value: values[index], unit: row.unit, dosage_basis: basis });
      await client.query('UPDATE public.agricultural_materials SET default_dosage=$2,default_dosage_value=$3,dosage_basis=$4 WHERE id=$1', [row.id, dosage.default_dosage, values[index], basis]);
      await client.query(`UPDATE technical.entity_metadata SET version=version+1,data=data || $2::jsonb
        WHERE entity_type='agricultural_materials' AND entity_key=$1`, [row.id, JSON.stringify({ dosage_profile: PROFILE, legacy_default_dosage: row.default_dosage })]);
      await audit(row.id, 'CatalogDosageNormalized', { dosage_profile: PROFILE, changed_fields: ['default_dosage', 'default_dosage_value', 'dosage_basis'] }); normalized++;
    }
    return { inserted: writer.inserted, reused: writer.reused, normalized, skipped_customized: skippedCustomized };
  });
}
