import { DynamicModule, Module, Provider } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AdminGuard } from '../users/admin.guard';
import { AI_CONFIG, AiConfig } from './ai.config';
import { AiStore, MemoryAiStore, MongoAiStore } from './ai.store';
import { AiService } from './ai.service';
import { AiWorker, ChatProvider, DisabledChatProvider, HttpAiWorker } from './ai.worker';
import { AiFarmerController, AiFarmerGuard, AiRagController, AiStatusController } from './ai.controller';
@Module({})
export class AiModule {
  static register(config: AiConfig, imports: DynamicModule[], database = false): DynamicModule {
    const store: Provider = database ? { provide: AiStore, inject: [DatabaseService], useFactory: (db: DatabaseService) => new MongoAiStore(db.mongo.db()) }
      : { provide: AiStore, useClass: MemoryAiStore };
    return { module: AiModule, imports, controllers: [AiStatusController, AiFarmerController, AiRagController], providers: [store, AiService, AiFarmerGuard, AdminGuard,
      { provide: AI_CONFIG, useValue: config }, { provide: AiWorker, useFactory: () => new HttpAiWorker(config) }, { provide: ChatProvider, useClass: DisabledChatProvider }], exports: [AiStore, AiService] };
  }
}
