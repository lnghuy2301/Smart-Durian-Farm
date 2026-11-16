import { CreateFarmRequestDto, FarmListDto, FarmPageDto, FarmRequestListDto, UpdateFarmRequestDto } from './farms.dto';
import { FarmChangeRequest, FarmLeaveNotification, TestFarm } from './farms.types';

export interface FarmPage<T> { items: T[]; total: number; limit: number; offset: number }

// Contract HTTP async. Các domain RAM vẫn dùng FarmsService hiện có cho đến
// khi adapters của chúng chuyển cùng lúc; không trộn Farm PG với Zone RAM.
export abstract class FarmRecords {
  abstract list(actorId: string, query: FarmListDto): Promise<FarmPage<TestFarm>>;
  abstract get(actorId: string, farmId: string): Promise<TestFarm>;
  abstract createRequest(actorId: string, input: CreateFarmRequestDto): Promise<FarmChangeRequest>;
  abstract updateRequest(actorId: string, farmId: string, input: UpdateFarmRequestDto): Promise<FarmChangeRequest>;
  abstract joinRequest(actorId: string, farmId: string, cooperativeId: string): Promise<FarmChangeRequest>;
  abstract leaveRequest(actorId: string, farmId: string): Promise<FarmChangeRequest>;
  abstract listRequests(actorId: string, query: FarmRequestListDto): Promise<FarmPage<FarmChangeRequest>>;
  abstract getRequest(actorId: string, id: string): Promise<FarmChangeRequest>;
  abstract approve(actorId: string, id: string): Promise<FarmChangeRequest>;
  abstract reject(actorId: string, id: string, reason?: string): Promise<FarmChangeRequest>;
  abstract listNotifications(actorId: string, query: FarmPageDto): Promise<FarmPage<FarmLeaveNotification>>;
}
