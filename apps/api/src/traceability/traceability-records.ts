import { Inject, Injectable } from '@nestjs/common';
import { FarmPageDto } from '../farms/farms.dto';
import { TraceabilityService } from './traceability.service';

export abstract class TraceabilityRecords {
  abstract get(code: string): Promise<ReturnType<TraceabilityService['get']>>;
  abstract cultivationHistory(code: string, query: FarmPageDto): Promise<ReturnType<TraceabilityService['cultivationHistory']>>;
  abstract harvestHistory(code: string, query: FarmPageDto): Promise<ReturnType<TraceabilityService['harvestHistory']>>;
  abstract qrSvg(code: string): Promise<string>;
}
@Injectable()
export class MemoryTraceabilityRecords extends TraceabilityRecords {
  constructor(@Inject(TraceabilityService) private readonly service: TraceabilityService) { super(); }
  async get(code: string) { return this.service.get(code); }
  async cultivationHistory(code: string, query: FarmPageDto) { return this.service.cultivationHistory(code, query); }
  async harvestHistory(code: string, query: FarmPageDto) { return this.service.harvestHistory(code, query); }
  async qrSvg(code: string) { return this.service.qrSvg(code); }
}
