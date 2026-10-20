import { ActuatorTasksService } from './actuator-tasks.service';
import { TaskPageDto } from './actuator-tasks.dto';
import { ControlOperation } from './actuator-tasks.types';
import { BrokerState } from '../mqtt/mqtt.transport';
import { Inject, Injectable } from '@nestjs/common';

export abstract class ActuatorTaskRecords {
  abstract command(actor: string, device: string, operation: ControlOperation): Promise<ReturnType<ActuatorTasksService['command']>>;
  abstract get(actor: string, id: string): Promise<ReturnType<ActuatorTasksService['get']>>;
  abstract list(actor: string, device: string, page: TaskPageDto): Promise<Omit<ReturnType<ActuatorTasksService['list']>, 'storage'> & {
    storage: { mode: 'Memory' | 'MongoDB'; capacity_tasks: number; eviction: 'OldestTerminal' };
  }>;
  abstract state(actor: string, device: string): Promise<ReturnType<ActuatorTasksService['state']>>;
  // Synchronous RAM callbacks remain synchronous for the existing receiver;
  // the database adapter commits receipts before advancing to another step.
  abstract receiveAck(device: string, id: number, action: 0 | 1, now?: number): string | null | Promise<string | null>;
  abstract brokerChanged(state: BrokerState): void | Promise<void>;
}
@Injectable()
export class MemoryActuatorTaskRecords extends ActuatorTaskRecords {
  constructor(@Inject(ActuatorTasksService) private readonly tasks: ActuatorTasksService) { super(); }
  async command(actor: string, device: string, operation: ControlOperation) { return this.tasks.command(actor, device, operation); }
  async get(actor: string, id: string) { return this.tasks.get(actor, id); }
  async list(actor: string, device: string, page: TaskPageDto) { return this.tasks.list(actor, device, page); }
  async state(actor: string, device: string) { return this.tasks.state(actor, device); }
  receiveAck(device: string, id: number, action: 0 | 1, now?: number) { return this.tasks.receiveAck(device, id, action, now); }
  brokerChanged(state: BrokerState) { this.tasks.brokerChanged(state); }
}
