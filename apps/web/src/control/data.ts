import { ApiClient, ApiError, queryString } from "../api/client";
import { collectPages } from "../api/collection";
import type { Actuator, Device, Page } from "../types/api";
import type {
  ControlSnapshot,
  ControlState,
  ControlTask,
  TaskSnapshot,
} from "./types";

export const coreInterval = (data: ControlSnapshot) =>
  data.state.busy ? 1000 : 5000;
export const taskInterval = (data: TaskSnapshot) =>
  [data.root, ...data.linked].some((task) => task?.status === "Pending")
    ? 1000
    : 5000;
export const readingInterval = () => 15000;
export function scopedTask(task: ControlTask, deviceId: string) {
  if (task.device_id !== deviceId)
    throw new ApiError(
      502,
      "Phản hồi lệnh không thuộc trạm đang chọn. Hãy kiểm tra lại.",
    );
  return task;
}
export async function loadControl(
  api: ApiClient,
  deviceId: string,
  signal: AbortSignal,
): Promise<ControlSnapshot> {
  const [state, device, actuators] = await Promise.all([
    api.request<ControlState>(`actuator-tasks/devices/${deviceId}/state`, {
      signal,
    }),
    api.request<Device>(`devices/${deviceId}`, { signal }),
    collectPages<Actuator>(
      (offset) =>
        api.request<Page<Actuator>>(
          `actuators${queryString({ device_id: deviceId, limit: 100, offset })}`,
          { signal },
        ),
      (item) => item.id,
    ),
  ]);
  if (state.device_id !== deviceId || device.id !== deviceId)
    throw new ApiError(502, "Trạng thái không thuộc trạm đang chọn.");
  const active = state.active_task_id
    ? scopedTask(
        await api.request<ControlTask>(
          `actuator-tasks/${state.active_task_id}`,
          { signal },
        ),
        deviceId,
      )
    : undefined;
  return { state, device, actuators, active };
}
export async function loadTasks(
  api: ApiClient,
  deviceId: string,
  focusId: string,
  offset: number,
  status: string,
  signal: AbortSignal,
): Promise<TaskSnapshot> {
  const page = await api.request<Page<ControlTask>>(
    `actuator-tasks/devices/${deviceId}${queryString({ limit: 20, offset, status })}`,
    { signal },
  );
  for (const task of page.items) scopedTask(task, deviceId);
  async function get(id: string) {
    // Refresh selected and linked tasks even when already present on the list page.
    const task = scopedTask(
      await api.request<ControlTask>(`actuator-tasks/${id}`, { signal }),
      deviceId,
    );
    return task;
  }
  const chosen = focusId || page.items[0]?._id;
  if (!chosen) return { page, linked: [] };
  let root = await get(chosen);
  if (root.response_payload.parent_task_id)
    root = await get(root.response_payload.parent_task_id);
  const linked = await Promise.all(
    [
      root.response_payload.reset_task_id,
      root.response_payload.recovery_task_id,
    ]
      .filter((id): id is string => !!id && id !== root._id)
      .map(get),
  );
  return { page, root, linked };
}
export function recipeReady(actuators: Actuator[]) {
  return [
    [2, "shared"],
    [3, "watering"],
    [4, "spraying"],
  ].every(([id, purpose]) =>
    actuators.some(
      (item) => item.capability_id === id && item.purpose === purpose,
    ),
  );
}
export function startMetadataReady(
  data: ControlSnapshot,
  operation: "Watering" | "Spraying",
) {
  return (
    data.device.status === "Active" &&
    recipeReady(data.actuators) &&
    [2, operation === "Watering" ? 3 : 4].every((id) =>
      data.actuators.some(
        (item) => item.capability_id === id && item.status === "Active",
      ),
    )
  );
}
