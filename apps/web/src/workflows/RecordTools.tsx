import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil } from "lucide-react";
import { useSession } from "../auth/session";
import { farmFields, zoneFields } from "./farmZoneConfig";
import { EditorDialog, WorkflowLinks, useCollection, uuidPattern, type InputField, type Values } from "./shared";
import type { Farm, Zone } from "../types/api";

interface Config { title: string; requestKind: string; fields: InputField[]; parent?: "farm_id" | "zone_id" | "device_id" }
export const recordConfigs: Record<string, Config> = {
  farms: { title: "vườn", requestKind: "farm", fields: farmFields },
  zones: { title: "khu vực", requestKind: "zone", fields: zoneFields, parent: "farm_id" },
};
export function RecordTools({ path, item, onSaved }: { path: string; item?: object; onSaved: () => void }) {
  const { user } = useSession();
  const farms = useCollection<Farm>("farms");
  const zones = useCollection<Zone>("zones");
  const [editing, setEditing] = useState(false);
  const config = recordConfigs[path];
  if (!config) return null;
  const record = item as (Values & { id: string }) | undefined;
  const farmId = path === "farms" ? record?.id : config.parent === "farm_id" ? record?.farm_id : zones.data?.find((x) => x.id === record?.zone_id)?.farm_id;
  const owns = farms.data?.some((farm) => farm.id === farmId && farm.owner_id === user.id);
  const writable = user.role === "Admin" || (user.role === "Farmer" && (record ? owns : path === "farms" || farms.data?.some((farm) => farm.owner_id === user.id)));
  let fields = config.fields;
  if (user.role === "Farmer") fields = fields.map((field) => field.relation?.path === "farms" ? { ...field, relation: { ...field.relation, filter: (x: Values) => x.owner_id === user.id } } : field.relation?.path === "zones" ? { ...field, relation: { ...field.relation, filter: (x: Values) => !!farms.data?.some((farm) => farm.id === x.farm_id && farm.owner_id === user.id) } } : field);
  if (!record && path === "farms" && user.role === "Admin") fields = [{ key: "owner_id", label: "Mã tài khoản chủ vườn", pattern: uuidPattern, hint: "Chủ vườn phải là tài khoản Farmer đang hoạt động." }, ...fields];
  const proposal = path === "farms" || user.role === "Admin";
  const endpoint = record ? `${path}/${record.id}${proposal ? "/update-requests" : ""}` : `${path}${proposal ? "/requests" : ""}`;
  return <>
    <WorkflowLinks kind={config.requestKind}>
      {writable && <button className="button" onClick={() => setEditing(true)}>{record ? <Pencil size={16} /> : <Plus size={16} />}{record ? proposal ? "Đề xuất chỉnh sửa" : "Chỉnh sửa" : proposal ? `Đề xuất tạo ${config.title}` : `Thêm ${config.title}`}</button>}
      {record && path === "farms" && writable && <Link className="button secondary" to={`/farms/${record.id}/membership`}>Gia nhập / rời HTX</Link>}
      {record && path === "zones" && <Link className="button secondary" to={`/assignments?zone_id=${record.id}`}>Phân công khu vực</Link>}
    </WorkflowLinks>
    {editing && <EditorDialog title={`${record ? "Chỉnh sửa" : "Tạo"} ${config.title}${proposal ? " · Gửi đề xuất" : ""}`} fields={fields} initial={record ?? { status: "Active" }} before={record} path={endpoint} method={record && !proposal ? "PATCH" : "POST"} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }}>
      <p className="muted">{proposal ? "Thông tin chỉ có hiệu lực khi các bên liên quan chấp nhận đề xuất." : "Thông tin được cập nhật sau khi kiểm tra quyền và dữ liệu."}</p>
    </EditorDialog>}
  </>;
}
