import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Injectable, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { UserAccounts, publicUser } from '../auth/user-accounts';
import { WindowRateLimiter } from '../auth/rate-limiter';
import { EmailSender } from './email/email.sender';

class NameDto {
  @ApiProperty({ maxLength: 40 }) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(40) user_name!: string;
}
class AccountEmailDto {
  @ApiProperty({ maxLength: 255 }) @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(255) gmail!: string;
}
class VerifyAccountEmailDto {
  @ApiProperty() @IsUUID('4') verification_id!: string;
  @ApiProperty() @IsString() @Matches(/^\d{6}$/) otp!: string;
}
class CurrentPasswordDto {
  @ApiProperty({ minLength: 8, maxLength: 128 }) @IsString() @MinLength(8) @MaxLength(128) current_password!: string;
}
class ChangeAccountPasswordDto extends CurrentPasswordDto {
  @ApiProperty({ minLength: 8, maxLength: 128 }) @IsString() @MinLength(8) @MaxLength(128) new_password!: string;
  @ApiProperty() @IsString() @Matches(/^\d{6}$/) otp!: string;
}
interface ProfileEmailChallenge {
  id: string; email: string; oldEmail: string | null; phone: string; version: number;
  digest: Buffer; salt: string; expiresAt: number; nextSendAt: number; attempts: number;
  state: 'sending' | 'sent' | 'consumed' | 'failed';
}

@Injectable()
export class AccountService {
  private readonly challenges = new Map<string, ProfileEmailChallenge>();
  private readonly limiter = new WindowRateLimiter();
  constructor(@Inject(UserAccounts) private readonly users: UserAccounts, @Inject(EmailSender) private readonly sender: EmailSender) {}
  private async active(actor: string) {
    const account = await this.users.loadById(actor);
    if (!account || account.user.status !== 'Active') throw new BadRequestException('Tài khoản không còn hoạt động');
    return account;
  }
  async rename(actor: string, name: string) {
    const account = await this.active(actor);
    const changed = await this.users.updateProfile(actor, account.tokenVersion, { user_name: name });
    if (!changed) throw new BadRequestException('Tài khoản đã thay đổi; vui lòng đăng nhập lại');
    return publicUser(changed.user);
  }
  async requestEmail(actor: string, email: string) {
    this.limiter.take('profile-email', 5, actor);
    const now = Date.now(), account = await this.active(actor), previous = this.challenges.get(actor);
    if (previous && (previous.state === 'sending' || now < previous.nextSendAt)) throw new BadRequestException('Đợi 60 giây trước khi gửi lại email');
    if (account.user.gmail === email && account.user.gmail_verify) throw new BadRequestException('Email này đã được xác minh');
    await this.users.assertProfileEmailAvailable(actor, email);
    for (const [id, value] of this.challenges) if (id !== actor && value.expiresAt <= now && value.state !== 'sending') this.challenges.delete(id);
    if (!this.challenges.has(actor) && this.challenges.size >= 100) throw new BadRequestException('Quá nhiều phiên xác minh; vui lòng thử lại sau');
    // Recheck after uniqueness I/O so concurrent requests cannot send twice.
    if (this.challenges.get(actor) !== previous) throw new BadRequestException('Yêu cầu xác minh đã thay đổi');
    const otp = randomInt(0, 1000000).toString().padStart(6, '0'), salt = randomBytes(16).toString('hex');
    const challenge: ProfileEmailChallenge = { id: randomUUID(), email, oldEmail: account.user.gmail, phone: account.user.phone_number,
      version: account.tokenVersion, digest: this.digest(`${salt}:${otp}`), salt, expiresAt: now + 600000, nextSendAt: now + 60000, attempts: 0, state: 'sending' };
    this.challenges.set(actor, challenge);
    try { await this.sender.sendVerification(email, otp); challenge.state = 'sent'; }
    catch (error) { challenge.state = 'failed'; throw error; }
    return { verification_id: challenge.id, expires_in: Math.max(0, Math.floor((challenge.expiresAt - Date.now()) / 1000)), message: 'Đã gửi mã xác minh email; hồ sơ chưa thay đổi' };
  }
  async verifyEmail(actor: string, id: string, otp: string) {
    this.limiter.take('profile-email-verify', 20, actor);
    const account = await this.active(actor), challenge = this.challenges.get(actor);
    if (!challenge || challenge.id !== id || challenge.state !== 'sent' || challenge.expiresAt <= Date.now() || challenge.attempts >= 5 ||
      challenge.version !== account.tokenVersion || challenge.oldEmail !== account.user.gmail || challenge.phone !== account.user.phone_number) {
      throw new BadRequestException('Xác minh email không hợp lệ hoặc đã hết hạn');
    }
    challenge.attempts++;
    if (!timingSafeEqual(challenge.digest, this.digest(`${challenge.salt}:${otp}`))) throw new BadRequestException('Mã email không đúng');
    // Consume BEFORE the asynchronous DB write. A lost commit response must not
    // replay the proof. Existing email/verified flag remain until commit succeeds.
    challenge.state = 'consumed';
    const updated = await this.users.updateProfile(actor, challenge.version, { verifiedEmail: challenge.email, expectedEmail: challenge.oldEmail, expectedPhone: challenge.phone });
    if (!updated) throw new BadRequestException('Tài khoản đã thay đổi; cần xác minh lại');
    return publicUser(updated.user);
  }
  private digest(value: string) { return createHash('sha256').update(value).digest(); }
}

@ApiTags('account') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('account')
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService, @Inject(AuthService) private readonly auth: AuthService) {}
  @Get('profile') get(@Req() req: AuthRequest) { return req.user; }
  @Patch('profile') rename(@Req() req: AuthRequest, @Body() body: NameDto) { return this.account.rename(req.user!.id, body.user_name); }
  @Post('email/request') @HttpCode(202) requestEmail(@Req() req: AuthRequest, @Body() body: AccountEmailDto) { return this.account.requestEmail(req.user!.id, body.gmail); }
  @Post('email/verify') @HttpCode(200) verifyEmail(@Req() req: AuthRequest, @Body() body: VerifyAccountEmailDto) { return this.account.verifyEmail(req.user!.id, body.verification_id, body.otp); }
  @Post('password/request') @HttpCode(202) requestPassword(@Req() req: AuthRequest, @Body() body: CurrentPasswordDto) { return this.auth.requestPasswordChange(req.user!.id, body.current_password); }
  @Post('password/confirm') @HttpCode(200) changePassword(@Req() req: AuthRequest, @Body() body: ChangeAccountPasswordDto) { return this.auth.changePassword(req.user!.id, body.current_password, body.otp, body.new_password); }
}
