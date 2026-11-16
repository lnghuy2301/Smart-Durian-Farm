import { ApiClient, ApiError } from "../api/client";
import { collectPages } from "../api/collection";
import type { Page } from "../types/api";
import type { ControlTask } from "./types";

export interface ControlJournalPrefill {
  zoneId: string;
  activity: "Watering" | "Spraying";
  duration?: number;
  note: string;
}

export function sessionJournalPrefill(
  stop: ControlTask,
  tasks: ControlTask[],
  zoneId: string,
): ControlJournalPrefill {
  if (
    stop.response_payload.operation !== "Stop" ||
    stop.status !== "Confirmed" ||
    !stop.confirmed_at
  )
    throw new Error("Chỉ gợi ý nhật ký sau lệnh Dừng đã nhận đủ ACK.");
  // Use command order, not arrival order. Reset/Recovery/failed Starts are not
  // evidence of a successful work session and must never become farm work logs.
  const previous = tasks
    .filter(
      (t) =>
        t.device_id === stop.device_id &&
        t.command_id < stop.command_id &&
        !t.response_payload.parent_task_id &&
        t.response_payload.operation !== "Reset",
    )
    .sort((a, b) => b.command_id - a.command_id)[0];
  const activity = previous?.response_payload.operation;
  if (
    !previous ||
    previous.status !== "Confirmed" ||
    !previous.confirmed_at ||
    (activity !== "Watering" && activity !== "Spraying")
  )
    throw new Error(
      "Không tìm thấy phiên Bật hoàn tất ngay trước lệnh Dừng. Hãy ghi nhật ký thủ công theo thực tế.",
    );
  const end =
    stop.response_payload.steps.find((s) => s.action === 0)?.sent_at ??
    stop.sent_at;
  const minutes = end
    ? (Date.parse(end) - Date.parse(previous.confirmed_at)) / 60000
    : NaN;
  return {
    zoneId,
    activity,
    ...(activity === "Watering" && minutes >= 0.001 && minutes <= 10080
      ? { duration: Number(minutes.toFixed(3)) }
      : {}),
    note: `Tham chiếu phiên điều khiển #${previous.command_id} → Dừng #${stop.command_id}. Thời điểm nhận đủ lệnh bật: ${new Date(previous.confirmed_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.${Number.isFinite(minutes) && minutes > 0 ? ` Thời lượng ước tính theo lệnh: ${minutes.toFixed(3)} phút.` : ""} Người ghi cần đối chiếu công việc thực tế; ACK chỉ xác nhận nhận lệnh.`,
  };
}

export async function loadSessionJournalPrefill(
  api: ApiClient,
  stopId: string,
  deviceId: string,
  zoneId: string,
  signal: AbortSignal,
) {
  const stop = await api.request<ControlTask>(`actuator-tasks/${stopId}`, {
    signal,
  });
  if (stop.device_id !== deviceId)
    throw new ApiError(502, "Phiên điều khiển không thuộc trạm đang chọn.");
  const tasks = await collectPages<ControlTask>(
    (offset) =>
      api.request<Page<ControlTask>>(
        `actuator-tasks/devices/${deviceId}?limit=100&offset=${offset}`,
        { signal },
      ),
    (t) => t._id,
  );
  if (tasks.some((t) => t.device_id !== deviceId))
    throw new ApiError(502, "Lịch sử lệnh không thuộc trạm đang chọn.");
  return sessionJournalPrefill(stop, tasks, zoneId);
}
