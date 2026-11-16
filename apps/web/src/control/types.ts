import type { Actuator, Device, Page } from "../types/api";

export type ControlOperation = "Watering" | "Spraying" | "Stop";
export type TaskOperation = ControlOperation | "Reset" | "RecoveryStop";
export type TaskStatus = "Pending" | "Confirmed" | "Failed";
export interface ControlStep {
  task_id: number;
  tasking_capability_id: number;
  action: 0 | 1;
  status: "Queued" | "WaitingAck" | "Acknowledged" | "Failed" | "Cancelled";
  sent_at: string | null;
  ack_received_at: string | null;
  ack: { taskId: number; status: "ACK"; action: 0 | 1 } | null;
}
export interface ControlTask {
  _id: string;
  device_id: string;
  command_id: number;
  targets: { task_id: number; tasking_capability_id: number }[];
  tasking_parameters: { actionType: "control"; action: 0 | 1 };
  status: TaskStatus;
  created_at: string;
  sent_at: string | null;
  confirmed_at: string | null;
  error_message: string | null;
  response_payload: {
    operation: TaskOperation;
    confirmation_kind: "CommandReceipt";
    parent_task_id: string | null;
    reset_task_id: string | null;
    recovery_task_id: string | null;
    steps: ControlStep[];
  };
}
export interface ControlState {
  device_id: string;
  acknowledged_mode: "Unknown" | "Off" | "Watering" | "Spraying";
  physical_state: "Unknown";
  confirmation_kind: "CommandReceipt";
  busy: boolean;
  active_task_id: string | null;
  reset_required: boolean;
  broker_ready: boolean;
  ack_timeout_ms: number;
}
export interface AcceptedControl {
  task: ControlTask;
  status_url: string;
  state_url: string;
}
export interface ControlSnapshot {
  state: ControlState;
  device: Device;
  actuators: Actuator[];
  active?: ControlTask;
}
export interface TaskSnapshot {
  page: Page<ControlTask>;
  root?: ControlTask;
  linked: ControlTask[];
}
export const operationNames: Record<TaskOperation, string> = {
  Watering: "Tưới nước",
  Spraying: "Phun thuốc",
  Stop: "Dừng",
  Reset: "Chuẩn bị trước khi bật",
  RecoveryStop: "Dừng phục hồi",
};
export const taskStatusNames: Record<TaskStatus, string> = {
  Pending: "Đang chờ phản hồi",
  Confirmed: "Đã nhận đủ ACK",
  Failed: "Lệnh chưa hoàn tất",
};
export const modeNames: Record<ControlState["acknowledged_mode"], string> = {
  Unknown: "Chưa xác định",
  Off: "Đã nhận đủ lệnh dừng",
  Watering: "Đã nhận đủ lệnh tưới",
  Spraying: "Đã nhận đủ lệnh phun",
};
