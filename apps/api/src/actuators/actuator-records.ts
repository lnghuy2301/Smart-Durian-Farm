import { FarmPage } from '../farms/farm-records';
import { FarmPageDto, FarmRequestListDto } from '../farms/farms.dto';
import { CreateActuatorDto, ActuatorListDto, UpdateActuatorDto } from './actuators.dto';
import { TestActuator, ActuatorChangeRequest, ActuatorMetadataHistory } from './actuators.types';

export abstract class ActuatorRecords {
  abstract list(actor: string, query: ActuatorListDto): Promise<FarmPage<TestActuator>>;
  abstract get(actor: string, id: string): Promise<TestActuator>;
  abstract getByCapability(actor: string, deviceId: string, capabilityId: number): Promise<TestActuator>;
  abstract history(actor: string, id: string, query: FarmPageDto): Promise<FarmPage<ActuatorMetadataHistory>>;
  abstract create(actor: string, input: CreateActuatorDto): Promise<TestActuator>;
  abstract update(actor: string, id: string, input: UpdateActuatorDto): Promise<TestActuator>;
  abstract createRequest(actor: string, input: CreateActuatorDto): Promise<ActuatorChangeRequest>;
  abstract updateRequest(actor: string, id: string, input: UpdateActuatorDto): Promise<ActuatorChangeRequest>;
  abstract listRequests(actor: string, query: FarmRequestListDto): Promise<FarmPage<ActuatorChangeRequest>>;
  abstract getRequest(actor: string, id: string): Promise<ActuatorChangeRequest>;
  abstract approve(actor: string, id: string): Promise<ActuatorChangeRequest>;
  abstract reject(actor: string, id: string, reason?: string): Promise<ActuatorChangeRequest>;
  // Trusted lookups for dependent services. HTTP must use scoped methods.
  abstract getRecord(id: string): Promise<TestActuator>;
  abstract getRecordByCapability(deviceId: string, capabilityId: number): Promise<TestActuator>;
}
