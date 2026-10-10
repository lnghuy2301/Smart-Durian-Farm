import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeEmail } from '../../auth/account-identity';
import { TestUser } from '../../auth/mock-user.store';
import { UserManagement } from '../user-management';
import { WindowRateLimiter } from '../../auth/rate-limiter';
import { EmailSender } from './email.sender';
import { VerifyRegistrationEmailDto } from '../users.dto';

const TTL_MS = 10 * 60 * 1000;
interface EmailChallenge {
  id: string;
  phone: string;
  email: string;
  salt: string;
  digest: Buffer;
  expiresAt: number;
  nextSendAt: number;
  attempts: number;
  state: 'sending' | 'sent' | 'verified' | 'committing' | 'consumed' | 'failed';
  tokenDigest?: Buffer;
}

@Injectable()
export class EmailVerificationService {
  private readonly challenges = new Map<string, EmailChallenge>();
  private readonly limiter = new WindowRateLimiter();

  constructor(
    @Inject(EmailSender) private readonly sender: EmailSender,
    @Inject(UserManagement) private readonly store: UserManagement,
  ) {}

  async request(phone: string, gmail: string) {
    this.limiter.take('email-send', 5);
    const email = normalizeEmail(gmail);
    await this.store.assertAvailable(phone, email);
    const now = Date.now();
    for (const [key, challenge] of this.challenges) {
      if (challenge.expiresAt <= now && !['sending', 'committing'].includes(challenge.state)) { this.challenges.delete(key); }
    }
    const previous = this.challenges.get(email);
    if (previous && (['sending', 'committing'].includes(previous.state) || now < previous.nextSendAt)) {
      throw new HttpException('Đợi 60 giây trước khi gửi lại email', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!previous && this.challenges.size >= 100) { throw new HttpException('Quá nhiều yêu cầu xác minh; thử lại sau', HttpStatus.TOO_MANY_REQUESTS); }
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    const challenge: EmailChallenge = {
      id: randomUUID(), phone, email, salt,
      digest: this.digest(`${salt}:${code}`),
      expiresAt: now + TTL_MS,
      nextSendAt: now + 60000,
      attempts: 0,
      state: 'sending',
    };
    // Đặt trạng thái trước await để request đồng thời không gửi hai email hoặc dùng mã chưa gửi.
    this.challenges.set(email, challenge);
    try {
      await this.sender.sendVerification(email, code);
      challenge.state = 'sent';
    } catch (error) {
      challenge.state = 'failed';
      throw error;
    }
    return {
      message: 'Yêu cầu gửi email xác minh đã được chấp nhận',
      verification_id: challenge.id,
      expires_in: Math.max(0, Math.floor((challenge.expiresAt - Date.now()) / 1000)),
    };
  }

  verify(input: VerifyRegistrationEmailDto) {
    this.limiter.take('email-verify', 20);
    const challenge = this.challenges.get(normalizeEmail(input.gmail));
    if (!challenge || challenge.id !== input.verification_id || challenge.phone !== input.phone_number ||
      challenge.state !== 'sent' || challenge.expiresAt <= Date.now() || challenge.attempts >= 5) {
      throw this.invalid();
    }
    challenge.attempts++;
    if (!timingSafeEqual(challenge.digest, this.digest(`${challenge.salt}:${input.otp}`))) { throw this.invalid(); }
    const token = randomUUID();
    challenge.state = 'verified';
    challenge.tokenDigest = this.digest(token);
    return {
      message: 'Email đã được xác minh; tiếp tục đăng ký tài khoản',
      email_verification_token: token,
      expires_in: Math.max(0, Math.floor((challenge.expiresAt - Date.now()) / 1000)),
    };
  }

  requireProof(phone: string, gmail: string, token: string): EmailChallenge {
    const challenge = this.challenges.get(normalizeEmail(gmail));
    if (!challenge || challenge.phone !== phone || challenge.state !== 'verified' || challenge.expiresAt <= Date.now() ||
      !challenge.tokenDigest || !timingSafeEqual(challenge.tokenDigest, this.digest(token))) {
      throw this.invalid();
    }
    return challenge;
  }

  consume(phone: string, gmail: string, token: string): void {
    this.requireProof(phone, gmail, token).state = 'consumed';
  }

  consumeForRegistration(phone: string, gmail: string, token: string, createAccount: () => TestUser): TestUser {
    const challenge = this.requireProof(phone, gmail, token);
    // Chốt proof còn hạn trước khi ghi. Cả khối phải đồng bộ, không await hoặc kiểm tra hạn lần nữa
    // sau khi đã tạo user: tránh trả 400 nhưng tài khoản vẫn tồn tại khi clock vượt deadline.
    // Nếu createAccount bị từ chối (trùng email/phone hoặc đầy store), proof vẫn chưa bị dùng.
    const user = createAccount();
    challenge.state = 'consumed';
    return user;
  }

  async consumeForRegistrationAsync<T>(phone: string, gmail: string, token: string, createAccount: () => Promise<T>): Promise<T> {
    const challenge = this.requireProof(phone, gmail, token);
    // Proof phải còn hạn tại reservation sau hash. Một lần commit đã bắt đầu
    // không bị báo lỗi chỉ vì deadline đi qua trong lúc DB chờ/ghi.
    challenge.state = 'committing';
    try {
      const result = await createAccount();
      challenge.state = 'consumed';
      return result;
    } catch (error) {
      // Chỉ lỗi validation/unique/capacity đã xác định không ghi account mới
      // mới cho thử lại proof còn hạn. 503/connection/commit không rõ kết quả
      // phải xác minh lại, tránh replay một proof có thể đã tạo tài khoản.
      const knownRejection = error instanceof HttpException && [400, 409, 429].includes(error.getStatus());
      challenge.state = knownRejection ? 'verified' : 'consumed';
      throw error;
    }
  }

  private digest(value: string): Buffer {
    return createHash('sha256').update(value).digest();
  }

  private invalid(): BadRequestException {
    return new BadRequestException('Xác minh email không hợp lệ, đã dùng hoặc hết hạn');
  }
}
