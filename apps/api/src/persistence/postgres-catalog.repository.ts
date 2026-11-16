import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { MaterialRecords, StandardRecords, StandardMaterialRecords, CatalogPage } from '../catalog/catalog-records';
import { catalogInput, catalogUuid } from '../catalog/catalog-validation';
import { AgriculturalMaterial } from '../materials/materials.service';
import { CreateMaterialDto, MaterialListDto, UpdateMaterialDto } from '../materials/materials.dto';
import { FarmingStandard } from '../standards/standards.service';
import { CreateStandardDto, StandardListDto, UpdateStandardDto } from '../standards/standards.dto';
import { PostgresUsersRepository } from './postgres-users.repository';
import { safeInteger } from './mappers';
import { inPostgresTransaction } from './transactions';
import { materialDosage } from '../materials/material-dosage';

type CatalogTable = 'agricultural_materials' | 'farming_standards';
type CatalogRecord = AgriculturalMaterial | FarmingStandard;
const MATERIAL_FIELDS = ['name', 'material_type', 'default_dosage', 'default_dosage_value', 'dosage_basis', 'unit', 'quarantine_days', 'status'] as const;
const STANDARD_FIELDS = ['code', 'name', 'description', 'certifying_body', 'status'] as const;

// Một instance và pool được caller sở hữu. Ba ports chỉ là views trên cùng
// repository, không tạo pool/cache/catalog mới hoặc tự seed dữ liệu.
export class PostgresCatalogRepository {
  readonly materials: MaterialRecords;
  readonly standards: StandardRecords;
  readonly links: StandardMaterialRecords;

  constructor(private readonly pool: Pool, private readonly users: PostgresUsersRepository,
    private readonly clock: () => Date = () => new Date()) {
    this.materials = {
      create: (actor, input) => this.createMaterial(actor, input),
      get: (actor, id) => this.withActor(actor, false, (client) => this.read<AgriculturalMaterial>(client, 'agricultural_materials', id)),
      list: (actor, query) => this.withActor(actor, false, (client) => this.materialPage(client, catalogInput(MaterialListDto, query))),
      update: (actor, id, input) => this.updateMaterial(actor, id, input),
    };
    this.standards = {
      create: (actor, input) => this.createStandard(actor, input),
      get: (actor, id) => this.withActor(actor, false, (client) => this.read<FarmingStandard>(client, 'farming_standards', id)),
      list: (actor, query) => this.withActor(actor, false, (client) => this.standardPage(client, catalogInput(StandardListDto, query))),
      update: (actor, id, input) => this.updateStandard(actor, id, input),
    };
    this.links = {
      add: (actor, standard, material) => this.changeLink(actor, standard, material, true),
      remove: async (actor, standard, material) => { await this.changeLink(actor, standard, material, false); },
      list: (actor, standard, query) => this.withActor(actor, false, async (client) => {
        const current = await this.read(client, 'farming_standards', standard);
        return { standard_id: current.id, ...await this.materialPage(client, catalogInput(MaterialListDto, query), current.id) };
      }),
      has: (actor, standard, material) => this.withActor(actor, false, async (client) => {
        await this.read(client, 'farming_standards', standard);
        await this.read(client, 'agricultural_materials', material);
        return Boolean((await client.query('SELECT 1 FROM public.standard_materials WHERE standard_id=$1 AND material_id=$2', [standard, material])).rowCount);
      }),
    };
  }

  private async createMaterial(actor: string, input: CreateMaterialDto): Promise<AgriculturalMaterial> {
    return this.withActor(actor, true, async (client) => {
      const value = catalogInput(CreateMaterialDto, input);
      const dosage = materialDosage(value);
      return this.insert(client, 'agricultural_materials', actor, { ...value, ...dosage, default_dosage: dosage.default_dosage!, status: value.status ?? 'Active' }, MATERIAL_FIELDS);
    });
  }
  private async createStandard(actor: string, input: CreateStandardDto): Promise<FarmingStandard> {
    return this.withActor(actor, true, async (client) => {
      const value = catalogInput(CreateStandardDto, input);
      return this.insert(client, 'farming_standards', actor, { ...value, status: value.status ?? 'Active' }, STANDARD_FIELDS);
    });
  }
  private async updateMaterial(actor: string, id: string, input: UpdateMaterialDto): Promise<AgriculturalMaterial> {
    return this.withActor(actor, true, (client) => this.patch(client, 'agricultural_materials', actor, id, catalogInput(UpdateMaterialDto, input), MATERIAL_FIELDS));
  }
  private async updateStandard(actor: string, id: string, input: UpdateStandardDto): Promise<FarmingStandard> {
    return this.withActor(actor, true, (client) => this.patch(client, 'farming_standards', actor, id, catalogInput(UpdateStandardDto, input), STANDARD_FIELDS));
  }

