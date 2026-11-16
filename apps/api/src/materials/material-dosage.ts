import { BadRequestException } from '@nestjs/common';

interface DosageInput { default_dosage?: string; default_dosage_value?: number | null; dosage_basis?: string | null; unit?: string }
export function materialDosage(input: DosageInput, current?: DosageInput): { default_dosage?: string; default_dosage_value?: number | null; dosage_basis?: string | null } {
  const changed = ['default_dosage', 'default_dosage_value', 'dosage_basis', 'unit'].some((key) => input[key as keyof DosageInput] !== undefined);
  if (current && !changed) return {};
  const structured = input.default_dosage_value !== undefined || input.dosage_basis !== undefined;
  if (!structured && input.default_dosage !== undefined && input.default_dosage !== current?.default_dosage) {
    // Transitional clients may still send a label. Never guess a dose from text.
    if (typeof input.default_dosage !== 'string' || !input.default_dosage.trim() || input.default_dosage.length > 100) throw new BadRequestException('Liều mặc định không hợp lệ');
    return { default_dosage: input.default_dosage, default_dosage_value: null, dosage_basis: null };
  }
  const value = input.default_dosage_value ?? current?.default_dosage_value;
  const basis = input.dosage_basis ?? current?.dosage_basis;
  if (value === undefined || value === null) {
    if (structured || !current?.default_dosage) throw new BadRequestException('Cần số lượng liều và cơ sở liều');
    return { default_dosage: current.default_dosage, default_dosage_value: null, dosage_basis: null };
  }
  const unit = input.unit ?? current?.unit;
  if (!Number.isFinite(value) || value < 0.001 || value > 1000000 || Math.abs(value * 1000 - Math.round(value * 1000)) > 0.000001 ||
    typeof basis !== 'string' || !basis.trim() || basis.length > 60 || !unit) throw new BadRequestException('Liều cần số dương tối đa 3 chữ số thập phân, đơn vị và cơ sở liều');
  return { default_dosage: `${value} ${unit}/${basis.trim()}`, default_dosage_value: value, dosage_basis: basis.trim() };
}
