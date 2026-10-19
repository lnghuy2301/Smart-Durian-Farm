import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { TelemetryHistoryDto, TelemetryLatestDto } from './telemetry.dto';
import { TelemetryRecords } from './telemetry-records';

@ApiTags('iot-telemetries') @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller('telemetry/devices')
export class TelemetryController {
  constructor(@Inject(TelemetryRecords) private readonly telemetry: TelemetryRecords) {}

  @Get(':id/latest')
  @ApiOperation({ summary: 'Giá trị mới nhất mỗi stream còn được lưu, đúng phạm vi quyền hiện tại' })
  latest(@Req() req: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Query() query: TelemetryLatestDto) {
    return this.telemetry.latest(req.user!.id, id, query);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Lịch sử theo received_at; Farmer hết phân công không truy cập' })
  history(@Req() req: AuthRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Query() query: TelemetryHistoryDto) {
    return this.telemetry.history(req.user!.id, id, query);
  }
}
