import { applyDecorators, Controller, Get, Header, Inject, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { TreeCodeParamDto } from '../trees/trees.dto';
import { FarmPageDto } from '../farms/farms.dto';
import { TraceabilityService } from './traceability.service';
import { traceSchema, versionPageSchema, harvestPageSchema } from './traceability.schema';
const publicHeaders = () => applyDecorators(Header('Cache-Control', 'no-store'), Header('X-Content-Type-Options', 'nosniff'));

// Route public riêng. Không gỡ AuthGuard ở các API quản lý Tree/Cultivation.
@ApiTags('public-traceability')
@Controller('traceability/trees/:treeCode')
export class TraceabilityController {
  constructor(@Inject(TraceabilityService) private readonly trace: TraceabilityService) {}
  @Get() @publicHeaders() @ApiOperation({ summary: 'Public whitelisted Tree/Zone/Cooperative/standard metadata' })
  @ApiOkResponse({ schema: traceSchema })
  get(@Param() param: TreeCodeParamDto) { return this.trace.get(param.treeCode); }

  @Get('cultivation') @publicHeaders() @ApiOperation({ summary: 'All Locked versions of relevant lineages, with target applicability labels' })
  @ApiOkResponse({ schema: versionPageSchema })
  cultivation(@Param() param: TreeCodeParamDto, @Query() query: FarmPageDto) { return this.trace.cultivationHistory(param.treeCode, query); }

  @Get('harvests') @publicHeaders() @ApiOperation({ summary: 'Confirmed harvest contents, including prior approved data during correction review' })
  @ApiOkResponse({ schema: harvestPageSchema })
  harvests(@Param() param: TreeCodeParamDto, @Query() query: FarmPageDto) { return this.trace.harvestHistory(param.treeCode, query); }

  @Get('qr.svg') @publicHeaders() @ApiOperation({ summary: 'Download SVG QR encoding configured public web trace URL' })
  @ApiProduces('image/svg+xml') @ApiOkResponse({ schema: { type: 'string' } })
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  qr(@Param() param: TreeCodeParamDto) { return this.trace.qrSvg(param.treeCode); }
}
