import { ObjectId } from 'mongodb';
import { ActuatorTask } from '../actuator-tasks/actuator-tasks.types';
import { utcIso } from './mappers';

export function taskInvariant(value: unknown): asserts value {
  if (!value) throw new Error('Invalid persisted actuator task state');
}
function keys(value: object, expected: string[]) {
  taskInvariant(value && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)));
}
function iso(value: string | null) {
  taskInvariant(value === null || typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
}
function id(value: string | null) { taskInvariant(value === null || typeof value === 'string' && /^[0-9a-f]{24}$/.test(value)); }
function integer(value: number) { taskInvariant(typeof value === 'number' && Number.isSafeInteger(value) && value > 0); }
export function validateTask(task: ActuatorTask): void {
  keys(task, ['_id', 'device_id', 'command_id', 'targets', 'tasking_parameters', 'status', 'created_at', 'sent_at', 'confirmed_at', 'error_message', 'response_payload']);
  id(task._id); taskInvariant(task._id !== null && typeof task.device_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(task.device_id));
  integer(task.command_id); iso(task.created_at); taskInvariant(task.created_at !== null); iso(task.sent_at); iso(task.confirmed_at);
  taskInvariant(['Pending', 'Confirmed', 'Failed'].includes(task.status));
  keys(task.tasking_parameters, ['actionType', 'action']);
  taskInvariant(task.tasking_parameters.actionType === 'control' && [0, 1].includes(task.tasking_parameters.action));
  const payload = task.response_payload;
  keys(payload, ['operation', 'confirmation_kind', 'parent_task_id', 'reset_task_id', 'recovery_task_id', 'steps']);
  taskInvariant(['Watering', 'Spraying', 'Stop', 'Reset', 'RecoveryStop'].includes(payload.operation) && payload.confirmation_kind === 'CommandReceipt');
  for (const link of [payload.parent_task_id, payload.reset_task_id, payload.recovery_task_id]) { id(link); taskInvariant(link !== task._id); }
  taskInvariant((payload.operation === 'Reset' || payload.operation === 'RecoveryStop') === (payload.parent_task_id !== null));
  const action = payload.operation === 'Watering' || payload.operation === 'Spraying' ? 1 : 0;
  // Order is semantic (valve→pump ON, pump→valves OFF), not fixed numeric IDs.
  // PG authority resolved roles before creation; retain historical capabilities
  // without interpreting them using today's metadata or rewriting old receipts.
  const lengths = payload.operation === 'Watering' || payload.operation === 'Spraying' ? [2] : payload.operation === 'Stop' ? [2, 3] : [3];
  taskInvariant(Array.isArray(payload.steps) && lengths.includes(payload.steps.length)
    && new Set(payload.steps.map((step) => step.tasking_capability_id)).size === payload.steps.length);
  taskInvariant(task.tasking_parameters.action === action && Array.isArray(task.targets) && task.targets.length === payload.steps.length);
  const ids = new Set([task.command_id]);
  payload.steps.forEach((step, index) => {
    keys(step, ['task_id', 'tasking_capability_id', 'action', 'status', 'sent_at', 'ack_received_at', 'ack']);
    integer(step.task_id); integer(step.tasking_capability_id); taskInvariant(!ids.has(step.task_id)); ids.add(step.task_id);
    taskInvariant(step.action === action && ['Queued', 'WaitingAck', 'Acknowledged', 'Failed', 'Cancelled'].includes(step.status));
    iso(step.sent_at); iso(step.ack_received_at);
    keys(task.targets[index], ['task_id', 'tasking_capability_id']);
    taskInvariant(task.targets[index].task_id === step.task_id && task.targets[index].tasking_capability_id === step.tasking_capability_id);
    if (step.ack !== null) {
      keys(step.ack, ['taskId', 'status', 'action']);
      taskInvariant(step.ack.taskId === step.task_id && step.ack.status === 'ACK' && step.ack.action === action && step.ack_received_at !== null);
    } else taskInvariant(step.ack_received_at === null);
    if (step.status === 'Queued' || step.status === 'Cancelled') taskInvariant(step.sent_at === null && step.ack === null);
    else taskInvariant(step.sent_at !== null);
    if (step.status === 'Acknowledged') taskInvariant(step.ack !== null);
  });
  taskInvariant(task.sent_at === payload.steps[0].sent_at);
  const sequence = payload.steps.map((step) => ({ Acknowledged: 'A', WaitingAck: 'W', Queued: 'Q', Failed: 'F', Cancelled: 'C' })[step.status]).join('');
  if (task.status === 'Pending') taskInvariant(/^A*W?Q*$/.test(sequence) && /[WQ]/.test(sequence));
  if (task.status === 'Failed') taskInvariant(/^A*F?C*$/.test(sequence));
  if (task.status === 'Confirmed') taskInvariant(task.error_message === null && task.confirmed_at !== null &&
    payload.steps.every((step) => step.status === 'Acknowledged') && task.confirmed_at === payload.steps.at(-1)!.ack_received_at);
  else taskInvariant(task.confirmed_at === null);
  if (task.status === 'Failed') taskInvariant(typeof task.error_message === 'string' && /^[A-Z_]{1,64}$/.test(task.error_message)
    && payload.steps.every((step) => ['Acknowledged', 'Failed', 'Cancelled'].includes(step.status)));
  else taskInvariant(task.error_message === null);
}
// Nested control timestamps/links have explicit mappings; never normalize ACKs
// or carry arbitrary provider payloads into the public receipt history.
export interface TaskDocument { _id: ObjectId; [key: string]: unknown }
export function taskDocument(task: ActuatorTask): TaskDocument {
  validateTask(task);
  const date = (value: string | null) => value === null ? null : new Date(value);
  const link = (value: string | null) => value === null ? null : new ObjectId(value);
  return { ...structuredClone(task), _id: new ObjectId(task._id), created_at: date(task.created_at),
    sent_at: date(task.sent_at), confirmed_at: date(task.confirmed_at), response_payload: {
      ...structuredClone(task.response_payload), parent_task_id: link(task.response_payload.parent_task_id),
      reset_task_id: link(task.response_payload.reset_task_id), recovery_task_id: link(task.response_payload.recovery_task_id),
      steps: task.response_payload.steps.map((step) => ({ ...structuredClone(step), sent_at: date(step.sent_at), ack_received_at: date(step.ack_received_at) })),
    } };
}
export function mapTask(row: TaskDocument): ActuatorTask {
  taskInvariant(row._id instanceof ObjectId);
  const wire = { ...row, _id: row._id.toHexString() } as unknown as ActuatorTask;
  wire.created_at = utcIso(row.created_at as Date);
  wire.sent_at = row.sent_at === null ? null : utcIso(row.sent_at as Date);
  wire.confirmed_at = row.confirmed_at === null ? null : utcIso(row.confirmed_at as Date);
  const payload = row.response_payload as ActuatorTask['response_payload'];
  const link = (value: unknown) => { if (value === null) return null; taskInvariant(value instanceof ObjectId); return value.toHexString(); };
  wire.response_payload = { ...payload, parent_task_id: link(payload.parent_task_id), reset_task_id: link(payload.reset_task_id), recovery_task_id: link(payload.recovery_task_id),
    steps: payload.steps.map((step) => ({ ...step, sent_at: step.sent_at === null ? null : utcIso(step.sent_at as unknown as Date),
      ack_received_at: step.ack_received_at === null ? null : utcIso(step.ack_received_at as unknown as Date) })) };
  validateTask(wire);
  return wire;
}
