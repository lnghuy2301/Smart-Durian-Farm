import { FarmPage } from '../farms/farm-records';
import { FarmPageDto, FarmRequestListDto } from '../farms/farms.dto';
import { CreateSensorDto, SensorListDto, UpdateSensorDto } from './sensors.dto';
import { TestSensor, SensorChangeRequest, SensorMetadataHistory } from './sensors.types';

export abstract class SensorRecords {
  abstract list(actor: string, query: SensorListDto): Promise<FarmPage<TestSensor>>;
  abstract get(actor: string, id: string): Promise<TestSensor>;
  abstract getByStream(actor: string, deviceId: string, streamId: string): Promise<TestSensor>;
  abstract history(actor: string, id: string, query: FarmPageDto): Promise<FarmPage<SensorMetadataHistory>>;
  abstract create(actor: string, input: CreateSensorDto): Promise<TestSensor>;
  abstract update(actor: string, id: string, input: UpdateSensorDto): Promise<TestSensor>;
  abstract createRequest(actor: string, input: CreateSensorDto): Promise<SensorChangeRequest>;
  abstract updateRequest(actor: string, id: string, input: UpdateSensorDto): Promise<SensorChangeRequest>;
  abstract listRequests(actor: string, query: FarmRequestListDto): Promise<FarmPage<SensorChangeRequest>>;
  abstract getRequest(actor: string, id: string): Promise<SensorChangeRequest>;
  abstract approve(actor: string, id: string): Promise<SensorChangeRequest>;
  abstract reject(actor: string, id: string, reason?: string): Promise<SensorChangeRequest>;
  // Trusted lookups for dependent services. HTTP must use scoped methods.
  abstract getRecord(id: string): Promise<TestSensor>;
  abstract getRecordByStream(deviceId: string, streamId: string): Promise<TestSensor>;
}
