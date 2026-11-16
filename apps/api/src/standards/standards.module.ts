import { DynamicModule, Module } from '@nestjs/common';
import { AdminGuard } from '../users/admin.guard';
import { StandardsController } from './standards.controller';
import { StandardsService } from './standards.service';
import { StandardRecords } from '../catalog/catalog-records';
import { MemoryStandardRecords } from '../catalog/memory-catalog-records';

@Module({})
export class StandardsModule {
  static forMock(authModule: DynamicModule): DynamicModule {
    return {
      module: StandardsModule,
      imports: [authModule],
      controllers: [StandardsController],
      providers: [StandardsService, MemoryStandardRecords, { provide: StandardRecords, useExisting: MemoryStandardRecords }, AdminGuard],
      exports: [StandardsService, StandardRecords],
    };
  }
}
