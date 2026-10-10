import { DynamicModule, Module } from '@nestjs/common';
import { AdminGuard } from '../users/admin.guard';
import { StandardMaterialsController } from './standard-materials.controller';
import { StandardMaterialsService } from './standard-materials.service';
import { StandardMaterialRecords } from '../catalog/catalog-records';
import { MemoryStandardMaterialRecords } from '../catalog/memory-catalog-records';

@Module({})
export class StandardMaterialsModule {
  static forMock(authModule: DynamicModule, materialsModule: DynamicModule, standardsModule: DynamicModule): DynamicModule {
    return {
      module: StandardMaterialsModule,
      imports: [authModule, materialsModule, standardsModule],
      controllers: [StandardMaterialsController],
      providers: [StandardMaterialsService, MemoryStandardMaterialRecords, { provide: StandardMaterialRecords, useExisting: MemoryStandardMaterialRecords }, AdminGuard],
      exports: [StandardMaterialsService, StandardMaterialRecords],
    };
  }
}
