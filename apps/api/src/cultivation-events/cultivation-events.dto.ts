import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsIn, IsMongoId, IsNumber, IsObject, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { FarmPageDto } from '../farms/farms.dto';
import { ACTION_TYPES, EVENT_STATUSES, TARGET_TYPES } from './cultivation-events.types';

export class EventMaterialDto {
  @ApiProperty() @IsUUID('4') material_id!: string;
  @ApiProperty({ minimum: 0.001, maximum: 1000000 })
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1000000) quantity!: number;
}

export class EventDetailsDto {
  @ApiPropertyOptional({ maxLength: 200, description: 'Tên công việc bắt buộc khi action_type=Other; không công khai trên QR' })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(200) activity_name?: string;
  @ApiPropertyOptional({ minimum: 0.001, maximum: 10080 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(10080) duration_minutes?: number;

  @ApiPropertyOptional({ minimum: 0.001, maximum: 1000000 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1000000) water_volume_l?: number;

  @ApiPropertyOptional({ type: [EventMaterialDto], minItems: 1, maxItems: 20 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => EventMaterialDto)
  materials?: EventMaterialDto[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(2000) note?: string;
}

export class CreateEventDto {
  @ApiProperty({ enum: TARGET_TYPES }) @IsIn(TARGET_TYPES) target_type!: typeof TARGET_TYPES[number];
  @ApiProperty() @IsUUID('4') target_id!: string;
  @ApiProperty({ enum: ACTION_TYPES }) @IsIn(ACTION_TYPES) action_type!: typeof ACTION_TYPES[number];
  @ApiProperty({ type: EventDetailsDto }) @IsDefined() @IsObject() @ValidateNested() @Type(() => EventDetailsDto)
  details!: EventDetailsDto;
}

export class UpdateEventDto extends PartialType(CreateEventDto, { skipNullProperties: false }) {}

export class CreateCorrectionDto extends CreateEventDto {
  @ApiProperty({ maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(2000) correction_reason!: string;
}

export class EventIdDto {
  @ApiProperty({ description: 'ObjectId, 24 hexadecimal characters' }) @IsMongoId() id!: string;
}

export class EventListDto extends FarmPageDto {
  @ApiPropertyOptional() @ValidateIf((_o, v) => v !== undefined) @IsUUID('4') zone_id?: string;
  @ApiPropertyOptional() @ValidateIf((_o, v) => v !== undefined) @IsUUID('4') target_id?: string;
  @ApiPropertyOptional({ enum: TARGET_TYPES }) @ValidateIf((_o, v) => v !== undefined) @IsIn(TARGET_TYPES)
  target_type?: typeof TARGET_TYPES[number];
  @ApiPropertyOptional({ enum: ACTION_TYPES }) @ValidateIf((_o, v) => v !== undefined) @IsIn(ACTION_TYPES)
  action_type?: typeof ACTION_TYPES[number];
  @ApiPropertyOptional({ enum: EVENT_STATUSES }) @ValidateIf((_o, v) => v !== undefined) @IsIn(EVENT_STATUSES)
  status?: typeof EVENT_STATUSES[number];
}
