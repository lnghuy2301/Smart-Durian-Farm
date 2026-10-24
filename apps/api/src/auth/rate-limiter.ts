import { HttpException, HttpStatus } from '@nestjs/common';

type Action = 'login' | 'forgot' | 'register' | 'email-send' | 'email-verify'
  | 'cooperative-email-send' | 'cooperative-email-verify' | 'cooperative-sms-send' | 'cooperative-sms-verify'
  | 'refresh' | 'password-current' | 'profile-email' | 'profile-email-verify';

export class WindowRateLimiter {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();

  take(action: Action, max: number, actor?: string): void {
    // Optional scope is an authenticated actor ID, never a submitted phone/email.
    // Bound the map and evict expired buckets before admitting a new actor.
    const now = Date.now();
    const key = `${action}:${actor ?? ''}`;
    if (!this.buckets.has(key) && this.buckets.size >= 1000) {
      for (const [id, value] of this.buckets) if (now - value.startedAt >= 60000) this.buckets.delete(id);
      if (this.buckets.size >= 1000) throw new HttpException('Vui lòng thử lại sau một phút', HttpStatus.TOO_MANY_REQUESTS);
    }
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= 60000) { bucket = { startedAt: now, count: 0 }; this.buckets.set(key, bucket); }
    if (++bucket.count > max) { throw new HttpException('Vui lòng thử lại sau một phút', HttpStatus.TOO_MANY_REQUESTS); }
  }
}
