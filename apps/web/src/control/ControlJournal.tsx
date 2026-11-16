import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../auth/session";
import { useTask } from "../hooks/useTask";
import { Notice } from "../components/ui";
import { JournalEditor } from "../pages/Cultivation";
import {
  loadSessionJournalPrefill,
  type ControlJournalPrefill,
} from "./journal";
import type { ControlTask } from "./types";

export function ControlJournal({
  stop,
  zoneId,
}: {
  stop: ControlTask;
  zoneId: string;
}) {
  const { api, user } = useSession();
  const task = useTask();
  const [prefill, setPrefill] = useState<ControlJournalPrefill>();
  const [saved, setSaved] = useState(false);
  if (
    user.role !== "Farmer" ||
    stop.status !== "Confirmed" ||
    stop.response_payload.operation !== "Stop"
  )
    return null;
  return (
    <section className="panel" aria-label="Ghi nhật ký từ phiên điều khiển">
      <h3>Ghi nhận công việc vừa thực hiện</h3>
      <p>
        Nhận đủ ACK chưa tự tạo nhật ký. Hãy xác nhận công việc thực tế và bổ
        sung vật tư trước khi lưu.
      </p>
      {task.error && <Notice kind="warning">{task.error}</Notice>}
      {saved ? (
        <Notice>
          Đã lưu nhật ký chờ khóa.{" "}
          <Link to={`/cultivation-events?zone_id=${zoneId}`}>
            Xem nhật ký khu vực
          </Link>
        </Notice>
      ) : (
        <button
          className="button secondary"
          disabled={task.busy}
          onClick={() => {
            void task.run(async (signal) => {
              const value = await loadSessionJournalPrefill(
                api,
                stop._id,
                stop.device_id,
                zoneId,
                signal,
              );
              if (!signal.aborted) setPrefill(value);
            });
          }}
        >
          {task.busy ? "Đang đối chiếu phiên…" : "Ghi nhật ký từ phiên này"}
        </button>
      )}
      {prefill && (
        <JournalEditor
          initial={prefill}
          onClose={() => setPrefill(undefined)}
          onSaved={() => {
            setPrefill(undefined);
            setSaved(true);
          }}
        />
      )}
    </section>
  );
}
