import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { AdminGuard } from '../users/admin.guard';
import { CreateMaterialDto, MaterialListDto, UpdateMaterialDto } from './materials.dto';
import { MaterialRecords } from '../catalog/catalog-records';

@ApiTags('agricultural-materials-local-test')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('materials')
export class MaterialsController {
  constructor(@Inject(MaterialRecords) private readonly materials: MaterialRecords) {}

  @Get()
  list(@Req() request: AuthRequest, @Query() query: MaterialListDto) { return this.materials.list(request.user!.id, query); }

  @Get(':id')
  get(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.materials.get(request.user!.id, id); }

  @Post()
  @UseGuards(AdminGuard)
  create(@Req() request: AuthRequest, @Body() body: CreateMaterialDto) { return this.materials.create(request.user!.id, body); }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: UpdateMaterialDto) {
    return this.materials.update(request.user!.id, id, body);
  }
}
