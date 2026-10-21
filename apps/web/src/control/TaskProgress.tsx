import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Clock3, XCircle } from "lucide-react";
import { Notice } from "../components/ui";
import type { Actuator } from "../types/api";
import {
  operationNames,
  taskStatusNames,
  type ControlStep,
  type ControlTask,
} from "./types";

export const controlTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date(value))
    : "Chưa có";
const failures: Record<string, string> = {
  ACK_TIMEOUT: "Thiết bị chưa phản hồi trong thời hạn của bước này.",
  RESET_FAILED:
    "Chưa hoàn tất chuẩn bị thiết bị; lệnh bật chưa được thực hiện đầy đủ.",
  MQTT_DISCONNECTED:
    "Kênh kết nối bị gián đoạn. Trạng thái thực tế chưa xác định.",
  MQTT_PUBLISH_FAILED: "Chưa gửi được lệnh qua kênh kết nối.",
  MQTT_UNAVAILABLE: "Kênh kết nối chưa sẵn sàng để gửi lệnh.",
  CONTEXT_UNAVAILABLE: "Quyền hoặc cấu hình thiết bị đã thay đổi.",
  CANCELLED_BY_STOP: "Lệnh đã được ngắt để chuyển sang Dừng.",
  BACKEND_SHUTDOWN: "Máy chủ đã khởi động lại trong khi xử lý lệnh.",
};
export function TaskBadge({ task }: { task: ControlTask }) {
  return (
    <span className={`control-task-badge control-${task.status.toLowerCase()}`}>
      {task.status === "Confirmed" ? (
        <CheckCircle2 size={16} />
      ) : task.status === "Failed" ? (
        <XCircle size={16} />
      ) : (
        <Clock3 size={16} />
      )}
      {taskStatusNames[task.status]}
    </span>
  );
}
function StepWaiting({
  step,
  timeout,
}: {
  step: ControlStep;
  timeout: number;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (step.status !== "WaitingAck") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [step.status]);
  if (step.status !== "WaitingAck" || !step.sent_at) return null;
  const seconds = Math.ceil(
    Math.max(0, Date.parse(step.sent_at) + timeout - now) / 1000,
  );
  return (
    <small className="control-wait" aria-live="off">
      {seconds > 0
        ? `Chờ phản hồi · còn khoảng ${seconds} giây`
        : "Đang kiểm tra phản hồi từ máy chủ…"}
    </small>
  );
}
const stepNames: Record<ControlStep["status"], string> = {
  Queued: "Chưa gửi",
  WaitingAck: "Đang chờ phản hồi",
  Acknowledged: "Đã nhận ACK",
  Failed: "Chưa hoàn tất",
  Cancelled: "Không gửi tiếp",
};
export function TaskProgress({
  task,
  timeout,
  actuators = [],
}: {
  task: ControlTask;
  timeout: number;
  actuators?: Actuator[];
}) {
  return (
    <article
      className="control-task"
      aria-label={`Tiến trình ${operationNames[task.response_payload.operation]}`}
    >
      <div className="control-section-title">
        <h3>{operationNames[task.response_payload.operation]}</h3>
        <TaskBadge task={task} />
      </div>
      <p className="muted">Tạo lúc {controlTime(task.created_at)}</p>
      {task.error_message && (
        <Notice kind="warning">
          {failures[task.error_message] ??
            "Lệnh gặp lỗi. Kiểm tra tiến trình và kết nối trước khi thao tác tiếp."}
        </Notice>
      )}
      <ol className="control-steps">
        {task.response_payload.steps.map((step, index) => {
          const actuator = actuators.find(
            (item) => item.capability_id === step.tasking_capability_id,
          );
          const target = actuator
            ? {
                shared: "bơm chung",
                watering: "van tưới",
                spraying: "van phun",
              }[actuator.purpose]
            : `thiết bị ${step.tasking_capability_id}`;
          const Icon =
            step.status === "Acknowledged"
              ? CheckCircle2
              : step.status === "Failed" || step.status === "Cancelled"
                ? XCircle
                : step.status === "WaitingAck"
                  ? Clock3
                  : Circle;
          return (
            <li
              key={step.task_id}
              className={`control-step control-step-${step.status.toLowerCase()}`}
            >
              <span className="control-step-number">{index + 1}</span>
              <div>
                <strong>
                  {step.action === 1 ? "Bật" : "Tắt"} {target}
                </strong>
                <span className="control-step-status">
                  <Icon size={16} />
                  {stepNames[step.status]}
                </span>
                <StepWaiting step={step} timeout={timeout} />
                <small>Gửi: {controlTime(step.sent_at)}</small>
                {step.ack_received_at && (
                  <small>Nhận ACK: {controlTime(step.ack_received_at)}</small>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <details className="control-technical">
        <summary>Mã lệnh và thời điểm</summary>
        <dl className="details">
          <div>
            <dt>Mã lệnh</dt>
            <dd>{task._id}</dd>
          </div>
          <div>
            <dt>Bắt đầu gửi</dt>
            <dd>{controlTime(task.sent_at)}</dd>
          </div>
          <div>
            <dt>Nhận đủ ACK</dt>
            <dd>{controlTime(task.confirmed_at)}</dd>
          </div>
          {task.error_message && (
            <div>
              <dt>Mã lỗi</dt>
              <dd>{task.error_message}</dd>
            </div>
          )}
        </dl>
      </details>
    </article>
  );
}
