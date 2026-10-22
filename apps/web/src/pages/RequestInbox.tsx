import { useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ClipboardCheck } from "lucide-react";
import { useSession } from "../auth/session";
import { collectPages } from "../api/collection";
import { useResource } from "../hooks/useResource";
import { DataState, Notice } from "../components/ui";
import { requestKinds, type ChangeRequest } from "./Requests";
import { needsReview } from "./dashboardContext";
import type { Page } from "../types/api";

export function RequestInbox({
  cooperativeId,
  invitations = false,
}: {
  cooperativeId?: string;
  invitations?: boolean;
}) {
  const { api, user } = useSession();
  const kinds = invitations
    ? "assignment"
    : user.role === "Farmer"
      ? Object.keys(requestKinds).join(",")
      : "farm,harvest";
  const load = useCallback(
    async (signal: AbortSignal) =>
      Promise.all(
        kinds.split(",").map(async (kind) => {
          const config = requestKinds[kind];
          try {
            const records = await collectPages<ChangeRequest>(
              (offset) =>
                api.request<Page<ChangeRequest>>(
                  `${config.path}?status=Pending&limit=100&offset=${offset}`,
                  { signal },
                ),
              (row) => row.id,
            );
            const waiting = records.filter((request) =>
              needsReview(kind, request, user, cooperativeId),
            );
            return { kind, label: config.label, waiting, failed: false };
          } catch (error) {
            if (signal.aborted) throw error;
            return {
              kind,
              label: config.label,
              waiting: [] as ChangeRequest[],
              failed: true,
            };
          }
        }),
      ),
    [api, kinds, user, cooperativeId],
  );
  const resource = useResource(
    `request-inbox:${user.id}:${kinds}:${cooperativeId ?? ""}`,
    load,
  );
  return (
    <section
      className="panel role-inbox"
      aria-label={invitations ? "Lời mời phân công" : "Việc cần bạn xử lý"}
    >
      <div className="panel-heading">
        <div>
          <span className="section-label">CẦN CHÚ Ý</span>
          <h2>{invitations ? "Lời mời cần phản hồi" : "Việc cần bạn xử lý"}</h2>
        </div>
        <Link to={invitations ? "/requests?kind=assignment" : "/requests"}>
          Xem phiếu đề xuất →
        </Link>
      </div>
      <DataState resource={resource}>
        {(data) => (
          <>
            {data.some((entry) => entry.failed) && (
              <Notice kind="warning">
                Chưa tải được đề xuất{" "}
                {data
                  .filter((entry) => entry.failed)
                  .map((entry) => entry.label.toLocaleLowerCase("vi"))
                  .join(", ")}
                .{" "}
                <button
                  type="button"
                  className="button secondary"
                  onClick={resource.reload}
                >
                  Kiểm tra lại
                </button>
              </Notice>
            )}
            <div className="role-inbox-grid">
              {data
                .filter((entry) => !entry.failed && entry.waiting.length > 0)
                .map((entry) => (
                  <Link
                    key={entry.kind}
                    className="role-inbox-item"
                    to={`/requests?kind=${entry.kind}&status=Pending`}
                  >
                    <ClipboardCheck size={22} />
                    <span>
                      <strong>{entry.label}</strong>
                      <small>
                        {entry.waiting.length} phiếu đang chờ bạn xem xét
                      </small>
                    </span>
                    <ArrowUpRight size={18} />
                  </Link>
                ))}
            </div>
            {data.every(
              (entry) => !entry.failed && entry.waiting.length === 0,
            ) && (
              <p className="muted">
                {invitations
                  ? "Chưa có lời mời cần bạn chấp nhận. Khi chủ vườn gửi lời mời, bạn có thể xem và phản hồi tại đây."
                  : "Không có đề xuất đang chờ bạn chấp nhận. Các phiếu đã gửi và lịch sử vẫn có trong Phiếu đề xuất."}
              </p>
            )}
          </>
        )}
      </DataState>
      {user.role === "Admin" && !invitations && (
        <div className="role-inbox-footer">
          <Link className="button secondary" to="/harvest-backdates">
            Cấp quyền nhập bù thu hoạch
          </Link>
          <span className="muted">
            Kiểm tra đúng người, khu vực và ngày thu hoạch trước khi cấp.
          </span>
        </div>
      )}
    </section>
  );
}
