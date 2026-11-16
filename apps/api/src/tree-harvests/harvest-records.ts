import { FarmPage } from '../farms/farm-records';
import { FarmPageDto } from '../farms/farms.dto';
import {
  CreateHarvestBackdateDto,
  CreateHarvestDto,
  HarvestCorrectionDto,
  HarvestListDto,
  HarvestRequestListDto,
  UpdateHarvestDto,
} from './tree-harvests.dto';
import {
  HarvestBackdatePermission,
  HarvestDetails,
  HarvestRequest,
  TestTreeHarvest,
} from './tree-harvests.types';

export abstract class HarvestRecords {
  abstract list(actor: string, query: HarvestListDto): Promise<FarmPage<TestTreeHarvest>>;
  abstract get(actor: string, id: string): Promise<TestTreeHarvest>;
  abstract create(actor: string, input: CreateHarvestDto): Promise<TestTreeHarvest>;
  abstract updateDraft(actor: string, id: string, input: UpdateHarvestDto): Promise<TestTreeHarvest>;
  abstract removeDraft(actor: string, id: string): Promise<{ deleted: boolean; id: string }>;
  abstract submit(actor: string, id: string): Promise<TestTreeHarvest>;
  abstract correction(actor: string, id: string, input: HarvestCorrectionDto): Promise<HarvestRequest>;
  abstract prepareCorrection(actor: string, id: string, input: UpdateHarvestDto): Promise<HarvestRequest>;
  abstract approve(actor: string, id: string): Promise<HarvestRequest>;
  abstract reject(actor: string, id: string, reason?: string): Promise<HarvestRequest>;
  abstract listRequests(actor: string, query: HarvestRequestListDto): Promise<FarmPage<HarvestRequest>>;
  abstract getRequest(actor: string, id: string): Promise<HarvestRequest>;
  abstract grantBackdate(actor: string, input: CreateHarvestBackdateDto): Promise<HarvestBackdatePermission>;
  abstract listBackdates(actor: string, query: FarmPageDto): Promise<FarmPage<HarvestBackdatePermission>>;
  abstract revokeBackdate(actor: string, id: string): Promise<HarvestBackdatePermission>;
  // Trusted public-trace adapter lookup; already whitelisted business fields.
  abstract confirmedForTrace(treeId: string): Promise<HarvestDetails[]>;
}
