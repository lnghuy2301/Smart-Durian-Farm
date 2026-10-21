import { ConflictException, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ActuatorTaskRecords } from '../actuator-tasks/actuator-task-records';
import { ActuatorTask, AcknowledgedMode, ControlOperation } from '../actuator-tasks/actuator-tasks.types';
import { ACTUATOR_TASK_LIMIT } from '../actuator-tasks/actuator-tasks.service';
import { ActuatorTasksConfig } from '../actuator-tasks/actuator-tasks.config';
import { CreateControlDto, TaskPageDto, TaskIdParamDto } from '../actuator-tasks/actuator-tasks.dto';
import { TaskAccess, TaskScope } from '../actuator-tasks/task-access';
import { ControlRecipe, markTaskFailed, requireActiveCapabilities, startCapabilities, stopCapabilities } from '../actuator-tasks/task-rules';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { BrokerState, MqttTransport } from '../mqtt/mqtt.transport';
import { buildControlPublication } from '../mqtt/mqtt.protocol';
import { MongoActuatorTaskStore, TaskJournal } from './mongo-actuator-task.store';
import { taskInvariant } from './task-mappers';

interface Run { device: string; actor: string; current: ActuatorTask; start?: ActuatorTask; index: number; epoch: number; recipe: ControlRecipe }
interface Wait { run: Run; id: number; action: 0 | 1; deadline: number; timer: NodeJS.Timeout; published: boolean; ackAt?: string }
const visible = (task: ActuatorTask, scope: TaskScope) => Date.parse(task.created_at) >= scope.from && Date.parse(task.created_at) < scope.to;

// The maps below are only live execution handles/modes, deliberately discarded
// after restart. Mongo is the sole journal/ID/order authority. No ON is resumed
// from a persisted Pending step, including an uncertain publish or commit.
export class DatabaseActuatorTaskRecords extends ActuatorTaskRecords implements OnModuleInit, OnModuleDestroy {
  private readonly owner = randomUUID();
  private readonly runs = new Map<string, Run>();
  private readonly modes = new Map<string, AcknowledgedMode>();
  private readonly waits = new Map<number, Wait>();
  private readonly queues = new Map<string, Promise<void>>();
  private release?: () => Promise<void>;
  private initialization?: Promise<void>;
  private initialized = false;
  private ready = false;
  private closing = false;
  private faulted = false;
  private epoch = 0;
  constructor(private readonly config: ActuatorTasksConfig, private readonly transport: MqttTransport,
    private readonly access: TaskAccess, private readonly store: MongoActuatorTaskStore, private readonly clock: () => number = Date.now) { super(); }

