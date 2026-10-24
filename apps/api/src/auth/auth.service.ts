import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { publicUser, UserAccounts } from './user-accounts';
import { hashPassword, verifyPassword } from './password';
import { OtpProof, OtpProvider } from './sms/otp.provider';
import { WindowRateLimiter } from './rate-limiter';
import { phoneIdentity } from './account-identity';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const TOKEN_TTL_SECONDS = 15 * 60;

interface OtpChallenge { proof: OtpProof; expiresAt: number; attempts: number; consumed: boolean; tokenVersion: number; purpose: 'reset' | 'change' }
interface OtpState { challenge?: OtpChallenge; nextSendAt: number; busy: boolean }

@Injectable()
export class AuthService {
  private readonly otpStates = new Map<string, OtpState>();
  private readonly rateLimits = new WindowRateLimiter();

  constructor(@Inject(UserAccounts) private readonly store: UserAccounts,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(OtpProvider) private readonly otpProvider: OtpProvider) {}

  async login(phoneNumber: string, password: string) {
    this.rateLimits.take('login', 20);
    const account = await this.store.loadByPhone(phoneNumber);
    const user = account?.user;
    const version = account?.tokenVersion;
    // Luôn verify một hash hợp lệ, kể cả số điện thoại sai, để giảm chênh lệch thời gian phản hồi.
    const matches = await verifyPassword(password, user?.password ?? await this.store.dummyPasswordHash());
    // Snapshot không tự thay đổi như object RAM. Đọc lại sau scrypt để không ký
    // JWT từ mật khẩu/version/status cũ khi reset hoặc duyệt diễn ra đồng thời.
    const current = user ? await this.store.loadById(user.id) : null;
    if (!matches || !user || !current || version !== current.tokenVersion || current.user.status === 'Locked') {
      throw new UnauthorizedException('Số điện thoại hoặc mật khẩu không đúng');
    }
    if (current.user.status !== 'Active') { throw new ForbiddenException('Tài khoản chưa được duyệt hoặc đã bị từ chối'); }
    return {
      access_token: await this.jwt.signAsync({ sub: user.id, version }, { expiresIn: TOKEN_TTL_SECONDS }),
      token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS, user: publicUser(current.user),
    };
  }

  async forgotPassword(phoneNumber: string) {
    return this.requestPasswordOtp(phoneNumber, 'reset');
  }

