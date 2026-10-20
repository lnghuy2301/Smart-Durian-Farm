import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { Pool, PoolClient } from 'pg';
import { CultivationRecords } from '../cultivation-events/cultivation-records';
import { CreateCorrectionDto, CreateEventDto, EventDetailsDto, EventIdDto, EventListDto, UpdateEventDto } from '../cultivation-events/cultivation-events.dto';
import { CultivationEvent, EventContext, EventDetails, LOCK_DELAY_MS } from '../cultivation-events/cultivation-events.types';
import { CultivationEventsStore } from '../cultivation-events/cultivation-events.store';
import { compareEvents } from '../cultivation-events/cultivation-chain';
import { assignmentActive, assignmentAllowsCorrection } from '../assignments/assignment-policy';
import { UserZoneAssignment } from '../assignments/assignments.types';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { FarmPageDto } from '../farms/farms.dto';
import { AgriculturalMaterial } from '../materials/materials.service';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresTreesRepository } from './postgres-trees.repository';
import { PostgresAssignmentsRepository } from './postgres-assignments.repository';
import { PostgresCatalogRepository } from './postgres-catalog.repository';
import { PostgresDomainAccess, RetryDomainContext, ZoneWriteContext } from './domain-access';
import { MongoCultivationStore } from './mongo-cultivation.store';
import { inPostgresTransaction } from './transactions';
import { ZONE_READ_SCOPE } from './zone-read-scope';

