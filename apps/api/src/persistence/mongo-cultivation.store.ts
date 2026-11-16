import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AnyBulkWriteOperation, ClientSession, Db, Document, MongoClient, ObjectId } from 'mongodb';
import { CultivationEventsStore, CultivationSnapshot } from '../cultivation-events/cultivation-events.store';
import { EVENT_CAPACITY } from '../cultivation-events/cultivation-events.types';
import { canonicalJson, compareEvents } from '../cultivation-events/cultivation-chain';
import { contextDocument, cultivationDocument, cultivationInvariant as check, EventDocument, mapCultivation, mapCultivationContext } from './cultivation-mappers';

interface Ledger { _id: string; kind: 'CultivationLedger'; key: 'global'; payload: { revision: number; event_ids: ObjectId[] } }
interface StateRow { _id: string; kind: string; key: string; payload: Document }
const LEDGER = 'cultivation-ledger:global';
const contextKey = (id: string) => `cultivation-context:${id}`;
const headKey = (zone: string) => `cultivation-head:${zone}`;

export class MongoCultivationStore {
  constructor(private readonly client: MongoClient, private readonly db: Db, private readonly clock: () => number = Date.now) {}
  async read<T>(work: (journal: CultivationEventsStore) => T, hashes = true): Promise<T> {
    return this.transaction(async (session) => structuredClone(work((await this.snapshot(session, hashes)).journal)));
  }
  async change<T>(work: (journal: CultivationEventsStore) => T): Promise<T> {
    for (;;) {
      const result = await this.transaction(async (session): Promise<{ done: false } | { done: true; value: T }> => {
        const before = await this.snapshot(session), now = this.clock();
        // Restart can leave10k overdue events. Commit the earliest128 and head
        // atomically per transaction, preserving ordering without extending the
        // deadline or attempting10k updates inside one10s transaction.
        // Leave room for the full snapshot read/verification in the same10s
        // transaction;512 replacements can exhaust that budget under load.
        before.journal.lockDue(now, 128);
        const afterLock = before.journal.snapshot();
        if (afterLock.events.some((event) => event.status === 'Pending' && Date.parse(event.lock_at) <= now)) {
          await this.commit(session, before.ledger, before.snapshot, afterLock); return { done: false };
        }
        // Pure synchronous work only: driver retry cannot send messages,
        // acquire PG locks or apply external mutations a second time.
        const value = work(before.journal);
        await this.commit(session, before.ledger, before.snapshot, before.journal.snapshot());
        return { done: true, value: structuredClone(value) };
      });
      if (result.done) return result.value;
    }
  }
  async lockDue() { return this.change(() => undefined); }
  private async snapshot(session: ClientSession, hashes = true) {
    const ledger = await this.db.collection<Ledger>('PERSISTENCE_STATE').findOne({ _id: LEDGER }, { session });
    const count = await this.db.collection('CULTIVATION_EVENTS').countDocuments({}, { session });
    const contextsCount = await this.db.collection('PERSISTENCE_STATE').countDocuments({ kind: 'CultivationContext' }, { session });
    const headsCount = await this.db.collection('PERSISTENCE_STATE').countDocuments({ kind: 'ZoneChainHead' }, { session });
    if (!ledger) {
      check(count === 0 && contextsCount === 0 && headsCount === 0);
      const snapshot: CultivationSnapshot = { events: [], contexts: [], heads: [] };
      return { ledger, snapshot, journal: CultivationEventsStore.restore(snapshot, this.clock) };
    }
    check(ledger.kind === 'CultivationLedger' && ledger.key === 'global' && Object.keys(ledger).length === 4 && Object.keys(ledger.payload).length === 2);
    const { revision, event_ids: ids } = ledger.payload;
    check(Number.isSafeInteger(revision) && revision >= 0 && Array.isArray(ids) && ids.length <= EVENT_CAPACITY && count === ids.length && contextsCount === count);
    check(ids.every((id) => id instanceof ObjectId) && new Set(ids.map((id) => id.toHexString())).size === ids.length);
    const events = [], contexts: CultivationSnapshot['contexts'] = [];
    // A bounded single batch per chunk avoids CSOT/getMore on non-awaitData
    // cursors. 100 events with max20 material snapshots stays below 16MiB.
    for (let start = 0; start < ids.length; start += 100) {
      const chunk = ids.slice(start, start + 100);
      const rows = await this.db.collection<EventDocument>('CULTIVATION_EVENTS').find({ _id: { $in: chunk } }, { session, limit: 100, batchSize: 100 }).toArray();
      const privateRows = await this.db.collection<StateRow>('PERSISTENCE_STATE').find({ _id: { $in: chunk.map((id) => contextKey(id.toHexString())) } }, { session, limit: 100, batchSize: 100 }).toArray();
      check(rows.length === chunk.length && privateRows.length === chunk.length);
      // verify() below checks each complete chain once; avoid hashing every
      // Locked event a second time while decoding BSON.
      events.push(...rows.map((row) => mapCultivation(row, false)));
      for (const row of privateRows) {
        check(row.kind === 'CultivationContext' && typeof row.key === 'string' && row._id === contextKey(row.key) && Object.keys(row).length === 4);
        contexts.push([row.key, mapCultivationContext(row.payload)]);
      }
    }
    const contextMap = new Map(contexts), byId = new Map(events.map((event) => [event._id, event]));
    const zones = new Set<string>();
    for (const event of events) {
      const context = contextMap.get(event._id), root = context && byId.get(context.root_id);
      check(context && root && !root.is_correction && context.author_id === event.farmer_id && context.author_id === root.farmer_id
        && context.original_created_at === root.created_at && context.root_id === (event.root_event_id ?? event._id)
        && (event.target_type !== 'Zone' || event.target_id === context.zone_id));
      const rootContext = contextMap.get(root._id)!;
      check(rootContext && Object.keys(context).every((key) => context[key as keyof typeof context] === rootContext[key as keyof typeof rootContext]));
      if (event.status === 'Locked') zones.add(context.zone_id);
    }
    // Exactly one non-branching lineage; Pending can only be the final version.
    const lineages = new Map<string, typeof events>(), tails = new Map<string, typeof events[number]>();
    for (const event of [...events].sort(compareEvents)) {
      const root = event.root_event_id ?? event._id, lineage = lineages.get(root) ?? [];
      lineage.push(event); lineages.set(root, lineage);
      if (event.status === 'Locked') tails.set(contextMap.get(event._id)!.zone_id, event);
    }
    for (const lineage of lineages.values()) {
      lineage.forEach((event, index) => {
        if (index) check(event.reference_event_id === lineage[index - 1]._id && lineage[index - 1].status === 'Locked');
      });
    }
    const heads: CultivationSnapshot['heads'] = [];
    check(headsCount === zones.size);
    for (const zone of zones) {
      const row = await this.db.collection<StateRow>('PERSISTENCE_STATE').findOne({ _id: headKey(zone) }, { session });
      check(row && row.kind === 'ZoneChainHead' && row.key === zone && Object.keys(row).length === 4 && Object.keys(row.payload).length === 4);
      const head = row.payload;
      check(Number.isSafeInteger(head.count) && head.count > 0 && typeof head.hash === 'string' && /^[0-9a-f]{64}$/.test(head.hash)
        && head.last_event_id instanceof ObjectId && head.last_lock_at instanceof Date && Number.isFinite(head.last_lock_at.getTime()));
      const tail = tails.get(zone)!;
      if (hashes) check(head.last_event_id.toHexString() === tail._id && head.last_lock_at.toISOString() === tail.lock_at);
      heads.push([zone, { count: head.count, hash: head.hash }]);
    }
    const snapshot = { events, contexts, heads }, journal = CultivationEventsStore.restore(snapshot, this.clock);
    if (hashes) for (const zone of zones) check(journal.verify(zone).valid);
    return { ledger, snapshot, journal };
  }
  private async commit(session: ClientSession, ledger: Ledger | null, before: CultivationSnapshot, after: CultivationSnapshot) {
    const old = new Map(before.events.map((event) => [event._id, event]));
    const contexts = new Map(after.contexts), business: AnyBulkWriteOperation<EventDocument>[] = [], state: AnyBulkWriteOperation<StateRow>[] = [];
    for (const event of after.events) {
      const previous = old.get(event._id);
      if (previous && JSON.stringify(previous) === JSON.stringify(event)) continue;
      if (previous) {
        check(previous.status === 'Pending');
        business.push({ replaceOne: { filter: { _id: new ObjectId(event._id), status: 'Pending' }, replacement: cultivationDocument(event) } });
      } else {
        business.push({ insertOne: { document: cultivationDocument(event) } });
        state.push({ insertOne: { document: { _id: contextKey(event._id), kind: 'CultivationContext', key: event._id, payload: contextDocument(contexts.get(event._id)!) } } });
      }
    }
    const remaining = new Set(after.events.map((event) => event._id));
    for (const event of before.events.filter((item) => !remaining.has(item._id))) {
      check(event.status === 'Pending');
      business.push({ deleteOne: { filter: { _id: new ObjectId(event._id), status: 'Pending' } } });
      state.push({ deleteOne: { filter: { _id: contextKey(event._id) } } });
    }
    const tails = new Map<string, typeof after.events[number]>();
    for (const event of [...after.events].filter((event) => event.status === 'Locked').sort(compareEvents)) tails.set(contexts.get(event._id)!.zone_id, event);
    for (const [zone, head] of after.heads) {
      if (canonicalJson(before.heads.find(([id]) => id === zone)?.[1] ?? null) === canonicalJson(head)) continue;
      const tail = tails.get(zone)!;
      const document: StateRow = { _id: headKey(zone), kind: 'ZoneChainHead', key: zone,
        payload: { ...head, last_event_id: new ObjectId(tail._id), last_lock_at: new Date(tail.lock_at) } };
      state.push({ replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true } });
    }
    if (business.length) await this.db.collection<EventDocument>('CULTIVATION_EVENTS').bulkWrite(business, { session, ordered: true });
    if (state.length) await this.db.collection<StateRow>('PERSISTENCE_STATE').bulkWrite(state, { session, ordered: true });
    const revision = ledger?.payload.revision ?? 0;
    check(revision < Number.MAX_SAFE_INTEGER);
    const next: Ledger = { _id: LEDGER, kind: 'CultivationLedger', key: 'global', payload: { revision: revision + 1, event_ids: after.events.map((event) => new ObjectId(event._id)) } };
    if (!ledger) await this.db.collection<Ledger>('PERSISTENCE_STATE').insertOne(next, { session });
    else check((await this.db.collection<Ledger>('PERSISTENCE_STATE').replaceOne({ _id: LEDGER, 'payload.revision': revision }, next, { session })).matchedCount === 1);
  }
  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const session = this.client.startSession();
      try { return await session.withTransaction(() => work(session), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, timeoutMS: 10000, maxCommitTimeMS: 10000 }); }
      catch (error) {
        // Only an initial ledger duplicate is safe to retry after the whole
        // transaction aborted. Never replay an uncertain commit at this layer.
        if (error && typeof error === 'object' && 'code' in error && error.code === 11000 && attempt < 3) continue;
        if (error instanceof HttpException) throw error;
        throw new ServiceUnavailableException('Không thể truy cập nhật ký canh tác; vui lòng kiểm tra lại');
      } finally { await session.endSession(); }
    }
    throw new ServiceUnavailableException('Không thể truy cập nhật ký canh tác');
  }
}
