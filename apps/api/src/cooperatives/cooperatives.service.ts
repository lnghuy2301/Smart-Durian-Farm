import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger,
  NotFoundException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { UserAccounts } from '../auth/user-accounts';
import { OtpProvider } from '../auth/sms/otp.provider';
import { WindowRateLimiter } from '../auth/rate-limiter';
import { CreateCooperativeDto } from '../users/users.dto';
import { EmailSender } from '../users/email/email.sender';
import { COOPERATIVE_OTP_PROVIDER } from './cooperative-otp.provider';
import { CooperativeListDto, CooperativePageDto, ManagerCooperativeUpdateDto, UpdateCooperativeDto } from './cooperatives.dto';
import { CooperativeUpdateStatus, StoredCooperativeUpdate } from './cooperatives.types';
import { COOPERATIVE_TERMINAL as TERMINAL, CooperativeRecords, CooperativeWorkflow, cooperativeChanges } from './cooperative-records';
import { COOPERATIVE_WARNING_DAYS, COOPERATIVE_DELETE_DAYS, COOPERATIVE_DAY_MS as DAY_MS } from './cooperative-lifecycle';
export { COOPERATIVE_WARNING_DAYS, COOPERATIVE_DELETE_DAYS } from './cooperative-lifecycle';

const EMAIL_TTL_MS = 10 * 60 * 1000, SMS_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class CooperativesService implements OnApplicationBootstrap, OnApplicationShutdown {
  // Chỉ phiên chứng cứ OTP ở RAM. Nội dung/version/trạng thái do records sở hữu.
  private readonly sessions = new Map<string, StoredCooperativeUpdate>();
  private readonly operations = new Set<string>();
  private readonly sessionId = randomUUID();
  private readonly limiter = new WindowRateLimiter();
  private readonly logger = new Logger(CooperativesService.name);
  private timer?: ReturnType<typeof setInterval>;
  private sweeping?: Promise<void>;

  constructor(
    @Inject(UserAccounts) private readonly users: UserAccounts,
    @Inject(CooperativeRecords) private readonly records: CooperativeRecords,
    @Inject(EmailSender) private readonly emailSender: EmailSender,
    @Inject(COOPERATIVE_OTP_PROVIDER) private readonly sms: OtpProvider,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.records.initialize(this.sessionId);
    await this.sweep();
    this.timer = setInterval(() => { void this.sweep().catch(() => this.logger.warn('Không hoàn tất kiểm tra vòng đời HTX; sẽ kiểm tra lại ở chu kỳ sau')); }, 60000);
    this.timer.unref();
  }
  async onApplicationShutdown(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); }
    await this.sweeping?.catch(() => undefined);
    for (const entry of this.sessions.values()) { this.clearProof(entry); }
  }
  async sweep(): Promise<void> {
    if (this.sweeping) { return this.sweeping; }
    this.sweeping = (async () => {
      const now = Date.now(); await this.records.expireRequests(now); await this.records.sweep();
      for (const entry of this.sessions.values()) {
        if (!entry.busy && !this.operations.has(entry.value.id) && now >= Date.parse(entry.value.expires_at)) {
          this.clearProof(entry); this.sessions.delete(entry.value.id);
        }
      }
    })();
    try { await this.sweeping; } finally { this.sweeping = undefined; }
  }
  async list(actorId: string, query: CooperativeListDto) {
    await this.activeUser(actorId); await this.sweep();
    const q = query.q?.toLocaleLowerCase();
    return this.page((await this.records.list(actorId)).filter((c) => !q ||
      [c.cooperative_name, c.certificate_number, c.address].some((text) => text.toLocaleLowerCase().includes(q))), query);
  }
  async get(actorId: string, id: string) {
    await this.activeUser(actorId); await this.sweep();
    const { cooperative, createdAt } = await this.records.get(actorId, id);
    return { ...cooperative, lifecycle: { created_at: createdAt,
      warning_at: cooperative.manager_id ? null : new Date(Date.parse(createdAt) + COOPERATIVE_WARNING_DAYS * DAY_MS).toISOString(),
      deletion_due_at: cooperative.manager_id ? null : new Date(Date.parse(createdAt) + COOPERATIVE_DELETE_DAYS * DAY_MS).toISOString() } };
  }
  async create(actorId: string, input: CreateCooperativeDto) { await this.admin(actorId); await this.sweep(); return this.records.create(actorId, input); }
  async update(actorId: string, id: string, input: UpdateCooperativeDto) { await this.admin(actorId); await this.sweep(); return this.records.update(actorId, id, input); }
  async listNotifications(actorId: string, query: CooperativePageDto) {
    await this.admin(actorId); await this.sweep(); return this.page(await this.records.notifications(actorId), query);
  }

  async createUpdateRequest(actorId: string, id: string, input: ManagerCooperativeUpdateDto) {
    const { account, cooperative } = await this.manager(actorId, id);
    await this.sweep(); const now = Date.now();
    if ([...this.sessions.values()].some((r) => r.value.manager_id === actorId && (r.busy || this.operations.has(r.value.id)))) {
      throw new ConflictException('Manager đã có yêu cầu sửa HTX đang xử lý; chờ thao tác hoàn tất');
    }
    const changes = cooperativeChanges(cooperative.cooperative, input, true);
    const stored = await this.records.insertRequest({ value: { id: randomUUID(), cooperative_id: id, manager_id: actorId,
      proposed_changes: changes, status: 'EmailPending', created_at: new Date(now).toISOString(), resolved_at: null,
      expires_at: new Date(now + EMAIL_TTL_MS).toISOString(), email_verified_at: null },
    cooperativeVersion: cooperative.version, tokenVersion: account.tokenVersion, revision: 1, sessionId: this.sessionId },
    { email: account.user.gmail!, phone: account.user.phone_number });
    const entry: StoredCooperativeUpdate = { ...stored, email: account.user.gmail!, phone: account.user.phone_number,
      emailAttempts: 0, smsAttempts: 0, smsActive: false, emailValidUntil: 0, nextEmailSendAt: 0, nextSmsSendAt: 0, busy: false };
    this.sessions.set(entry.value.id, entry);
    return this.exclusive(entry.value.id, async () => {
      try { return await this.sendEmailEntry(entry); }
      catch (error) { await this.finish(entry, 'Failed'); throw error; }
    });
  }
  async listRequests(actorId: string, query: CooperativePageDto) {
    await this.activeUser(actorId); await this.sweep();
    return this.page((await this.records.listRequests(actorId)).map((r) => r.value), query);
  }
  async getRequest(actorId: string, id: string) {
    await this.records.expireRequests(Date.now()); return (await this.records.getRequest(actorId, id)).value;
  }
  async resendEmail(actorId: string, id: string) {
    return this.exclusive(id, async () => this.sendEmailEntry(await this.mutableRequest(actorId, id, ['EmailPending'])));
  }
  async verifyEmail(actorId: string, id: string, code: string) {
    return this.exclusive(id, async () => {
      this.limiter.take('cooperative-email-verify', 20);
      const entry = await this.mutableRequest(actorId, id, ['EmailPending']);
      if (entry.emailAttempts >= 5 || !entry.emailDigest || !entry.emailSalt) { throw this.invalidOtp(); }
      entry.emailAttempts++;
      if (!/^\d{6}$/.test(code) || !timingSafeEqual(entry.emailDigest, this.digest(`${entry.emailSalt}:${code}`))) {
        if (entry.emailAttempts >= 5) { await this.finish(entry, 'Failed'); } throw this.invalidOtp();
      }
      const now = Date.now();
      entry.emailDigest = undefined; entry.emailSalt = undefined; entry.emailValidUntil = now + EMAIL_TTL_MS;
      try {
        await this.save(entry, { status: 'EmailVerified', email_verified_at: new Date(now).toISOString(), expires_at: new Date(entry.emailValidUntil).toISOString() });
      } catch (error) { await this.finish(entry, 'Failed'); throw error; }
      return structuredClone(entry.value);
    });
  }
  async sendSms(actorId: string, id: string) {
    return this.exclusive(id, async () => {
      const entry = await this.mutableRequest(actorId, id, ['EmailVerified', 'SmsPending']), now = Date.now();
      if (now >= entry.emailValidUntil) { await this.finish(entry, 'Expired'); throw this.invalidOtp(); }
      if (now < entry.nextSmsSendAt) { throw this.cooldown(); }
      this.limiter.take('cooperative-sms-send', 5);
      entry.nextSmsSendAt = now + 60000; entry.smsProof = undefined; entry.smsAttempts = 0; entry.busy = true;
      try {
        await this.save(entry, { status: 'SmsSending', expires_at: new Date(now + SMS_TTL_MS).toISOString() });
        entry.smsActive = true;
        const proof = await this.sms.issue(entry.phone, now + SMS_TTL_MS);
        entry.smsProof = proof;
        await this.checkContext(entry);
        if (Date.now() >= Date.parse(entry.value.expires_at)) { await this.finish(entry, 'Expired'); throw this.invalidOtp(); }
        await this.save(entry, { status: 'SmsPending' }); return structuredClone(entry.value);
      } catch (error) { await this.finish(entry, 'Failed'); throw error; }
      finally { entry.busy = false; }
    });
  }
  async verifySms(actorId: string, id: string, code: string) {
    return this.exclusive(id, async () => {
      this.limiter.take('cooperative-sms-verify', 20);
      const entry = await this.mutableRequest(actorId, id, ['SmsPending']);
      if (!entry.smsProof || entry.smsAttempts >= 5 || !/^\d{6}$/.test(code)) { throw this.invalidOtp(); }
      entry.smsAttempts++; entry.busy = true;
      try {
        await this.save(entry, { status: 'SmsChecking' });
        const matches = await this.sms.verify(entry.smsProof, code);
        await this.checkContext(entry);
        if (Date.now() >= Date.parse(entry.value.expires_at)) { await this.finish(entry, 'Expired'); throw this.invalidOtp(); }
        if (!matches) {
          if (entry.smsAttempts >= 5) { await this.finish(entry, 'Failed'); }
          else { await this.save(entry, { status: 'SmsPending' }); }
          throw this.invalidOtp();
        }
        // Adapter khóa và recheck account/HTX/request ngay lúc ghi. Không có
        // khoảng await giữa cập nhật HTX và Accepted/audit trong transaction.
        const result = await this.save(entry, { status: 'Accepted', resolved_at: new Date(Date.now()).toISOString() });
        this.clearProof(entry); this.sessions.delete(id); return { request: structuredClone(entry.value), cooperative: result.cooperative! };
      } catch (error) {
        // OTP sai còn lượt được giữ ở SmsPending; lỗi provider/DB/context hết
        // chứng cứ thì không cho replay, kể cả khi kết quả commit chưa rõ.
        if (!(error instanceof BadRequestException && entry.value.status === 'SmsPending')) { await this.finish(entry, 'Failed'); }
        throw error;
      } finally { entry.busy = false; }
    });
  }
  async cancel(actorId: string, id: string) {
    return this.exclusive(id, async () => {
      const entry = await this.mutableRequest(actorId, id, ['EmailPending', 'EmailVerified', 'SmsPending']);
      await this.save(entry, { status: 'Cancelled', resolved_at: new Date(Date.now()).toISOString() }); this.clearProof(entry); this.sessions.delete(id); return structuredClone(entry.value);
    });
  }
  async testSms(actorId: string, id: string) {
    return this.exclusive(id, async () => {
      const entry = await this.mutableRequest(actorId, id, ['SmsPending']);
      if (this.sms.mode !== 'mock') { throw new NotFoundException(); } return { mode: 'mock', messages: this.sms.messages(entry.phone) };
    });
  }

  private async sendEmailEntry(entry: StoredCooperativeUpdate) {
    const now = Date.now(); if (now < entry.nextEmailSendAt) { throw this.cooldown(); }
    this.limiter.take('cooperative-email-send', 5);
    entry.nextEmailSendAt = now + 60000; entry.emailAttempts = 0;
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    entry.emailSalt = randomBytes(16).toString('hex'); entry.emailDigest = this.digest(`${entry.emailSalt}:${code}`); entry.busy = true;
    try {
      await this.save(entry, { status: 'EmailSending', expires_at: new Date(now + EMAIL_TTL_MS).toISOString() });
      await this.emailSender.sendVerification(entry.email, code, 'cooperative-update');
      await this.checkContext(entry);
      if (Date.now() >= Date.parse(entry.value.expires_at)) { await this.finish(entry, 'Expired'); throw this.invalidOtp(); }
      await this.save(entry, { status: 'EmailPending' }); return structuredClone(entry.value);
    } catch (error) { await this.finish(entry, 'Failed'); throw error; }
    finally { entry.busy = false; }
  }
  private async checkContext(entry: StoredCooperativeUpdate) {
    const { account, cooperative } = await this.manager(entry.value.manager_id, entry.value.cooperative_id);
    if (account.user.gmail !== entry.email || account.user.phone_number !== entry.phone || account.tokenVersion !== entry.tokenVersion || cooperative.version !== entry.cooperativeVersion) {
      throw new ConflictException('HTX hoặc tài khoản đã thay đổi; cần tạo yêu cầu và xác minh lại');
    }
    const latest = await this.records.getRequest(entry.value.manager_id, entry.value.id);
    if (latest.revision !== entry.revision || TERMINAL.includes(latest.value.status)) { throw new ConflictException('Yêu cầu đã được xử lý hoặc thay đổi'); }
  }
  private async mutableRequest(actorId: string, id: string, statuses: CooperativeUpdateStatus[]) {
    await this.records.expireRequests(Date.now());
    const stored = await this.records.getRequest(actorId, id);
    if (actorId !== stored.value.manager_id) { throw new ForbiddenException('Chỉ Manager gửi yêu cầu được xác minh'); }
    const entry = this.sessions.get(id);
    if (!entry || entry.sessionId !== stored.sessionId) { throw new ConflictException('Phiên xác minh đã kết thúc; cần tạo yêu cầu và xác minh lại'); }
    Object.assign(entry, stored);
    if (entry.busy || !statuses.includes(entry.value.status)) { throw new ConflictException('Yêu cầu không ở bước xác minh phù hợp'); }
    try { await this.checkContext(entry); } catch (error) { await this.finish(entry, 'Failed'); throw error; }
    return entry;
  }
  private async save(entry: StoredCooperativeUpdate, changes: Partial<StoredCooperativeUpdate['value']>) {
    const result = await this.records.saveRequest(this.workflow(entry), { ...entry.value, ...changes }, { email: entry.email, phone: entry.phone });
    Object.assign(entry, result.stored); return result;
  }
  private async finish(entry: StoredCooperativeUpdate, status: 'Failed' | 'Expired') {
    this.clearProof(entry);
    this.sessions.delete(entry.value.id);
    if (TERMINAL.includes(entry.value.status)) { return; }
    try {
      const result = await this.records.saveRequest(this.workflow(entry), { ...entry.value, status, resolved_at: new Date(Date.now()).toISOString() });
      Object.assign(entry, result.stored);
    } catch (error) {
      if (!(error instanceof ConflictException)) { throw error; }
      // Sweep/restart hoặc commit trước đó có thể đã chốt record. Không ghi
      // đè terminal state chỉ để phản ánh lỗi mạng sau COMMIT không rõ kết quả.
    }
  }
  private clearProof(entry: StoredCooperativeUpdate) {
    entry.emailDigest = undefined; entry.emailSalt = undefined; entry.smsProof = undefined;
    // Cleanup lặp sau await/unknown response không được clear OTP của phiên
    // mới cùng phone đã bắt đầu sau khi slot request cũ được giải phóng.
    if (entry.smsActive) { entry.smsActive = false; this.sms.clear(entry.phone); }
  }
  private workflow(entry: StoredCooperativeUpdate): CooperativeWorkflow {
    const { value, cooperativeVersion, tokenVersion, revision, sessionId } = entry;
    return { value: structuredClone(value), cooperativeVersion, tokenVersion, revision, sessionId };
  }
  private async exclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.operations.has(id)) { throw new ConflictException('Yêu cầu đang gửi hoặc xác minh OTP'); }
    this.operations.add(id); try { return await action(); } finally { this.operations.delete(id); }
  }
  private async activeUser(id: string) {
    const account = await this.users.loadById(id);
    if (!account || account.user.status !== 'Active') { throw new ForbiddenException('Tài khoản phải Active'); } return account;
  }
  private async admin(id: string) { if ((await this.activeUser(id)).user.role !== 'Admin') { throw new ForbiddenException('Chỉ Admin tạo/sửa trực tiếp HTX'); } }
  private async manager(actorId: string, id: string) {
    const account = await this.activeUser(actorId), cooperative = await this.records.get(actorId, id);
    if (account.user.role !== 'Manager' || cooperative.cooperative.manager_id !== actorId) { throw new ForbiddenException('Chỉ Manager của HTX được gửi thay đổi'); }
    if (!account.user.gmail || !account.user.gmail_verify) { throw new ConflictException('Manager phải có email tài khoản đã xác minh'); }
    return { account, cooperative };
  }
  private page<T>(items: T[], query: CooperativePageDto) { return { items: structuredClone(items.slice(query.offset, query.offset + query.limit)), total: items.length, limit: query.limit, offset: query.offset }; }
  private digest(value: string): Buffer { return createHash('sha256').update(value).digest(); }
  private invalidOtp() { return new BadRequestException('OTP không hợp lệ, đã dùng hoặc hết hạn'); }
  private cooldown() { return new HttpException('Đợi 60 giây trước khi gửi lại OTP', HttpStatus.TOO_MANY_REQUESTS); }
}
