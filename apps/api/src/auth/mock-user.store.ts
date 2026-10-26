import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MockAuthConfig } from '../config/environment';
import { hashPassword } from './password';
import { AccountSnapshot, publicUser, UserAccounts, UserRecord } from './user-accounts';
import { normalizeEmail, phoneIdentity } from './account-identity';

export type { UserRole, UserStatus } from './user-accounts';
export type TestUser = UserRecord;

export { normalizeEmail } from './account-identity';

export class MockUserStore extends UserAccounts {
  readonly user: TestUser;
  private readonly users = new Map<string, TestUser>();
  private readonly versions = new Map<string, number>();

  private constructor(config: MockAuthConfig, passwordHash: string) {
    super();
    this.user = this.add({
      user_name: 'Local test Farmer', phone_number: config.phoneNumber, gmail: null, gmail_verify: false,
      password: passwordHash, role: 'Farmer', status: 'Active', is_owner: false,
    });
  }

  static async create(config: MockAuthConfig): Promise<MockUserStore> {
    const store = new MockUserStore(config, await hashPassword(config.password));
    if (config.admin) {
      store.add({ user_name: 'Local test Admin', phone_number: config.admin.phoneNumber, password: await hashPassword(config.admin.password),
        gmail: null, gmail_verify: false, role: 'Admin', status: 'Active', is_owner: false });
    }
    return store;
  }

  // Giữ fixture cũ cho bộ test Auth; metadata version không phải field mới của ERD.
  get version(): number { return this.versionOf(this.user.id); }
  set version(value: number) { this.versions.set(this.user.id, value); }
  versionOf(id: string): number { return this.versions.get(id) ?? 0; }
  revokeTokens(id: string): void { this.versions.set(id, this.versionOf(id) + 1); }
  findById(id: string): TestUser | undefined { return this.users.get(id); }
  findByPhone(phone: string): TestUser | undefined { return [...this.users.values()].find((user) => phoneIdentity(user.phone_number) === phoneIdentity(phone)); }
  findByEmail(email: string): TestUser | undefined { return [...this.users.values()].find((user) => user.gmail === normalizeEmail(email)); }
  pendingManagers(): TestUser[] { return [...this.users.values()].filter((user) => user.role === 'Manager' && user.status === 'Pending'); }
  activeFarmerNames() {
    return [...this.users.values()].filter((user) => user.role === 'Farmer' && user.status === 'Active')
      .map(({ id, user_name, phone_number }) => ({ id, user_name, phone_number }));
  }

  assertAvailable(phone: string, email?: string | null): void {
    if ([...this.users.values()].some((user) => phoneIdentity(user.phone_number) === phoneIdentity(phone))) {
      throw new ConflictException('Số điện thoại đã có tài khoản');
    }
    if (email && this.findByEmail(email)) { throw new ConflictException('Email đã có tài khoản'); }
    if (this.users.size >= 100) { throw new HttpException('Bộ nhớ test đã đầy; restart API để bắt đầu lại', HttpStatus.TOO_MANY_REQUESTS); }
  }

  add(input: Omit<TestUser, 'id' | 'created_at'>): TestUser {
    // Kiểm tra và ghi đồng bộ sau await hash, để hai request không cùng vượt qua UNIQUE.
    this.assertAvailable(input.phone_number, input.gmail);
    const user: TestUser = { ...input, gmail: input.gmail ? normalizeEmail(input.gmail) : null, id: randomUUID(), created_at: new Date().toISOString() };
    this.users.set(user.id, user);
    this.versions.set(user.id, 0);
    return user;
  }

  publicUser(user: TestUser = this.user): Omit<TestUser, 'password'> {
    return publicUser(user);
  }

  async loadById(id: string): Promise<AccountSnapshot | null> { return this.snapshot(this.findById(id)); }
  async loadByPhone(phone: string): Promise<AccountSnapshot | null> { return this.snapshot(this.findByPhone(phone)); }
  async dummyPasswordHash(): Promise<string> { return this.user.password; }
  async assertProfileEmailAvailable(id: string, email: string): Promise<void> {
    const existing = this.findByEmail(email);
    if (existing && existing.id !== id) throw new ConflictException('Email đã có tài khoản');
  }
  async updateProfile(id: string, expectedTokenVersion: number, input: { user_name?: string; verifiedEmail?: string; expectedEmail?: string | null; expectedPhone?: string }): Promise<AccountSnapshot | null> {
    const user = this.findById(id);
    if (!user || user.status !== 'Active' || this.versionOf(id) !== expectedTokenVersion) return null;
    if (input.verifiedEmail !== undefined && (input.expectedEmail !== user.gmail || input.expectedPhone !== user.phone_number)) return null;
    // No await between uniqueness check and write in the memory authority.
    if (input.verifiedEmail !== undefined) {
      const other = this.findByEmail(input.verifiedEmail);
      if (other && other.id !== id) throw new ConflictException('Email đã có tài khoản');
      user.gmail = normalizeEmail(input.verifiedEmail); user.gmail_verify = true;
    }
    if (input.user_name !== undefined) user.user_name = input.user_name;
    return this.snapshot(user);
  }
  async replacePassword(id: string, expectedTokenVersion: number, passwordHash: string): Promise<boolean> {
    const user = this.findById(id);
    // Adapter memory cũng thực hiện compare-and-write trong một khối đồng bộ.
    if (!user || user.status !== 'Active' || this.versionOf(id) !== expectedTokenVersion) { return false; }
    user.password = passwordHash;
    this.revokeTokens(id);
    return true;
  }

  private snapshot(user: TestUser | undefined): AccountSnapshot | null {
    return user ? { user: { ...user }, tokenVersion: this.versionOf(user.id) } : null;
  }
}
