import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useSession } from "../auth/session";
import {
  Badge,
  DataState,
  Notice,
  PageHeader,
  Pagination,
  dateTime,
} from "../components/ui";
import {
  ConfirmDialog,
  EditorDialog,
  WorkflowLinks,
  useGet,
  useOwnedFarms,
} from "../workflows/shared";
import { queryString } from "../api/client";
import type { AssignmentHistory, Farm, Page } from "../types/api";
import { RecordReference } from "../components/ReadableValue";
import { AssignmentInviteDialog } from "../workflows/AssignmentInviteDialog";
export function MembershipPage() {
  const { id } = useParams();
  const { user } = useSession();
  const resource = useGet<Farm>(`farms/${id}`);
  const [action, setAction] = useState<"join" | "leave">();
  return (
    <>
      <PageHeader
        title="Thành viên hợp tác xã"
        actions={
          <Link className="button secondary" to={`/farms/${id}`}>
            Về hồ sơ vườn
          </Link>
        }
      />
      <WorkflowLinks kind="farm" />
      <DataState resource={resource}>
        {(farm) => (
          <section className="panel workflow-summary">
            <h2>{farm.certificate_number}</h2>
            <p>{farm.address}</p>
            <p className="muted">
              {farm.cooperative_id
                ? "Vườn đã tham gia HTX. Cần hoàn tất rời HTX trước khi gia nhập HTX khác."
                : "Vườn đang hoạt động độc lập."}
            </p>
            {(user.role === "Admin" || farm.owner_id === user.id) && (
              <div className="workflow-form-actions">
                <button
                  className="button"
                  onClick={() =>
                    setAction(farm.cooperative_id ? "leave" : "join")
                  }
                >
                  {farm.cooperative_id
                    ? "Đề xuất rời HTX"
                    : "Đề xuất gia nhập HTX"}
                </button>
              </div>
            )}
            {action === "join" && (
              <EditorDialog
                title="Gia nhập hợp tác xã"
                fields={[
                  {
                    key: "cooperative_id",
                    label: "Hợp tác xã",
                    relation: {
                      path: "cooperatives",
                      label: (x) =>
                        `${x.cooperative_name} · ${x.certificate_number}`,
                      filter: (x) => !!x.manager_id,
                    },
                  },
                ]}
                path={`farms/${id}/join-requests`}
                onClose={() => setAction(undefined)}
                onSaved={() => {
                  setAction(undefined);
                  resource.reload();
                }}
              >
                <Notice>
                  Chọn HTX đã có Manager. Chủ vườn, Admin và Manager liên quan
                  phải chấp nhận theo phiếu đề xuất.
                </Notice>
              </EditorDialog>
            )}
            {action === "leave" && (
              <ConfirmDialog
                title="Đề xuất rời hợp tác xã"
                path={`farms/${id}/leave-requests`}
                method="POST"
                onClose={() => setAction(undefined)}
                onSaved={() => {
                  setAction(undefined);
                  resource.reload();
                }}
              >
                <Notice kind="warning">
                  Vườn vẫn thuộc HTX cho đến khi đủ chữ ký chấp nhận. Sau đó
                  Manager sẽ nhận thông báo.
                </Notice>
              </ConfirmDialog>
            )}
          </section>
        )}
      </DataState>
    </>
  );
}
export function AssignmentsPage() {
  const { user } = useSession();
  const [params] = useSearchParams();
  const zoneId = params.get("zone_id") || undefined;
  const farms = useOwnedFarms();
  const [offset, setOffset] = useState(0);
  const [create, setCreate] = useState(false);
  const [end, setEnd] = useState<string>();
  const path = `zone-assignments${queryString({ zone_id: zoneId, limit: 20, offset })}`;
  const resource = useGet<Page<AssignmentHistory>>(path);
  const canManage = user.role === "Admin" || !!farms.data?.length;
  return (
    <>
      <PageHeader
        title="Phân công khu vực"
        subtitle="Lời mời chỉ có hiệu lực sau khi người nhận và các bên liên quan chấp nhận."
        actions={
          <button className="button secondary" onClick={resource.reload}>
            Làm mới
          </button>
        }
      />
      <WorkflowLinks kind="assignment">
        {canManage && zoneId && (
          <button className="button" onClick={() => setCreate(true)}>
            Mời phụ trách khu vực
          </button>
        )}
        {!zoneId && canManage && (
          <Link className="button" to="/zones">
            Chọn khu vực để phân công
          </Link>
        )}
      </WorkflowLinks>
      <section className="panel">
        <DataState
          resource={resource}
          empty={resource.data?.items.length === 0}
        >
          {(data) => (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Khu vực</th>
                    <th>Người phụ trách</th>
                    <th>Thời gian</th>
                    <th>Hiệu lực</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.assignment.id}>
                      <td>
                        <Link to={`/zones/${item.assignment.zone_id}`}>
                          {item.zone_snapshot.zone_name}
                        </Link>
                      </td>
                      <td className="break-word">
                        <RecordReference
                          kind="zone-assignments"
                          id={item.assignment.id}
                          field="user_id"
                          value={item.assignment.user_id}
                        />
                      </td>
                      <td>
                        {dateTime(item.assignment.start_date)}
                        <small>
                          Đến{" "}
                          {item.assignment.end_date
                            ? dateTime(item.assignment.end_date)
                            : "khi kết thúc phân công"}
                        </small>
                      </td>
                      <td>
                        <Badge status={item.active ? "Active" : "Inactive"} />
                        <small>
                          Hạn đính chính:{" "}
                          {item.correction_deadline
                            ? dateTime(item.correction_deadline)
                            : "Theo thời điểm kết thúc"}
                        </small>
                      </td>
                      <td>
                        {item.active &&
                          (user.role === "Admin" ||
                            farms.data?.some(
                              (x) => x.id === item.zone_snapshot.farm_id,
                            )) && (
                            <button
                              className="button secondary"
                              onClick={() => setEnd(item.assignment.id)}
                            >
                              {user.role === "Admin"
                                ? "Đề xuất kết thúc"
                                : "Kết thúc"}
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataState>
        {resource.data && (
          <Pagination {...resource.data} onChange={setOffset} />
        )}
      </section>
      {create && zoneId && (
        <AssignmentInviteDialog
          key={zoneId}
          zoneId={zoneId}
          onClose={() => setCreate(false)}
          onSaved={() => {
            setCreate(false);
            resource.reload();
          }}
        />
      )}
      {end && (
        <ConfirmDialog
          title="Kết thúc phân công"
          path={`zone-assignments/${end}/${user.role === "Admin" ? "end-requests" : "end"}`}
          method={user.role === "Admin" ? "POST" : "PATCH"}
          onClose={() => setEnd(undefined)}
          onSaved={() => {
            setEnd(undefined);
            resource.reload();
          }}
        >
          <p>
            Người phụ trách sẽ mất quyền ghi mới khi việc kết thúc có hiệu lực.
            Quyền đính chính cũ tuân theo hạn backend.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
interface FarmNotification {
  id: string;
  farm_id: string;
  cooperative_id: string;
  request_id: string;
  created_at: string;
}
export function FarmNotificationsPage() {
  const [offset, setOffset] = useState(0);
  const resource = useGet<Page<FarmNotification>>(
    `farm-notifications${queryString({ limit: 20, offset })}`,
  );
  return (
    <>
      <PageHeader title="Thông báo thành viên HTX" />
      <section className="panel">
        <DataState
          resource={resource}
          empty={resource.data?.items.length === 0}
        >
          {(data) => (
            <div className="workflow-timeline">
              {data.items.map((item) => (
                <article key={item.id}>
                  <strong>Vườn đã rời hợp tác xã</strong>
                  <p>{dateTime(item.created_at)}</p>
                  <p className="break-word">
                    Vườn:{" "}
                    <RecordReference
                      kind="farms"
                      id={item.farm_id}
                      field="farm_id"
                      value={item.farm_id}
                    />
                  </p>
                  <Link to={`/requests?kind=farm&id=${item.request_id}`}>
                    Xem phiếu đã xử lý
                  </Link>
                </article>
              ))}
            </div>
          )}
        </DataState>
        {resource.data && (
          <Pagination {...resource.data} onChange={setOffset} />
        )}
      </section>
    </>
  );
}
