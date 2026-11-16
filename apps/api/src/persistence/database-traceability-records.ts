import { HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import QRCode from 'qrcode';
import { TraceabilityRecords } from '../traceability/traceability-records';
import { TraceabilityConfig } from '../traceability/traceability.config';
import { projectCultivation } from '../traceability/cultivation-projection';
import { FarmPageDto } from '../farms/farms.dto';
import { farmInput } from '../farms/farm-validation';
import { CultivationRecords } from '../cultivation-events/cultivation-records';
import { HarvestRecords } from '../tree-harvests/harvest-records';
import { PublicTrace } from '../traceability/traceability.types';
import { PostgresTreesRepository } from './postgres-trees.repository';

export class DatabaseTraceabilityRecords extends TraceabilityRecords {
  constructor(private readonly pool: Pool, private readonly trees: PostgresTreesRepository, private readonly cultivation: CultivationRecords,
    private readonly harvests: HarvestRecords, private readonly config: TraceabilityConfig) { super(); }
  async get(code: string): Promise<PublicTrace> {
    return this.safe(async () => {
      const { tree, metadata } = await this.context(code);
      return { tree: { tree_code: tree.tree_code, variety: tree.variety, plant_date: tree.plant_date, status: tree.status },
        zone: { name: metadata.zone_name }, cooperative: metadata.cooperative_name === null ? null : { name: metadata.cooperative_name },
        standard: { code: metadata.standard_code, name: metadata.standard_name, status: metadata.standard_status }, trace_url: this.url(code) };
    });
  }
  async cultivationHistory(code: string, query: FarmPageDto) {
    const page = farmInput(FarmPageDto, query);
    return this.safe(async () => {
      const { tree, metadata } = await this.context(code), records = await this.cultivation.lockedForTrace(tree.zone_id);
      const ids = [...new Set(records.filter((event) => event.target_type === 'Tree').map((event) => event.target_id))];
      const rows = await this.pool.query<{ id: string; tree_code: string }>('SELECT id,tree_code FROM public.trees WHERE zone_id=$1 AND id=ANY($2::uuid[])', [tree.zone_id, ids]);
      const codes = new Map(rows.rows.map((row) => [row.id, row.tree_code]));
      const items = projectCultivation(records, tree.id, tree.zone_id, metadata.zone_name, (id) => {
        const result = codes.get(id); if (!result) throw new ServiceUnavailableException('Không thể xác định cây trong lịch sử truy xuất'); return result;
      });
      return this.page(items, page);
    });
  }
  async harvestHistory(code: string, query: FarmPageDto) {
    const page = farmInput(FarmPageDto, query);
    return this.safe(async () => {
      const { tree } = await this.context(code);
      const items = (await this.harvests.confirmedForTrace(tree.id)).sort((a, b) => b.harvest_date.localeCompare(a.harvest_date) || a.batch_code.localeCompare(b.batch_code))
        .map((record) => ({ season_name: record.season_name, harvest_date: record.harvest_date, fruit_count: record.fruit_count,
          total_weight_kg: record.total_weight_kg, batch_code: record.batch_code, confirmation_state: 'Confirmed' as const }));
      return this.page(items, page);
    });
  }
  async qrSvg(code: string) {
    return this.safe(async () => {
      await this.context(code);
      return QRCode.toString(this.url(code), { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 320, color: { dark: '#000000ff', light: '#ffffffff' } });
    });
  }
  private async context(code: string) {
    const tree = await this.trees.getTraceRecordByCode(code);
    const result = await this.pool.query<{ zone_name: string; cooperative_name: string | null; standard_code: string; standard_name: string; standard_status: 'Active' | 'Inactive' }>(
      `SELECT z.zone_name,c.cooperative_name,s.code AS standard_code,s.name AS standard_name,s.status AS standard_status
       FROM public.zones z JOIN public.farms f ON f.id=z.farm_id JOIN public.farming_standards s ON s.id=z.standard_id
       LEFT JOIN public.cooperatives c ON c.id=f.cooperative_id WHERE z.id=$1`, [tree.zone_id]);
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy cây');
    return { tree, metadata: result.rows[0] };
  }
  private url(code: string) { return `${this.config.publicBaseUrl}/trace/${encodeURIComponent(code)}`; }
  private page<T>(items: T[], query: FarmPageDto) { return { items: items.slice(query.offset, query.offset + query.limit), total: items.length, limit: query.limit, offset: query.offset }; }
  private async safe<T>(work: () => Promise<T>) {
    try { return await work(); }
    catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException('Không thể đọc thông tin truy xuất'); }
  }
}
