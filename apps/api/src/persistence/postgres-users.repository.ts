import { BadRequestException, ConflictException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { normalizeEmail, phoneIdentity } from '../auth/account-identity';
import { hashPassword, isPasswordHash } from '../auth/password';
import { AccountSnapshot, publicUser, PublicUser, UserAccounts, UserRecord } from '../auth/user-accounts';
import { safeInteger, utcIso } from './mappers';
import { inPostgresTransaction } from './transactions';

export interface RegisterStoredUser {
  user_name: string;
  phone_number: string;
  gmail: string | null;
  passwordHash: string;
  role: 'Farmer' | 'Manager';
}

interface UserRow extends Omit<UserRecord, 'created_at'> {
  created_at: Date;
  entity_version: string | null;
  metadata: Record<string, unknown> | null;
}

const COLUMNS = `u.id,u.user_name,u.phone_number,u.gmail,u.gmail_verify,u.password,u.role,u.status,u.is_owner,u.created_at,
  m.version AS entity_version,m.data AS metadata`;
const READ = `SELECT ${COLUMNS} FROM public.users u LEFT JOIN technical.entity_metadata m
  ON m.entity_type='users' AND m.entity_key=u.id::text`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pool được truyền từ DatabaseService; repository không mở pool/store phụ,
// không seed, không gọi provider và không fallback RAM khi DB lỗi.
export class PostgresUsersRepository extends UserAccounts {
  private dummyHash?: Promise<string>;
  constructor(private readonly pool: Pool) { super(); }

  async loadById(id: string): Promise<AccountSnapshot | null> {
    if (!UUID.test(id)) { return null; }
    return this.run(async () => this.first((await this.pool.query<UserRow>(`${READ} WHERE u.id=$1`, [id])).rows));
  }

  async loadByPhone(phone: string): Promise<AccountSnapshot | null> {
    // Đọc login exact, chỉ uniqueness dùng identity 0/84/+84 như contract cũ.
    return this.run(async () => this.first((await this.pool.query<UserRow>(`${READ} WHERE u.phone_number=$1`, [phone])).rows));
  }

  // Dùng cùng client của transaction duyệt Manager–HTX; caller khóa users rồi
  // metadata trước. Không gọi pool.query tách khỏi transaction đang chạy.
  async loadOnClient(client: PoolClient, id: string): Promise<AccountSnapshot | null> {
    return this.first((await client.query<UserRow>(`${READ} WHERE u.id=$1`, [id])).rows);
  }

  async findByEmail(email: string): Promise<AccountSnapshot | null> {
    return this.run(async () => this.first((await this.pool.query<UserRow>(`${READ} WHERE u.gmail=$1`, [normalizeEmail(email)])).rows));
  }

  async pendingManagers(): Promise<PublicUser[]> {
    return this.run(async () => (await this.pool.query<UserRow>(`${READ} WHERE u.role='Manager' AND u.status='Pending' ORDER BY u.created_at,u.id`))
      .rows.map((row) => publicUser(this.map(row).user)));
  }

  async dummyPasswordHash(): Promise<string> {
    // Không cần user fixture hoặc tài khoản đầu tiên trong DB để login số sai.
    this.dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
    return this.dummyHash;
  }

  async assertAvailable(phone: string, email: string | null = null): Promise<void> {
    await this.run(async () => {
      const existing = await this.pool.query<{ phone_matches: boolean; email_matches: boolean }>(`SELECT
        (CASE WHEN ltrim(phone_number,'+') ~ '^0[0-9]{9}$' THEN '84' || substr(ltrim(phone_number,'+'),2) ELSE ltrim(phone_number,'+') END)=$1 AS phone_matches,
        gmail=$2 AS email_matches FROM public.users WHERE
        (CASE WHEN ltrim(phone_number,'+') ~ '^0[0-9]{9}$' THEN '84' || substr(ltrim(phone_number,'+'),2) ELSE ltrim(phone_number,'+') END)=$1 OR gmail=$2`,
      [phoneIdentity(phone), email ? normalizeEmail(email) : null]);
      if (existing.rows.some((row) => row.phone_matches)) { throw new ConflictException('Số điện thoại đã có tài khoản'); }
      if (existing.rows.some((row) => row.email_matches)) { throw new ConflictException('Email đã có tài khoản'); }
    });
  }

  // Chỉ nhận hash + email đã được service xác minh, không nhận role Admin,
  // status/is_owner/gmail_verify/ID/version từ body. Service phải giữ lease proof
  // suốt await transaction; không thể tái dùng callback commit đồng bộ của RAM.
  async createRegisteredUser(input: RegisterStoredUser, verifiedEmail: string | null = null): Promise<AccountSnapshot> {
    const gmail = input.gmail ? normalizeEmail(input.gmail) : null;
    const verified = verifiedEmail !== null;
    if (!['Farmer', 'Manager'].includes(input.role) || !isPasswordHash(input.passwordHash)) {
      throw new BadRequestException('Dữ liệu tạo tài khoản không hợp lệ');
    }
    if ((verified && (!gmail || normalizeEmail(verifiedEmail!) !== gmail)) || (input.role === 'Manager' && !verified)) {
      throw new BadRequestException('Manager cần email đã xác minh; bằng chứng phải đúng email đăng ký');
    }
    return this.run(() => inPostgresTransaction(this.pool, async (client) => {
      // UNIQUE của database quyết định cuối cùng; assertAvailable chỉ là preflight.
      const result = await client.query<{ id: string }>(`INSERT INTO public.users
        (user_name,phone_number,gmail,password,role,status,gmail_verify,is_owner)
        VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING id`,
      [input.user_name, input.phone_number, gmail, input.passwordHash, input.role, input.role === 'Manager' ? 'Pending' : 'Active', verified]);
      const id = result.rows[0].id;
      await client.query(`INSERT INTO technical.entity_metadata(entity_type,entity_key,version,data) VALUES ('users',$1,1,'{"token_version":0}')`, [id]);
      await this.audit(client, id, 'AccountRegistered', { role: input.role, status: input.role === 'Manager' ? 'Pending' : 'Active' });
      return this.first((await client.query<UserRow>(`${READ} WHERE u.id=$1`, [id])).rows)!;
    }));
  }

  async replacePassword(id: string, expectedTokenVersion: number, passwordHash: string): Promise<boolean> {
    if (!UUID.test(id) || !Number.isSafeInteger(expectedTokenVersion) || expectedTokenVersion < 0 || !isPasswordHash(passwordHash)) {
      throw new BadRequestException('Dữ liệu đổi mật khẩu không hợp lệ');
    }
    return this.run(() => inPostgresTransaction(this.pool, async (client) => {
      // Mọi adapter đổi tài khoản phải khóa user trước metadata. Đọc lại sau khi
      // chờ khóa ở READ COMMITTED: hai reset với cùng version chỉ một được commit.
      const user = await client.query('SELECT id FROM public.users WHERE id=$1 FOR UPDATE', [id]);
      if (!user.rowCount) { return false; }
      await client.query("SELECT entity_key FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=$1 FOR UPDATE", [id]);
      const row = (await client.query<UserRow>(`${READ} WHERE u.id=$1`, [id])).rows[0];
      const account = this.map(row);
      if (account.user.status !== 'Active' || account.tokenVersion !== expectedTokenVersion) { return false; }
      const next = account.tokenVersion + 1;
      if (!Number.isSafeInteger(next) || !Number.isSafeInteger(safeInteger(row.entity_version!) + 1)) {
        throw new Error('Account version exhausted');
      }
      await client.query('UPDATE public.users SET password=$1 WHERE id=$2', [passwordHash, id]);
      // jsonb_set chỉ thay token_version, giữ seed/provenance và metadata khác.
      await client.query(`UPDATE technical.entity_metadata SET version=version+1,
        data=jsonb_set(data,'{token_version}',$2::jsonb) WHERE entity_type='users' AND entity_key=$1`, [id, JSON.stringify(next)]);
      await this.audit(client, id, 'PasswordReset', { token_version: next });
      return true;
    }));
  }

  private first(rows: UserRow[]): AccountSnapshot | null { return rows[0] ? this.map(rows[0]) : null; }

  private map(row: UserRow): AccountSnapshot {
    const tokenVersion = row.metadata?.token_version;
    // Thiếu/hỏng metadata là lỗi dữ liệu, tuyệt đối không mặc định version 0
    // vì có thể làm JWT đã bị thu hồi trở lại hợp lệ sau restart.
    if (row.entity_version === null || safeInteger(row.entity_version) < 1 || typeof tokenVersion !== 'number' ||
        !Number.isSafeInteger(tokenVersion) || tokenVersion < 0 || !isPasswordHash(row.password)) {
      throw new Error('Invalid account persistence state');
    }
    const { id, user_name, phone_number, gmail, gmail_verify, password, role, status, is_owner, created_at } = row;
    return { tokenVersion, user: { id, user_name, phone_number, gmail, gmail_verify, password, role, status, is_owner, created_at: utcIso(created_at) } };
  }

  private async audit(client: PoolClient, userId: string, action: string, payload: Record<string, unknown>): Promise<void> {
    // Không lưu password/hash/OTP/proof/contact vào lịch sử.
    await client.query(`INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload)
      VALUES ('users',$1::text,$1::uuid,$2,clock_timestamp(),$3)`, [userId, action, JSON.stringify(payload)]);
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof HttpException) { throw error; }
      const driver = error as { code?: string; constraint?: string };
      if (driver.code === '23505' && driver.constraint === 'users_phone_identity') { throw new ConflictException('Số điện thoại đã có tài khoản'); }
      if (driver.code === '23505' && driver.constraint === 'users_gmail_key') { throw new ConflictException('Email đã có tài khoản'); }
      // detail của pg có thể chứa phone/email/hash; không trả/log driver error.
      throw new ServiceUnavailableException('Không thể truy cập dữ liệu tài khoản; vui lòng thử lại sau');
    }
  }
}
