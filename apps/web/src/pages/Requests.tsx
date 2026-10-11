import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../auth/session";
import { queryString } from "../api/client";
import { Badge, DataState, Field, Notice, PageHeader, Pagination, dateTime } from "../components/ui";
import { ConfirmDialog, Diff, EditorDialog, useGet } from "../workflows/shared";
import type { Page } from "../types/api";

export interface ChangeRequest {
  id: string; action: string; status: string; owner_id: string; proposed_by?: string; requested_by?: string;
  user_id?: string; cooperative_id?: string | null; created_at: string; rejection_reason: string | null; reason?: string | null;
  proposed_changes?: Record<string, unknown> | null;
  required_approvals?: { role?: string; purpose?: string; user_id: string | null; approved_at: string | null }[];
  farm_snapshot?: Record<string, unknown> | null; zone_snapshot?: Record<string, unknown> | null; tree_snapshot?: Record<string, unknown> | null;
  device_snapshot?: Record<string, unknown> | null; sensor_snapshot?: Record<string, unknown> | null; actuator_snapshot?: Record<string, unknown> | null; harvest_snapshot?: Record<string, unknown>;
}
export const requestKinds: Record<string, { label: string; path: string }> = {
  farm: { label: "Vườn & thành viên HTX", path: "farm-requests" },
  zone: { label: "Khu vực", path: "zone-requests" },
  assignment: { label: "Phân công", path: "assignment-requests" },
  tree: { label: "Cây sầu riêng", path: "tree-requests" },
};
export const fieldLabels: Record<string, string> = { area_size: "Diện tích", address: "Địa chỉ", certificate_number: "Số chứng nhận", longitude: "Kinh độ", latitude: "Vĩ độ", standard_id: "Tiêu chuẩn", zone_name: "Tên khu vực", variety: "Giống cây", plant_date: "Ngày trồng", status: "Trạng thái", installed_at: "Ngày lắp đặt", cost: "Chi phí", station_id: "Mã trạm", name: "Tên", unit: "Đơn vị", min_threshold: "Ngưỡng tối thiểu", max_threshold: "Ngưỡng tối đa", season_name: "Mùa vụ", harvest_date: "Ngày thu hoạch", batch_code: "Mã lô", fruit_count: "Số quả", total_weight_kg: "Khối lượng (kg)" };
const actionLabels: Record<string, string> = { Create: "Tạo mới", Update: "Cập nhật", Join: "Gia nhập HTX", Leave: "Rời HTX", Assign: "Mời phụ trách", End: "Kết thúc phân công", Confirm: "Xác nhận thu hoạch", Correct: "Sửa thu hoạch" };
export function RequestsPage() {
  const [params, setParams] = useSearchParams();
  const kind = (params.get("kind") ?? "") in requestKinds ? params.get("kind")! : "farm";
  const config = requestKinds[kind];
  const status = ["Pending", "Accepted", "Rejected"].includes(params.get("status") ?? "") ? params.get("status")! : "Pending";
  const offsetValue = Number(params.get("offset") ?? 0);
  const offset = Number.isInteger(offsetValue) && offsetValue >= 0 && offsetValue <= 100000 ? offsetValue : 0;
  const resource = useGet<Page<ChangeRequest>>(`${config.path}${queryString({ status, offset, limit: 20 })}`);
  const selected = params.get("id");
  function change(key: string, value: string) { setParams((previous) => { const next = new URLSearchParams(previous); next.set(key, value); if (key !== "id") next.delete("id"); if (key !== "offset") next.delete("offset"); return next; }); }
  return <>
    <PageHeader title="Phiếu đề xuất" subtitle="Theo dõi nội dung, chữ ký và trạng thái xử lý trong phạm vi của bạn." actions={<button className="button secondary" onClick={resource.reload}>Làm mới</button>} />
    <div className="panel"><div className="toolbar"><Field label="Loại đề xuất"><select value={kind} onChange={(e) => change("kind", e.target.value)}>{Object.entries(requestKinds).map(([value, x]) => <option key={value} value={value}>{x.label}</option>)}</select></Field><Field label="Trạng thái"><select value={status} onChange={(e) => change("status", e.target.value)}><option value="Pending">Chờ xử lý</option><option value="Accepted">Đã chấp nhận</option><option value="Rejected">Đã từ chối</option></select></Field></div>
      <DataState resource={resource} empty={resource.data?.items.length === 0}>{(data) => <div className="table-scroll"><table><thead><tr><th>Đề xuất</th><th>Thời gian</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td><strong>{actionLabels[item.action] ?? item.action}</strong><small className="break-word">{item.id}</small></td><td>{dateTime(item.created_at)}</td><td><Badge status={item.status} /></td><td><button className="button secondary" onClick={() => change("id", item.id)}>Xem đề xuất</button></td></tr>)}</tbody></table></div>}</DataState>
      {resource.data && <Pagination {...resource.data} onChange={(value) => change("offset", String(value))} />}
    </div>
    {selected && <RequestDetail key={`${kind}/${selected}`} kind={kind} id={selected} onClose={() => setParams((previous) => { const next = new URLSearchParams(previous); next.delete("id"); return next; })} onChanged={resource.reload} />}
  </>;
}
function RequestDetail({ kind, id, onClose, onChanged }: { kind: string; id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useSession();
  const config = requestKinds[kind];
  const resource = useGet<ChangeRequest>(`${config.path}/${id}`);
  const [action, setAction] = useState<"approve" | "reject">();
  function saved() { setAction(undefined); resource.reload(); onChanged(); }
  return <section className="panel workflow-summary"><div className="panel-heading"><h2>Nội dung đề xuất</h2><div className="actions"><button className="button secondary" onClick={() => { setAction(undefined); resource.reload(); onChanged(); }}>Kiểm tra trạng thái</button><button className="button secondary" onClick={onClose}>Đóng chi tiết</button></div></div>
    <DataState resource={resource}>{(request) => {
      const pending = request.status === "Pending";
      const approve = pending && (request.required_approvals ? request.required_approvals.some((x) => !x.approved_at && (x.user_id === user.id || (x.user_id === null && x.role === user.role))) : request.owner_id === user.id);
      const reject = pending && (kind === "farm" ? approve : kind === "assignment" ? request.owner_id === user.id || request.proposed_by === user.id || request.user_id === user.id && request.action === "Assign" : request.owner_id === user.id);
      const snapshot = request.farm_snapshot ?? request.zone_snapshot ?? request.tree_snapshot ?? request.device_snapshot ?? request.sensor_snapshot ?? request.actuator_snapshot ?? request.harvest_snapshot;
      return <><p className="muted break-word">{request.id} · {dateTime(request.created_at)}</p><Badge status={request.status} /><h3 className="workflow-subheading">{actionLabels[request.action]}</h3>
        {snapshot && <><h3 className="workflow-subheading">Hồ sơ tại thời điểm gửi</h3><Diff changes={snapshot} labels={fieldLabels} /></>}
        {request.proposed_changes && <><h3 className="workflow-subheading">Thông tin thay đổi</h3><Diff changes={request.proposed_changes} snapshot={snapshot} labels={fieldLabels} /></>}
        {request.cooperative_id && <p className="break-word">HTX được đề xuất: {request.cooperative_id}</p>}
        {request.reason && <Notice>Lý do: {request.reason}</Notice>}
        {request.required_approvals && <div className="workflow-timeline">{request.required_approvals.map((x, index) => <article key={index}><strong>{x.role ?? (x.purpose === "Owner" ? "Chủ vườn" : "Người được phân công")}</strong><p>{x.approved_at ? `Đã đồng ý · ${dateTime(x.approved_at)}` : "Chờ chấp nhận"}</p></article>)}</div>}
        {request.rejection_reason && <Notice kind="warning">Lý do từ chối: {request.rejection_reason}</Notice>}
        <div className="workflow-form-actions">{reject && <button className="button secondary" onClick={() => setAction("reject")}>Từ chối / rút đề xuất</button>}{approve && <button className="button" onClick={() => setAction("approve")}>Chấp nhận đề xuất</button>}</div>
        {action === "approve" && <ConfirmDialog title="Chấp nhận đề xuất" path={`${config.path}/${id}/approve`} onClose={() => setAction(undefined)} onSaved={saved}><p>Xác nhận đồng ý với nội dung đã đối chiếu. Các đề xuất nhiều bên chỉ có hiệu lực khi đủ chữ ký.</p></ConfirmDialog>}
        {action === "reject" && <EditorDialog allowEmpty title="Từ chối / rút đề xuất" fields={[{ key: "reason", label: "Lý do", type: "textarea", maxLength: 500, required: false }]} initial={{ reason: "" }} path={`${config.path}/${id}/reject`} method="PATCH" onClose={() => setAction(undefined)} onSaved={saved} />}
      </>;
    }}</DataState>
  </section>;
}
