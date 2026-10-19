import { ServiceUnavailableException } from '@nestjs/common';
import { ClientSession, Db, MongoClient, ObjectId } from 'mongodb';
import { farmUuid } from '../farms/farm-validation';
import { TelemetryRecord } from '../telemetry/telemetry.types';
import { TELEMETRY_READING_LIMIT } from '../telemetry/telemetry.store';
import { utcIso } from './mappers';

interface ReadingDocument extends Omit<TelemetryRecord, '_id' | 'measured_at' | 'received_at'> {
  _id: ObjectId;
  measured_at: Date;
  received_at: Date;
}
interface InsertionState {
  _id: string;
  kind: 'TelemetryInsertionCounter';
  key: 'global';
  payload: { sequence: number; retained_ids: ObjectId[] };
}
const STATE_ID = 'telemetry-insertion:global';
function invariant(value: boolean): asserts value {
  if (!value) {
    throw new Error('Invalid persisted telemetry state');
  }
}
function mapReading(row: ReadingDocument): TelemetryRecord {
  invariant(
    Object.keys(row).length === 7 &&
      Object.keys(row).every((key) =>
        ['_id', 'device_id', 'data_stream_id', 'measured_at', 'received_at', 'value', 'unit'].includes(key),
      ),
  );
  invariant(row._id instanceof ObjectId && farmUuid(row.device_id) === row.device_id);
  invariant(typeof row.data_stream_id === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(row.data_stream_id));
  invariant(typeof row.value === 'number' && Number.isFinite(row.value));
  invariant(typeof row.unit === 'string' && row.unit.length >= 1 && row.unit.length <= 16);
  return {
    ...row,
    _id: row._id.toHexString(),
    measured_at: utcIso(row.measured_at),
    received_at: utcIso(row.received_at),
  };
}
function toDocument(record: TelemetryRecord): ReadingDocument {
  invariant(typeof record._id === 'string' && /^[0-9a-f]{24}$/.test(record._id));
  const row = {
    ...record,
    _id: new ObjectId(record._id),
    measured_at: new Date(record.measured_at),
    received_at: new Date(record.received_at),
  };
  const mapped = mapReading(row);
  invariant(mapped.measured_at === record.measured_at && mapped.received_at === record.received_at);
  return row;
}

