import { FarmPage } from '../farms/farm-records';
import { FarmPageDto, FarmRequestListDto } from '../farms/farms.dto';
import { CreateDeviceDto, DeviceListDto, UpdateDeviceDto } from './devices.dto';
import { TestDevice, DeviceChangeRequest, DeviceMetadataHistory } from './devices.types';
import { TestTree } from '../trees/trees.types';

export abstract class DeviceRecords {
  abstract list(actor: string, query: DeviceListDto): Promise<FarmPage<TestDevice>>;
  abstract get(actor: string, id: string): Promise<TestDevice>;
  abstract getByStationId(actor: string, code: string): Promise<TestDevice>;
  abstract affectedTrees(actor: string, id: string, query: FarmPageDto): Promise<FarmPage<TestTree>>;
  abstract history(actor: string, id: string, query: FarmPageDto): Promise<FarmPage<DeviceMetadataHistory>>;
  abstract create(actor: string, input: CreateDeviceDto): Promise<TestDevice>;
  abstract update(actor: string, id: string, input: UpdateDeviceDto): Promise<TestDevice>;
  abstract createRequest(actor: string, input: CreateDeviceDto): Promise<DeviceChangeRequest>;
  abstract updateRequest(actor: string, id: string, input: UpdateDeviceDto): Promise<DeviceChangeRequest>;
  abstract listRequests(actor: string, query: FarmRequestListDto): Promise<FarmPage<DeviceChangeRequest>>;
  abstract getRequest(actor: string, id: string): Promise<DeviceChangeRequest>;
  abstract approve(actor: string, id: string): Promise<DeviceChangeRequest>;
  abstract reject(actor: string, id: string, reason?: string): Promise<DeviceChangeRequest>;
  // Trusted lookups for dependent services. HTTP must use scoped methods.
  abstract getRecord(id: string): Promise<TestDevice>;
  abstract getRecordByStationId(code: string): Promise<TestDevice>;
  // Receiver-only presence; does not change administrative status or metadata version.
  abstract recordSeen(id: string, receivedAt: string): Promise<void>;
}
