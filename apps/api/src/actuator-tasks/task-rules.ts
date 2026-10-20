import { ObjectId } from 'mongodb';
import { ActuatorTask, AcknowledgedMode, TaskOperation, TaskStep } from './actuator-tasks.types';

export const CONTROL_RECIPE = [{ capability: 2, purpose: 'shared' }, { capability: 3, purpose: 'watering' }, { capability: 4, purpose: 'spraying' }] as const;
export function stopCapabilities(mode: AcknowledgedMode): number[] {
  return mode === 'Watering' ? [2, 3] : mode === 'Spraying' ? [2, 4] : [2, 3, 4];
}
export function markTaskFailed(task: ActuatorTask, code: string): void {
  if (task.status !== 'Pending') return;
  task.status = 'Failed'; task.error_message = code;
  for (const step of task.response_payload.steps) {
    if (step.status === 'WaitingAck') step.status = 'Failed';
    else if (step.status === 'Queued') step.status = 'Cancelled';
  }
}
export function createControlTask(deviceId: string, operation: TaskOperation, caps: number[], action: 0 | 1,
  allocate: () => number, now: string, parent: string | null = null): ActuatorTask {
  const steps: TaskStep[] = caps.map((id) => ({ task_id: allocate(), tasking_capability_id: id, action,
    status: 'Queued', sent_at: null, ack_received_at: null, ack: null }));
  return { _id: new ObjectId().toHexString(), device_id: deviceId, command_id: allocate(),
    targets: steps.map(({ task_id, tasking_capability_id }) => ({ task_id, tasking_capability_id })),
    tasking_parameters: { actionType: 'control', action }, status: 'Pending', created_at: now,
    sent_at: null, confirmed_at: null, error_message: null, response_payload: { operation, confirmation_kind: 'CommandReceipt',
      parent_task_id: parent, reset_task_id: null, recovery_task_id: null, steps } };
}
