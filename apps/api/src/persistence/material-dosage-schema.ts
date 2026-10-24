// Additive contract: retain the old label and all historical JSON/hash snapshots.
// Legacy labels are NOT parsed into doses; normalization is explicit and audited.
export const MATERIAL_DOSAGE_SCHEMA = `
ALTER TABLE public.agricultural_materials
 ADD COLUMN default_dosage_value double precision,
 ADD COLUMN dosage_basis varchar(60),
 ADD CONSTRAINT material_dosage_pair CHECK (
  (default_dosage_value IS NULL AND dosage_basis IS NULL) OR
  (default_dosage_value IS NOT NULL AND dosage_basis IS NOT NULL AND
   default_dosage_value BETWEEN 0.001 AND 1000000 AND
   default_dosage_value=round(default_dosage_value::numeric,3)::double precision AND
   length(btrim(dosage_basis)) BETWEEN 1 AND 60)
 );
`;
