import { ObjectId } from 'mongodb';
import { ConflictException } from '@nestjs/common';
import { ActuatorTask, AcknowledgedMode, TaskOperation, TaskStep } from './actuator-tasks.types';

export interface ControlRecipe { shared: number; watering: number; spraying: number }
export function resolveControlRecipe(relays: readonly { capability_id: number; purpose: string }[]): ControlRecipe {
  const recipe = {} as ControlRecipe;
  // Firmware capability numbers carry no business meaning. Include Inactive
  // metadata too: disabling a duplicate must not silently select another relay.
  for (const purpose of ['shared', 'watering', 'spraying'] as const) {
    const matches = relays.filter((relay) => relay.purpose === purpose);
    if (matches.length !== 1) throw new ConflictException('Trạm cần đúng một bơm shared, một van watering và một van spraying');
    recipe[purpose] = matches[0].capability_id;
  }
  if (new Set(Object.values(recipe)).size !== 3) throw new ConflictException('Các vai trò phải dùng capability khác nhau');
  return recipe;
}
export function startCapabilities(recipe: ControlRecipe, operation: 'Watering' | 'Spraying'): number[] {
  return [recipe[operation === 'Watering' ? 'watering' : 'spraying'], recipe.shared];
}
export function stopCapabilities(recipe: ControlRecipe, mode: AcknowledgedMode): number[] {
  return mode === 'Watering' ? [recipe.shared, recipe.watering] : mode === 'Spraying' ? [recipe.shared, recipe.spraying]
    : [recipe.shared, recipe.watering, recipe.spraying];
}
export function requireActiveCapabilities(capabilities: number[], active: readonly number[]): void {
  if (!capabilities.every((capability) => active.includes(capability))) {
    throw new ConflictException('Actuator nhận lệnh phải Active, kể cả lệnh OFF');
  }
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
