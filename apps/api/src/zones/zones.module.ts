import { DynamicModule, Module } from '@nestjs/common';
import { ZoneRequestsController, ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { MockZoneAssignmentStore } from '../assignments/mock-zone-assignment.store';
import { ZoneRecords } from './zone-records';
import { MemoryZoneRecords } from './memory-zone-records';

@Module({})
export class ZonesModule {
  static forMock(authModule: DynamicModule, farmsModule: DynamicModule, standardsModule: DynamicModule): DynamicModule {
    return { module: ZonesModule, imports: [authModule, farmsModule, standardsModule],
      controllers: [ZonesController, ZoneRequestsController],
      providers: [ZonesService, MockZoneAssignmentStore, MemoryZoneRecords, { provide: ZoneRecords, useExisting: MemoryZoneRecords }],
      exports: [ZonesService, MockZoneAssignmentStore, ZoneRecords] };
  }
}
