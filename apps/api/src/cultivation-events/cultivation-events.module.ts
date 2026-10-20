import { DynamicModule, Module } from '@nestjs/common';
import { CultivationEventsController } from './cultivation-events.controller';
import { CultivationEventsService } from './cultivation-events.service';
import { CultivationEventsStore } from './cultivation-events.store';
import { CultivationRecords, MemoryCultivationRecords } from './cultivation-records';

@Module({})
export class CultivationEventsModule {
  static forMock(imports: DynamicModule[]): DynamicModule {
    // AppModule supplies the existing instances, including the material bridge.
    return { module: CultivationEventsModule, imports, controllers: [CultivationEventsController],
      providers: [CultivationEventsStore, CultivationEventsService, MemoryCultivationRecords,
        { provide: CultivationRecords, useExisting: MemoryCultivationRecords }], exports: [CultivationEventsService, CultivationRecords] };
  }
}
