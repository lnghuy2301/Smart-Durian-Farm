import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

// Repositories còn được gọi ngoài HTTP; không dựa riêng vào ValidationPipe.
export function catalogInput<T extends object>(type: new () => T, input: T): T {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Dữ liệu danh mục phải là object');
  }
  const value = plainToInstance(type, input);
  if (validateSync(value, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }).length) {
    throw new BadRequestException('Dữ liệu danh mục không hợp lệ');
  }
  return value;
}

export function catalogUuid(id: string): void {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new BadRequestException('Định danh phải là UUID v4');
  }
}
