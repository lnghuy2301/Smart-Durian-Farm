import { DynamicModule, Module } from '@nestjs/common';
import { TreesController, TreeRequestsController } from './trees.controller';
import { TreesService } from './trees.service';
import { TreeRecords } from './tree-records';
import { MemoryTreeRecords } from './memory-tree-records';

@Module({})
export class TreesModule {
  static forMock(authModule: DynamicModule, farmsModule: DynamicModule, zonesModule: DynamicModule): DynamicModule {
    // Truyền đúng module đang chạy: quyền Tree thấy ngay Farm/Zone/phân công/HTX hiện có.
    return { module: TreesModule, imports: [authModule, farmsModule, zonesModule],
      controllers: [TreesController, TreeRequestsController],
      providers: [TreesService, MemoryTreeRecords, {provide:TreeRecords,useExisting:MemoryTreeRecords}],
      exports: [TreesService,TreeRecords] };
  }
}