  onModuleInit() { return this.initialize(); }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.initialization) this.initialization = (async () => {
      this.release = await this.access.claim(() => this.fault());
      try {
        await this.store.initialize(this.owner);
        this.initialized = true;
      } catch (error) { await this.release(); this.release = undefined; throw error; }
    })();
    await this.initialization;
  }
  async command(actor: string, device: string, input: ControlOperation) {
    actor = farmUuid(actor); device = farmUuid(device);
    const operation = farmInput(CreateControlDto, { operation: input }).operation;
    this.available();
    return this.serial(device, async () => {
      this.available();
      return this.access.control(actor, device, operation, async (scope) => {
        this.available();
        taskInvariant(scope.recipe && scope.activeCapabilities);
        const recipe = scope.recipe;
        const old = this.runs.get(device), mode = this.modes.get(device) ?? 'Unknown';
        if (old && (operation !== 'Stop' || ['Stop', 'RecoveryStop'].includes(old.current.response_payload.operation))) {
          throw new ConflictException('Device đang có thao tác; không gửi trùng');
        }
        if (operation !== 'Stop' && ['Watering', 'Spraying'].includes(mode)) throw new ConflictException('Phải Dừng trước khi Bật lại/chuyển tưới–phun');
        const reset = operation !== 'Stop' && mode === 'Unknown', epoch = this.epoch;
        const caps = operation === 'Stop' ? stopCapabilities(recipe, old ? 'Unknown' : mode) : startCapabilities(recipe, operation);
        requireActiveCapabilities(reset ? stopCapabilities(recipe, 'Unknown') : caps, scope.activeCapabilities);
        const committed = await this.write((journal) => {
          // Capacity before cancellation: a refused Stop must not erase an active Start.
          journal.room(reset ? 2 : 1);
          if (old) this.cancelIn(journal, old, 'CANCELLED_BY_STOP');
          const task = journal.create(device, operation, caps, operation === 'Stop' ? 0 : 1, this.now());
          const first = reset ? journal.create(device, 'Reset', stopCapabilities(recipe, 'Unknown'), 0, this.now(), task._id) : task;
          if (reset) task.response_payload.reset_task_id = first._id;
          return { task, first };
        });
        this.available();
        if (old) this.clearWait(old);
        const run: Run = { device, actor, current: committed.first, start: reset ? committed.task : undefined, index: 0, epoch, recipe };
        this.runs.set(device, run); this.modes.set(device, 'Unknown');
        this.advanceLater(run);
        return { task: structuredClone(committed.task), status_url: `/api/actuator-tasks/${committed.task._id}`,
          state_url: `/api/actuator-tasks/devices/${device}/state` };
      });
    });
  }
  async get(actor: string, input: string) {
    const id = farmInput(TaskIdParamDto, { id: input }).id;
    const task = (await this.readJournal()).find((entry) => entry._id === id);
    if (!task) throw new NotFoundException('Không tìm thấy task trong phạm vi truy cập');
    return this.access.read(actor, task.device_id, async (scope) => {
      // Read again while current authority locks are held; an earlier snapshot
      // is only a Device hint, not permission or journal authority.
      const current = (await this.readJournal()).find((entry) => entry._id === id);
      if (!current || !visible(current, scope)) throw new NotFoundException('Không tìm thấy task trong phạm vi truy cập');
      return current;
    });
  }
  async list(actor: string, device: string, input: TaskPageDto) {
    actor = farmUuid(actor); device = farmUuid(device);
    const page = farmInput(TaskPageDto, input);
    return this.access.read(actor, device, async (scope) => {
      const items = (await this.readJournal()).reverse().filter((task) => task.device_id === device && visible(task, scope) && (!page.status || task.status === page.status));
      return { items: items.slice(page.offset, page.offset + page.limit), total: items.length, limit: page.limit, offset: page.offset,
        storage: { mode: 'MongoDB' as const, capacity_tasks: ACTUATOR_TASK_LIMIT, eviction: 'OldestTerminal' as const } };
    });
  }
  async state(actor: string, device: string) {
    actor = farmUuid(actor); device = farmUuid(device);
    return this.serial(device, () => this.access.read(actor, device, async (scope) => {
      const current = this.runs.get(device)?.current;
      // Verify storage on every read. Do not serve a cached Off/Watering when
      // Mongo is unavailable, corrupted, or the persisted active task vanished.
      const records = await this.readJournal();
      if (current && !records.some((task) => task._id === current._id && task.status === 'Pending')) {
        this.fault(); throw new ServiceUnavailableException('Lịch sử lệnh không nhất quán; hãy kiểm tra lại');
      }
      const mode = this.modes.get(device) ?? 'Unknown';
      return { device_id: device, acknowledged_mode: mode, physical_state: 'Unknown', confirmation_kind: 'CommandReceipt',
        busy: !!current, active_task_id: current && visible(current, scope) ? current._id : null,
        reset_required: mode === 'Unknown', broker_ready: this.initialized && this.ready && !this.closing && !this.faulted,
        ack_timeout_ms: this.config.ackTimeoutMs };
    }));
  }
  async receiveAck(device: string, id: number, action: 0 | 1, now = this.clock()): Promise<string | null> {
    const found = this.waits.get(id);
    if (!found) return 'ACK_NOT_WAITING';
    if (found.run.device !== device) return 'ACK_DEVICE_MISMATCH';
    return this.serial(device, async () => {
      const wait = this.waits.get(id);
      if (!wait || !this.live(wait.run)) return 'ACK_NOT_WAITING';
      if (wait.run.epoch !== this.epoch) { await this.failLocked(wait.run, 'MQTT_DISCONNECTED'); return 'ACK_NOT_WAITING'; }
      if (wait.action !== action) return 'ACK_ACTION_MISMATCH';
      if (now >= wait.deadline) { await this.failLocked(wait.run, 'ACK_TIMEOUT'); return 'ACK_EXPIRED'; }
      if (wait.ackAt) return 'ACK_DUPLICATE';
      const ackAt = new Date(now).toISOString();
      const task = await this.write((journal) => {
        const task = journal.require(wait.run.current._id), step = task.response_payload.steps[wait.run.index];
        taskInvariant(task.status === 'Pending' && step.status === 'WaitingAck' && step.task_id === id);
        step.ack_received_at = ackAt; step.ack = { taskId: id, status: 'ACK', action };
        return task;
      });
      wait.run.current = task; wait.ackAt = ackAt;
      if (wait.published) await this.acknowledgeLocked(wait);
      return null;
    });
  }
  async brokerChanged(state: BrokerState): Promise<void> {
    const previous = this.ready;
    this.ready = state.enabled && state.connected && state.subscribed;
    if (previous && !this.ready) {
      ++this.epoch;
      this.modes.clear();
      await Promise.all([...this.runs.values()].map((run) => this.serial(run.device, async () => {
        if (this.live(run)) await this.failLocked(run, 'MQTT_DISCONNECTED');
      })));
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.closing = true; this.ready = false;
    for (const wait of this.waits.values()) clearTimeout(wait.timer);
    await Promise.all([...this.queues.values()]);
    try { if (this.initialized) await this.store.release(this.owner); }
    finally {
      this.runs.clear(); this.waits.clear(); this.modes.clear();
      if (this.release) { const release = this.release; this.release = undefined; await release(); }
    }
  }
  private advanceLater(run: Run) {
    queueMicrotask(() => { void this.serial(run.device, () => this.advanceLocked(run)).catch(() => this.fault()); });
  }
  private async advanceLocked(run: Run): Promise<void> {
    if (!this.live(run)) return;
    try {
      this.available();
      if (run.epoch !== this.epoch) { await this.failLocked(run, 'MQTT_DISCONNECTED'); return; }
      const step = run.current.response_payload.steps[run.index];
      taskInvariant(step && step.status === 'Queued');
      const send = async (scope: TaskScope) => {
        if (!this.live(run)) return;
        this.available();
        if (run.epoch !== this.epoch) { await this.failLocked(run, 'MQTT_DISCONNECTED'); return; }
        taskInvariant(scope.activeCapabilities);
        requireActiveCapabilities([step.tasking_capability_id], scope.activeCapabilities);
        const task = await this.write((journal) => {
          const task = journal.require(run.current._id), step = task.response_payload.steps[run.index];
          taskInvariant(task.status === 'Pending' && step.status === 'Queued');
          step.sent_at = this.now(); step.status = 'WaitingAck'; task.sent_at ??= step.sent_at;
          return task;
        });
        run.current = task;
        if (!this.live(run)) return;
        this.available();
        if (run.epoch !== this.epoch) { await this.failLocked(run, 'MQTT_DISCONNECTED'); return; }
        const current = task.response_payload.steps[run.index], deadline = Date.parse(current.sent_at!) + this.config.ackTimeoutMs;
        if (this.clock() >= deadline) { await this.failLocked(run, 'ACK_TIMEOUT'); return; }
        const publication = buildControlPublication(scope.stationId, [{ taskId: current.task_id, taskingCapabilityId: current.tasking_capability_id }], current.action);
        const wait: Wait = { run, id: current.task_id, action: current.action, deadline, published: false,
          timer: setTimeout(() => { void this.serial(run.device, async () => {
            if (this.waits.get(current.task_id) === wait && this.live(run)) await this.failLocked(run, 'ACK_TIMEOUT');
          }).catch(() => this.fault()); }, Math.max(0, deadline - this.clock())) };
        wait.timer.unref(); this.waits.set(current.task_id, wait);
        // Persist intent first, publish exactly once, do not await the callback
        // while holding the per-Device queue: Stop must preempt a slow publish.
        const pending = this.transport.publish(publication.topic, publication.payload);
        void pending.then(() => this.serial(run.device, async () => {
          if (this.waits.get(wait.id) !== wait || !this.live(run)) return;
          wait.published = true;
          if (wait.ackAt) await this.acknowledgeLocked(wait);
        }), () => this.serial(run.device, async () => {
          if (this.waits.get(wait.id) === wait && this.live(run)) await this.failLocked(run, 'MQTT_PUBLISH_FAILED');
        })).catch(() => this.fault());
      };
      if (step.action === 1) await this.access.control(run.actor, run.device, run.current.response_payload.operation as ControlOperation, send);
      else await this.access.off(run.device, send);
    } catch {
      if (this.live(run)) await this.failLocked(run, this.ready ? 'CONTEXT_UNAVAILABLE' : 'MQTT_UNAVAILABLE');
    }
  }
  private async acknowledgeLocked(wait: Wait) {
    const run = wait.run;
    const task = await this.write((journal) => {
      const task = journal.require(run.current._id), step = task.response_payload.steps[run.index];
      taskInvariant(task.status === 'Pending' && step.status === 'WaitingAck' && step.ack_received_at === wait.ackAt);
      step.status = 'Acknowledged';
      if (run.index === task.response_payload.steps.length - 1) { task.status = 'Confirmed'; task.confirmed_at = step.ack_received_at; }
      return task;
    });
    if (!this.live(run)) return;
    this.clearWait(run); run.current = task; ++run.index;
    if (task.status === 'Confirmed') {
      if (task.response_payload.operation === 'Reset' && run.start) {
        run.current = run.start; run.start = undefined; run.index = 0;
      } else {
        const operation = task.response_payload.operation;
        this.modes.set(run.device, run.epoch !== this.epoch || !this.ready ? 'Unknown'
          : operation === 'Watering' ? 'Watering' : operation === 'Spraying' ? 'Spraying' : 'Off');
        this.runs.delete(run.device); return;
      }
    }
    this.advanceLater(run);
  }
  private async failLocked(run: Run, code: string) {
    if (!this.live(run)) return;
    const committed = await this.write((journal) => {
      const failed = journal.require(run.current._id);
      taskInvariant(failed.status === 'Pending');
      this.cancelIn(journal, run, code);
      if (failed.response_payload.operation !== 'Watering' && failed.response_payload.operation !== 'Spraying') return undefined;
      journal.room(1, [failed._id]);
      const recovery = journal.create(run.device, 'RecoveryStop', stopCapabilities(run.recipe, 'Unknown'), 0, this.now(), failed._id);
      failed.response_payload.recovery_task_id = recovery._id;
      return recovery;
    });
    this.clearWait(run); this.runs.delete(run.device); this.modes.set(run.device, 'Unknown');
    if (committed) {
      const recovery: Run = { device: run.device, actor: run.actor, current: committed, index: 0, epoch: this.epoch, recipe: run.recipe };
      this.runs.set(run.device, recovery); this.advanceLater(recovery);
    }
  }
  private cancelIn(journal: TaskJournal, run: Run, code: string) {
    markTaskFailed(journal.require(run.current._id), code);
    if (run.start) markTaskFailed(journal.require(run.start._id), code === 'CANCELLED_BY_STOP' ? code : 'RESET_FAILED');
  }
  private clearWait(run: Run) {
    for (const [id, wait] of this.waits) if (wait.run === run) { clearTimeout(wait.timer); this.waits.delete(id); }
  }
  private live(run: Run) { return !this.closing && !this.faulted && this.runs.get(run.device) === run && run.current.status === 'Pending'; }
  private available() {
    if (!this.initialized || !this.ready || this.closing || this.faulted) throw new ServiceUnavailableException('Điều khiển chưa sẵn sàng; không xếp lệnh offline');
  }
  private fault() {
    this.faulted = true;
    for (const wait of this.waits.values()) clearTimeout(wait.timer);
    this.waits.clear(); this.runs.clear(); this.modes.clear();
  }
  private async readJournal() {
    try { return await this.store.read(); }
    catch (error) { this.fault(); throw error; }
  }
  private async write<T>(work: (journal: TaskJournal) => T) {
    try { return await this.store.change(this.owner, work); }
    catch (error) { if (error instanceof ServiceUnavailableException) this.fault(); throw error; }
  }
  private now() { return new Date(this.clock()).toISOString(); }
  private serial<T>(device: string, work: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(device) ?? Promise.resolve()).then(work);
    const tail = result.then(() => {}, () => {});
    this.queues.set(device, tail);
    void tail.then(() => { if (this.queues.get(device) === tail) this.queues.delete(device); });
    return result;
  }
}
