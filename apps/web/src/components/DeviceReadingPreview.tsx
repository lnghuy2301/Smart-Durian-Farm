import { useCallback } from "react";
import "./DeviceReadingPreview.css";
import { useSession } from "../auth/session";
import { useResource } from "../hooks/useResource";
import { dateTime, number } from "./ui";
import type { TelemetryPage } from "../types/api";

// A measurement and a station's last signal are different facts. Read the
// authorized telemetry endpoint, never substitute another station's reading.
export function DeviceReadingPreview({ deviceId }: { deviceId: string }) {
  const { api } = useSession();
  const path = `telemetry/devices/${deviceId}/latest?limit=1&offset=0`;
  const load = useCallback(
    (signal: AbortSignal) => api.request<TelemetryPage>(path, { signal }),
    [api, path],
  );
  const resource = useResource(path, load);
  if (resource.loading) return <small>Đang tải số đo…</small>;
  if (resource.error)
    return (
      <span>
        <small>Chưa tải được số đo.</small>
        <button className="button secondary" onClick={resource.reload}>
          Thử lại số đo
        </button>
      </span>
    );
  const reading = resource.data?.items.find(
    (item) => item.device_id === deviceId,
  );
  return reading ? (
    <span className="device-reading-preview">
      <strong>
        {number(reading.value)} {reading.unit}
      </strong>
      <small>Nhận lúc {dateTime(reading.received_at)}</small>
    </span>
  ) : (
    <small>Chưa có số đo</small>
  );
}
