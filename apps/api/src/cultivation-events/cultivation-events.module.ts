import { DynamicModule, Module } from '@nestjs/common';
import { CultivationEventsController } from './cultivation-events.controller';
import { CultivationEventsService } from './cultivation-events.service';
import { CultivationEventsStore } from './cultivation-events.store';

@Module({})
export class CultivationEventsModule {
  static forMock(imports: DynamicModule[]): DynamicModule {
    // AppModule supplies the existing instances, including the material bridge.
    return { module: CultivationEventsModule, imports, controllers: [CultivationEventsController],
      providers: [CultivationEventsStore, CultivationEventsService], exports: [CultivationEventsService] };
  }
}
