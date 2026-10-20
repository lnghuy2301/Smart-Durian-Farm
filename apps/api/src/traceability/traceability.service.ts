import { projectCultivation } from './cultivation-projection';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
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
import { TRACEABILITY_CONFIG, TraceabilityConfig } from './traceability.config';
import { PublicHarvest, PublicTrace } from './traceability.types';

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
    const items = projectCultivation(this.cultivation.lockedForTrace(zone.id), tree.id, zone.id, zone.zone_name, (id) => this.trees.getRecord(id).tree_code);
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
  private query(input: FarmPageDto): FarmPageDto {
    const dto = plainToInstance(FarmPageDto, input);
    if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length) { throw new BadRequestException('Invalid trace pagination'); }
    return dto;
  }
  private page<T>(items: T[], query: FarmPageDto) {
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length, limit: query.limit, offset: query.offset };
  }
}
