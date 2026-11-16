import { AgriculturalMaterial } from '../materials/materials.service';
import { CreateMaterialDto, MaterialListDto, UpdateMaterialDto } from '../materials/materials.dto';
import { FarmingStandard } from '../standards/standards.service';
import { CreateStandardDto, StandardListDto, UpdateStandardDto } from '../standards/standards.dto';

export interface CatalogPage<T> { items: T[]; total: number; limit: number; offset: number }
export interface StandardMaterialLink { standard_id: string; material_id: string }

// HTTP dùng contracts async; domain RAM vẫn dùng đúng services hiện có.
// Khi chuyển cả domain sang DB, các lookup nội bộ phải chuyển cùng lúc, không
// ghép API PostgreSQL với Zone/Cultivation đọc một danh mục RAM khác.
export abstract class MaterialRecords {
  abstract create(actorId: string, input: CreateMaterialDto): Promise<AgriculturalMaterial>;
  abstract list(actorId: string, query: MaterialListDto): Promise<CatalogPage<AgriculturalMaterial>>;
  abstract get(actorId: string, id: string): Promise<AgriculturalMaterial>;
  abstract update(actorId: string, id: string, input: UpdateMaterialDto): Promise<AgriculturalMaterial>;
}
export abstract class StandardRecords {
  abstract create(actorId: string, input: CreateStandardDto): Promise<FarmingStandard>;
  abstract list(actorId: string, query: StandardListDto): Promise<CatalogPage<FarmingStandard>>;
  abstract get(actorId: string, id: string): Promise<FarmingStandard>;
  abstract update(actorId: string, id: string, input: UpdateStandardDto): Promise<FarmingStandard>;
}
export abstract class StandardMaterialRecords {
  abstract add(actorId: string, standardId: string, materialId: string): Promise<StandardMaterialLink>;
  abstract list(actorId: string, standardId: string, query: MaterialListDto): Promise<CatalogPage<AgriculturalMaterial> & { standard_id: string }>;
  abstract has(actorId: string, standardId: string, materialId: string): Promise<boolean>;
  abstract remove(actorId: string, standardId: string, materialId: string): Promise<void>;
}
