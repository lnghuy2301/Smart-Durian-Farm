import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { UserRecord } from '../auth/user-accounts';
import { TreeRecords } from '../trees/tree-records';
import { TestTree, TreeDetails } from '../trees/trees.types';
import { CreateTreeDto, TreeListDto, UpdateTreeDto, TreeCodeParamDto } from '../trees/trees.dto';
import { FarmPageDto, FarmRequestListDto, RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { FarmPage } from '../farms/farm-records';
import { PostgresUsersRepository } from './postgres-users.repository';
import { PostgresFarmsRepository } from './postgres-farms.repository';
import { PostgresZonesRepository } from './postgres-zones.repository';
import { PostgresDomainAccess, RetryDomainContext, ZoneWriteContext } from './domain-access';
import { ZONE_READ_SCOPE } from './zone-read-scope';
import {
  TreeRow,
  TreeSnapshot,
  TreeRequestRow,
  TREE_FIELDS,
  mapTree,
  mapTreeRequest,
  mapTreeHistory,
  treeRequestPayload,
  treeChanges,
} from './tree-mappers';
import { inPostgresTransaction } from './transactions';
import { safeInteger } from './mappers';

const SELECT_TREE = `SELECT t.id,t.zone_id,t.tree_code,t.variety,t.plant_date,t.longitude,t.latitude,t.status,m.version::text AS entity_version
  FROM public.trees t JOIN public.zones z ON z.id=t.zone_id LEFT JOIN technical.entity_metadata m ON m.entity_type='trees' AND m.entity_key=t.id::text`;
const SELECT_REQUEST = `SELECT id,action,status,target_key,requested_by,expected_version::text,payload,created_at,resolved_at,resolved_by FROM technical.workflow_requests WHERE module='trees'`;
interface Context extends ZoneWriteContext {
  tree: TreeSnapshot | null;
  request: ReturnType<typeof mapTreeRequest> | null;
}

export class PostgresTreesRepository extends TreeRecords {
  private readonly access: PostgresDomainAccess;
  constructor(
    private readonly pool: Pool,
    users: PostgresUsersRepository,
    farms: PostgresFarmsRepository,
    zones: PostgresZonesRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {
    super();
    this.access = new PostgresDomainAccess(users, farms, zones);
  }
  async list(actor: string, input: TreeListDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(TreeListDto, input),
        scope = await this.access.scopeValues(client, user);
      return this.page(
        client,
        `${SELECT_TREE} WHERE ${ZONE_READ_SCOPE} AND ($4::uuid IS NULL OR t.zone_id=$4) AND ($5::text IS NULL OR t.status=$5)
      AND ($6::text IS NULL OR strpos(lower(t.tree_code),lower($6))>0 OR strpos(lower(t.variety),lower($6))>0)`,
        [...scope, q.zone_id ? farmUuid(q.zone_id) : null, q.status ?? null, q.q ?? null],
        q,
        'id',
        (row: TreeRow) => mapTree(row).tree,
      );
    });
  }
  async get(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => this.scoped(client, user, 't.id', id));
  }
  async getByCode(actor: string, code: string) {
    code = farmInput(TreeCodeParamDto, { treeCode: code }).treeCode;
    return this.readAs(actor, async (client, user) => this.scoped(client, user, 't.tree_code', code));
  }
  async history(actor: string, id: string, input: FarmPageDto) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(FarmPageDto, input);
      await this.scoped(client, user, 't.id', id);
      return this.page(
        client,
        `SELECT id,entity_key,actor_id,action,changed_at,payload FROM technical.audit_events WHERE entity_type='trees' AND entity_key=$1 AND action IN ('TreeCreated','TreeUpdated')`,
        [id],
        q,
        "(payload->>'version')::bigint,id",
        mapTreeHistory,
      );
    });
  }
  async getRecord(id: string) {
    id = farmUuid(id);
    return this.transaction(async (client) => (await this.loadOnClient(client, id)).tree);
  }
  async getTraceRecordByCode(code: string) {
    code = farmInput(TreeCodeParamDto, { treeCode: code }).treeCode;
    return this.transaction(async (client) => {
      const row = await client.query<TreeRow>(`${SELECT_TREE} WHERE t.tree_code=$1`, [code]);
      if (!row.rows[0]) {
        throw new NotFoundException('Không tìm thấy cây');
      }
      return mapTree(row.rows[0]).tree;
    });
  }
  async create(actor: string, input: CreateTreeDto) {
    return this.write(actor, input);
  }
  async update(actor: string, id: string, input: UpdateTreeDto) {
    return this.write(actor, input, farmUuid(id));
  }
  async createRequest(actor: string, input: CreateTreeDto) {
    return this.propose(actor, input);
  }
  async updateRequest(actor: string, id: string, input: UpdateTreeDto) {
    return this.propose(actor, input, farmUuid(id));
  }
  async listRequests(actor: string, input: FarmRequestListDto) {
    return this.readAs(actor, async (client, user) => {
      const q = farmInput(FarmRequestListDto, input);
      return this.page(
        client,
        `${SELECT_REQUEST} AND ($1::text='Admin' OR payload->>'owner_id'=$2) AND ($3::text IS NULL OR status=$3)`,
        [user.role, user.id, q.status ?? null],
        q,
        'created_at,id',
        (row: TreeRequestRow) => mapTreeRequest(row).value,
      );
    });
  }
  async getRequest(actor: string, id: string) {
    id = farmUuid(id);
    return this.readAs(actor, async (client, user) => {
      const r = (await this.request(client, id)).value;
      if (user.role !== 'Admin' && user.id !== r.owner_id) {
        throw new NotFoundException('Không tìm thấy đề xuất cây');
      }
      return r;
    });
  }
  async approve(actor: string, id: string) {
    return this.decide(actor, farmUuid(id));
  }
  async reject(actor: string, id: string, reason?: string) {
    return this.decide(actor, farmUuid(id), { reason: farmInput(RejectFarmRequestDto, { reason }).reason });
  }
  async loadOnClient(client: PoolClient, id: string, lock = false): Promise<TreeSnapshot> {
    id = farmUuid(id);
    if (lock) {
      await client.query('SELECT id FROM public.trees WHERE id=$1 FOR UPDATE', [id]);
    }
    const rows = await client.query<TreeRow>(`${SELECT_TREE} WHERE t.id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy cây');
    }
    return mapTree(rows.rows[0]);
  }
  private input(
    input: CreateTreeDto | UpdateTreeDto,
    creating: boolean,
  ): Partial<TreeDetails> & { zone_id?: string } {
    const value = creating
      ? farmInput(CreateTreeDto, input as CreateTreeDto)
      : farmInput(UpdateTreeDto, input);
    const result = { ...value };
    if (result.plant_date !== undefined) {
      result.plant_date = new Date(result.plant_date).toISOString();
    }
    if (creating) {
      result.status ??= 'Active';
    }
    return result;
  }
  private async write(actor: string, input: CreateTreeDto | UpdateTreeDto, id?: string) {
    actor = farmUuid(actor);
    const value = this.input(input, !id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, {
        treeId: id,
        zoneId: value.zone_id ? farmUuid(value.zone_id) : undefined,
      });
      this.access.writable(c, 'Farmer');
      const changes = treeChanges(value);
      if (c.tree) {
        this.requireChanges(c.tree.tree, changes);
      }
      return this.save(client, c, { ...c.tree?.tree, ...changes } as TreeDetails, actor);
    });
  }
  private async propose(actor: string, input: CreateTreeDto | UpdateTreeDto, id?: string) {
    actor = farmUuid(actor);
    const value = this.input(input, !id);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, {
        treeId: id,
        zoneId: value.zone_id ? farmUuid(value.zone_id) : undefined,
      });
      this.access.writable(c, 'Admin');
      const changes = treeChanges(value);
      if (c.tree) {
        this.requireChanges(c.tree.tree, changes);
        if (
          (
            await client.query(
              "SELECT 1 FROM technical.workflow_requests WHERE module='trees' AND status='Pending' AND target_key=$1",
              [id],
            )
          ).rowCount
        ) {
          throw new ConflictException('Cây đã có đề xuất sửa Pending');
        }
      }
      const payload = {
        zone_id: c.zone.id,
        farm_id: c.farm.farm.id,
        owner_id: c.farm.farm.owner_id,
        proposed_changes: changes,
        tree_snapshot: c.tree?.tree ?? null,
        rejection_reason: null,
      };
      const rows = await client.query<TreeRequestRow>(
        `INSERT INTO technical.workflow_requests(module,action,status,target_key,requested_by,expected_version,payload,created_at)
        VALUES ('trees',$1,'Pending',$2,$3,$4,$5,$6) RETURNING id,action,status,target_key,requested_by,expected_version::text,payload,created_at,resolved_at,resolved_by`,
        [
          c.tree ? 'Update' : 'Create',
          c.tree?.tree.id ?? null,
          actor,
          c.tree?.version ?? null,
          JSON.stringify(payload),
          this.clock(),
        ],
      );
      const r = mapTreeRequest(rows.rows[0]).value;
      await this.metadata(client, 'tree_requests', r.id);
      await this.audit(client, 'tree_requests', r.id, actor, 'TreeRequestCreated', {
        action: r.action,
        zone_id: r.zone_id,
        tree_id: r.tree_id,
      });
      return r;
    });
  }
  private async decide(actor: string, id: string, rejection?: { reason?: string }) {
    actor = farmUuid(actor);
    return this.transaction(async (client) => {
      const c = await this.context(client, actor, { requestId: id }),
        r = structuredClone(c.request!.value);
      if (r.status !== 'Pending') {
        throw new ConflictException('Đề xuất cây đã được xử lý');
      }
      if (c.actor.role !== 'Farmer' || actor !== r.owner_id) {
        throw new ForbiddenException('Chỉ chủ Farmer được duyệt/từ chối đề xuất cây');
      }
      if (rejection) {
        r.status = 'Rejected';
        r.rejection_reason = rejection.reason ?? null;
      } else {
        this.access.writable(c, 'Farmer');
        if (c.farm.farm.id !== r.farm_id || c.farm.farm.owner_id !== r.owner_id) {
          throw new ConflictException('Farm/chủ đã thay đổi; cần đề xuất mới');
        }
        if (this.access.active(c.users, r.proposed_by).role !== 'Admin') {
          throw new ConflictException('Người đề xuất không còn là Admin');
        }
        if (c.tree && c.tree.version !== c.request!.version) {
          throw new ConflictException('Cây đã thay đổi; từ chối và lập đề xuất mới');
        }
        r.tree_id = (
          await this.save(
            client,
            c,
            { ...c.tree?.tree, ...r.proposed_changes } as TreeDetails,
            actor,
            r.id,
            r.proposed_by,
          )
        ).id;
        r.status = 'Accepted';
      }
      r.resolved_by = actor;
      r.resolved_at = this.clock().toISOString();
      await client.query(
        "UPDATE technical.workflow_requests SET status=$2,target_key=$3,payload=$4,resolved_at=$5,resolved_by=$6 WHERE module='trees' AND id=$1",
        [id, r.status, r.tree_id, JSON.stringify(treeRequestPayload(r)), r.resolved_at, actor],
      );
      await this.metadata(client, 'tree_requests', id);
      await this.audit(
        client,
        'tree_requests',
        id,
        actor,
        rejection ? 'TreeRequestRejected' : 'TreeRequestAccepted',
        { zone_id: r.zone_id, tree_id: r.tree_id },
      );
      return r;
    });
  }
  private async save(
    client: PoolClient,
    c: Context,
    next: TreeDetails,
    actor: string,
    requestId: string | null = null,
    proposedBy: string | null = null,
  ): Promise<TestTree> {
    let id = c.tree?.tree.id;
    if (id) {
      await client.query(
        'UPDATE public.trees SET variety=$2,plant_date=$3,longitude=$4,latitude=$5,status=$6 WHERE id=$1',
        [id, ...TREE_FIELDS.map((key) => next[key])],
      );
    } else {
      // DO NOTHING avoids a failed transaction on UUID/code collision, allowing
      // the same bounded three attempts as RAM without changing existing trees.
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = farmUuid(this.idFactory());
        const inserted = await client.query(
          'INSERT INTO public.trees(id,zone_id,tree_code,variety,plant_date,longitude,latitude,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id',
          [candidate, c.zone.id, `DRN-${candidate}`, ...TREE_FIELDS.map((key) => next[key])],
        );
        if (inserted.rowCount) {
          id = candidate;
          break;
        }
      }
      if (!id) {
        throw new ConflictException('Không thể sinh mã cây duy nhất; thử lại');
      }
    }
    const version = await this.metadata(client, 'trees', id),
      after = (await this.loadOnClient(client, id)).tree;
    await this.audit(client, 'trees', id, actor, c.tree ? 'TreeUpdated' : 'TreeCreated', {
      proposed_by: proposedBy,
      request_id: requestId,
      version,
      before: c.tree?.tree ?? null,
      after,
    });
    return after;
  }
  private requireChanges(tree: TestTree, input: Partial<TreeDetails>) {
    if (!Object.entries(input).some(([key, value]) => tree[key as keyof TreeDetails] !== value)) {
      throw new BadRequestException('Cần ít nhất một thông tin cây thực sự thay đổi');
    }
  }
  private async scoped(
    client: PoolClient,
    user: UserRecord,
    column: 't.id' | 't.tree_code',
    value: string,
  ): Promise<TestTree> {
    const scope = await this.access.scopeValues(client, user),
      rows = await client.query<TreeRow>(`${SELECT_TREE} WHERE ${ZONE_READ_SCOPE} AND ${column}=$4`, [
        ...scope,
        value,
      ]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy cây trong phạm vi truy cập');
    }
    return mapTree(rows.rows[0]).tree;
  }
  private async request(client: PoolClient, id: string, lock = false) {
    if (lock) {
      await client.query(
        "SELECT id FROM technical.workflow_requests WHERE module='trees' AND id=$1 FOR UPDATE",
        [id],
      );
    }
    const rows = await client.query<TreeRequestRow>(`${SELECT_REQUEST} AND id=$1`, [id]);
    if (!rows.rows[0]) {
      throw new NotFoundException('Không tìm thấy đề xuất cây');
    }
    return mapTreeRequest(rows.rows[0]);
  }
  private async context(
    client: PoolClient,
    actor: string,
    target: { zoneId?: string; treeId?: string; requestId?: string },
  ): Promise<Context> {
    const hint = target.requestId ? await this.request(client, target.requestId) : null,
      treeId = target.treeId ?? hint?.value.tree_id;
    const treeHint = treeId ? await this.loadOnClient(client, treeId) : null;
    const c = await this.access.lockZone(
      client,
      actor,
      target.zoneId ?? hint?.value.zone_id ?? treeHint!.tree.zone_id,
      hint ? [hint.value.owner_id, hint.value.proposed_by] : [],
    );
    const tree = treeId ? await this.loadOnClient(client, treeId, true) : null,
      request = target.requestId ? await this.request(client, target.requestId, true) : null;
    if (tree && tree.tree.zone_id !== c.zone.id) {
      throw new Error('Persisted Tree parent mismatch');
    }
    if (request && JSON.stringify(request) !== JSON.stringify(hint)) {
      throw new RetryDomainContext();
    }
    return { ...c, tree, request };
  }
  private async readAs<T>(
    actor: string,
    work: (client: PoolClient, user: UserRecord) => Promise<T>,
  ): Promise<T> {
    actor = farmUuid(actor);
    return this.transaction(async (client) => work(client, await this.access.actorOnClient(client, actor)));
  }
  private async page<Row, T>(
    client: PoolClient,
    select: string,
    values: unknown[],
    q: { limit: number; offset: number },
    order: string,
    map: (row: Row) => T,
  ): Promise<FarmPage<T>> {
    const n = values.length,
      result = await client.query<{ total: string; items: Row[] }>(
        `WITH filtered AS (${select}),page AS (SELECT * FROM filtered ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2})
      SELECT (SELECT count(*) FROM filtered)::text AS total,COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY ${order}) FROM page p),'[]'::jsonb) AS items`,
        [...values, q.limit, q.offset],
      );
    return {
      items: result.rows[0].items.map(map),
      total: safeInteger(result.rows[0].total),
      limit: q.limit,
      offset: q.offset,
    };
  }
  private async metadata(client: PoolClient, type: string, id: string): Promise<number> {
    const rows = await client.query<{ version: string }>(
      `INSERT INTO technical.entity_metadata(entity_type,entity_key,version) VALUES ($1,$2,1) ON CONFLICT(entity_type,entity_key) DO UPDATE SET version=technical.entity_metadata.version+1
      WHERE technical.entity_metadata.version BETWEEN 1 AND 9007199254740990 RETURNING version::text`,
      [type, id],
    );
    if (!rows.rows[0]) {
      throw new Error('Invalid or exhausted Tree version');
    }
    return safeInteger(rows.rows[0].version);
  }
  private async audit(
    client: PoolClient,
    type: string,
    id: string,
    actor: string,
    action: string,
    payload: object,
  ) {
    await client.query(
      'INSERT INTO technical.audit_events(entity_type,entity_key,actor_id,action,changed_at,payload) VALUES ($1,$2,$3,$4,$5,$6)',
      [type, id, actor, action, this.clock(), JSON.stringify(payload)],
    );
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await inPostgresTransaction(this.pool, work);
      } catch (error) {
        if (error instanceof RetryDomainContext) {
          continue;
        }
        if (error instanceof HttpException) {
          throw error;
        }
        const pg = error as { code?: string; constraint?: string };
        if (pg.code === '23505' && pg.constraint === 'tree_one_pending_update') {
          throw new ConflictException('Cây đã có đề xuất sửa Pending');
        }
        throw new ServiceUnavailableException('Không thể truy cập dữ liệu cây; vui lòng thử lại sau');
      }
    }
    throw new ConflictException('Dữ liệu cây vừa thay đổi; hãy tải lại');
  }
}
