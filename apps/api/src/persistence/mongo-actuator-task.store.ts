import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { AnyBulkWriteOperation, ClientSession, Db, MongoClient, ObjectId } from 'mongodb';
import { ActuatorTask } from '../actuator-tasks/actuator-tasks.types';
import { ACTUATOR_TASK_LIMIT } from '../actuator-tasks/actuator-tasks.service';
import { createControlTask, markTaskFailed } from '../actuator-tasks/task-rules';
import { mapTask, taskDocument, TaskDocument, taskInvariant, validateTask } from './task-mappers';

interface TaskState {
  _id: string; kind: 'TaskIdAllocator'; key: 'global';
  payload: { next_id: number; revision: number; owner: string | null; retained_ids: ObjectId[] };
}
const STATE_ID = 'task-journal:global';
export class TaskJournal {
  readonly tasks: Map<string, ActuatorTask>;
  constructor(public nextId: number, records: ActuatorTask[]) { this.tasks = new Map(structuredClone(records).map((task) => [task._id, task])); }
  require(id: string) { const task = this.tasks.get(id); taskInvariant(task); return task; }
  room(count: number, protect: string[] = []) {
    const need = Math.max(0, this.tasks.size + count - ACTUATOR_TASK_LIMIT);
    const removable = [...this.tasks.values()].filter((task) => task.status !== 'Pending' && !protect.includes(task._id)).slice(0, need);
    if (removable.length !== need) throw new HttpException('Task journal đầy Pending', HttpStatus.TOO_MANY_REQUESTS);
    for (const task of removable) this.tasks.delete(task._id);
  }
  create(...args: [string, ActuatorTask['response_payload']['operation'], number[], 0 | 1, string, (string | null)?]) {
    const [device, operation, caps, action, now, parent = null] = args;
    const task = createControlTask(device, operation, caps, action, () => {
      taskInvariant(Number.isSafeInteger(this.nextId) && this.nextId < Number.MAX_SAFE_INTEGER);
      return this.nextId++;
    }, now, parent);
    this.tasks.set(task._id, task); return task;
  }
}
// One durable allocator + exact insertion order in the approved technical
// TaskIdAllocator document. Business records retain the original ERD/API shape.
export class MongoActuatorTaskStore {
  constructor(private readonly client: MongoClient, private readonly db: Db, private readonly timeoutMs = 10000) {}
  async initialize(owner: string) {
    return this.transaction(async (session) => {
      const { state, records } = await this.snapshot(session);
      const journal = new TaskJournal(state?.payload.next_id ?? 1, records);
      for (const task of journal.tasks.values()) markTaskFailed(task, 'BACKEND_SHUTDOWN');
      await this.commit(session, state, records, journal, owner);
    });
  }
  async release(owner: string) {
    await this.change(owner, (journal) => { for (const task of journal.tasks.values()) markTaskFailed(task, 'BACKEND_SHUTDOWN'); }, true);
  }
  async read(): Promise<ActuatorTask[]> { return this.transaction(async (session) => (await this.snapshot(session)).records); }
  async change<T>(owner: string, work: (journal: TaskJournal) => T, release = false): Promise<T> {
    return this.transaction(async (session) => {
      const { state, records } = await this.snapshot(session);
      taskInvariant(state && state.payload.owner === owner);
      const journal = new TaskJournal(state.payload.next_id, records);
      // Callback is synchronous/pure: a Mongo retry must NEVER publish MQTT.
      const result = work(journal);
      await this.commit(session, state, records, journal, release ? null : owner);
      return structuredClone(result);
    });
  }
  private async snapshot(session: ClientSession) {
    const state = await this.db.collection<TaskState>('PERSISTENCE_STATE').findOne({ _id: STATE_ID }, { session });
    const count = await this.db.collection('ACTUATOR_TASKS').countDocuments({}, { session });
    if (!state) { taskInvariant(count === 0); return { state: null, records: [] as ActuatorTask[] }; }
    taskInvariant(state.kind === 'TaskIdAllocator' && state.key === 'global' && Object.keys(state).length === 4 && Object.keys(state.payload).length === 4);
    const { next_id: next, revision, retained_ids: ids, owner } = state.payload;
    taskInvariant(Number.isSafeInteger(next) && next >= 1 && Number.isSafeInteger(revision) && revision >= 0);
    taskInvariant(owner === null || typeof owner === 'string' && /^[0-9a-f-]{36}$/.test(owner));
    taskInvariant(Array.isArray(ids) && ids.length <= ACTUATOR_TASK_LIMIT && count === ids.length && ids.every((id) => id instanceof ObjectId));
    taskInvariant(new Set(ids.map((id) => id.toHexString())).size === ids.length);
    const rows = await this.db.collection<TaskDocument>('ACTUATOR_TASKS').find({ _id: { $in: ids } },
      { session, batchSize: ACTUATOR_TASK_LIMIT, limit: ACTUATOR_TASK_LIMIT }).toArray();
    taskInvariant(rows.length === ids.length);
    const mapped = new Map(rows.map((row) => { const task = mapTask(row); return [task._id, task] as const; }));
    const records = ids.map((id) => mapped.get(id.toHexString())!);
    const allocated = records.flatMap((task) => [task.command_id, ...task.targets.map((target) => target.task_id)]);
    taskInvariant(allocated.every((id) => id < next) && new Set(allocated).size === allocated.length);
    return { state, records };
  }
  private async commit(session: ClientSession, previous: TaskState | null, before: ActuatorTask[], journal: TaskJournal, owner: string | null) {
    const old = new Map(before.map((task) => [task._id, JSON.stringify(task)]));
    taskInvariant(journal.tasks.size <= ACTUATOR_TASK_LIMIT);
    taskInvariant(Number.isSafeInteger(journal.nextId) && journal.nextId >= (previous?.payload.next_id ?? 1));
    const allocated = [...journal.tasks.values()].flatMap((task) => [task.command_id, ...task.targets.map((target) => target.task_id)]);
    taskInvariant(allocated.every((id) => id < journal.nextId) && new Set(allocated).size === allocated.length);
    taskInvariant([...journal.tasks].every(([id, task]) => id === task._id));
    const revision = previous?.payload.revision ?? 0;
    taskInvariant(revision < Number.MAX_SAFE_INTEGER);
    const ids: ObjectId[] = [];
    const inserted: TaskDocument[] = [], updates: AnyBulkWriteOperation<TaskDocument>[] = [];
    for (const task of journal.tasks.values()) {
      validateTask(task); ids.push(new ObjectId(task._id));
      if (!old.has(task._id)) inserted.push(taskDocument(task));
      else if (old.get(task._id) !== JSON.stringify(task)) {
        updates.push({ replaceOne: { filter: { _id: new ObjectId(task._id) }, replacement: taskDocument(task) } });
      }
    }
    if (inserted.length) await this.db.collection<TaskDocument>('ACTUATOR_TASKS').insertMany(inserted, { session, ordered: true });
    if (updates.length) {
      const result = await this.db.collection<TaskDocument>('ACTUATOR_TASKS').bulkWrite(updates, { session, ordered: true });
      taskInvariant(result.matchedCount === updates.length);
    }
    const removed = before.filter((task) => !journal.tasks.has(task._id));
    taskInvariant(removed.every((task) => task.status !== 'Pending'));
    if (removed.length) await this.db.collection('ACTUATOR_TASKS').deleteMany({ _id: { $in: removed.map((task) => new ObjectId(task._id)) } }, { session });
    const next: TaskState = { _id: STATE_ID, kind: 'TaskIdAllocator', key: 'global',
      payload: { next_id: journal.nextId, revision: revision + 1, owner, retained_ids: ids } };
    if (!previous) await this.db.collection<TaskState>('PERSISTENCE_STATE').insertOne(next, { session });
    else {
      const result = await this.db.collection<TaskState>('PERSISTENCE_STATE').replaceOne({ _id: STATE_ID, 'payload.revision': revision }, next, { session });
      taskInvariant(result.matchedCount === 1);
    }
  }
  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(() => work(session), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
        timeoutMS: this.timeoutMs, maxCommitTimeMS: this.timeoutMs });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Không thể truy cập lịch sử lệnh điều khiển; vui lòng kiểm tra lại');
    } finally { await session.endSession(); }
  }
}
