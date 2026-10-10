import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import QRCode from 'qrcode';
import { TreesService } from '../trees/trees.service';
import { FarmsService } from '../farms/farms.service';
import { ZonesService } from '../zones/zones.service';
import { StandardsService } from '../standards/standards.service';
import { MockCooperativeStore } from '../users/mock-cooperative.store';
import { CultivationEventsService } from '../cultivation-events/cultivation-events.service';
import { TreeHarvestsService } from '../tree-harvests/tree-harvests.service';
import { TreeCodeParamDto } from '../trees/trees.dto';
import { FarmPageDto } from '../farms/farms.dto';
import { CultivationEvent } from '../cultivation-events/cultivation-events.types';
import { compareEvents } from '../cultivation-events/cultivation-chain';
import { TRACEABILITY_CONFIG, TraceabilityConfig } from './traceability.config';
import { PublicHarvest, PublicTarget, PublicTrace, PublicVersion } from './traceability.types';

@Injectable()
export class TraceabilityService {
  constructor(
    @Inject(TreesService) private readonly trees: TreesService,
    @Inject(FarmsService) private readonly farms: FarmsService,
    @Inject(ZonesService) private readonly zones: ZonesService,
    @Inject(StandardsService) private readonly standards: StandardsService,
    @Inject(MockCooperativeStore) private readonly cooperatives: MockCooperativeStore,
    @Inject(CultivationEventsService) private readonly cultivation: CultivationEventsService,
    @Inject(TreeHarvestsService) private readonly harvests: TreeHarvestsService,
    @Inject(TRACEABILITY_CONFIG) private readonly config: TraceabilityConfig,
  ) {}

  get(code: string): PublicTrace {
    const { tree, zone, farm } = this.context(code);
    const standard = this.standards.get(zone.standard_id);
    return { tree: { tree_code: tree.tree_code, variety: tree.variety, plant_date: tree.plant_date, status: tree.status },
      zone: { name: zone.zone_name },
      cooperative: farm.cooperative_id ? { name: this.cooperatives.get(farm.cooperative_id).cooperative_name } : null,
      standard: { code: standard.code, name: standard.name, status: standard.status },
      trace_url: this.traceUrl(code) };
  }

  cultivationHistory(code: string, query: FarmPageDto) {
    const page = this.query(query);
    const { tree, zone } = this.context(code);
    const roots = new Map<string, CultivationEvent[]>();
    for (const event of this.cultivation.lockedForTrace(zone.id)) {
      const root = event.root_event_id ?? event._id;
      const versions = roots.get(root) ?? [];
      versions.push(event);
      roots.set(root, versions);
    }
    const matches = (event: CultivationEvent) => event.target_type === 'Zone' ? event.target_id === zone.id : event.target_id === tree.id;
    // Xây lineage đầy đủ trước khi lọc: A→B→C vẫn hiện cả chuỗi trên QR A/B/C,
    // chỉ bản mới nhất mô tả nội dung hiện tại. Pending chưa tham gia roots.
    const relevant = [...roots.entries()].filter(([, versions]) => versions.some(matches))
      .sort((a, b) => compareEvents(b[1][b[1].length - 1], a[1][a[1].length - 1]));
    const items: PublicVersion[] = [];
    for (const [root, versions] of relevant) {
      const latest = versions[versions.length - 1];
      const latestTarget = this.target(latest, zone.zone_name);
      // Khóa nhóm công khai là SHA-256 của root, không phải ObjectId/UUID nội bộ,
      // không là token xác thực. Dùng để giữ nhóm khi pagination cắt qua lineage.
      const historyKey = createHash('sha256').update(`smart-durian/trace-history/v1/${root}`).digest('hex');
      versions.forEach((event, index) => {
        const details: PublicVersion['details'] = { standard_snapshot: {
          code: event.details.standard_snapshot.code, name: event.details.standard_snapshot.name } };
        if (event.action_type === 'Watering') {
          details.duration_minutes = event.details.duration_minutes;
          details.water_volume_l = event.details.water_volume_l ?? null;
        } else {
          details.materials = (event.details.materials ?? []).map((material) => ({ name: material.name,
            quantity: material.quantity, unit: material.unit, standard_linked: material.standard_linked }));
        }
        // Whitelist ở mọi cấp; không spread raw event/details/materials vì
        // chúng có farmer_id, material_id, note và correction_reason riêng tư.
        items.push({ history_key: historyKey, version: index + 1, latest_version: versions.length,
          is_correction: event.is_correction, is_latest: event._id === latest._id,
          applies_to_tree: matches(event), latest_applies_to_tree: matches(latest),
          target: this.target(event, zone.zone_name), latest_target: latestTarget, action_type: event.action_type,
          entered_at: event.created_at, locked_at: event.locked_at!, details });
      });
    }
    return this.page(items, page);
  }

  harvestHistory(code: string, query: FarmPageDto) {
    const page = this.query(query);
    const { tree } = this.context(code);
    const items: PublicHarvest[] = this.harvests.confirmedForTrace(tree.id)
      .sort((a, b) => b.harvest_date.localeCompare(a.harvest_date) || a.batch_code.localeCompare(b.batch_code))
      .map((record) => ({ season_name: record.season_name, harvest_date: record.harvest_date, fruit_count: record.fruit_count,
        total_weight_kg: record.total_weight_kg, batch_code: record.batch_code, confirmation_state: 'Confirmed' }));
    return this.page(items, page);
  }

  async qrSvg(code: string): Promise<string> {
    this.context(code);
    return QRCode.toString(this.traceUrl(code), { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 320,
      color: { dark: '#000000ff', light: '#ffffffff' } });
  }

  private context(code: string) {
    const dto = plainToInstance(TreeCodeParamDto, { treeCode: code });
    if (validateSync(dto).length) { throw new BadRequestException('Invalid tree_code'); }
    const tree = this.trees.getTraceRecordByCode(code);
    const zone = this.zones.getRecord(tree.zone_id);
    return { tree, zone, farm: this.farms.getRecord(zone.farm_id) };
  }
  private traceUrl(code: string): string { return `${this.config.publicBaseUrl}/trace/${encodeURIComponent(code)}`; }
  private target(event: CultivationEvent, zoneName: string): PublicTarget {
    return { type: event.target_type, label: event.target_type === 'Zone' ? zoneName : this.trees.getRecord(event.target_id).tree_code };
  }
  private query(input: FarmPageDto): FarmPageDto {
    const dto = plainToInstance(FarmPageDto, input);
    if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length) { throw new BadRequestException('Invalid trace pagination'); }
    return dto;
  }
  private page<T>(items: T[], query: FarmPageDto) {
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length, limit: query.limit, offset: query.offset };
  }
}