export class DatabaseCultivationRecords extends CultivationRecords implements OnModuleInit, OnModuleDestroy {
  private readonly access: PostgresDomainAccess;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private closing = false;
  constructor(private readonly pool: Pool, users: PostgresUsersRepository, farms: PostgresFarmsRepository,
    private readonly zones: PostgresZonesRepository, private readonly trees: PostgresTreesRepository,
    private readonly assignments: PostgresAssignmentsRepository, private readonly catalogs: PostgresCatalogRepository,
    private readonly store: MongoCultivationStore, private readonly clock: () => number = Date.now) {
    super(); this.access = new PostgresDomainAccess(users, farms, zones);
  }
  async onModuleInit() {
    await this.store.lockDue();
    this.timer = setInterval(() => {
      if (!this.running && !this.closing) {
        // No unhandled rejection, no RAM fallback. The next tick/HTTP request
        // retries a fresh transaction; the original lock_at is never extended.
        this.running = this.store.lockDue().catch(() => undefined).finally(() => { this.running = undefined; });
      }
    }, 30000);
    this.timer.unref();
  }
  async onModuleDestroy() { this.closing = true; if (this.timer) clearInterval(this.timer); await this.running; }
  async create(actor: string, input: CreateEventDto) {
    actor = farmUuid(actor);
    const body = farmInput(CreateEventDto, input); body.target_id = farmUuid(body.target_id);
    return this.transaction(async (client) => {
      const zone = await this.targetZone(client, body), context = await this.access.lockZone(client, actor, zone);
      this.farmer(context);
      const assignment = actor === context.farm.farm.owner_id ? null : (await this.assignments.activeOnClient(client, actor, zone))?.assignment;
      if (assignment === undefined) throw new ForbiddenException('Cần phân công Accepted đang hiệu lực');
      await this.sameZone(client, body, zone);
      const details = await this.details(client, context, body.action_type, body.details);
      return this.store.change((journal) => {
        if (assignment && !assignmentActive(assignment, this.clock())) throw new ForbiddenException('Phân công đã hết hiệu lực');
        const event = this.newEvent(actor, body, details);
        return journal.add(event, { zone_id: zone, farm_id: context.farm.farm.id, author_id: actor,
          assignment_id: assignment?.id ?? null, original_created_at: event.created_at, root_id: event._id });
      });
    });
  }
  async update(actor: string, id: string, input: UpdateEventDto) {
    actor = farmUuid(actor); id = this.id(id);
    const body = farmInput(UpdateEventDto, input);
    if (!Object.values(body).some((value) => value !== undefined)) throw new BadRequestException('Cần ít nhất một field để sửa');
    return this.edit(actor, id, async (client, context, hint, original) => {
      const target = { target_type: body.target_type ?? hint.target_type, target_id: farmUuid(body.target_id ?? hint.target_id) };
      await this.sameZone(client, target, original.zone_id);
      const action = body.action_type ?? hint.action_type;
      if (action !== hint.action_type && body.details === undefined) throw new BadRequestException('Đổi hoạt động cần nhập lại details');
      const details = body.details === undefined ? undefined : await this.details(client, context, action, body.details);
      return (journal: CultivationEventsStore) => {
        const current = journal.get(id);
        if (current.action_type !== hint.action_type || current.target_id !== hint.target_id || current.target_type !== hint.target_type) {
          throw new ConflictException('Nhật ký vừa thay đổi; hãy tải lại trước khi sửa');
        }
        return journal.update({ ...current, ...target, action_type: action, details: details ?? current.details });
      };
    });
  }
  async remove(actor: string, id: string) {
    actor = farmUuid(actor); id = this.id(id);
    await this.edit(actor, id, async () => (journal: CultivationEventsStore) => journal.remove(id));
  }
  async correct(actor: string, id: string, input: CreateCorrectionDto) {
    actor = farmUuid(actor); id = this.id(id);
    const body = farmInput(CreateCorrectionDto, input); body.target_id = farmUuid(body.target_id);
    return this.edit(actor, id, async (client, context, _hint, original) => {
      await this.sameZone(client, body, original.zone_id);
      const details = await this.details(client, context, body.action_type, body.details);
      return (journal: CultivationEventsStore) => {
        const current = journal.get(id), lineage = this.lineage(journal, original.root_id);
        if (current.status !== 'Locked') throw new ConflictException('Chỉ correction nhật ký Locked');
        if (lineage.some((event) => event.status === 'Pending') || lineage.at(-1)!._id !== id) throw new ConflictException('Phải tham chiếu bản Locked mới nhất, không tạo hai correction Pending');
        const event: CultivationEvent = { ...this.newEvent(actor, body, details), is_correction: true,
          reference_event_id: id, root_event_id: original.root_id, correction_reason: body.correction_reason };
        return journal.add(event, original);
      };
    });
  }
  private async edit<T>(actor: string, id: string, prepare: (client: PoolClient, context: ZoneWriteContext, hint: CultivationEvent, original: EventContext) => Promise<(journal: CultivationEventsStore) => T>) {
    const hint = await this.store.read((journal) => ({ event: journal.get(id), original: journal.context(id) }));
    return this.transaction(async (client) => {
      const context = await this.access.lockZone(client, actor, hint.original.zone_id);
      this.farmer(context);
      if (hint.event.farmer_id !== actor) throw new ForbiddenException('Chỉ tác giả được sửa/xóa/correction');
      let assignment: UserZoneAssignment | null = null;
      if (hint.original.assignment_id) assignment = (await this.assignments.loadOnClient(client, hint.original.assignment_id, true)).assignment;
      const authorized = () => {
        if (assignment) {
          if (assignment.user_id !== actor || assignment.zone_id !== hint.original.zone_id || hint.original.author_id !== actor
            || !assignmentAllowsCorrection(assignment, hint.original.original_created_at, this.clock())) throw new ForbiddenException('Đã hết quyền correction theo phân công gốc');
        } else if (context.farm.farm.owner_id !== actor) throw new ForbiddenException('Tác giả chủ Farm phải còn là chủ Farm');
      };
      authorized();
      const work = await prepare(client, context, hint.event, hint.original);
      return this.store.change((journal) => { authorized(); return work(journal); });
    });
  }
  async get(actor: string, id: string) {
    actor = farmUuid(actor); id = this.id(id);
    const zone = await this.store.read((journal) => journal.context(id).zone_id);
    return this.transaction(async (client) => {
      const context = await this.access.lockZone(client, actor, zone), allowed = await this.canReadZone(client, context);
      return this.store.change((journal) => {
        const event = journal.get(id);
        if (event.farmer_id !== actor && !allowed) throw new NotFoundException('Không tìm thấy nhật ký trong phạm vi');
        return event;
      });
    });
  }
  async list(actor: string, input: EventListDto, mineOnly = false) {
    actor = farmUuid(actor); const query = farmInput(EventListDto, input);
    if (query.zone_id) query.zone_id = farmUuid(query.zone_id);
    if (query.target_id) query.target_id = farmUuid(query.target_id);
    return this.transaction(async (client) => {
      const user = await this.access.actorOnClient(client, actor), values = await this.access.scopeValues(client, user);
      const rows = await client.query<{ id: string }>(`SELECT z.id FROM public.zones z WHERE ${ZONE_READ_SCOPE}`, values), allowed = new Set(rows.rows.map((row) => row.id));
      return this.store.change((journal) => {
        const records = journal.list().filter((event) => (mineOnly ? event.farmer_id === actor : event.farmer_id === actor || allowed.has(journal.context(event._id).zone_id))
          && (!query.zone_id || journal.context(event._id).zone_id === query.zone_id) && (!query.target_id || event.target_id === query.target_id)
          && (!query.target_type || event.target_type === query.target_type) && (!query.action_type || event.action_type === query.action_type)
          && (!query.status || event.status === query.status)).sort(compareEvents).reverse();
        return this.page(records, query);
      });
    });
  }
  async corrections(actor: string, id: string, input: FarmPageDto) {
    actor = farmUuid(actor); id = this.id(id); const query = farmInput(FarmPageDto, input);
    const zone = await this.store.read((journal) => journal.context(id).zone_id);
    return this.transaction(async (client) => {
      const context = await this.access.lockZone(client, actor, zone), allowed = await this.canReadZone(client, context);
      return this.store.change((journal) => {
        if (journal.get(id).farmer_id !== actor && !allowed) throw new NotFoundException('Không tìm thấy nhật ký trong phạm vi');
        return this.page(this.lineage(journal, journal.context(id).root_id), query);
      });
    });
  }
  async verify(actor: string, zone: string) {
    actor = farmUuid(actor); zone = farmUuid(zone);
    return this.transaction(async (client) => {
      const context = await this.access.lockZone(client, actor, zone);
      if (!await this.canReadZone(client, context)) throw new NotFoundException('Không tìm thấy Zone trong phạm vi');
      try { await this.store.lockDue(); }
      catch (error) { if (!(error instanceof ServiceUnavailableException)) throw error; }
      // Report cryptographic tampering through this authorized verification API;
      // ordinary reads/writes fail closed instead of returning corrupted logs.
      return this.store.read((journal) => ({ zone_id: zone, algorithm: 'SHA-256' as const, ...journal.verify(zone), checked_at: new Date(this.clock()).toISOString() }), false);
    });
  }
  async lockedForTrace(zone: string) {
    zone = farmUuid(zone);
    return this.transaction(async (client) => {
      await this.zones.loadOnClient(client, zone);
      return this.store.change((journal) => journal.list().filter((event) => event.status === 'Locked' && journal.context(event._id).zone_id === zone).sort(compareEvents));
    });
  }
  private farmer(context: ZoneWriteContext) { if (context.actor.role !== 'Farmer') throw new ForbiddenException('Admin và Manager chỉ đọc nhật ký'); }
  private async canReadZone(client: PoolClient, context: ZoneWriteContext) {
    const values = await this.access.scopeValues(client, context.actor);
    return !!(await client.query(`SELECT z.id FROM public.zones z WHERE ${ZONE_READ_SCOPE} AND z.id=$4`, [...values, context.zone.id])).rowCount;
  }
  private async targetZone(client: PoolClient, target: Pick<CreateEventDto, 'target_type' | 'target_id'>) {
    return target.target_type === 'Zone' ? target.target_id : (await this.trees.loadOnClient(client, target.target_id)).tree.zone_id;
  }
  private async sameZone(client: PoolClient, target: Pick<CreateEventDto, 'target_type' | 'target_id'>, zone: string) {
    const actual = target.target_type === 'Zone' ? target.target_id : (await this.trees.loadOnClient(client, target.target_id, true)).tree.zone_id;
    if (actual !== zone) throw new BadRequestException('Không được chuyển nhật ký sang Zone khác');
  }
  private async details(client: PoolClient, context: ZoneWriteContext, action: CultivationEvent['action_type'], input: EventDetailsDto): Promise<EventDetails> {
    const standard = await this.catalogs.loadStandardOnClient(client, context.zone.standard_id, true);
    const details: EventDetails = { standard_snapshot: { standard_id: standard.id, code: standard.code, name: standard.name }, note: input.note ?? null, warnings: [] };
    if (action === 'Watering') {
      if (input.duration_minutes === undefined || input.materials !== undefined) throw new BadRequestException('Watering cần thời lượng, không nhận materials');
      return { ...details, duration_minutes: input.duration_minutes, water_volume_l: input.water_volume_l ?? null };
    }
    if (!input.materials?.length || input.duration_minutes !== undefined || input.water_volume_l !== undefined) throw new BadRequestException('Spraying/Fertilizing cần materials, không nhận thông tin tưới');
    const items = input.materials.map((item) => ({ ...item, material_id: farmUuid(item.material_id) }));
    if (new Set(items.map((item) => item.material_id)).size !== items.length) throw new BadRequestException('Mỗi vật tư chỉ nhập một lần');
    const materials = new Map<string, AgriculturalMaterial>();
    for (const id of items.map((item) => item.material_id).sort()) materials.set(id, await this.catalogs.loadMaterialOnClient(client, id));
    const links = new Set((await client.query<{ material_id: string }>('SELECT material_id FROM public.standard_materials WHERE standard_id=$1', [standard.id])).rows.map((row) => row.material_id));
    details.materials = items.map(({ material_id, quantity }) => {
      const material = materials.get(material_id)!;
      if (material.status !== 'Active') throw new BadRequestException('Chỉ được chọn vật tư Active');
      const linked = links.has(material_id);
      if (!linked) details.warnings.push({ code: 'MATERIAL_OUTSIDE_STANDARD', material_id });
      return { material_id, quantity, name: material.name, material_type: material.material_type, unit: material.unit,
        default_dosage: material.default_dosage, quarantine_days: material.quarantine_days, standard_linked: linked };
    });
    return details;
  }
  private newEvent(actor: string, body: CreateEventDto, details: EventDetails): CultivationEvent {
    const now = this.clock();
    return { _id: new ObjectId().toHexString(), farmer_id: actor, target_id: body.target_id, target_type: body.target_type, action_type: body.action_type,
      details: structuredClone(details), status: 'Pending', is_correction: false, reference_event_id: null, root_event_id: null, correction_reason: null,
      created_at: new Date(now).toISOString(), lock_at: new Date(now + LOCK_DELAY_MS).toISOString(), locked_at: null, hash: null, previous_hash: null };
  }
  private lineage(journal: CultivationEventsStore, root: string) { return journal.list().filter((event) => (event.root_event_id ?? event._id) === root).sort(compareEvents); }
  private id(id: string) { return farmInput(EventIdDto, { id }).id.toLowerCase(); }
  private page(items: CultivationEvent[], query: FarmPageDto) { return { items: items.slice(query.offset, query.offset + query.limit), total: items.length, limit: query.limit, offset: query.offset }; }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await inPostgresTransaction(this.pool, work); }
      catch (error) {
        if (error instanceof RetryDomainContext) continue;
        if (error instanceof HttpException) throw error;
        throw new ServiceUnavailableException('Không thể truy cập dữ liệu canh tác');
      }
    }
    throw new ConflictException('Phạm vi Farm/Zone vừa thay đổi; hãy tải lại');
  }
}
