import {
  TestActuator,
  ActuatorDetails,
  ActuatorCreationDetails,
  ActuatorChangeRequest,
  ActuatorMetadataHistory,
} from '../actuators/actuators.types';
import { CreateActuatorDto, UpdateActuatorDto } from '../actuators/actuators.dto';
import { RejectFarmRequestDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { safeInteger, utcIso } from './mappers';

export const ACTUATOR_FIELDS = ['name', 'status'] as const;
export interface ActuatorRow extends Omit<TestActuator, 'capability_id'> {
  capability_id: string | number;
  entity_version: string | null;
}
export interface ActuatorSnapshot {
  actuator: TestActuator;
  version: number;
}
export interface ActuatorRequestRow {
  id: string;
  action: ActuatorChangeRequest['action'];
  status: ActuatorChangeRequest['status'];
  target_key: string | null;
  requested_by: string;
  expected_version: string | null;
  request_version: string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  payload: Pick<
    ActuatorChangeRequest,
    | 'device_id'
    | 'zone_id'
    | 'farm_id'
    | 'owner_id'
    | 'proposed_changes'
    | 'actuator_snapshot'
    | 'rejection_reason'
  >;
}
export interface ActuatorHistoryRow {
  id: string;
  entity_key: string;
  actor_id: string;
  action: 'ActuatorCreated' | 'ActuatorUpdated';
  changed_at: Date | string;
  payload: Pick<ActuatorMetadataHistory, 'proposed_by' | 'request_id' | 'version' | 'before' | 'after'>;
}
function invariant(value: boolean): asserts value {
  if (!value) {
    throw new Error('Invalid persisted Actuator state');
  }
}
function id(value: string) {
  invariant(farmUuid(value) === value);
  return value;
}
function time(value: Date | string) {
  return utcIso(value instanceof Date ? value : new Date(value));
}
export function validateActuator(actuator: TestActuator): void {
  invariant(Boolean(actuator) && typeof actuator === 'object' && !Array.isArray(actuator));
  invariant(
    Object.keys(actuator).length === 6 &&
      Object.keys(actuator).every((key) =>
        ['id', 'device_id', 'purpose', 'capability_id', ...ACTUATOR_FIELDS].includes(key),
      ),
  );
  id(actuator.id);
  id(actuator.device_id);
  invariant(typeof actuator.name === 'string' && actuator.name.trim() === actuator.name);
  farmInput(CreateActuatorDto, {
    device_id: actuator.device_id,
    purpose: actuator.purpose,
    capability_id: actuator.capability_id,
    ...Object.fromEntries(ACTUATOR_FIELDS.map((key) => [key, actuator[key]])),
  } as CreateActuatorDto);
}
export function mapActuator(row: ActuatorRow): ActuatorSnapshot {
  try {
    const actuator: TestActuator = {
      id: row.id,
      device_id: row.device_id,
      purpose: row.purpose,
      capability_id: safeInteger(row.capability_id),
      name: row.name,
      status: row.status,
    };
    validateActuator(actuator);
    invariant(row.entity_version !== null);
    const version = safeInteger(row.entity_version);
    invariant(version >= 1);
    return { actuator, version };
  } catch {
    throw new Error('Invalid persisted Actuator record');
  }
}
export function actuatorRequestPayload(value: ActuatorChangeRequest): ActuatorRequestRow['payload'] {
  const { device_id, zone_id, farm_id, owner_id, proposed_changes, actuator_snapshot, rejection_reason } =
    value;
  return { device_id, zone_id, farm_id, owner_id, proposed_changes, actuator_snapshot, rejection_reason };
}
export function mapActuatorRequest(row: ActuatorRequestRow): {
  value: ActuatorChangeRequest;
  version: number | null;
  requestVersion: number;
} {
  try {
    invariant(
      ['Create', 'Update'].includes(row.action) && ['Pending', 'Accepted', 'Rejected'].includes(row.status),
    );
    const p = row.payload,
      keys = [
        'device_id',
        'zone_id',
        'farm_id',
        'owner_id',
        'proposed_changes',
        'actuator_snapshot',
        'rejection_reason',
      ];
    invariant(
      Boolean(p) &&
        typeof p === 'object' &&
        Object.keys(p).length === 7 &&
        Object.keys(p).every((key) => keys.includes(key)),
    );
    const value: ActuatorChangeRequest = {
      ...structuredClone(p),
      id: id(row.id),
      action: row.action,
      status: row.status,
      actuator_id: row.target_key === null ? null : id(row.target_key),
      proposed_by: id(row.requested_by),
      created_at: time(row.created_at),
      resolved_at: row.resolved_at === null ? null : time(row.resolved_at),
      resolved_by: row.resolved_by === null ? null : id(row.resolved_by),
    };
    id(value.zone_id);
    id(value.device_id);
    id(value.farm_id);
    id(value.owner_id);
    const changes = value.proposed_changes;
    invariant(
      Boolean(changes) &&
        typeof changes === 'object' &&
        !Array.isArray(changes) &&
        Object.keys(changes).every((key) =>
          [...ACTUATOR_FIELDS, ...(value.action === 'Create' ? ['purpose', 'capability_id'] : [])].includes(
            key,
          ),
        ),
    );
    invariant(row.request_version !== null);
    const requestVersion = safeInteger(row.request_version);
    invariant(requestVersion >= 1);
    const version = row.expected_version === null ? null : safeInteger(row.expected_version);
    if (value.action === 'Create') {
      farmInput(CreateActuatorDto, { ...changes, device_id: value.device_id } as CreateActuatorDto);
      invariant(changes.status !== undefined);
      invariant(
        version === null &&
          value.actuator_snapshot === null &&
          (value.status === 'Accepted') === (value.actuator_id !== null),
      );
    } else {
      farmInput(UpdateActuatorDto, changes);
      invariant(
        Object.keys(changes).length > 0 &&
          version !== null &&
          version >= 1 &&
          value.actuator_id !== null &&
          value.actuator_snapshot !== null,
      );
      validateActuator(value.actuator_snapshot);
      invariant(
        value.actuator_snapshot.id === value.actuator_id &&
          value.actuator_snapshot.device_id === value.device_id,
      );
      invariant(
        Object.entries(changes).some(
          ([key, value]) => value !== row.payload.actuator_snapshot![key as keyof ActuatorDetails],
        ),
      );
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
    return { value, version, requestVersion };
  } catch {
    throw new Error('Invalid persisted Actuator workflow');
  }
}
export function mapActuatorHistory(row: ActuatorHistoryRow): ActuatorMetadataHistory {
  try {
    invariant(['ActuatorCreated', 'ActuatorUpdated'].includes(row.action));
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
    validateActuator(p.after);
    invariant(p.after.id === id(row.entity_key));
    if (row.action === 'ActuatorCreated') {
      invariant(p.before === null && version === 1);
    } else {
      invariant(p.before !== null && version >= 2);
      validateActuator(p.before);
      invariant(
        p.before.id === p.after.id &&
          p.before.device_id === p.after.device_id &&
          p.before.purpose === p.after.purpose &&
          p.before.capability_id === p.after.capability_id,
      );
    }
    invariant((p.proposed_by === null) === (p.request_id === null));
    if (p.proposed_by !== null) {
      id(p.proposed_by);
      id(p.request_id!);
    }
    return {
      id: id(row.id),
      actuator_id: row.entity_key,
      action: row.action === 'ActuatorCreated' ? 'Create' : 'Update',
      actor_id: id(row.actor_id),
      changed_at: time(row.changed_at),
      ...structuredClone(p),
      version,
    };
  } catch {
    throw new Error('Invalid persisted Actuator history');
  }
}
export function actuatorChanges(input: Partial<ActuatorCreationDetails>): Partial<ActuatorCreationDetails> {
  return Object.fromEntries(
    [...ACTUATOR_FIELDS, 'purpose' as const, 'capability_id' as const]
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
}
