import { ObjectId } from 'mongodb';

export function decimalNumber(value: string | number): number {
  if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value)) { throw new Error('Invalid database decimal'); }
  const number = Number(value);
  if (!Number.isFinite(number)) { throw new Error('Invalid database decimal'); }
  return number;
}
export function safeInteger(value: string | number): number {
  const number = decimalNumber(value);
  if (!Number.isSafeInteger(number)) { throw new Error('Database integer exceeds exact JSON range'); }
  return number;
}
export function utcIso(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) { throw new Error('Invalid database timestamp'); }
  return value.toISOString();
}

// Chỉ đổi các field cấp gốc đã định nghĩa; details/snapshots không được normalize
// đệ quy vì canonical hash v1 sử dụng nội dung JSON lịch sử chính xác.
export function toMongoRecord(record: Record<string, unknown>, idFields: readonly string[], dateFields: readonly string[]) {
  const stored: Record<string, unknown> = { ...record };
  for (const field of idFields) {
    const value = stored[field];
    if (value !== null) {
      if (typeof value !== 'string' || !/^[0-9a-f]{24}$/.test(value)) { throw new Error('Invalid ObjectId mapping'); }
      stored[field] = new ObjectId(value);
    }
  }
  for (const field of dateFields) {
    const value = stored[field];
    if (value !== null) {
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new Error('Mongo timestamp requires canonical UTC ISO');
      }
      stored[field] = new Date(value);
    }
  }
  return stored;
}
export function fromMongoRecord(record: Record<string, unknown>, idFields: readonly string[], dateFields: readonly string[]) {
  const wire: Record<string, unknown> = { ...record };
  for (const field of idFields) {
    if (wire[field] !== null) {
      if (!(wire[field] instanceof ObjectId)) { throw new Error('Invalid stored ObjectId'); }
      wire[field] = (wire[field] as ObjectId).toHexString();
    }
  }
  for (const field of dateFields) { if (wire[field] !== null) { wire[field] = utcIso(wire[field] as Date); } }
  return wire;
}
