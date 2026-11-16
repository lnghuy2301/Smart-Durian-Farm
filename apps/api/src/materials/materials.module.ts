import { DynamicModule, Module } from '@nestjs/common';
import { AdminGuard } from '../users/admin.guard';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';
import { MaterialRecords } from '../catalog/catalog-records';
import { MemoryMaterialRecords } from '../catalog/memory-catalog-records';

@Module({})
export class MaterialsModule {
  static forMock(authModule: DynamicModule): DynamicModule {
    return {
      module: MaterialsModule,
      imports: [authModule],
      controllers: [MaterialsController],
      providers: [MaterialsService, MemoryMaterialRecords, { provide: MaterialRecords, useExisting: MemoryMaterialRecords }, AdminGuard],
      exports: [MaterialsService, MaterialRecords],
    };
  }
}
