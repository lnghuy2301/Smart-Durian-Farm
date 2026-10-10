import { PublicUser, UserRecord } from '../auth/user-accounts';
import { TestCooperative } from './mock-cooperative.store';
import { ApproveManagerDto } from './users.dto';

export interface RegisteredAccountInput {
  user_name: string;
  phone_number: string;
  gmail: string | null;
  passwordHash: string;
  role: 'Farmer' | 'Manager';
}

// Ghi duyệt nằm trong adapter để status User và liên kết HTX cùng commit.
// verifiedEmail chỉ do EmailVerificationService cung cấp sau khi giữ lease.
export abstract class UserManagement {
  abstract assertAvailable(phone: string, email?: string | null): Promise<void>;
  abstract createRegisteredUser(input: RegisteredAccountInput, verifiedEmail?: string | null): Promise<UserRecord>;
  abstract pendingManagers(adminId: string): Promise<PublicUser[]>;
  abstract listCooperatives(adminId: string): Promise<TestCooperative[]>;
  abstract approve(adminId: string, userId: string, input: ApproveManagerDto): Promise<{ user: PublicUser; cooperative: TestCooperative }>;
  abstract reject(adminId: string, userId: string): Promise<PublicUser>;
}
