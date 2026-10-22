import { BadRequestException, Controller, DynamicModule, Get, HttpException, Inject, Module, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { UserAccounts } from '../auth/user-accounts';
import { FarmRecords } from '../farms/farm-records';
import { ZoneRecords } from '../zones/zone-records';
import { TreeRecords } from '../trees/tree-records';
import { DeviceRecords } from '../devices/device-records';
import { SensorRecords } from '../sensors/sensor-records';
import { ActuatorRecords } from '../actuators/actuator-records';
import { HarvestRecords } from '../tree-harvests/harvest-records';
import { AssignmentRecords } from '../assignments/assignment-records';
import { CultivationRecords } from '../cultivation-events/cultivation-records';
import { CooperativeRecords } from '../cooperatives/cooperative-records';
import { MaterialRecords, StandardRecords } from '../catalog/catalog-records';

@ApiTags('display-references')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('display-references')
export class DisplayController {
  constructor(
    @Inject(UserAccounts) private readonly users: UserAccounts,
    @Inject(FarmRecords) private readonly farms: FarmRecords,
    @Inject(ZoneRecords) private readonly zones: ZoneRecords,
    @Inject(TreeRecords) private readonly trees: TreeRecords,
    @Inject(DeviceRecords) private readonly devices: DeviceRecords,
    @Inject(SensorRecords) private readonly sensors: SensorRecords,
    @Inject(ActuatorRecords) private readonly actuators: ActuatorRecords,
    @Inject(HarvestRecords) private readonly harvests: HarvestRecords,
    @Inject(AssignmentRecords) private readonly assignments: AssignmentRecords,
    @Inject(CultivationRecords) private readonly cultivation: CultivationRecords,
    @Inject(CooperativeRecords) private readonly cooperatives: CooperativeRecords,
    @Inject(StandardRecords) private readonly standards: StandardRecords,
    @Inject(MaterialRecords) private readonly materials: MaterialRecords,
  ) {}

  @Get(':kind/:id')
  async get(@Req() request: AuthRequest, @Param('kind') kind: string, @Param('id') id: string) {
    const actor = request.user!.id;
    const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
    if (!(kind === 'cultivation-events' ? /^[\da-f]{24}$/i.test(id) : uuid.test(id))) throw new BadRequestException('Mã hồ sơ không hợp lệ');
    const resources = {
      farms: this.farms, zones: this.zones, trees: this.trees, devices: this.devices,
      sensors: this.sensors, actuators: this.actuators, 'tree-harvests': this.harvests,
      'zone-assignments': this.assignments, 'cultivation-events': this.cultivation,
      cooperatives: this.cooperatives,
    };
    const requests = {
      'farm-requests': this.farms, 'zone-requests': this.zones, 'tree-requests': this.trees,
      'device-requests': this.devices, 'sensor-requests': this.sensors, 'actuator-requests': this.actuators,
      'harvest-requests': this.harvests, 'assignment-requests': this.assignments,
    };
    // Authorize the source through its existing repository BEFORE looking up any
    // name. Clients cannot submit arbitrary user IDs or expand the QR whitelist.
    let source: unknown;
    if (kind === 'harvest-backdate-permissions') {
      // This repository exposes an authorized list, not a trusted get-by-id.
      // Scan that scoped list only; never read permission metadata directly.
      for (let offset = 0; ; offset += 100) {
        const page = await this.harvests.listBackdates(actor, { limit: 100, offset });
        source = page.items.find((item) => item.id === id);
        if (source || offset + page.items.length >= page.total || !page.items.length) break;
      }
      if (!source) throw new NotFoundException('Không tìm thấy quyền nhập bù');
    }
    else if (Object.hasOwn(resources, kind)) source = await resources[kind as keyof typeof resources].get(actor, id);
    else if (Object.hasOwn(requests, kind)) source = await requests[kind as keyof typeof requests].getRequest(actor, id);
    else throw new BadRequestException('Loại hồ sơ không được hỗ trợ');
    const labels: Record<string, string> = {};
    const record = source as Record<string, unknown>;
    const self = kind === 'cooperatives' ? record.cooperative as Record<string, unknown> : record;
    const selfKey: Record<string, string> = { farms: 'address', zones: 'zone_name', trees: 'tree_code', devices: 'station_id', sensors: 'name', actuators: 'name', cooperatives: 'cooperative_name' };
    if (selfKey[kind] && typeof self[selfKey[kind]] === 'string') labels[id] = self[selfKey[kind]] as string;
    const userKeys = new Set(['owner_id', 'user_id', 'farmer_id', 'manager_id', 'created_by', 'updated_by', 'proposed_by', 'requested_by', 'changed_by', 'granted_by', 'resolved_by', 'editor_id', 'actor_id']);
    const pending = new Map<string, () => Promise<void>>();
    const visit = (value: unknown, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 5) return;
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'object') { visit(item, depth + 1); continue; }
        if (typeof item !== 'string' || !/^[\da-f-]{36}$/i.test(item)) continue;
        const field = key === 'target_id' ? ((value as { target_type?: string }).target_type === 'Tree' ? 'tree_id' : 'zone_id') : key;
        if (!userKeys.has(field) && !['tree_id', 'zone_id', 'farm_id', 'device_id', 'cooperative_id', 'standard_id', 'material_id'].includes(field)) continue;
        if (pending.size >= 50) continue;
        pending.set(`${field}:${item}`, async () => {
          try {
            let label: string | undefined;
            if (userKeys.has(field)) label = (await this.users.loadById(item))?.user.user_name;
            else if (field === 'tree_id') label = (await this.trees.get(actor, item)).tree_code;
            else if (field === 'zone_id') label = (await this.zones.get(actor, item)).zone_name;
            else if (field === 'farm_id') label = (await this.farms.get(actor, item)).address;
            else if (field === 'device_id') label = (await this.devices.get(actor, item)).station_id;
            else if (field === 'cooperative_id') label = (await this.cooperatives.get(actor, item)).cooperative.cooperative_name;
            else if (field === 'standard_id') { const s = await this.standards.get(actor, item); label = `${s.code} · ${s.name}`; }
            else if (field === 'material_id') label = (await this.materials.get(actor, item)).name;
            if (label) labels[item] = label;
          } catch (error) {
            // A historical relation may no longer be visible. Keep its ID in
            // the UI; do not use trusted/unscoped repository lookups instead.
            if (!(error instanceof HttpException) || ![403, 404].includes(error.getStatus())) throw error;
          }
        });
      }
    };
    visit(source);
    await Promise.all([...pending.values()].map((resolve) => resolve()));
    return { labels };
  }
}

@Module({})
export class DisplayModule {
  static register(imports: DynamicModule[]): DynamicModule {
    return { module: DisplayModule, imports, controllers: [DisplayController] };
  }
}
