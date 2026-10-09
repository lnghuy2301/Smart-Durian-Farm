import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { CultivationEvent, EventContext, EVENT_CAPACITY } from './cultivation-events.types';
import { compareEvents, eventHash, verifyEvents } from './cultivation-chain';

@Injectable()
export class CultivationEventsStore {
  private readonly records = new Map<string, CultivationEvent>();
  private readonly contexts = new Map<string, EventContext>();
  private readonly chains = new Map<string, string[]>();
  private readonly heads = new Map<string, { count: number; hash: string | null }>();

  get(id: string): CultivationEvent {
    const event = this.records.get(id);
    if (!event) { throw new NotFoundException('Cultivation event not found'); }
    return structuredClone(event);
  }

  context(id: string): EventContext {
    this.get(id);
    return structuredClone(this.contexts.get(id)!);
  }

  list(): CultivationEvent[] { return structuredClone([...this.records.values()]); }

  add(event: CultivationEvent, context: EventContext): CultivationEvent {
    if (this.records.size >= EVENT_CAPACITY) { throw new HttpException('Cultivation RAM store full; locked history is never evicted', HttpStatus.TOO_MANY_REQUESTS); }
    if (this.records.has(event._id)) { throw new ConflictException('Duplicate event id'); }
    const chain = this.chains.get(context.zone_id) ?? [];
    const tail = chain.length ? this.records.get(chain[chain.length - 1]) : undefined;
    // Nếu đồng hồ lùi quá xa, không chèn trước đuôi đã hash. Từ chối trước
    // mutation, giữ nguyên lịch sử thay vì tính lại hash các bản Locked.
    if (tail && compareEvents(tail, event) >= 0) { throw new ConflictException('Server clock precedes the locked chain; retry after clock correction'); }
    this.records.set(event._id, structuredClone(event));
    this.contexts.set(event._id, structuredClone(context));
    return this.get(event._id);
  }

  update(event: CultivationEvent): CultivationEvent {
    this.pending(event._id);
    this.records.set(event._id, structuredClone(event));
    return this.get(event._id);
  }

  remove(id: string): void {
    this.pending(id);
    this.records.delete(id);
    this.contexts.delete(id);
  }

  lockDue(now = Date.now()): number {
    const due = [...this.records.values()].filter((event) => event.status === 'Pending' && Date.parse(event.lock_at) <= now).sort(compareEvents);
    // Không await giữa kiểm tra và ghi: trong một process Nest, request khác
    // không đọc bản ghi đang khóa dở hoặc nối cùng head hai lần. Khi persistence
    // cần transaction/lock thật; tính đồng bộ RAM không bảo vệ nhiều process.
    for (const event of due) {
      const zoneId = this.contexts.get(event._id)!.zone_id;
      const head = this.heads.get(zoneId) ?? { count: 0, hash: null };
      event.status = 'Locked';
      event.locked_at = new Date(now).toISOString();
      event.previous_hash = head.hash;
      event.hash = eventHash(event);
      const chain = this.chains.get(zoneId) ?? [];
      chain.push(event._id);
      this.chains.set(zoneId, chain);
      this.heads.set(zoneId, { count: head.count + 1, hash: event.hash });
    }
    return due.length;
  }

  verify(zoneId: string) {
    const events = (this.chains.get(zoneId) ?? []).map((id) => this.get(id));
    const head = this.heads.get(zoneId) ?? { count: 0, hash: null };
    return { ...verifyEvents(events, head), locked_events: head.count, tail_hash: head.hash };
  }

  private pending(id: string): void {
    const event = this.get(id);
    if (event.status !== 'Pending' || Date.now() >= Date.parse(event.lock_at)) { throw new ConflictException('Only Pending events before lock_at can change'); }
  }
}
