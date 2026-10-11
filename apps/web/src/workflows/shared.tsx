import { useCallback, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, queryString } from "../api/client";
import { collectPages } from "../api/collection";
import { useSession } from "../auth/session";
import { useResource } from "../hooks/useResource";
import { useTask } from "../hooks/useTask";
import { DataState, Field, Modal, Notice, dateTime } from "../components/ui";
import type { Farm, Page } from "../types/api";
import "./workflows.css";

export type Values = Record<string, string | number | null>;
export interface InputField {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "textarea";
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  pattern?: string;
  hint?: string;
  options?: readonly (readonly [string, string])[];
  relation?: { path: string; label: (item: Values) => string; filter?: (item: Values) => boolean };
  createOnly?: boolean;
  nullable?: boolean;
}
export const uuidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
export function useGet<T>(path: string) {
  const { api } = useSession();
  const load = useCallback((signal: AbortSignal) => api.request<T>(path, { signal }), [api, path]);
  return useResource(path, load);
}
export function useCollection<T extends { id: string }>(path: string) {
  const { api } = useSession();
  const load = useCallback((signal: AbortSignal) => collectPages<T>(
    (offset) => api.request<Page<T>>(`${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`, { signal }),
    (item) => item.id,
  ), [api, path]);
  return useResource(path, load);
}
export function useOwnedFarms() {
  const { user } = useSession();
  const result = useCollection<Farm>("farms");
  return { ...result, data: result.data?.filter((farm) => farm.owner_id === user.id) };
}
export function RelationSelect({ field, value, onChange, disabled }: {
  field: InputField; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const relation = field.relation!;
  const resource = useCollection<Values & { id: string }>(relation.path);
  const options = resource.data?.filter(relation.filter ?? (() => true));
  return <Field label={field.label} hint={field.hint}>
    <select required={field.required !== false} value={value} disabled={disabled || resource.loading || !!resource.error} onChange={(e) => onChange(e.target.value)}>
      <option value="">{resource.loading ? "Đang tải lựa chọn…" : "Chọn một mục"}</option>
      {value && !options?.some((item) => item.id === value) && <option value={value}>Mục đã chọn · {value}</option>}
      {options?.map((item) => <option key={item.id} value={item.id}>{relation.label(item)}</option>)}
    </select>
    {resource.error && <Notice kind="error">{resource.error.message}<button type="button" className="button secondary" onClick={resource.reload}>Tải lại lựa chọn</button></Notice>}
    {options?.length === 0 && <small>Chưa có mục được cấp quyền phù hợp.</small>}
  </Field>;
}
export function FormFields({ fields, values, set, editing = false, disabled = false }: {
  fields: InputField[]; values: Values; set: (key: string, value: string) => void; editing?: boolean; disabled?: boolean;
}) {
  return <div className="form-grid">{fields.filter((field) => !editing || !field.createOnly).map((field) => {
    const value = String(values[field.key] ?? "");
    if (field.relation) return <RelationSelect key={field.key} field={field} value={value} onChange={(v) => set(field.key, v)} disabled={disabled} />;
    return <Field key={field.key} label={field.label} hint={field.hint}>
      {field.options ? <select required={field.required !== false} value={value} onChange={(e) => set(field.key, e.target.value)} disabled={disabled}>
        <option value="">Chọn một mục</option>{field.options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select> : field.type === "textarea" ? <textarea required={field.required !== false} maxLength={field.maxLength} value={value} disabled={disabled} onChange={(e) => set(field.key, e.target.value)} /> :
        <input type={field.type ?? "text"} required={field.required !== false} min={field.min} max={field.max} step={field.step} maxLength={field.maxLength} pattern={field.pattern} value={value} disabled={disabled} onChange={(e) => set(field.key, e.target.value)} />}
    </Field>;
  })}</div>;
}
// datetime-local displays the browser's local time; convert to an ISO instant at submission.
export function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function serializeFields(fields: InputField[], values: Values, before?: Values): Values {
  const body: Values = {};
  for (const field of fields) {
    if (before && field.createOnly) continue;
    const raw = values[field.key];
    if ((raw === "" || raw === undefined || raw === null) && field.required === false && !field.nullable) continue;
    const value = (raw === "" || raw === null) && field.nullable ? null : field.type === "number" ? Number(raw) : field.type === "datetime-local" ? before?.[field.key] && String(raw) === localDateTime(String(before[field.key])) ? before[field.key] : new Date(String(raw)).toISOString() : String(raw ?? "").trim();
    if (!before || value !== before[field.key]) body[field.key] = value;
  }
  return body;
}
export function EditorDialog({ title, fields, initial = {}, before, path, method = "POST", onClose, onSaved, transform, children, allowEmpty = false }: {
  title: string; fields: InputField[]; initial?: Values; before?: Values; path: string; method?: "POST" | "PATCH";
  onClose: () => void; onSaved: (value: unknown) => void; transform?: (body: Values) => unknown; children?: ReactNode; allowEmpty?: boolean;
}) {
  const { api } = useSession();
  const task = useTask();
  const [values, setValues] = useState<Values>(() => Object.fromEntries(fields.map((field) => {
    const raw = initial[field.key];
    return [field.key, raw && field.type === "datetime-local" ? localDateTime(String(raw)) : raw ?? ""];
  })));
  const [uncertain, setUncertain] = useState(false);
  return <Modal title={title} onClose={() => { if (!task.busy) onClose(); }}>
    <form className="workflow-form" onSubmit={(e) => {
      e.preventDefault();
      if (uncertain) return;
      void task.run(async (signal) => {
        const body = serializeFields(fields, values, before);
        if (!allowEmpty && !Object.keys(body).length) throw new Error("Cần ít nhất một thay đổi thực sự.");
        try { const result = await api.request(path, { method, body: transform ? transform(body) : body, signal }); if (!signal.aborted) onSaved(result); }
        catch (error) { if (error instanceof ApiError && (error.status === 0 || error.status === 409 || error.status >= 500)) setUncertain(true); throw error; }
      });
    }}>
      {children}
      <FormFields fields={fields} values={values} set={(key, value) => setValues((v) => ({ ...v, [key]: value }))} editing={!!before} disabled={task.busy || uncertain} />
      {task.error && <Notice kind="error">{task.error}</Notice>}
      {uncertain && <Notice kind="warning">Hãy đóng biểu mẫu, tải lại hồ sơ và đề xuất trước khi gửi lại. Kết quả yêu cầu có thể đã được lưu.</Notice>}
      <div className="workflow-form-actions"><button type="button" className="button secondary" disabled={task.busy} onClick={onClose}>Đóng</button><button className="button" disabled={task.busy || uncertain}>{task.busy ? "Đang gửi…" : "Lưu thông tin"}</button></div>
    </form>
  </Modal>;
}
export function ConfirmDialog({ title, path, method = "PATCH", body = {}, onClose, onSaved, children }: {
  title: string; path: string; method?: "POST" | "PATCH" | "DELETE"; body?: unknown; onClose: () => void; onSaved: () => void; children: ReactNode;
}) {
  const { api } = useSession(); const task = useTask(); const [attempted, setAttempted] = useState(false);
  return <Modal title={title} onClose={() => { if (!task.busy) onClose(); }}><div className="workflow-form">{children}
    {task.error && <Notice kind="error">{task.error} Đóng và tải lại để kiểm tra trạng thái trước khi thao tác tiếp.</Notice>}
    <div className="workflow-form-actions"><button className="button secondary" disabled={task.busy} onClick={onClose}>Đóng</button><button className="button" disabled={task.busy || attempted} onClick={() => {
      setAttempted(true); void task.run(async (signal) => { await api.request(path, { method, body: method === "DELETE" ? undefined : body, signal }); if (!signal.aborted) onSaved(); });
    }}>Xác nhận</button></div></div></Modal>;
}
export function WorkflowLinks({ kind, children }: { kind: string; children?: ReactNode }) {
  return <div className="workflow-navigation actions"><Link className="button secondary" to={`/requests?kind=${kind}`}>Phiếu đề xuất</Link>{children}</div>;
}
export function Diff({ changes, snapshot, labels = {} }: { changes: Record<string, unknown>; snapshot?: Record<string, unknown> | null; labels?: Record<string, string> }) {
  const format = (value: unknown) => value === undefined || value === null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return <div className="table-scroll"><table><thead><tr><th>Thông tin</th><th>Trước thay đổi</th><th>Đề xuất</th></tr></thead><tbody>{Object.entries(changes).map(([key, value]) => <tr key={key}><th>{labels[key] ?? key}</th><td className="break-word">{format(snapshot?.[key])}</td><td className="workflow-diff-new break-word">{format(value)}</td></tr>)}</tbody></table></div>;
}
export function HistoryPanel({ path, title = "Lịch sử thay đổi" }: { path: string; title?: string }) {
  const [offset, setOffset] = useState(0);
  const resource = useGet<Page<{ id: string; version: number; action: string; changed_at: string; after: Record<string, unknown> }>>(`${path}${queryString({ limit: 20, offset })}`);
  return <section className="panel"><h2>{title}</h2><DataState resource={resource} empty={resource.data?.items.length === 0}>{(data) => <div className="workflow-timeline">{data.items.map((item) => <article key={item.id}><strong>Phiên bản {item.version} · {item.action === "Create" ? "Tạo mới" : "Cập nhật"}</strong><p className="muted">{dateTime(item.changed_at)}</p><Diff changes={item.after} /></article>)}</div>}</DataState>{resource.data && <div className="actions"><button className="button secondary" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Trước</button><span>{offset + resource.data.items.length} / {resource.data.total}</span><button className="button secondary" disabled={offset + 20 >= resource.data.total || offset + 20 > 100000} onClick={() => setOffset(offset + 20)}>Sau</button></div>}</section>;
}
