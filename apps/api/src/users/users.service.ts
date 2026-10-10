import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { normalizeEmail } from '../auth/account-identity';
import { publicUser } from '../auth/user-accounts';
import { hashPassword } from '../auth/password';
import { WindowRateLimiter } from '../auth/rate-limiter';
import { EmailVerificationService } from './email/email-verification.service';
import { UserManagement } from './user-management';
import { ApproveManagerDto, RegisterUserDto } from './users.dto';

@Injectable()
export class UsersService {
  private readonly limiter = new WindowRateLimiter();
  constructor(
    @Inject(UserManagement) private readonly store: UserManagement,
    @Inject(EmailVerificationService) private readonly emailVerification: EmailVerificationService,
  ) {}

  async register(input: RegisterUserDto) {
    this.limiter.take('register', 5);
    if (!['Farmer', 'Manager'].includes(input.role)) {
      throw new BadRequestException('Chỉ đăng ký công khai Farmer hoặc Manager');
    }
    const gmail = input.gmail ? normalizeEmail(input.gmail) : null;
    const token = input.email_verification_token;
    if (input.role === 'Manager' && (!gmail || !token)) {
      throw new BadRequestException('Manager cần email đã xác minh trước khi đăng ký');
    }
    if (token && !gmail) {
      throw new BadRequestException('Bằng chứng xác minh phải đi kèm email');
    }
    await this.store.assertAvailable(input.phone_number, gmail);
    if (token && gmail) { this.emailVerification.requireProof(input.phone_number, gmail, token); }
    const passwordHash = await hashPassword(input.password);
    // Lease giữ proof không thể dùng/gửi lại khi adapter đang await database.
    const createAccount = () => this.store.createRegisteredUser({
      user_name: input.user_name,
      phone_number: input.phone_number,
      passwordHash,
      gmail,
      role: input.role,
    }, token ? gmail : null);
    const user = token && gmail
      ? await this.emailVerification.consumeForRegistrationAsync(input.phone_number, gmail, token, createAccount)
      : await createAccount();
    return {
      message: user.status === 'Pending' ? 'Tài khoản đang chờ Admin duyệt' : 'Đăng ký thành công',
      user: publicUser(user),
    };
  }

  async pendingManagers(adminId: string) {
    return { users: await this.store.pendingManagers(adminId) };
  }

  async listCooperatives(adminId: string) {
    return { cooperatives: await this.store.listCooperatives(adminId) };
  }

  async approve(adminId: string, userId: string, input: ApproveManagerDto) {
    const { user, cooperative } = await this.store.approve(adminId, userId, input);
    return {
      message: 'Đã duyệt Manager và gắn HTX',
      user,
      cooperative: { ...cooperative },
    };
  }

  async reject(adminId: string, userId: string) {
    return { message: 'Đã từ chối tài khoản Manager', user: await this.store.reject(adminId, userId) };
  }
}
