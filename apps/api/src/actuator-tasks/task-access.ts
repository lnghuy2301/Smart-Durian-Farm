import { ControlOperation } from './actuator-tasks.types';
export interface TaskScope { stationId: string; from: number; to: number }
export abstract class TaskAccess {
  abstract claim(onLost: () => void): Promise<() => Promise<void>>;
  abstract read<T>(actor: string, device: string, work: (scope: TaskScope) => Promise<T>): Promise<T>;
  abstract control<T>(actor: string, device: string, operation: ControlOperation, work: (scope: TaskScope) => Promise<T>): Promise<T>;
  abstract off<T>(device: string, work: (scope: TaskScope) => Promise<T>): Promise<T>;
}
