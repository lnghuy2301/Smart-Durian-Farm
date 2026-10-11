import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

export function farmInput<T extends object>(type: new () => T, input: T): T {
  if (!input || typeof input !== 'object' || Array.isArray(input)) { throw new BadRequestException('Dữ liệu Farm phải là object'); }
  const value = plainToInstance(type, input);
  if (validateSync(value, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }).length) {
    throw new BadRequestException('Dữ liệu Farm không hợp lệ');
  }
  return value;
}

export function farmUuid(id: string): string {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new BadRequestException('Định danh phải là UUID v4');
  }
  return id.toLowerCase();
}
