import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Leaf, Map, Users } from "lucide-react";
import { useSession } from "../auth/session";
import { collectPages } from "../api/collection";
import { usePollingResource } from "../hooks/usePollingResource";
import { DataState, PageHeader, Pagination, dateTime } from "../components/ui";
import { farmerContext } from "./dashboardContext";
import { RequestInbox } from "./RequestInbox";
import type { AssignmentHistory, Farm, Page, Zone } from "../types/api";
import "./RoleDashboards.css";

export function FarmerWorkspace({
  assignedOnly = false,
}: {
  assignedOnly?: boolean;
}) {
  const { api, user } = useSession();
  const [offset, setOffset] = useState(0);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const read = <T,>(path: string, identity: (item: T) => string) =>
        collectPages<T>(
          (offset) =>
            api.request<Page<T>>(`${path}?limit=100&offset=${offset}`, {
              signal,
            }),
          identity,
        );
      const [farms, zones, assignments] = await Promise.all([
        read<Farm>("farms", (item) => item.id),
        read<Zone>("zones", (item) => item.id),
        read<AssignmentHistory>(
          "zone-assignments",
          (item) => item.assignment.id,
        ),
      ]);
      return farmerContext(user.id, farms, zones, assignments);
    },
    [api, user.id],
  );
  const resource = usePollingResource(`farmer-workspace:${user.id}`, load);
  return (
    <div className="role-workspace">
      <DataState resource={resource}>
        {(data) => (
          <div className={assignedOnly ? "" : "role-context-grid"}>
            {!assignedOnly && (
              <section
                className="panel role-context-card"
                aria-label="Vườn của tôi"
              >
                <div className="panel-heading">
                  <div>
                    <span className="section-label">QUẢN LÝ VƯỜN</span>
                    <h2>Vườn của tôi</h2>
                  </div>
                  <Leaf size={25} />
                </div>
                {data.ownedFarms.length ? (
                  <>
                    <p>
                      <strong>{data.ownedFarms.length} vườn</strong> ·{" "}
                      {data.ownedZones.length} khu vực thuộc vườn của bạn.
                    </p>
                    <div className="role-context-list">
                      {data.ownedFarms.slice(0, 3).map((farm) => (
                        <Link to={`/farms/${farm.id}`} key={farm.id}>
                          <Leaf size={18} />
                          <span>
                            <strong>{farm.certificate_number}</strong>
                            <small>{farm.address}</small>
                          </span>
                        </Link>
                      ))}
                    </div>
                    <p className="muted">
                      Mở từng vườn để quản lý khu vực, cây, phân công và thiết
                      bị theo quyền.
                    </p>
                  </>
                ) : (
                  <p>
                    Bạn chưa có vườn được duyệt. Gửi yêu cầu tạo vườn; sau khi
                    được chấp nhận, bạn có thể quản lý khu vực và cây trồng.
                  </p>
                )}
                <Link className="button secondary" to="/farms">
                  {data.ownedFarms.length
                    ? "Quản lý vườn của tôi"
                    : "Gửi yêu cầu tạo vườn"}
                </Link>
              </section>
            )}
            <section
              className="panel role-context-card"
              aria-label="Công việc được giao"
            >
              <div className="panel-heading">
                <div>
                  <span className="section-label">NHẬN VIỆC TẠI VƯỜN</span>
                  <h2>Công việc được giao</h2>
                </div>
                <Users size={25} />
              </div>
              <p>
                {data.assigned.length
                  ? `${data.assigned.length} khu vực đang có phân công hiệu lực.`
                  : "Bạn chưa có khu vực đang phụ trách. Xem lời mời phân công và chấp nhận trước khi ghi nhận công việc."}
              </p>
              <div className="role-context-list">
                {data.assigned
                  .slice(
                    assignedOnly ? offset : 0,
                    assignedOnly ? offset + 20 : 3,
                  )
                  .map((entry) => (
                    <article key={entry.assignment.id}>
                      <Link to={`/zones/${entry.assignment.zone_id}`}>
                        <Map size={18} />
                        <span>
                          <strong>{entry.zone_snapshot.zone_name}</strong>
                          <small>
                            Từ {dateTime(entry.assignment.start_date)}
                          </small>
                        </span>
                      </Link>
                      {assignedOnly && (
                        <div className="role-context-actions">
                          <Link
                            className="button secondary"
                            to={`/cultivation-events?zone_id=${entry.assignment.zone_id}`}
                          >
                            Nhật ký khu vực
                          </Link>
                          <Link
                            className="button secondary"
                            to={`/tree-harvests?zone_id=${entry.assignment.zone_id}`}
                          >
                            Thu hoạch
                          </Link>
                          <Link
                            className="button secondary"
                            to={`/iot?zone_id=${entry.assignment.zone_id}`}
                          >
                            Theo dõi IoT
                          </Link>
                        </div>
                      )}
                    </article>
                  ))}
              </div>
              {assignedOnly && (
                <Pagination
                  total={data.assigned.length}
                  offset={offset}
                  limit={20}
                  onChange={setOffset}
                />
              )}
              <div className="role-context-actions">
                <Link
                  className="button secondary"
                  to={
                    assignedOnly
                      ? "/requests?kind=assignment"
                      : "/assigned-work"
                  }
                >
                  {assignedOnly
                    ? "Xem lời mời phân công"
                    : "Mở công việc được giao"}
                </Link>
              </div>
              {!!data.history.length && (
                <p className="muted">
                  Có {data.history.length} phân công trong lịch sử của bạn. Kết
                  thúc phân công vẫn giữ lịch sử cá nhân theo quyền.
                </p>
              )}
            </section>
          </div>
        )}
      </DataState>
      <div className="role-history-links">
        <Link to="/cultivation-events?mine=1">Nhật ký & lịch sử của tôi</Link>
        <Link to="/assignments">Lịch sử phân công</Link>
      </div>
    </div>
  );
}
export function AssignedWorkPage() {
  const [refresh, setRefresh] = useState(0);
  return (
    <>
      <PageHeader
        title="Công việc được giao"
        subtitle="Xem lời mời, khu vực đang phụ trách và lịch sử công việc của bạn."
        actions={
          <button
            className="button secondary"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Làm mới công việc
          </button>
        }
      />
      <RequestInbox key={`inbox:${refresh}`} invitations />
      <FarmerWorkspace key={`workspace:${refresh}`} assignedOnly />
    </>
  );
}
