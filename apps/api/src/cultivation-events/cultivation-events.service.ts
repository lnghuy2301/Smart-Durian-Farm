import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ObjectId } from 'mongodb';
import { MockUserStore, TestUser } from '../auth/mock-user.store';
import { FarmsService } from '../farms/farms.service';
import { ZonesService } from '../zones/zones.service';
import { TreesService } from '../trees/trees.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { MockZoneAssignmentStore } from '../assignments/mock-zone-assignment.store';
import { assignmentActive } from '../assignments/assignment-policy';
import { MaterialsService } from '../materials/materials.service';
import { StandardsService } from '../standards/standards.service';
import { StandardMaterialsService } from '../standard-materials/standard-materials.service';
import { FarmPageDto } from '../farms/farms.dto';
import { CreateCorrectionDto, CreateEventDto, EventDetailsDto, EventIdDto, EventListDto, UpdateEventDto } from './cultivation-events.dto';
import { CultivationEvent, EventDetails, LOCK_DELAY_MS } from './cultivation-events.types';
import { CultivationEventsStore } from './cultivation-events.store';
import { compareEvents } from './cultivation-chain';

@Injectable()
export class CultivationEventsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(MockUserStore) private readonly users: MockUserStore,
    @Inject(FarmsService) private readonly farms: FarmsService,
    @Inject(ZonesService) private readonly zones: ZonesService,
    @Inject(TreesService) private readonly trees: TreesService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(MockZoneAssignmentStore) private readonly assignmentStore: MockZoneAssignmentStore,
    @Inject(MaterialsService) private readonly materials: MaterialsService,
    @Inject(StandardsService) private readonly standards: StandardsService,
    @Inject(StandardMaterialsService) private readonly standardMaterials: StandardMaterialsService,
    @Inject(CultivationEventsStore) private readonly store: CultivationEventsStore,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.store.lockDue(), 30000);
    this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = undefined; } }

  create(actorId: string, input: CreateEventDto): CultivationEvent {
    const actor = this.farmer(actorId);
    const body = this.validate(CreateEventDto, input);
    this.store.lockDue();
    const zone = this.resolveTarget(body);
    const farm = this.farms.getRecord(zone.farm_id);
    const now = Date.now();
    let assignmentId: string | null = null;
    if (farm.owner_id !== actor.id) {
      this.assignments.assertCanWork(actor.id, zone.id);
      const accepted = this.assignmentStore.list().find(({ assignment }) => assignment.user_id === actor.id
        && assignment.zone_id === zone.id && assignmentActive(assignment, now));
      if (!accepted) { throw new ForbiddenException('Assignment expired before journal creation'); }
      assignmentId = accepted.assignment.id;
    }
    const event = this.newEvent(actor.id, body, now);
    return this.store.add(event, { zone_id: zone.id, farm_id: farm.id, author_id: actor.id,
      assignment_id: assignmentId, original_created_at: event.created_at, root_id: event._id });
  }

  update(actorId: string, id: string, input: UpdateEventDto): CultivationEvent {
    this.farmer(actorId);
    const body = this.validate(UpdateEventDto, input);
    const keys = Object.keys(body).filter((key) => body[key as keyof UpdateEventDto] !== undefined);
    if (!keys.length) { throw new BadRequestException('Provide at least one editable field'); }
    this.store.lockDue();
    const current = this.event(id);
    this.assertAuthorCanCorrect(actorId, current);
    this.pending(current);
    if (body.action_type !== undefined && body.action_type !== current.action_type && body.details === undefined) {
      throw new BadRequestException('Changing action_type requires replacement details');
    }
    const target = { target_type: body.target_type ?? current.target_type, target_id: body.target_id ?? current.target_id };
    this.assertSameZone(current, target);
    const action = body.action_type ?? current.action_type;
    const details = body.details === undefined ? current.details : this.buildDetails(action, body.details, this.store.context(id).zone_id);
    return this.store.update({ ...current, ...target, action_type: action, details });
  }

  remove(actorId: string, id: string): void {
    this.farmer(actorId);
    this.store.lockDue();
    const current = this.event(id);
    this.assertAuthorCanCorrect(actorId, current);
    this.pending(current);
    this.store.remove(id);
  }

  correct(actorId: string, id: string, input: CreateCorrectionDto): CultivationEvent {
    this.farmer(actorId);
    const body = this.validate(CreateCorrectionDto, input);
    this.store.lockDue();
    const current = this.event(id);
    this.assertAuthorCanCorrect(actorId, current);
    if (current.status !== 'Locked') { throw new ConflictException('Correct only Locked events; edit Pending instead'); }
    const context = this.store.context(id);
    const lineage = this.lineage(context.root_id);
    // Correction nối tiếp để hai request không cùng thay thế một bản gốc.
    // Client phải tải lại và tham chiếu bản Locked mới nhất; không rẽ nhánh.
    if (lineage.some((event) => event.status === 'Pending')) { throw new ConflictException('A correction is already Pending'); }
    if (lineage[lineage.length - 1]._id !== id) { throw new ConflictException('Reference the latest Locked correction'); }
    this.assertSameZone(current, body);
    const event: CultivationEvent = { ...this.newEvent(actorId, body, Date.now()), is_correction: true,
      reference_event_id: id, root_event_id: context.root_id, correction_reason: body.correction_reason };
    return this.store.add(event, context);
  }

  get(actorId: string, id: string): CultivationEvent {
    const actor = this.active(actorId);
    this.store.lockDue();
    const event = this.event(id);
    if (!this.canRead(actor, event)) { throw new NotFoundException('Cultivation event not found in your scope'); }
    return event;
  }

  list(actorId: string, query: EventListDto, mineOnly = false) {
    const actor = this.active(actorId);
    const filter = this.validate(EventListDto, query);
    this.store.lockDue();
    const visible = this.store.list().filter((event) => (mineOnly ? event.farmer_id === actor.id : this.canRead(actor, event))
      && (!filter.zone_id || this.store.context(event._id).zone_id === filter.zone_id)
      && (!filter.target_type || event.target_type === filter.target_type)
      && (!filter.target_id || event.target_id === filter.target_id)
      && (!filter.action_type || event.action_type === filter.action_type)
      && (!filter.status || event.status === filter.status)).sort(compareEvents).reverse();
    return this.page(visible, filter);
  }

  corrections(actorId: string, id: string, query: FarmPageDto) {
    this.get(actorId, id);
    const page = this.validate(FarmPageDto, query);
    // Trả bản gốc trước, rồi các correction. Pending chưa thay thế nội dung
    // Locked có hiệu lực; frontend phải phân biệt hai trạng thái này.
    return this.page(this.lineage(this.store.context(id).root_id), page);
  }

  verify(actorId: string, zoneId: string) {
    this.active(actorId);
    // Quyền đọc lịch sử của mình không cấp lại toàn bộ chain Zone sau hết việc.
    this.zones.get(actorId, zoneId);
    this.store.lockDue();
    return { zone_id: zoneId, algorithm: 'SHA-256', ...this.store.verify(zoneId), checked_at: new Date().toISOString() };
  }

  // Adapter nội bộ nhận nguyên lịch sử Locked trong Zone để dựng lineage rồi
  // mới xét target. Không expose raw records này qua route public hoặc bỏ guard
  // ở controller Cultivation; TraceabilityService có whitelist riêng.
  lockedForTrace(zoneId: string): CultivationEvent[] {
    this.zones.getRecord(zoneId);
    this.store.lockDue();
    return this.store.list().filter((event) => event.status === 'Locked'
      && this.store.context(event._id).zone_id === zoneId).sort(compareEvents);
  }

  private newEvent(actorId: string, input: CreateEventDto, now: number): CultivationEvent {
    const zone = this.resolveTarget(input);
    return { _id: new ObjectId().toHexString(), farmer_id: actorId,
      target_type: input.target_type, target_id: input.target_id, action_type: input.action_type,
      details: this.buildDetails(input.action_type, input.details, zone.id), status: 'Pending',
      is_correction: false, reference_event_id: null, root_event_id: null, correction_reason: null,
      created_at: new Date(now).toISOString(), locked_at: null, lock_at: new Date(now + LOCK_DELAY_MS).toISOString(),
      previous_hash: null, hash: null };
  }

  private buildDetails(action: CultivationEvent['action_type'], input: EventDetailsDto, zoneId: string): EventDetails {
    const zone = this.zones.getRecord(zoneId);
    const standard = this.standards.get(zone.standard_id);
    const details: EventDetails = { standard_snapshot: { standard_id: standard.id, code: standard.code, name: standard.name },
      note: input.note ?? null, warnings: [] };
    if (action === 'Other') {
      if (!input.activity_name?.trim() || input.materials !== undefined || input.duration_minutes !== undefined || input.water_volume_l !== undefined) {
        throw new BadRequestException('Công việc khác cần tên công việc, chỉ nhận ghi chú, không nhận vật tư/thông tin tưới');
      }
      return { ...details, activity_name: input.activity_name.trim() };
    }
    if (input.activity_name !== undefined) throw new BadRequestException('Tên công việc tự nhập chỉ dành cho hoạt động Khác');
    if (action === 'Watering') {
      if (input.duration_minutes === undefined || input.materials !== undefined) { throw new BadRequestException('Watering requires duration_minutes and does not accept materials'); }
      return { ...details, duration_minutes: input.duration_minutes, water_volume_l: input.water_volume_l ?? null };
    }
    if (!input.materials?.length || input.duration_minutes !== undefined || input.water_volume_l !== undefined) {
      throw new BadRequestException('Spraying/Fertilizing requires materials and does not accept watering fields');
    }
    if (new Set(input.materials.map((item) => item.material_id)).size !== input.materials.length) {
      throw new BadRequestException('Use one entry per material_id');
    }
    details.materials = input.materials.map(({ material_id, quantity }) => {
      const material = this.materials.get(material_id);
      if (material.status !== 'Active') { throw new BadRequestException('Only Active materials may be selected'); }
      const linked = this.standardMaterials.has(standard.id, material_id);
      if (!linked) { details.warnings.push({ code: 'MATERIAL_OUTSIDE_STANDARD', material_id }); }
      return { material_id, quantity, name: material.name, material_type: material.material_type, unit: material.unit,
        default_dosage: material.default_dosage, quarantine_days: material.quarantine_days, standard_linked: linked,
        ...(material.default_dosage_value != null && material.dosage_basis != null ? { default_dosage_value: material.default_dosage_value, dosage_basis: material.dosage_basis } : {}) };
    });
    return details;
  }

  private resolveTarget(input: Pick<CreateEventDto, 'target_type' | 'target_id'>) {
    const zoneId = input.target_type === 'Zone' ? input.target_id : this.trees.getRecord(input.target_id).zone_id;
    return this.zones.getRecord(zoneId);
  }

  private assertSameZone(current: CultivationEvent, target: Pick<CreateEventDto, 'target_type' | 'target_id'>): void {
    if (this.resolveTarget(target).id !== this.store.context(current._id).zone_id) { throw new BadRequestException('Cannot move an event to another Zone'); }
  }

  private assertAuthorCanCorrect(actorId: string, event: CultivationEvent): void {
    if (event.farmer_id !== actorId) { throw new ForbiddenException('Only the original author may edit or correct'); }
    const context = this.store.context(event._id);
    if (context.assignment_id !== null) {
      // Dùng created_at và phân công GỐC. Lấy thời điểm correction sẽ làm sai
      // cửa sổ grace; lấy phân công mới sẽ vô tình gia hạn quyền lịch sử cũ.
      this.assignments.assertCanCorrect(actorId, { assignment_id: context.assignment_id,
        zone_id: context.zone_id, author_id: context.author_id, created_at: context.original_created_at });
    } else if (this.farms.getRecord(context.farm_id).owner_id !== actorId) {
      throw new ForbiddenException('Original owner may correct only while still owning the Farm');
    }
  }

  private canRead(actor: TestUser, event: CultivationEvent): boolean {
    if (event.farmer_id === actor.id) { return true; }
    try { this.zones.get(actor.id, this.store.context(event._id).zone_id); return true; }
    catch (error) { if (error instanceof NotFoundException) { return false; } throw error; }
  }

  private lineage(rootId: string): CultivationEvent[] {
    return this.store.list().filter((event) => event._id === rootId || event.root_event_id === rootId).sort(compareEvents);
  }

  private event(id: string): CultivationEvent {
    this.validate(EventIdDto, { id });
    return this.store.get(id);
  }
  private pending(event: CultivationEvent): void {
    if (event.status !== 'Pending' || Date.now() >= Date.parse(event.lock_at)) { throw new ConflictException('Event is Locked; create a correction instead'); }
  }
  private active(id: string): TestUser {
    const user = this.users.findById(id);
    if (user?.status !== 'Active') { throw new ForbiddenException('Active account required'); }
    return user;
  }
  private farmer(id: string): TestUser {
    const user = this.active(id);
    if (user.role !== 'Farmer') { throw new ForbiddenException('Admin and Manager may only read cultivation events'); }
    return user;
  }
  private validate<T extends object>(type: new () => T, input: object): T {
    const value = plainToInstance(type, input);
    if (validateSync(value, { whitelist: true, forbidNonWhitelisted: true }).length) { throw new BadRequestException('Invalid cultivation request fields'); }
    return value;
  }
  private page(items: CultivationEvent[], query: FarmPageDto) {
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length, limit: query.limit, offset: query.offset };
  }
}