// One durable FIFO for ALL Devices, using the approved private state collection.
// No process-local latest cache/counter and no insertion field in business docs.
export class MongoTelemetryStore {
  constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
    private readonly timeoutMs = 10000,
  ) {}

  async newestFirst(): Promise<TelemetryRecord[]> {
    return this.transaction(async (session) => (await this.snapshot(session)).records.reverse());
  }
  async append(input: TelemetryRecord[]): Promise<void> {
    if (!input.length) {
      return;
    }
    // Clone once before any awaits; a caller must not mutate a batch mid-commit.
    const rows = input.map((record) => toDocument(structuredClone(record)));
    invariant(new Set(rows.map((row) => row._id.toHexString())).size === rows.length);
    // Only duplicate first-counter creation may retry the WHOLE aborted txn.
    // Driver withTransaction handles transient conflicts and retries COMMIT for
    // uncertain outcomes; never replay a callback on an uncertain COMMIT here.
    for (let attempt = 0; attempt < 4; attempt++) {
      let creatingCounter = false;
      try {
        await this.transaction(async (session) => {
          const snapshot = await this.snapshot(session),
            state = snapshot.state;
          const existing = new Set(snapshot.records.map((record) => record._id));
          invariant(rows.every((row) => !existing.has(row._id.toHexString())));
          const oldSequence = state?.payload.sequence ?? 0;
          invariant(oldSequence <= Number.MAX_SAFE_INTEGER - rows.length);
          if (!state) {
            creatingCounter = true;
            await this.db.collection<InsertionState>('PERSISTENCE_STATE').insertOne(
              {
                _id: STATE_ID,
                kind: 'TelemetryInsertionCounter',
                key: 'global',
                payload: { sequence: 0, retained_ids: [] },
              },
              { session },
            );
          }
          const ordered = [...(state?.payload.retained_ids ?? []), ...rows.map((row) => row._id)],
            evicted = ordered.slice(0, Math.max(0, ordered.length - TELEMETRY_READING_LIMIT)),
            retained = ordered.slice(-TELEMETRY_READING_LIMIT);
          await this.db
            .collection<ReadingDocument>('IOT_TELEMETRIES')
            .insertMany(rows, { session, ordered: true });
          if (evicted.length) {
            await this.db
              .collection<ReadingDocument>('IOT_TELEMETRIES')
              .deleteMany({ _id: { $in: evicted } }, { session });
          }
          const updated = await this.db
            .collection<InsertionState>('PERSISTENCE_STATE')
            .updateOne(
              { _id: STATE_ID, kind: 'TelemetryInsertionCounter', key: 'global' },
              { $set: { payload: { sequence: oldSequence + rows.length, retained_ids: retained } } },
              { session },
            );
          invariant(updated.matchedCount === 1);
        }, true);
        return;
      } catch (error) {
        if (creatingCounter && (error as { code?: number }).code === 11000) {
          continue;
        }
        if (error instanceof ServiceUnavailableException) {
          throw error;
        }
        throw new ServiceUnavailableException('Không thể lưu dữ liệu telemetry; vui lòng thử lại sau');
      }
    }
    throw new ServiceUnavailableException('Không thể khởi tạo thứ tự telemetry; vui lòng thử lại sau');
  }
  private async snapshot(
    session: ClientSession,
  ): Promise<{ state: InsertionState | null; records: TelemetryRecord[] }> {
    const state = await this.db
      .collection<InsertionState>('PERSISTENCE_STATE')
      .findOne({ kind: 'TelemetryInsertionCounter', key: 'global' }, { session });
    const count = await this.db
      .collection<ReadingDocument>('IOT_TELEMETRIES')
      .countDocuments({}, { session });
    if (!state) {
      // An existing collection without its ordering state must be repaired,
      // never silently adopt ObjectId/time order or reset retention metadata.
      invariant(count === 0);
      return { state: null, records: [] };
    }
    invariant(
      state._id === STATE_ID && Object.keys(state).length === 4 && Object.keys(state.payload).length === 2,
    );
    const { sequence, retained_ids: ids } = state.payload;
    invariant(
      Number.isSafeInteger(sequence) &&
        sequence >= 0 &&
        Array.isArray(ids) &&
        ids.length <= TELEMETRY_READING_LIMIT &&
        sequence >= ids.length,
    );
    invariant(ids.every((id) => id instanceof ObjectId));
    invariant(new Set(ids.map((id) => id.toHexString())).size === ids.length && count === ids.length);
    const rows = await this.db
      .collection<ReadingDocument>('IOT_TELEMETRIES')
      // The schema bounds each document and the global journal at10000, well
      // below a16MiB batch. Read that bounded snapshot in ONE batch. The current
      // driver/session CSOT path can attach maxTimeMS to a non-awaitData getMore,
      // which Mongo rejects. Keep transaction deadlines and all consistency
      // checks; avoid that extra cursor round trip instead of removing timeouts.
      .find(
        { _id: { $in: ids } },
        { session, batchSize: TELEMETRY_READING_LIMIT, limit: TELEMETRY_READING_LIMIT },
      )
      .toArray();
    invariant(rows.length === ids.length);
    const byId = new Map(
      rows.map((row) => {
        const record = mapReading(row);
        return [record._id, record] as const;
      }),
    );
    return { state, records: ids.map((id) => byId.get(id.toHexString())!) };
  }
  private async transaction<T>(
    work: (session: ClientSession) => Promise<T>,
    exposeDuplicate = false,
  ): Promise<T> {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(() => work(session), {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        timeoutMS: this.timeoutMs,
        maxCommitTimeMS: this.timeoutMs,
      });
    } catch (error) {
      if (exposeDuplicate && (error as { code?: number }).code === 11000) {
        throw error;
      }
      throw new ServiceUnavailableException('Không thể truy cập dữ liệu telemetry; vui lòng thử lại sau');
    } finally {
      await session.endSession();
    }
  }
}
