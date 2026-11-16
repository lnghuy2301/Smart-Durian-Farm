import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MockUserStore, TestUser } from '../auth/mock-user.store';
import { publicUser } from '../auth/user-accounts';
import { normalizeEmail } from '../auth/account-identity';
import { isPasswordHash } from '../auth/password';
import { MockCooperativeStore } from './mock-cooperative.store';
import { ApproveManagerDto } from './users.dto';
import { RegisteredAccountInput, UserManagement } from './user-management';

// Chỉ bọc hai store đang có, không tạo dữ liệu hoặc store mới.
export class MemoryUserManagement extends UserManagement {
  constructor(private readonly users: MockUserStore, private readonly cooperatives: MockCooperativeStore) { super(); }
  async assertAvailable(phone: string, email: string | null = null): Promise<void> { this.users.assertAvailable(phone, email); }
  async createRegisteredUser(input: RegisteredAccountInput, verifiedEmail: string | null = null): Promise<TestUser> {
    const gmail = input.gmail ? normalizeEmail(input.gmail) : null;
    if (!['Farmer', 'Manager'].includes(input.role) || !isPasswordHash(input.passwordHash) ||
        (input.role === 'Manager' && verifiedEmail === null) ||
        (verifiedEmail !== null && (!gmail || normalizeEmail(verifiedEmail) !== gmail))) {
      throw new BadRequestException('Dữ liệu hoặc bằng chứng tạo tài khoản không hợp lệ');
    }
    return { ...this.users.add({ user_name: input.user_name, phone_number: input.phone_number, gmail,
      password: input.passwordHash, role: input.role, status: input.role === 'Manager' ? 'Pending' : 'Active',
      gmail_verify: verifiedEmail !== null, is_owner: false }) };
  }
  async pendingManagers(adminId: string) { this.admin(adminId); return this.users.pendingManagers().map(publicUser); }
  async listCooperatives(adminId: string) { this.admin(adminId); return this.cooperatives.list(); }
  async approve(adminId: string, userId: string, input: ApproveManagerDto) {
    this.admin(adminId);
    const user = this.pending(userId);
    if (!user.gmail || !user.gmail_verify) { throw new ConflictException('Manager chưa xác minh email'); }
    if (Boolean(input.cooperative_id) === Boolean(input.cooperative)) {
      throw new BadRequestException('Chọn đúng một cách: cooperative_id hoặc cooperative');
    }
    // Không await giữa các bước ghi RAM: giữ nguyên atomicity một process.
    const cooperative = input.cooperative_id ? this.cooperatives.assign(input.cooperative_id, user.id) : this.cooperatives.create(input.cooperative!, user.id);
    user.status = 'Active'; this.users.revokeTokens(user.id);
    return { user: publicUser(user), cooperative };
  }
  async reject(adminId: string, userId: string) {
    this.admin(adminId); const user = this.pending(userId);
    user.status = 'Reject'; this.users.revokeTokens(user.id); return publicUser(user);
  }
  private pending(id: string): TestUser {
    const user = this.users.findById(id);
    if (!user) { throw new NotFoundException('Không tìm thấy tài khoản'); }
    if (user.role !== 'Manager' || user.status !== 'Pending') { throw new ConflictException('Chỉ xử lý Manager đang Pending'); }
    return user;
  }
  private admin(id: string): void {
    const user = this.users.findById(id);
    if (user?.role !== 'Admin' || user.status !== 'Active') { throw new ForbiddenException('Chỉ Admin được duyệt tài khoản'); }
  }
}
