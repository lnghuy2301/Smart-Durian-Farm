import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class AiPageDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(20) limit = 10;
  @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset = 0;
}
export class DiagnosisInput {
  @Transform(({ value }: { value: unknown }) => value === '' ? null : value)
  @ValidateIf((_o, value) => value !== undefined && value !== null) @IsUUID('4') zone_id?: string | null;
}
export class FeedbackInput { @IsBoolean() user_feedback!: boolean; }
export class ConversationInput { @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) session_title!: string; }
export class ChatInput { @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) message!: string; }
export class ImportPdfInput {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(255) filename!: string;
  @Transform(trim) @ValidateIf((_o, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(120) title?: string;
}
export class PreparedPdfInput { @Transform(trim) @IsString() @MinLength(1) @MaxLength(255) filename!: string; }
export class PdfTitleInput { @Transform(trim) @ValidateIf((_o, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(120) title?: string; }
export class DocumentStatusInput { @IsIn(['Active', 'Inactive']) status!: 'Active' | 'Inactive'; }
export interface AiUpload { buffer: Buffer; originalname: string; mimetype: string; size: number }
