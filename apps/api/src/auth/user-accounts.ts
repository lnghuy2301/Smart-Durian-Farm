export type UserRole = 'Farmer' | 'Manager' | 'Admin';
export type UserStatus = 'Active' | 'Locked' | 'Pending' | 'Reject';

export interface UserRecord {
  id: string;
  user_name: string;
  phone_number: string;
  gmail: string | null;
  gmail_verify: boolean;
  password: string;
  role: UserRole;
  status: UserStatus;
  is_owner: boolean;
  created_at: string;
}

export interface AccountSnapshot { user: UserRecord; tokenVersion: number }
export type PublicUser = Omit<UserRecord, 'password'>;

export function publicUser(user: UserRecord): PublicUser {
  // Không spread record: hash và metadata mới thêm không được lọt ra API.
  const { id, user_name, phone_number, gmail, gmail_verify, role, status, is_owner, created_at } = user;
  return { id, user_name, phone_number, gmail, gmail_verify, role, status, is_owner, created_at };
}

// Snapshot chứa user/version từ cùng lần đọc. Auth không giữ live object hoặc
// tự sửa password rồi ghi version riêng, vì DB có thể đổi trong lúc await hash.
export abstract class UserAccounts {
  abstract loadById(id: string): Promise<AccountSnapshot | null>;
  abstract loadByPhone(phone: string): Promise<AccountSnapshot | null>;
  abstract dummyPasswordHash(): Promise<string>;
  abstract replacePassword(id: string, expectedTokenVersion: number, passwordHash: string): Promise<boolean>;
  abstract assertProfileEmailAvailable(id: string, email: string): Promise<void>;
  abstract updateProfile(id: string, expectedTokenVersion: number, input: { user_name?: string; verifiedEmail?: string; expectedEmail?: string | null; expectedPhone?: string }): Promise<AccountSnapshot | null>;
}
