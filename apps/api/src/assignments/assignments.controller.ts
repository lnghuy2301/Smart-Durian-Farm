import { Body, Controller, Get, Header, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { EmptyFarmActionDto, FarmRequestListDto, RejectFarmRequestDto } from '../farms/farms.dto';
import { AssignmentListDto, CreateAssignmentRequestDto, AssignmentCandidateQueryDto } from './assignments.dto';
import { WindowRateLimiter } from '../auth/rate-limiter';
import { AssignmentRecords } from './assignment-records';

@ApiTags('zone-assignments-local-test') @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller('zone-assignments')
export class AssignmentsController {
  constructor(@Inject(AssignmentRecords) private readonly assignments: AssignmentRecords) {}

  @Get()
  list(@Req() request: AuthRequest, @Query() query: AssignmentListDto) { return this.assignments.list(request.user!.id, query); }

  @Get('mine')
  mine(@Req() request: AuthRequest, @Query() query: AssignmentListDto) { return this.assignments.list(request.user!.id, query, true); }

  @Get(':id')
  get(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.assignments.get(request.user!.id, id); }

  @Patch(':id/end')
  end(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: EmptyFarmActionDto) {
    void body; return this.assignments.end(request.user!.id, id);
  }

  @Post(':id/end-requests')
  endRequest(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: EmptyFarmActionDto) {
    void body; return this.assignments.endRequest(request.user!.id, id);
  }
}

@ApiTags('assignment-requests-local-test') @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller()
export class AssignmentRequestsController {
  private readonly candidateLimiter = new WindowRateLimiter();
  constructor(@Inject(AssignmentRecords) private readonly assignments: AssignmentRecords) {}

  @Get('zones/:id/assignment-candidates')
  @Header('Cache-Control', 'no-store')
  candidates(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Query() query: AssignmentCandidateQueryDto) {
    this.candidateLimiter.take('assignment-candidates', 20, request.user!.id);
    return this.assignments.candidates(request.user!.id, id, query.q);
  }

  @Post('zones/:id/assignment-requests')
  create(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: CreateAssignmentRequestDto) {
    return this.assignments.createRequest(request.user!.id, id, body);
  }

  @Get('assignment-requests')
  list(@Req() request: AuthRequest, @Query() query: FarmRequestListDto) { return this.assignments.listRequests(request.user!.id, query); }

  @Get('assignment-requests/:id')
  get(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.assignments.getRequest(request.user!.id, id); }

  @Patch('assignment-requests/:id/approve')
  approve(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: EmptyFarmActionDto) {
    void body; return this.assignments.approve(request.user!.id, id);
  }

  @Patch('assignment-requests/:id/reject')
  reject(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: RejectFarmRequestDto) {
    return this.assignments.reject(request.user!.id, id, body.reason);
  }
}
