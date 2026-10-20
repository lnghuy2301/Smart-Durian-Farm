import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { FarmPageDto } from '../farms/farms.dto';
import { CreateCorrectionDto, CreateEventDto, EventIdDto, EventListDto, UpdateEventDto } from './cultivation-events.dto';
import { CultivationRecords } from './cultivation-records';
import { chainSchema, eventPageSchema, eventSchema } from './cultivation-events.schema';

@ApiTags('cultivation-events') @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller('cultivation-events')
export class CultivationEventsController {
  constructor(@Inject(CultivationRecords) private readonly events: CultivationRecords) {}

  @Get() @ApiOperation({ summary: 'Visible journals, filtered before pagination' })
  @ApiOkResponse({ schema: eventPageSchema })
  list(@Req() req: AuthRequest, @Query() query: EventListDto) { return this.events.list(req.user!.id, query); }

  @Get('mine') @ApiOperation({ summary: 'Own journals, including after assignment ends' })
  @ApiOkResponse({ schema: eventPageSchema })
  mine(@Req() req: AuthRequest, @Query() query: EventListDto) { return this.events.list(req.user!.id, query, true); }

  @Get('zones/:zoneId/chain/verify') @ApiOperation({ summary: 'Verify full Locked Zone chain with current Zone access' })
  @ApiOkResponse({ schema: chainSchema })
  verify(@Req() req: AuthRequest, @Param('zoneId', new ParseUUIDPipe({ version: '4' })) zoneId: string) { return this.events.verify(req.user!.id, zoneId); }

  @Get(':id') @ApiOperation({ summary: 'Read journal by ObjectId' })
  @ApiOkResponse({ schema: eventSchema })
  get(@Req() req: AuthRequest, @Param() param: EventIdDto) { return this.events.get(req.user!.id, param.id); }

  @Get(':id/corrections') @ApiOperation({ summary: 'Original and successive corrections in chronological order' })
  @ApiOkResponse({ schema: eventPageSchema })
  corrections(@Req() req: AuthRequest, @Param() param: EventIdDto, @Query() query: FarmPageDto) { return this.events.corrections(req.user!.id, param.id, query); }

  @Post() @ApiOperation({ summary: 'Create Pending journal, lock_at is created_at + 15 minutes' })
  @ApiCreatedResponse({ schema: eventSchema })
  create(@Req() req: AuthRequest, @Body() body: CreateEventDto) { return this.events.create(req.user!.id, body); }

  @Patch(':id') @ApiOperation({ summary: 'Author edits Pending before lock_at; same Zone only' })
  @ApiOkResponse({ schema: eventSchema })
  update(@Req() req: AuthRequest, @Param() param: EventIdDto, @Body() body: UpdateEventDto) { return this.events.update(req.user!.id, param.id, body); }

  @Delete(':id') @HttpCode(204) @ApiNoContentResponse() @ApiOperation({ summary: 'Author deletes Pending before lock_at' })
  remove(@Req() req: AuthRequest, @Param() param: EventIdDto) { return this.events.remove(req.user!.id, param.id); }

  @Post(':id/corrections') @ApiOperation({ summary: 'Append Pending correction referencing latest Locked; original assignment policy' })
  @ApiCreatedResponse({ schema: eventSchema })
  correct(@Req() req: AuthRequest, @Param() param: EventIdDto, @Body() body: CreateCorrectionDto) { return this.events.correct(req.user!.id, param.id, body); }
}
