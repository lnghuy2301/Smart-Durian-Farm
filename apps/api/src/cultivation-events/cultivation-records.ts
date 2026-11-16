import { Inject, Injectable } from '@nestjs/common';
import { FarmPage } from '../farms/farm-records';
import { FarmPageDto } from '../farms/farms.dto';
import { CreateCorrectionDto, CreateEventDto, EventListDto, UpdateEventDto } from './cultivation-events.dto';
import { CultivationEvent } from './cultivation-events.types';
import { CultivationEventsService } from './cultivation-events.service';

export type ChainResult = ReturnType<CultivationEventsService['verify']>;
export abstract class CultivationRecords {
  abstract create(actor: string, input: CreateEventDto): Promise<CultivationEvent>;
  abstract update(actor: string, id: string, input: UpdateEventDto): Promise<CultivationEvent>;
  abstract remove(actor: string, id: string): Promise<void>;
  abstract correct(actor: string, id: string, input: CreateCorrectionDto): Promise<CultivationEvent>;
  abstract get(actor: string, id: string): Promise<CultivationEvent>;
  abstract list(actor: string, query: EventListDto, mineOnly?: boolean): Promise<FarmPage<CultivationEvent>>;
  abstract corrections(actor: string, id: string, query: FarmPageDto): Promise<FarmPage<CultivationEvent>>;
  abstract verify(actor: string, zone: string): Promise<ChainResult>;
  // Trusted QR consumer only; HTTP public projection must keep its whitelist.
  abstract lockedForTrace(zone: string): Promise<CultivationEvent[]>;
}

@Injectable()
export class MemoryCultivationRecords extends CultivationRecords {
  constructor(@Inject(CultivationEventsService) private readonly service: CultivationEventsService) { super(); }
  async create(actor: string, body: CreateEventDto) { return this.service.create(actor, body); }
  async update(actor: string, id: string, body: UpdateEventDto) { return this.service.update(actor, id, body); }
  async remove(actor: string, id: string) { this.service.remove(actor, id); }
  async correct(actor: string, id: string, body: CreateCorrectionDto) { return this.service.correct(actor, id, body); }
  async get(actor: string, id: string) { return this.service.get(actor, id); }
  async list(actor: string, query: EventListDto, mineOnly = false) { return this.service.list(actor, query, mineOnly); }
  async corrections(actor: string, id: string, query: FarmPageDto) { return this.service.corrections(actor, id, query); }
  async verify(actor: string, zone: string) { return this.service.verify(actor, zone); }
  async lockedForTrace(zone: string) { return this.service.lockedForTrace(zone); }
}
