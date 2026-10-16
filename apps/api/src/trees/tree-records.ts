import { FarmPage } from '../farms/farm-records';
import { FarmPageDto, FarmRequestListDto } from '../farms/farms.dto';
import { CreateTreeDto, TreeListDto, UpdateTreeDto } from './trees.dto';
import { TestTree, TreeChangeRequest, TreeMetadataHistory } from './trees.types';

export abstract class TreeRecords {
  abstract list(actor: string, query: TreeListDto): Promise<FarmPage<TestTree>>;
  abstract get(actor: string, id: string): Promise<TestTree>;
  abstract getByCode(actor: string, code: string): Promise<TestTree>;
  abstract history(actor: string, id: string, query: FarmPageDto): Promise<FarmPage<TreeMetadataHistory>>;
  abstract create(actor: string, input: CreateTreeDto): Promise<TestTree>;
  abstract update(actor: string, id: string, input: UpdateTreeDto): Promise<TestTree>;
  abstract createRequest(actor: string, input: CreateTreeDto): Promise<TreeChangeRequest>;
  abstract updateRequest(actor: string, id: string, input: UpdateTreeDto): Promise<TreeChangeRequest>;
  abstract listRequests(actor: string, query: FarmRequestListDto): Promise<FarmPage<TreeChangeRequest>>;
  abstract getRequest(actor: string, id: string): Promise<TreeChangeRequest>;
  abstract approve(actor: string, id: string): Promise<TreeChangeRequest>;
  abstract reject(actor: string, id: string, reason?: string): Promise<TreeChangeRequest>;
  // Trusted lookups for dependent services. HTTP must use scoped methods.
  abstract getRecord(id: string): Promise<TestTree>;
  abstract getTraceRecordByCode(code: string): Promise<TestTree>;
}
