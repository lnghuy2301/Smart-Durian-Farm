import { DynamicModule, Module } from '@nestjs/common';
import { TraceabilityConfig, TRACEABILITY_CONFIG } from './traceability.config';
import { TraceabilityController } from './traceability.controller';
import { TraceabilityService } from './traceability.service';
import { MemoryTraceabilityRecords, TraceabilityRecords } from './traceability-records';

@Module({})
export class TraceabilityModule {
  static register(config: TraceabilityConfig, imports: DynamicModule[]): DynamicModule {
    return { module: TraceabilityModule, imports, controllers: [TraceabilityController],
      providers: [{ provide: TRACEABILITY_CONFIG, useValue: config }, TraceabilityService, MemoryTraceabilityRecords,
        { provide: TraceabilityRecords, useExisting: MemoryTraceabilityRecords }], exports: [TraceabilityService] };
  }
}
