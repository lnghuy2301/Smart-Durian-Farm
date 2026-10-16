import { TestTree, TreeDetails, TreeChangeRequest, TreeMetadataHistory } from '../trees/trees.types';
import { CreateTreeDto, UpdateTreeDto } from '../trees/trees.dto';
import { RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { decimalNumber, safeInteger, utcIso } from './mappers';

export const TREE_FIELDS = ['variety', 'plant_date', 'longitude', 'latitude', 'status'] as const;
export interface TreeRow extends Omit<TestTree, 'plant_date' | 'longitude' | 'latitude'> {
  plant_date: Date | string;
  longitude: string | number;
  latitude: string | number;
  entity_version: string | null;
}
export interface TreeSnapshot {
  tree: TestTree;
  version: number;
}
export interface TreeRequestRow {
  id: string;
  action: TreeChangeRequest['action'];
  status: TreeChangeRequest['status'];
  target_key: string | null;
  requested_by: string;
  expected_version: string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  payload: Pick<
    TreeChangeRequest,
    'zone_id' | 'farm_id' | 'owner_id' | 'proposed_changes' | 'tree_snapshot' | 'rejection_reason'
  >;
}
export interface TreeHistoryRow {
  id: string;
  entity_key: string;
  actor_id: string;
  action: 'TreeCreated' | 'TreeUpdated';
  changed_at: Date | string;
  payload: Pick<TreeMetadataHistory, 'proposed_by' | 'request_id' | 'version' | 'before' | 'after'>;
}
function invariant(value: boolean): asserts value {
  if (!value) {
    throw new Error('Invalid persisted Tree state');
  }
}
function id(value: string) {
  invariant(farmUuid(value) === value);
  return value;
}
function time(value: Date | string) {
  return utcIso(value instanceof Date ? value : new Date(value));
}
export function validateTree(tree: TestTree): void {
  invariant(Boolean(tree) && typeof tree === 'object' && !Array.isArray(tree));
  invariant(
    Object.keys(tree).length === 8 &&
      Object.keys(tree).every((key) => ['id', 'zone_id', 'tree_code', ...TREE_FIELDS].includes(key)),
  );
  id(tree.id);
  id(tree.zone_id);
  invariant(tree.tree_code === `DRN-${tree.id}`);
  farmInput(CreateTreeDto, {
    zone_id: tree.zone_id,
    ...Object.fromEntries(TREE_FIELDS.map((key) => [key, tree[key]])),
  } as CreateTreeDto);
  invariant(time(tree.plant_date) === tree.plant_date);
}
export function mapTree(row: TreeRow): TreeSnapshot {
  try {
    const tree: TestTree = {
      id: row.id,
      zone_id: row.zone_id,
      tree_code: row.tree_code,
      variety: row.variety,
      plant_date: time(row.plant_date),
      longitude: decimalNumber(row.longitude),
      latitude: decimalNumber(row.latitude),
      status: row.status,
    };
    validateTree(tree);
    invariant(row.entity_version !== null);
    const version = safeInteger(row.entity_version);
    invariant(version >= 1);
    return { tree, version };
  } catch {
    throw new Error('Invalid persisted Tree record');
  }
}
export function treeRequestPayload(value: TreeChangeRequest): TreeRequestRow['payload'] {
  const { zone_id, farm_id, owner_id, proposed_changes, tree_snapshot, rejection_reason } = value;
  return { zone_id, farm_id, owner_id, proposed_changes, tree_snapshot, rejection_reason };
}
export function mapTreeRequest(row: TreeRequestRow): { value: TreeChangeRequest; version: number | null } {
  try {
    invariant(
      ['Create', 'Update'].includes(row.action) && ['Pending', 'Accepted', 'Rejected'].includes(row.status),
    );
    const p = row.payload,
      keys = ['zone_id', 'farm_id', 'owner_id', 'proposed_changes', 'tree_snapshot', 'rejection_reason'];
    invariant(
      Boolean(p) &&
        typeof p === 'object' &&
        Object.keys(p).length === 6 &&
        Object.keys(p).every((key) => keys.includes(key)),
    );
    const value: TreeChangeRequest = {
      ...structuredClone(p),
      id: id(row.id),
      action: row.action,
      status: row.status,
      tree_id: row.target_key === null ? null : id(row.target_key),
      proposed_by: id(row.requested_by),
      created_at: time(row.created_at),
      resolved_at: row.resolved_at === null ? null : time(row.resolved_at),
      resolved_by: row.resolved_by === null ? null : id(row.resolved_by),
    };
    id(value.zone_id);
    id(value.farm_id);
    id(value.owner_id);
    const changes = value.proposed_changes;
    invariant(
      Boolean(changes) &&
        typeof changes === 'object' &&
        !Array.isArray(changes) &&
        Object.keys(changes).every((key) => (TREE_FIELDS as readonly string[]).includes(key)),
    );
    if (changes.plant_date !== undefined) {
      invariant(time(changes.plant_date) === changes.plant_date);
    }
    const version = row.expected_version === null ? null : safeInteger(row.expected_version);
    if (value.action === 'Create') {
      farmInput(CreateTreeDto, { ...changes, zone_id: value.zone_id } as CreateTreeDto);
      invariant(changes.status !== undefined);
      invariant(
        version === null &&
          value.tree_snapshot === null &&
          (value.status === 'Accepted') === (value.tree_id !== null),
      );
    } else {
      farmInput(UpdateTreeDto, changes);
      invariant(
        Object.keys(changes).length > 0 &&
          version !== null &&
          version >= 1 &&
          value.tree_id !== null &&
          value.tree_snapshot !== null,
      );
      validateTree(value.tree_snapshot);
      invariant(value.tree_snapshot.id === value.tree_id && value.tree_snapshot.zone_id === value.zone_id);
    }
    if (value.status === 'Pending') {
      invariant(value.resolved_by === null && value.resolved_at === null && value.rejection_reason === null);
    } else {
      invariant(value.resolved_by === value.owner_id && value.resolved_at !== null);
      if (value.status === 'Accepted') {
        invariant(value.rejection_reason === null);
      } else if (value.rejection_reason !== null) {
        farmInput(RejectFarmRequestDto, { reason: value.rejection_reason });
      }
    }
    return { value, version };
  } catch {
    throw new Error('Invalid persisted Tree workflow');
  }
}
export function mapTreeHistory(row: TreeHistoryRow): TreeMetadataHistory {
  try {
    invariant(['TreeCreated', 'TreeUpdated'].includes(row.action));
    const p = row.payload,
      keys = ['proposed_by', 'request_id', 'version', 'before', 'after'];
    invariant(
      Boolean(p) &&
        typeof p === 'object' &&
        Object.keys(p).length === 5 &&
        Object.keys(p).every((key) => keys.includes(key)),
    );
    const version = safeInteger(p.version);
    invariant(version >= 1);
    validateTree(p.after);
    invariant(p.after.id === id(row.entity_key));
    if (row.action === 'TreeCreated') {
      invariant(p.before === null && version === 1);
    } else {
      invariant(p.before !== null && version >= 2);
      validateTree(p.before);
      invariant(
        p.before.id === p.after.id &&
          p.before.zone_id === p.after.zone_id &&
          p.before.tree_code === p.after.tree_code,
      );
    }
    invariant((p.proposed_by === null) === (p.request_id === null));
    if (p.proposed_by !== null) {
      id(p.proposed_by);
      id(p.request_id!);
    }
    return {
      id: id(row.id),
      tree_id: row.entity_key,
      action: row.action === 'TreeCreated' ? 'Create' : 'Update',
      actor_id: id(row.actor_id),
      changed_at: time(row.changed_at),
      ...structuredClone(p),
      version,
    };
  } catch {
    throw new Error('Invalid persisted Tree history');
  }
}
export function treeChanges(input: Partial<TreeDetails>): Partial<TreeDetails> {
  return Object.fromEntries(
    TREE_FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]),
  );
}