  private fields(table: CatalogTable): readonly string[] { return table === 'agricultural_materials' ? MATERIAL_FIELDS : STANDARD_FIELDS; }
  // Domain đã kiểm tra actor/parent locks dùng client của chính transaction;
  // không gọi standards.get() mở transaction khác rồi chờ lại cùng user lock.
  async loadStandardOnClient(client: PoolClient, id: string, sharedLock = false): Promise<FarmingStandard> {
    catalogUuid(id);
    const result = await client.query<FarmingStandard>(`SELECT id,${STANDARD_FIELDS.join(',')} FROM public.farming_standards WHERE id=$1${sharedLock ? ' FOR SHARE' : ''}`, [id]);
    if (!result.rows[0]) { throw new NotFoundException('Không tìm thấy tiêu chuẩn'); }
    return result.rows[0];
  }
  // Trusted snapshot lookup for Cultivation; caller already owns authority and
  // Standard lock, then acquires Material IDs in sorted order on this client.
  async loadMaterialOnClient(client: PoolClient, id: string): Promise<AgriculturalMaterial> {
    catalogUuid(id);
    const result = await client.query<AgriculturalMaterial>(`SELECT id,${MATERIAL_FIELDS.join(',')} FROM public.agricultural_materials WHERE id=$1 FOR SHARE`, [id]);
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy vật tư');
    return result.rows[0];
  }
  private async read<T extends CatalogRecord>(client: PoolClient, table: CatalogTable, id: string, lock = false): Promise<T> {
    catalogUuid(id);
    // Table/columns đến từ whitelist nội bộ; mọi giá trị HTTP là parameters.
    const result = await client.query<T>(`SELECT id,${this.fields(table).join(',')} FROM public.${table} WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!result.rows[0]) { throw new NotFoundException(table === 'agricultural_materials' ? 'Không tìm thấy vật tư' : 'Không tìm thấy tiêu chuẩn'); }
    return result.rows[0];
  }
  private async insert<T extends CatalogRecord>(client: PoolClient, table: CatalogTable, actor: string,
    input: Omit<T, 'id'>, fields: readonly string[]): Promise<T> {
    const values = fields.map((key) => (input as Record<string, unknown>)[key]);
    const result = await client.query<T>(`INSERT INTO public.${table}(${fields.join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')})
      RETURNING id,${fields.join(',')}`, values);
    const row = result.rows[0];
    await this.metadata(client, table, row.id, { created_at: this.clock().toISOString() });
    await this.audit(client, table, row.id, actor, 'CatalogCreated', { changed_fields: [...fields] });
    return row;
  }
  private async patch<T extends CatalogRecord>(client: PoolClient, table: CatalogTable, actor: string, id: string,
    input: object, fields: readonly string[]): Promise<T> {
    // Row lock trước khi merge: hai PATCH khác fields giữ được cả hai thay đổi.
    // PATCH cùng field áp dụng tuần tự theo lock; không thêm If-Match vào API cũ.
    const current = await this.read<T>(client, table, id, true);
    const normalized = table === 'agricultural_materials' ? { ...input, ...materialDosage(input as UpdateMaterialDto, current as AgriculturalMaterial) } : input;
    const changes = Object.entries(normalized).filter(([, value]) => value !== undefined);
    if (!changes.length) { throw new BadRequestException('Cần ít nhất một field để cập nhật'); }
    if (changes.some(([key]) => !fields.includes(key))) { throw new BadRequestException('Thông tin không thuộc phạm vi được sửa'); }
    const result = await client.query<T>(`UPDATE public.${table} SET ${changes.map(([key], i) => `${key}=$${i + 2}`).join(',')}
      WHERE id=$1 RETURNING id,${fields.join(',')}`, [current.id, ...changes.map(([, value]) => value)]);
    await this.metadata(client, table, current.id, {});
    await this.audit(client, table, current.id, actor, 'CatalogUpdated', { changed_fields: changes.map(([key]) => key) });
    return result.rows[0];
  }

  private async materialPage(client: PoolClient, query: MaterialListDto, standard?: string): Promise<CatalogPage<AgriculturalMaterial>> {
    return this.page(client, 'agricultural_materials', query, `($1::text IS NULL OR m.status=$1) AND
      ($2::text IS NULL OR strpos(lower(m.name),lower($2))>0) AND ($3::text IS NULL OR m.material_type=$3) AND
      ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM public.standard_materials b WHERE b.standard_id=$4 AND b.material_id=m.id))`,
    [query.status ?? null, query.q ?? null, query.material_type ?? null, standard ?? null]);
  }
  private async standardPage(client: PoolClient, query: StandardListDto): Promise<CatalogPage<FarmingStandard>> {
    return this.page(client, 'farming_standards', query, `($1::text IS NULL OR m.status=$1) AND
      ($2::text IS NULL OR strpos(lower(m.name),lower($2))>0 OR strpos(lower(m.code),lower($2))>0)`, [query.status ?? null, query.q ?? null]);
  }
  private async page<T extends CatalogRecord>(client: PoolClient, table: CatalogTable, query: StandardListDto,
    where: string, parameters: unknown[]): Promise<CatalogPage<T>> {
    const limitIndex = parameters.length + 1;
    // Count + page dùng một statement/snapshot; offset quá cuối vẫn trả total.
    // strpos tìm substring literal: %, _, apostrophe không biến thành wildcard.
    const result = await client.query<{ total: string; items: T[] }>(`WITH filtered AS (
      SELECT m.id,${this.fields(table).map((field) => `m.${field}`).join(',')} FROM public.${table} m WHERE ${where}
    ), page AS (SELECT * FROM filtered ORDER BY id LIMIT $${limitIndex} OFFSET $${limitIndex + 1})
    SELECT (SELECT count(*) FROM filtered)::text AS total, COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM page p),'[]'::jsonb) AS items`,
    [...parameters, query.limit, query.offset]);
    return { items: result.rows[0].items, total: safeInteger(result.rows[0].total), limit: query.limit, offset: query.offset };
  }

  private async changeLink(actor: string, standard: string, material: string, add: boolean) {
    return this.withActor(actor, true, async (client) => {
      // Thứ tự cố định Standard → Material. Inactive vẫn cấu hình bridge được;
      // điều kiện Active thuộc nghiệp vụ Zone/Cultivation, không thuộc bridge.
      // PostgreSQL UUID không phân biệt hoa/thường; metadata key là TEXT.
      // Dùng UUID canonical từ row để không tách version/audit thành hai keys.
      standard = (await this.read(client, 'farming_standards', standard, true)).id;
      material = (await this.read(client, 'agricultural_materials', material, true)).id;
      if (add) { await client.query('INSERT INTO public.standard_materials(standard_id,material_id) VALUES ($1,$2)', [standard, material]); }
      else {
        const result = await client.query('DELETE FROM public.standard_materials WHERE standard_id=$1 AND material_id=$2', [standard, material]);
        if (!result.rowCount) { throw new NotFoundException('Không tìm thấy liên kết tiêu chuẩn–vật tư'); }
      }
      const key = `${standard}:${material}`;
      // Giữ metadata khi unlink: version/seed manifest không mất hoặc reset
      // khi re-link. Rerun seed phải báo conflict thay vì dựng lại link đã bỏ.
      await this.metadata(client, 'standard_materials', key, { linked: add });
      await this.audit(client, 'standard_materials', key, actor, add ? 'StandardMaterialLinked' : 'StandardMaterialUnlinked',
        { standard_id: standard, material_id: material });
      return { standard_id: standard, material_id: material };
    });
  }
  private async metadata(client: PoolClient, table: string, key: string, data: Record<string, unknown>) {
    const result = await client.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,version,data) VALUES ($1,$2,1,$3)
      ON CONFLICT(entity_type,entity_key) DO UPDATE SET version=technical.entity_metadata.version+1,
      data=technical.entity_metadata.data || EXCLUDED.data WHERE technical.entity_metadata.version BETWEEN 1 AND 9007199254740990 RETURNING version`,
    [table, key, JSON.stringify(data)]);
    if (!result.rowCount) { throw new Error('Invalid or exhausted catalog version'); }
  }
  private async audit(client: PoolClient, table: string, key: string, actor: string, action: string, payload: Record<string, unknown>) {
    await client.query('INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ($1,$2,$3,$4,$5,$6)',
      [table, key, actor, action, this.clock(), JSON.stringify(payload)]);
  }
  private async withActor<T>(actor: string, admin: boolean, work: (client: PoolClient) => Promise<T>): Promise<T> {
    try {
      return await inPostgresTransaction(this.pool, async (client) => {
        catalogUuid(actor);
        actor = actor.toLowerCase();
        // Cùng lock order với Users/HTX: user → user metadata → catalog.
        // Recheck sau lock để request đợi không dùng quyền Admin đã bị thu hồi.
        await client.query('SELECT id FROM public.users WHERE id=$1 FOR UPDATE', [actor]);
        await client.query("SELECT entity_key FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=$1 FOR UPDATE", [actor]);
        const account = await this.users.loadOnClient(client, actor);
        if (!account || account.user.status !== 'Active' || (admin && account.user.role !== 'Admin')) {
          throw new ForbiddenException(admin ? 'Chỉ Admin được thực hiện thao tác này' : 'Tài khoản phải Active');
        }
        return work(client);
      });
    } catch (error) {
      if (error instanceof HttpException) { throw error; }
      const driver = error as { code?: string; constraint?: string };
      if (driver.code === '23505' && driver.constraint === 'standard_materials_pkey') { throw new ConflictException('Vật tư đã được gắn với tiêu chuẩn này'); }
      throw new ServiceUnavailableException('Không thể truy cập dữ liệu danh mục; vui lòng thử lại sau');
    }
  }
}
