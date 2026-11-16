import { useCallback } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../auth/session";
import { collectPages } from "../api/collection";
import { queryString } from "../api/client";
import { DataState, dateTime, number } from "../components/ui";
import type {
  DevicePresence,
  Page,
  Sensor,
  TelemetryPage,
  TelemetryRecord,
} from "../types/api";
import { useControlPolling } from "./useControlPolling";
import { readingInterval } from "./data";

export function ControlReadings({
  deviceId,
  zoneId,
  onFailure,
}: {
  deviceId: string;
  zoneId: string;
  onFailure: (error: Error) => void;
}) {
  const { api } = useSession();
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [presence, sensors, readings] = await Promise.all([
        api.request<DevicePresence>(`mqtt/devices/${deviceId}/status`, {
          signal,
        }),
        collectPages<Sensor>(
          (offset) =>
            api.request<Page<Sensor>>(
              `sensors${queryString({ device_id: deviceId, limit: 100, offset })}`,
              { signal },
            ),
          (item) => item.id,
        ),
        collectPages<TelemetryRecord>(
          (offset) =>
            api.request<TelemetryPage>(
              `telemetry/devices/${deviceId}/latest${queryString({ limit: 100, offset })}`,
              { signal },
            ),
          (item) => item._id,
        ),
      ]);
      return { presence, sensors, readings };
    },
    [api, deviceId],
  );
  const resource = useControlPolling(
    deviceId,
    load,
    readingInterval,
    onFailure,
  );
  return (
    <section className="control-readings" aria-label="Số đo tham khảo">
      <div className="control-section-title">
        <h3>Tín hiệu và số đo gần nhất</h3>
        <Link to={`/iot?zone_id=${zoneId}`}>Xem giám sát IoT →</Link>
      </div>
      <DataState resource={resource}>
        {({ presence, sensors, readings }) => (
          <>
            <p className="muted">
              Kết nối trạm:{" "}
              <strong>
                {presence.connectivity === "Online"
                  ? "Có tín hiệu gần đây"
                  : presence.connectivity === "Offline"
                    ? "Mất tín hiệu"
                    : "Chưa xác định"}
              </strong>{" "}
              · Tín hiệu cuối: {dateTime(presence.last_seen_at)}
            </p>
            <div className="control-reading-grid">
              {sensors
                .filter((sensor) =>
                  ["air_temperature", "air_humidity", "soil_moisture"].includes(
                    sensor.sensor_type,
                  ),
                )
                .map((sensor) => {
                  const reading = readings.find(
                    (item) => item.data_stream_id === sensor.data_stream_id,
                  );
                  return (
                    <div key={sensor.id}>
                      <span>{sensor.name}</span>
                      <strong>
                        {reading
                          ? `${number(reading.value)} ${reading.unit}`
                          : "Chưa có số đo"}
                      </strong>
                      {reading && (
                        <small>Nhận: {dateTime(reading.received_at)}</small>
                      )}
                    </div>
                  );
                })}
            </div>
            {readings.length === 0 && (
              <p className="muted">
                Chưa có số đo cảm biến trong phạm vi truy cập.
              </p>
            )}
            <small>
              Số đo có thể đã cũ; không dùng để xác nhận bơm hay van đang
              bật/tắt.
            </small>
          </>
        )}
      </DataState>
    </section>
  );
}
