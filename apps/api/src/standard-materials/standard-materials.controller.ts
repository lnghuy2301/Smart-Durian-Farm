import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { MaterialListDto } from '../materials/materials.dto';
import { AdminGuard } from '../users/admin.guard';
import { AddStandardMaterialDto } from './standard-materials.dto';
import { StandardMaterialRecords } from '../catalog/catalog-records';

@ApiTags('standard-materials-local-test')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('standards/:standard_id/materials')
export class StandardMaterialsController {
  constructor(@Inject(StandardMaterialRecords) private readonly links: StandardMaterialRecords) {}

  @Get()
  list(@Req() request: AuthRequest, @Param('standard_id', new ParseUUIDPipe({ version: '4' })) standardId: string, @Query() query: MaterialListDto) {
    return this.links.list(request.user!.id, standardId, query);
  }

  @Post()
  @UseGuards(AdminGuard)
  add(@Req() request: AuthRequest, @Param('standard_id', new ParseUUIDPipe({ version: '4' })) standardId: string, @Body() body: AddStandardMaterialDto) {
    return this.links.add(request.user!.id, standardId, body.material_id);
  }

  @Delete(':material_id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  remove(
    @Req() request: AuthRequest,
    @Param('standard_id', new ParseUUIDPipe({ version: '4' })) standardId: string,
    @Param('material_id', new ParseUUIDPipe({ version: '4' })) materialId: string,
  ) {
    return this.links.remove(request.user!.id, standardId, materialId);
  }
}
