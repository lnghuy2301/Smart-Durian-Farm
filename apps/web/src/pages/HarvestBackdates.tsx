import { useState } from "react";
import { useSession } from "../auth/session";
import { queryString } from "../api/client";
import { DataState, PageHeader, Pagination, dateTime } from "../components/ui";
import { ConfirmDialog, EditorDialog, useGet, uuidPattern } from "../workflows/shared";
import type { Page } from "../types/api";
interface Grant { id: string; user_id: string; zone_id: string; harvest_date: string; expires_at: string; reason: string; revoked_at: string | null }
export function HarvestBackdatesPage() {
  const { user } = useSession(); const [offset, setOffset] = useState(0); const [create, setCreate] = useState(false); const [revoke, setRevoke] = useState<string>();
  const resource = useGet<Page<Grant>>(`harvest-backdate-permissions${queryString({ limit: 20, offset })}`);
  return <><PageHeader title="Quyền nhập bù thu hoạch" subtitle="Quyền chỉ áp dụng cho đúng người, khu vực và ngày thu hoạch; không bỏ qua xác nhận hồ sơ." actions={<>{user.role === "Admin" && <button className="button" onClick={() => setCreate(true)}>Cấp quyền nhập bù</button>}<button className="button secondary" onClick={resource.reload}>Làm mới</button></>} />
    <section className="panel"><DataState resource={resource} empty={resource.data?.items.length === 0}>{(data) => <div className="table-scroll"><table><thead><tr><th>Người được cấp</th><th>Khu vực</th><th>Ngày thu hoạch</th><th>Hạn sử dụng</th><th>Lý do</th><th>Thao tác</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td className="break-word">{item.user_id}</td><td className="break-word">{item.zone_id}</td><td>{item.harvest_date}</td><td>{item.revoked_at ? `Đã thu hồi · ${dateTime(item.revoked_at)}` : dateTime(item.expires_at)}</td><td>{item.reason}</td><td>{user.role === "Admin" && !item.revoked_at && <button className="button secondary" onClick={() => setRevoke(item.id)}>Thu hồi</button>}</td></tr>)}</tbody></table></div>}</DataState>{resource.data && <Pagination {...resource.data} onChange={setOffset} />}</section>
    {create && <EditorDialog title="Cấp quyền nhập bù" fields={[{ key: "user_id", label: "Mã tài khoản Farmer", pattern: uuidPattern }, { key: "zone_id", label: "Khu vực", relation: { path: "zones", label: (x) => String(x.zone_name) } }, { key: "harvest_date", label: "Ngày thu hoạch thực tế", type: "date" }, { key: "expires_at", label: "Hạn sử dụng", type: "datetime-local" }, { key: "reason", label: "Lý do cấp quyền", type: "textarea", maxLength: 500 }]} path="harvest-backdate-permissions" onClose={() => setCreate(false)} onSaved={() => { setCreate(false); resource.reload(); }} />}
    {revoke && <ConfirmDialog title="Thu hồi quyền nhập bù" path={`harvest-backdate-permissions/${revoke}/revoke`} onClose={() => setRevoke(undefined)} onSaved={() => { setRevoke(undefined); resource.reload(); }}><p>Người được cấp không thể tiếp tục sử dụng quyền nhập bù này.</p></ConfirmDialog>}
  </>;
}
