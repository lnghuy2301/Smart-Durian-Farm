import { ArgumentsHost, Body, CanActivate, Catch, Controller, Delete, ExceptionFilter, ExecutionContext, ForbiddenException, Get, Header, HttpException, Inject, Injectable, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseFilters, UseGuards, UseInterceptors, Param, Req } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { ServerResponse } from 'node:http';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { WindowRateLimiter } from '../auth/rate-limiter';
import { AdminGuard } from '../users/admin.guard';
import { AiService } from './ai.service';
import { AiPageDto, AiUpload, ChatInput, ConversationInput, DiagnosisInput, DocumentStatusInput, FeedbackInput, ImportPdfInput, PdfTitleInput, PreparedPdfInput } from './ai.dto';

@Catch()
export class AiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>();
    if (error instanceof HttpException) { const value = error.getResponse(); response.status(error.getStatus()).json(typeof value === 'string' ? { message: value } : value); }
    else response.status(503).json({ message: 'Thao tác AI không hoàn tất; kiểm tra service/storage và thử lại sau khi đối chiếu dữ liệu' });
  }
}
@Injectable()
export class AiFarmerGuard implements CanActivate {
  canActivate(context: ExecutionContext) { if (context.switchToHttp().getRequest<AuthRequest>().user?.role !== 'Farmer') throw new ForbiddenException('Chức năng AI này dành cho Farmer'); return true; }
}
@ApiTags('ai-status') @ApiBearerAuth() @UseGuards(AuthGuard) @UseFilters(AiExceptionFilter) @Controller('ai')
export class AiStatusController {
  constructor(@Inject(AiService) private readonly service: AiService) {}
  @Get('status') @Header('Cache-Control', 'no-store') status(@Req() req: AuthRequest) { return this.service.status(req.user!.id); }
  @Get('model') @Header('Cache-Control', 'no-store') model(@Req() req: AuthRequest) { return this.service.model(req.user!.id); }
}
@ApiTags('ai-farmer') @ApiBearerAuth() @UseGuards(AuthGuard, AiFarmerGuard) @UseFilters(AiExceptionFilter) @Controller('ai')
export class AiFarmerController {
  private readonly limiter = new WindowRateLimiter();
  constructor(@Inject(AiService) private readonly service: AiService) {}
  @Post('diagnoses') @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, parts: 2 } }))
  diagnose(@Req() req: AuthRequest, @Body() input: DiagnosisInput, @UploadedFile() file?: AiUpload) { this.limiter.take('ai-image', 10, req.user!.id); return this.service.diagnose(req.user!.id, input.zone_id ?? null, file); }
  @Get('diagnoses') @Header('Cache-Control', 'no-store') diagnoses(@Req() req: AuthRequest, @Query() page: AiPageDto) { return this.service.diagnoses(req.user!.id, page); }
  @Get('diagnoses/:id') @Header('Cache-Control', 'no-store') diagnosis(@Req() req: AuthRequest, @Param('id') id: string) { return this.service.diagnosis(req.user!.id, id); }
  @Delete('diagnoses/:id') deleteDiagnosis(@Req() req: AuthRequest, @Param('id') id: string) { return this.service.deleteDiagnosis(req.user!.id, id); }
  @Patch('diagnoses/:id/feedback') feedback(@Req() req: AuthRequest, @Param('id') id: string, @Body() input: FeedbackInput) { return this.service.feedback(req.user!.id, id, input.user_feedback); }
  @Get('diagnoses/:id/image') @Header('Cache-Control', 'no-store')
  async image(@Req() req: AuthRequest, @Param('id') id: string, @Res({ passthrough: true }) response: ServerResponse) {
    const value = await this.service.image(req.user!.id, id); response.setHeader('Content-Type', value.mime); response.setHeader('X-Content-Type-Options', 'nosniff'); return new StreamableFile(value.bytes);
  }
  @Post('conversations') create(@Req() req: AuthRequest, @Body() input: ConversationInput) { this.limiter.take('ai-chat', 20, req.user!.id); return this.service.createConversation(req.user!.id, input.session_title); }
  @Get('conversations') @Header('Cache-Control', 'no-store') conversations(@Req() req: AuthRequest, @Query() page: AiPageDto) { return this.service.conversations(req.user!.id, page); }
  @Get('conversations/:id') @Header('Cache-Control', 'no-store') conversation(@Req() req: AuthRequest, @Param('id') id: string) { return this.service.conversation(req.user!.id, id); }
  @Delete('conversations/:id') deleteConversation(@Req() req: AuthRequest, @Param('id') id: string) { return this.service.deleteConversation(req.user!.id, id); }
  @Post('conversations/:id/messages') message(@Req() req: AuthRequest, @Param('id') id: string, @Body() input: ChatInput) { this.limiter.take('ai-chat', 20, req.user!.id); return this.service.message(req.user!.id, id, input.message); }
}
@ApiTags('ai-rag-admin') @ApiBearerAuth() @UseGuards(AuthGuard, AdminGuard) @UseFilters(AiExceptionFilter) @Controller('ai/rag')
export class AiRagController {
  private readonly limiter = new WindowRateLimiter();
  constructor(@Inject(AiService) private readonly service: AiService) {}
  @Get('inbox') @Header('Cache-Control', 'no-store') inbox(@Req() req: AuthRequest) { return this.service.inbox(req.user!.id); }
  @Get('documents') @Header('Cache-Control', 'no-store') documents(@Req() req: AuthRequest) { return this.service.documents(req.user!.id); }
  @Get('prepared') @Header('Cache-Control', 'no-store') prepared(@Req() req: AuthRequest) { return this.service.prepared(req.user!.id); }
  @Post('documents/import-prepared') importPrepared(@Req() req: AuthRequest, @Body() input: PreparedPdfInput) { this.limiter.take('ai-rag', 5, req.user!.id); return this.service.importPrepared(req.user!.id, input.filename); }
  @Post('documents/import') import(@Req() req: AuthRequest, @Body() input: ImportPdfInput) { this.limiter.take('ai-rag', 5, req.user!.id); return this.service.importFile(req.user!.id, input.filename, input.title); }
  @Post('documents/upload') @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('pdf', { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, parts: 2 } }))
  upload(@Req() req: AuthRequest, @Body() input: PdfTitleInput, @UploadedFile() file?: AiUpload) { this.limiter.take('ai-rag', 5, req.user!.id); if (!file) throw new HttpException('Cần file PDF', 400); return this.service.importPdf(req.user!.id, file.originalname, file.buffer, input.title); }
  @Patch('documents/:id/status') status(@Req() req: AuthRequest, @Param('id') id: string, @Body() input: DocumentStatusInput) { return this.service.documentStatus(req.user!.id, id, input.status); }
  @Post('search') search(@Req() req: AuthRequest, @Body() input: ChatInput) { this.limiter.take('ai-chat', 20, req.user!.id); return this.service.search(req.user!.id, input.message); }
}
