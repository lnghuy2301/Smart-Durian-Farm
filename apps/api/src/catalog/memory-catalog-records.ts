import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { UserAccounts } from '../auth/user-accounts';
import { MaterialsService } from '../materials/materials.service';
import { CreateMaterialDto, MaterialListDto, UpdateMaterialDto } from '../materials/materials.dto';
import { StandardsService } from '../standards/standards.service';
import { CreateStandardDto, StandardListDto, UpdateStandardDto } from '../standards/standards.dto';
import { StandardMaterialsService } from '../standard-materials/standard-materials.service';
import { MaterialRecords, StandardRecords, StandardMaterialRecords } from './catalog-records';

async function requireActor(accounts: UserAccounts, id: string, admin = false): Promise<void> {
  const account = await accounts.loadById(id);
  if (!account || account.user.status !== 'Active' || (admin && account.user.role !== 'Admin')) {
    throw new ForbiddenException(admin ? 'Chỉ Admin được thực hiện thao tác này' : 'Tài khoản phải Active');
  }
}

@Injectable()
export class MemoryMaterialRecords extends MaterialRecords {
  constructor(@Inject(MaterialsService) private readonly service: MaterialsService,
    @Inject(UserAccounts) private readonly accounts: UserAccounts) { super(); }
  async create(actor: string, input: CreateMaterialDto) { await requireActor(this.accounts, actor, true); return this.service.create(input); }
  async list(actor: string, query: MaterialListDto) { await requireActor(this.accounts, actor); return this.service.list(query); }
  async get(actor: string, id: string) { await requireActor(this.accounts, actor); return this.service.get(id); }
  async update(actor: string, id: string, input: UpdateMaterialDto) { await requireActor(this.accounts, actor, true); return this.service.update(id, input); }
}

@Injectable()
export class MemoryStandardRecords extends StandardRecords {
  constructor(@Inject(StandardsService) private readonly service: StandardsService,
    @Inject(UserAccounts) private readonly accounts: UserAccounts) { super(); }
  async create(actor: string, input: CreateStandardDto) { await requireActor(this.accounts, actor, true); return this.service.create(input); }
  async list(actor: string, query: StandardListDto) { await requireActor(this.accounts, actor); return this.service.list(query); }
  async get(actor: string, id: string) { await requireActor(this.accounts, actor); return this.service.get(id); }
  async update(actor: string, id: string, input: UpdateStandardDto) { await requireActor(this.accounts, actor, true); return this.service.update(id, input); }
}

@Injectable()
export class MemoryStandardMaterialRecords extends StandardMaterialRecords {
  constructor(@Inject(StandardMaterialsService) private readonly service: StandardMaterialsService,
    @Inject(UserAccounts) private readonly accounts: UserAccounts) { super(); }
  async add(actor: string, standard: string, material: string) { await requireActor(this.accounts, actor, true); return this.service.add(standard, material); }
  async list(actor: string, standard: string, query: MaterialListDto) { await requireActor(this.accounts, actor); return this.service.list(standard, query); }
  async has(actor: string, standard: string, material: string) { await requireActor(this.accounts, actor); return this.service.has(standard, material); }
  async remove(actor: string, standard: string, material: string) { await requireActor(this.accounts, actor, true); this.service.remove(standard, material); }
}
