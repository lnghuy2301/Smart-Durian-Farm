import { ConflictException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { ControlOperation } from '../actuator-tasks/actuator-tasks.types';
import { CONTROL_RECIPE } from '../actuator-tasks/task-rules';
import { TaskAccess, TaskScope } from '../actuator-tasks/task-access';
import { farmUuid } from '../farms/farm-validation';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresDevicesRepository } from './postgres-devices.repository';
import { PostgresActuatorsRepository } from './postgres-actuators.repository';
import { TestActuator } from '../actuators/actuators.types';
import { PostgresAssignmentsRepository } from './postgres-assignments.repository';
import { PostgresDomainAccess, RetryDomainContext } from './domain-access';
import { ZONE_READ_SCOPE } from './zone-read-scope';
import { inPostgresTransaction } from './transactions';

// Locks authority in PostgreSQL through the journal commit and the synchronous
// call into publish. Never writes a PG business row or claims a distributed txn.
export class PostgresTaskAccess extends TaskAccess {
  private readonly access: PostgresDomainAccess;
  constructor(private readonly pool: Pool, users: PostgresUsersRepository, farms: PostgresFarmsRepository, zones: PostgresZonesRepository,
    private readonly devices: PostgresDevicesRepository, private readonly actuators: PostgresActuatorsRepository,
    private readonly assignments: PostgresAssignmentsRepository) {
    super(); this.access = new PostgresDomainAccess(users, farms, zones);
  }
  async claim(onLost: () => void): Promise<() => Promise<void>> {
    let client: PoolClient | undefined, lost = false;
    const lose = () => { lost = true; onLost(); };
    try {
      client = await this.pool.connect();
      client.on('error', lose); client.on('end', lose);
      const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('smart-durian:actuator-runtime',0)) AS locked");
      if (!result.rows[0].locked) throw new ServiceUnavailableException('Đã có tiến trình điều khiển đang hoạt động');
      const held = client;
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try { if (!lost) await held.query("SELECT pg_advisory_unlock(hashtextextended('smart-durian:actuator-runtime',0))"); }
        catch { lost = true; }
        finally { held.removeListener('error', lose); held.removeListener('end', lose); held.release(lost); }
      };
    } catch (error) {
      if (client) { client.removeListener('error', lose); client.removeListener('end', lose); client.release(lost || !(error instanceof HttpException)); }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Không thể giữ khóa tiến trình điều khiển');
    }
  }
  async read<T>(actor: string, device: string, work: (scope: TaskScope) => Promise<T>): Promise<T> {
    return this.withScope(actor, device, 'read', work);
  }
  async control<T>(actor: string, device: string, operation: ControlOperation, work: (scope: TaskScope) => Promise<T>): Promise<T> {
    return this.withScope(actor, device, operation, work);
  }
  async off<T>(deviceId: string, work: (scope: TaskScope) => Promise<T>): Promise<T> {
    deviceId = farmUuid(deviceId);
    return this.transaction(async (client) => {
      // Internal OFF must survive actor revocation; Device → Actuators only.
      const device = (await this.devices.loadOnClient(client, deviceId, true)).device;
      await this.recipe(client, deviceId);
      return work({ stationId: device.station_id, from: -Infinity, to: Infinity });
    });
  }
  private async withScope<T>(actor: string, deviceId: string, operation: 'read' | ControlOperation, work: (scope: TaskScope) => Promise<T>): Promise<T> {
    actor = farmUuid(actor); deviceId = farmUuid(deviceId);
    return this.transaction(async (client) => {
      const hint = (await this.devices.loadOnClient(client, deviceId)).device;
      const context = await this.access.lockZone(client, actor, hint.zone_id);
      const device = (await this.devices.loadOnClient(client, deviceId, true)).device;
      if (device.zone_id !== context.zone.id) throw new Error('Persisted Device parent mismatch');
      const values = await this.access.scopeValues(client, context.actor);
      const allowed = await client.query(`SELECT d.id FROM public.devices d JOIN public.zones z ON z.id=d.zone_id WHERE ${ZONE_READ_SCOPE} AND d.id=$4`, [...values, deviceId]);
      if (!allowed.rowCount) throw new NotFoundException('Không tìm thấy Device trong phạm vi truy cập');
      const scope: TaskScope = { stationId: device.station_id, from: -Infinity, to: Infinity };
      if (context.actor.role === 'Farmer' && actor !== context.farm.farm.owner_id) {
        const current = await this.assignments.activeOnClient(client, actor, device.zone_id);
        if (!current) throw new NotFoundException('Không có phân công đang hiệu lực');
        scope.from = Date.parse(current.assignment.start_date);
        scope.to = current.assignment.end_date === null ? Infinity : Date.parse(current.assignment.end_date);
      }
      if (operation !== 'read') {
        if (context.actor.role !== 'Farmer') throw new ForbiddenException('Chỉ chủ Farmer hoặc Farmer đang phụ trách được điều khiển');
        const relays = await this.recipe(client, deviceId);
        if (operation !== 'Stop') {
          if (device.status !== 'Active' || ![2, operation === 'Watering' ? 3 : 4].every((id) => relays.some((relay) => relay.capability_id === id && relay.status === 'Active'))) {
            throw new ConflictException('Device và bơm/van tương ứng phải Active để Bật');
          }
        }
      }
      return work(scope);
    });
  }
  private async recipe(client: PoolClient, device: string) {
    const rows = await client.query<{ id: string }>('SELECT id FROM public.actuators WHERE device_id=$1 AND capability_id IN (2,3,4) ORDER BY id FOR UPDATE', [device]);
    const relays: TestActuator[] = [];
    for (const row of rows.rows) relays.push((await this.actuators.loadOnClient(client, row.id)).actuator);
    if (!CONTROL_RECIPE.every((entry) => relays.some((relay) => relay.capability_id === entry.capability && relay.purpose === entry.purpose))) {
      throw new ConflictException('Bộ điều khiển cần capability2/shared,3/watering,4/spraying');
    }
    return relays;
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await inPostgresTransaction(this.pool, work); }
      catch (error) {
        if (error instanceof RetryDomainContext) continue;
        if (error instanceof HttpException) throw error;
        throw new ServiceUnavailableException('Không thể kiểm tra quyền/cấu hình điều khiển');
      }
    }
    throw new ConflictException('Phạm vi Device vừa thay đổi; hãy kiểm tra lại');
  }
}
