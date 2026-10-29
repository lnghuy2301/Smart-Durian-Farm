import { Body, Controller, Get, Header, Inject, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { AdminGuard } from './admin.guard';
import { ApproveManagerDto, RejectManagerDto, FarmerSearchQueryDto } from './users.dto';
import { UserAccounts } from '../auth/user-accounts';
import { WindowRateLimiter } from '../auth/rate-limiter';
import { UsersService } from './users.service';

@ApiTags('users-admin-local-test')
@ApiBearerAuth()
@UseGuards(AuthGuard, AdminGuard)
@Controller('users')
export class UsersController {
  private readonly searchLimiter = new WindowRateLimiter();
  constructor(@Inject(UsersService) private readonly users: UsersService, @Inject(UserAccounts) private readonly accounts: UserAccounts) {}

  @Get('farmers') @Header('Cache-Control', 'no-store')
  farmers(@Req() request: AuthRequest, @Query() query: FarmerSearchQueryDto) {
    // AdminGuard protects this contact lookup; never expose a global directory
    // to ordinary Farmers through the existing assignment search API.
    this.searchLimiter.take('admin-farmer-search', 30, request.user!.id);
    return this.accounts.searchActiveFarmers(query.q);
  }

  @Get('pending-managers')
  pending(@Req() request: AuthRequest) { return this.users.pendingManagers(request.user!.id); }

  @Get('cooperatives')
  cooperatives(@Req() request: AuthRequest) { return this.users.listCooperatives(request.user!.id); }

  @Patch(':id/approve')
  approve(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: ApproveManagerDto) {
    return this.users.approve(request.user!.id, id, body);
  }

  @Patch(':id/reject')
  reject(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: RejectManagerDto) {
    // DTO rỗng vẫn cần được kiểm tra để từ chối các field không thuộc thao tác duyệt.
    void body;
    return this.users.reject(request.user!.id, id);
  }
}
