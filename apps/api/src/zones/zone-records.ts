import { FarmPage } from '../farms/farm-records';
import { FarmRequestListDto } from '../farms/farms.dto';
import { CreateZoneDto, UpdateZoneDto, ZoneListDto } from './zones.dto';
import { TestZone, ZoneChangeRequest } from './zones.types';

export abstract class ZoneRecords {
  abstract list(actor: string, query: ZoneListDto): Promise<FarmPage<TestZone>>;
  abstract get(actor: string, id: string): Promise<TestZone>;
  abstract create(actor: string, input: CreateZoneDto): Promise<TestZone>;
  abstract update(actor: string, id: string, input: UpdateZoneDto): Promise<TestZone>;
  abstract createRequest(actor: string, input: CreateZoneDto): Promise<ZoneChangeRequest>;
  abstract updateRequest(actor: string, id: string, input: UpdateZoneDto): Promise<ZoneChangeRequest>;
  abstract listRequests(actor: string, query: FarmRequestListDto): Promise<FarmPage<ZoneChangeRequest>>;
  abstract getRequest(actor: string, id: string): Promise<ZoneChangeRequest>;
  abstract approve(actor: string, id: string): Promise<ZoneChangeRequest>;
  abstract reject(actor: string, id: string, reason?: string): Promise<ZoneChangeRequest>;
}
