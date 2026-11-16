import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { UserRecord } from '../auth/user-accounts';
import { farmUuid } from '../farms/farm-validation';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { FarmSnapshot } from './farm-mappers';
import { TestZone } from '../zones/zones.types';

export interface ZoneWriteContext {
  actor: UserRecord;
  users: Map<string, UserRecord>;
  farm: FarmSnapshot;
  zone: TestZone;
}
export class RetryDomainContext extends Error {}

// Shared lock/scope primitives for dependent metadata adapters. Không sở hữu
// pool/store hoặc transaction; mọi lookup chạy trên client của caller.
export class PostgresDomainAccess {
  constructor(
    private readonly users: PostgresUsersRepository,
    private readonly farms: PostgresFarmsRepository,
    private readonly zones: PostgresZonesRepository,
  ) {}
  active(users: ReadonlyMap<string, UserRecord>, id: string): UserRecord {
    const user = users.get(id);
    if (!user || user.status !== 'Active') {
      throw new ForbiddenException('Tài khoản phải Active');
    }
    return user;
  }
  async actorOnClient(client: PoolClient, actor: string): Promise<UserRecord> {
    return this.active(await this.lockUsers(client, [actor]), actor);
  }
  async scopeValues(client: PoolClient, user: UserRecord): Promise<[string, string, string[]]> {
    return [user.role, user.id, await this.zones.acceptedZoneIdsOnClient(client, user)];
  }
  async lockZone(
    client: PoolClient,
    actor: string,
    zoneId: string,
    relatedUsers: string[] = [],
  ): Promise<ZoneWriteContext> {
    const hint = (await this.zones.loadOnClient(client, zoneId)).zone;
    const farmHint = await this.farms.loadOnClient(client, hint.farm_id);
    const users = await this.lockUsers(client, [actor, farmHint.farm.owner_id, ...relatedUsers]);
    const user = this.active(users, actor);
    // Global order users → metadata → HTX → Farm → Zone. Never lock a user
    // after a parent; context changes must restart BEFORE any business write.
    if (farmHint.farm.cooperative_id) {
      await client.query('SELECT id FROM public.cooperatives WHERE id=$1 FOR UPDATE', [
        farmHint.farm.cooperative_id,
      ]);
    }
    const farm = await this.farms.loadOnClient(client, farmHint.farm.id, true);
    if (
      farm.farm.owner_id !== farmHint.farm.owner_id ||
      farm.farm.cooperative_id !== farmHint.farm.cooperative_id
    ) {
      throw new RetryDomainContext();
    }
    const zone = (await this.zones.loadOnClient(client, hint.id, true)).zone;
    if (zone.farm_id !== farm.farm.id) {
      throw new Error('Persisted domain parent mismatch');
    }
    return { actor: user, users, farm, zone };
  }
  writable(context: ZoneWriteContext, role: 'Admin' | 'Farmer'): void {
    if (
      context.actor.role !== role ||
      (role === 'Farmer' && context.actor.id !== context.farm.farm.owner_id)
    ) {
      throw new ForbiddenException(
        role === 'Admin' ? 'Chỉ Admin được gửi đề xuất' : 'Chỉ chủ Farmer được ghi trực tiếp',
      );
    }
    if (this.active(context.users, context.farm.farm.owner_id).role !== 'Farmer') {
      throw new ConflictException('Chủ Farm phải là Farmer Active');
    }
  }
  private async lockUsers(client: PoolClient, ids: string[]): Promise<Map<string, UserRecord>> {
    const keys = [...new Set(ids.map(farmUuid))].sort();
    await client.query('SELECT id FROM public.users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [keys]);
    await client.query(
      "SELECT entity_key FROM technical.entity_metadata WHERE entity_type='users' AND entity_key=ANY($1::text[]) ORDER BY entity_key FOR UPDATE",
      [keys],
    );
    const result = new Map<string, UserRecord>();
    for (const key of keys) {
      const row = await this.users.loadOnClient(client, key);
      if (row) {
        result.set(key, row.user);
      }
    }
    return result;
  }
}