  private async requestPasswordOtp(phoneNumber: string, purpose: 'reset' | 'change') {
    this.rateLimits.take('forgot', 5);
    const now = Date.now();
    const account = await this.store.loadByPhone(phoneNumber);
    const user = account?.user;
    const state = user?.status === 'Active' ? this.stateFor(user.id) : undefined;
    // Unlike anonymous recovery, this actor is already authenticated. Report
    // cooldown honestly instead of claiming a new change-password SMS was sent
    // while an earlier reset-purpose challenge is still occupying the slot.
    if (purpose === 'change' && state && (state.busy || now < state.nextSendAt)) {
      throw new HttpException('Đợi 60 giây trước khi yêu cầu OTP đổi mật khẩu mới', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (state && !state.busy && now >= state.nextSendAt) {
      // Giữ cooldown trước await để request đồng thời không gửi hai SMS bị tính phí.
      state.nextSendAt = now + RESEND_DELAY_MS;
      state.challenge = undefined;
      this.otpProvider.clear(user!.phone_number);
      state.busy = true;
      try {
        const proof = await this.otpProvider.issue(user!.phone_number, now + OTP_TTL_MS);
        // Chỉ kích hoạt OTP sau khi provider nhận yêu cầu; không khẳng định điện thoại đã nhận SMS.
        state.challenge = { proof, expiresAt: now + OTP_TTL_MS, attempts: 0, consumed: false, tokenVersion: account!.tokenVersion, purpose };
      } finally { state.busy = false; }
    }
    // Cùng response cho tài khoản có/không tồn tại; không trả OTP hoặc SID ra client.
    return { message: 'Nếu tài khoản hợp lệ, mã OTP đã được gửi', expires_in: OTP_TTL_MS / 1000 };
  }

  async resetPassword(phoneNumber: string, otp: string, newPassword: string, purpose: 'reset' | 'change' = 'reset') {
    const account = await this.store.loadByPhone(phoneNumber);
    const user = account?.user;
    const state = user ? this.otpStates.get(user.id) : undefined;
    const challenge = state?.challenge;
    if (!user || !state || state.busy || !challenge || challenge.consumed || Date.now() >= challenge.expiresAt || challenge.attempts >= MAX_OTP_ATTEMPTS ||
        user.status !== 'Active' || challenge.tokenVersion !== account?.tokenVersion || challenge.purpose !== purpose) {
      throw new BadRequestException('OTP không hợp lệ hoặc đã hết hạn');
    }
    challenge.attempts++;
    // Khóa cả gửi lại và reset trong lúc chờ Verify/hash; không để hai request cùng đổi mật khẩu.
    state.busy = true;
    try {
      let matches: boolean;
      try { matches = await this.otpProvider.verify(challenge.proof, otp); }
      catch (error) {
        // Timeout có thể xảy ra sau khi Twilio đã dùng mã. Hủy challenge để không tái sử dụng mơ hồ.
        challenge.consumed = true;
        this.otpProvider.clear(user.phone_number);
        throw error;
      }
      if (!matches || Date.now() >= challenge.expiresAt || user.status !== 'Active') {
        throw new BadRequestException('OTP không hợp lệ hoặc đã hết hạn');
      }
      // Đánh dấu dùng trước await hash: mã đã được xác minh không thể dùng thêm lần nữa.
      challenge.consumed = true;
      this.otpProvider.clear(user.phone_number);
      const passwordHash = await hashPassword(newPassword);
      if (!await this.store.replacePassword(user.id, account!.tokenVersion, passwordHash)) {
        throw new BadRequestException('Tài khoản hoặc phiên xác minh đã thay đổi; vui lòng xác minh lại');
      }
      return { message: 'Đã đặt lại mật khẩu. Vui lòng đăng nhập lại' };
    } finally { state.busy = false; }
  }

  async authenticate(token: string) {
    return publicUser((await this.authenticatedAccount(token)).user);
  }

  async refresh(token: string) {
    const account = await this.authenticatedAccount(token);
    this.rateLimits.take('refresh', 60, account.user.id);
    // Only this explicit user-activity operation renews the token. Polling
    // telemetry, auth/me and other authenticated reads never extend its life.
    return { access_token: await this.jwt.signAsync({ sub: account.user.id, version: account.tokenVersion }, { expiresIn: TOKEN_TTL_SECONDS }),
      token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS, user: publicUser(account.user) };
  }

  async requestPasswordChange(actor: string, currentPassword: string) {
    const account = await this.requireCurrentPassword(actor, currentPassword);
    return this.requestPasswordOtp(account.user.phone_number, 'change');
  }

  async changePassword(actor: string, currentPassword: string, otp: string, newPassword: string) {
    const account = await this.requireCurrentPassword(actor, currentPassword);
    return this.resetPassword(account.user.phone_number, otp, newPassword, 'change');
  }

  private async requireCurrentPassword(actor: string, password: string) {
    this.rateLimits.take('password-current', 10, actor);
    const account = await this.store.loadById(actor);
    const matches = await verifyPassword(password, account?.user.password ?? await this.store.dummyPasswordHash());
    const current = await this.store.loadById(actor);
    if (!matches || !account || !current || current.user.status !== 'Active' || account.tokenVersion !== current.tokenVersion) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng hoặc tài khoản đã thay đổi');
    }
    return current;
  }

  private async authenticatedAccount(token: string) {
    let payload: { sub?: string; version?: number };
    try { payload = await this.jwt.verifyAsync(token); }
    catch { throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn'); }
    const account = typeof payload.sub === 'string' ? await this.store.loadById(payload.sub) : null;
    if (!account || payload.version !== account.tokenVersion || account.user.status !== 'Active') {
      throw new UnauthorizedException('Token không còn hợp lệ');
    }
    return account;
  }

  testSms(phoneNumber: string) {
    if (this.otpProvider.mode !== 'mock') { throw new NotFoundException(); }
    const identity = phoneIdentity(phoneNumber), variants = /^84\d{9}$/.test(identity)
      ? [identity, `+${identity}`, `0${identity.slice(2)}`] : [phoneNumber];
    return { mode: 'mock', messages: variants.flatMap((phone) => this.otpProvider.messages(phone)) };
  }

  private stateFor(userId: string): OtpState {
    let state = this.otpStates.get(userId);
    if (!state) { state = { nextSendAt: 0, busy: false }; this.otpStates.set(userId, state); }
    return state;
  }
}
