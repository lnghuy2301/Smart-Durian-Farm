import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { AdminGuard } from '../users/admin.guard';
import { CreateStandardDto, StandardListDto, UpdateStandardDto } from './standards.dto';
import { StandardRecords } from '../catalog/catalog-records';

@ApiTags('farming-standards-local-test')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('standards')
export class StandardsController {
  constructor(@Inject(StandardRecords) private readonly standards: StandardRecords) {}

  @Get()
  list(@Req() request: AuthRequest, @Query() query: StandardListDto) { return this.standards.list(request.user!.id, query); }

  @Get(':id')
  get(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.standards.get(request.user!.id, id); }

  @Post()
  @UseGuards(AdminGuard)
  create(@Req() request: AuthRequest, @Body() body: CreateStandardDto) { return this.standards.create(request.user!.id, body); }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: UpdateStandardDto) {
    return this.standards.update(request.user!.id, id, body);
  }
}
