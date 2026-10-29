import "./JournalUsability.css";
import { useCallback, useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Droplets, Leaf, Lock, Plus, ShieldCheck } from "lucide-react";
import { useSession } from "../auth/session";
import { ApiError, queryString } from "../api/client";
import {
  DataState,
  Field,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  dateTime,
  number,
} from "../components/ui";
import { useTask } from "../hooks/useTask";
import { useResource } from "../hooks/useResource";
import { collectPages } from "../api/collection";
import {
  ConfirmDialog,
  RelationSelect,
  useCollection,
  useGet,
} from "../workflows/shared";
import {
  activityLabels,
  type Activity,
  type Journal,
} from "../types/cultivation";
import type { Page, Tree, Zone } from "../types/api";
import { RecordReference } from "../components/ReadableValue";
import { vietnamDay, type Period } from "./managerOverview";
import type { ControlJournalPrefill } from "../control/journal";

function LockState({
  event,
  onExpired,
}: {
  event: Journal;
  onExpired?: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (event.status !== "Pending") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const expiry = setTimeout(
      () => onExpired?.(),
      Math.max(0, Date.parse(event.lock_at) - Date.now()) + 250,
    );
    return () => {
      clearInterval(timer);
      clearTimeout(expiry);
    };
  }, [event.status, event.lock_at, onExpired]);
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(event.lock_at) - now) / 1000),
  );
  return event.status === "Locked" ? (
    <span className="badge journal-lock-badge">
      <Lock size={14} /> Đã khóa
    </span>
  ) : (
    <span className="workflow-countdown">
      {seconds
        ? `Chờ khóa · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
        : "Đến hạn khóa · kiểm tra trạng thái"}
    </span>
  );
}
export function CultivationPage() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const mine = params.get("mine") === "1";
  const zoneId = params.get("zone_id") ?? "";
  const offsetValue = Number(params.get("offset") ?? 0);
  const offset =
    Number.isInteger(offsetValue) && offsetValue >= 0 && offsetValue <= 100000
      ? offsetValue
      : 0;
  const action = params.get("action_type") ?? "";
  const status = params.get("status") ?? "";
  const targetType = params.get("target_type") ?? "";
  const targetId = params.get("target_id") ?? "";
  const path = `cultivation-events${mine ? "/mine" : ""}${queryString({ zone_id: zoneId, action_type: action in activityLabels ? action : undefined, status: ["Pending", "Locked"].includes(status) ? status : undefined, target_type: ["Zone", "Tree"].includes(targetType) ? targetType : undefined, target_id: targetId || undefined, limit: 20, offset })}`;
  const resource = useGet<Page<Journal>>(path);
  const [create, setCreate] = useState(false);
  const [verify, setVerify] = useState(false);
  function change(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "offset") next.delete("offset");
      if (key === "zone_id" || key === "target_type") next.delete("target_id");
      return next;
    });
  }
  return (
    <>
      <PageHeader
        title="Nhật ký canh tác"
        subtitle="Ghi nhận chăm sóc, theo dõi thời hạn chỉnh sửa và các bản đính chính."
        actions={
          <>
            <button className="button secondary" onClick={resource.reload}>
              Làm mới
            </button>
            {user.role === "Farmer" && (
              <button className="button" onClick={() => setCreate(true)}>
                <Plus size={16} />
                Thêm nhật ký
              </button>
            )}
          </>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <Field label="Phạm vi nhật ký">
            <select
              value={mine ? "mine" : "visible"}
              onChange={(e) =>
                change("mine", e.target.value === "mine" ? "1" : "")
              }
            >
              <option value="visible">Phạm vi được truy cập</option>
              <option value="mine">Do tôi ghi</option>
            </select>
          </Field>
          <RelationSelect
            field={{
              key: "zone_id",
              label: "Khu vực",
              required: false,
              relation: { path: "zones", label: (x) => String(x.zone_name) },
            }}
            value={zoneId}
            onChange={(value) => change("zone_id", value)}
          />
          <Field label="Hoạt động">
            <select
              value={action}
              onChange={(e) => change("action_type", e.target.value)}
            >
              <option value="">Tất cả</option>
              {Object.entries(activityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Loại đối tượng">
            <select
              value={targetType}
              onChange={(e) => change("target_type", e.target.value)}
            >
              <option value="">Tất cả</option>
              <option value="Zone">Toàn khu vực</option>
              <option value="Tree">Một cây</option>
            </select>
          </Field>
          {targetType === "Tree" && (
            <RelationSelect
              field={{
                key: "target_id",
                label: "Cây trong nhật ký",
                required: false,
                relation: {
                  path: `trees${queryString({ zone_id: zoneId })}`,
                  label: (x) => `${x.tree_code} · ${x.variety}`,
                },
              }}
              value={targetId}
              onChange={(value) => change("target_id", value)}
            />
          )}
          <Field label="Trạng thái">
            <select
              value={status}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="">Tất cả</option>
              <option value="Pending">Chờ khóa</option>
              <option value="Locked">Đã khóa</option>
            </select>
          </Field>
          {zoneId && (
            <button
              className="button secondary"
              onClick={() => setVerify(true)}
            >
              <ShieldCheck size={16} />
              Kiểm tra chuỗi
            </button>
          )}
        </div>
        <DataState
          resource={resource}
          empty={resource.data?.items.length === 0}
        >
          {(data) => (
            <div className="workflow-card-grid">
              {data.items.map((event) => (
                <article className="workflow-card" key={event._id}>
                  <div className="actions">
                    {event.action_type === "Watering" ? (
                      <Droplets size={22} />
                    ) : (
                      <Leaf size={22} />
                    )}
                    <h2>
                      {event.action_type === "Other"
                        ? event.details.activity_name
                        : activityLabels[event.action_type]}
                    </h2>
                  </div>
                  <LockState event={event} onExpired={resource.reload} />
                  <p>{event.details.note || "Không có ghi chú"}</p>
                  <small>
                    {event.is_correction ? "Bản đính chính · " : ""}
                    {event.target_type === "Zone"
                      ? "Toàn khu vực"
                      : "Một cây"}{" "}
                    · {dateTime(event.created_at)}
                  </small>
                  <Link
                    className="button secondary"
                    to={`/cultivation-events/${event._id}`}
                  >
                    Xem nhật ký
                  </Link>
                </article>
              ))}
            </div>
          )}
        </DataState>
        {resource.data && (
          <Pagination
            {...resource.data}
            onChange={(value) => change("offset", String(value))}
          />
        )}
      </section>
      {create && (
        <JournalEditor
          onClose={() => setCreate(false)}
          onSaved={() => {
            setCreate(false);
            resource.reload();
          }}
        />
      )}
      {verify && (
        <ChainDialog zoneId={zoneId} onClose={() => setVerify(false)} />
      )}
    </>
  );
}
export function JournalDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useSession();
  const resource = useGet<Journal>(`cultivation-events/${id}`);
  const trees = useCollection<Tree>("trees");
  const zones = useCollection<Zone>("zones");
  const [action, setAction] = useState<
    "edit" | "delete" | "correct" | "chain"
  >();
  function saved() {
    if (action === "delete") {
      navigate("/cultivation-events");
      return;
    }
    setAction(undefined);
    resource.reload();
  }
  return (
    <>
      <PageHeader
        title="Chi tiết nhật ký canh tác"
        actions={
          <>
            <Link className="button secondary" to="/cultivation-events">
              Danh sách nhật ký
            </Link>
            <button className="button secondary" onClick={resource.reload}>
              Kiểm tra trạng thái
            </button>
          </>
        }
      />
      <DataState resource={resource}>
        {(event) => {
          const pending =
            event.status === "Pending" &&
            Date.now() < Date.parse(event.lock_at);
          const author = event.farmer_id === user.id && user.role === "Farmer";
          const zoneId =
            event.target_type === "Zone"
              ? event.target_id
              : trees.data?.find((x) => x.id === event.target_id)?.zone_id;
          return (
            <>
              <section className="panel workflow-summary">
                <div className="panel-heading">
                  <h2>
                    {event.action_type === "Other"
                      ? event.details.activity_name
                      : activityLabels[event.action_type]}
                    {event.is_correction ? " · Đính chính" : ""}
                  </h2>
                  <LockState event={event} onExpired={resource.reload} />
                </div>
                <dl className="details">
                  <div>
                    <dt>Đối tượng</dt>
                    <dd>
                      {event.target_type === "Zone" ? "Khu vực" : "Cây"} ·{" "}
                      <RecordReference
                        kind="cultivation-events"
                        id={event._id}
                        field="target_id"
                        value={event.target_id}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Người ghi nhật ký</dt>
                    <dd>
                      <RecordReference
                        kind="cultivation-events"
                        id={event._id}
                        field="farmer_id"
                        value={event.farmer_id}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Thời điểm ghi</dt>
                    <dd>{dateTime(event.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Khóa lúc</dt>
                    <dd>{dateTime(event.locked_at ?? event.lock_at)}</dd>
                  </div>
                  <div>
                    <dt>Tiêu chuẩn tại lúc ghi</dt>
                    <dd>
                      {event.details.standard_snapshot.code} ·{" "}
                      {event.details.standard_snapshot.name}
                    </dd>
                  </div>
                  <div>
                    <dt>Thời lượng</dt>
                    <dd>
                      {event.details.duration_minutes === undefined
                        ? "—"
                        : `${number(event.details.duration_minutes)} phút`}
                    </dd>
                  </div>
                  <div>
                    <dt>Lượng nước</dt>
                    <dd>
                      {event.details.water_volume_l
                        ? `${number(event.details.water_volume_l)} lít`
                        : "Chưa ghi"}
                    </dd>
                  </div>
                </dl>
                <p>{event.details.note || "Không có ghi chú"}</p>
                {event.correction_reason && (
                  <Notice>Lý do đính chính: {event.correction_reason}</Notice>
                )}
                {event.details.materials && (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Vật tư tại lúc ghi</th>
                          <th>Lượng sử dụng</th>
                          <th>Liều mặc định</th>
                          <th>Cách ly</th>
                          <th>Thuộc tiêu chuẩn</th>
                        </tr>
                      </thead>
                      <tbody>
                        {event.details.materials.map((material) => (
                          <tr key={material.material_id}>
                            <td>{material.name}</td>
                            <td>
                              {number(material.quantity)} {material.unit}
                            </td>
                            <td>{material.default_dosage}</td>
                            <td>{material.quarantine_days} ngày</td>
                            <td>
                              {material.standard_linked
                                ? "Có"
                                : "Ngoài tiêu chuẩn"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!!event.details.warnings.length && (
                  <Notice kind="warning">
                    Có vật tư ngoài tiêu chuẩn. Kiểm tra danh sách và thời gian
                    cách ly trước khi tiếp tục chăm sóc.
                  </Notice>
                )}
                {event.hash && (
                  <p className="break-word">
                    <small>SHA-256: {event.hash}</small>
                  </p>
                )}
                <div className="workflow-form-actions">
                  {zoneId && zones.data?.some((x) => x.id === zoneId) && (
                    <button
                      className="button secondary"
                      onClick={() => setAction("chain")}
                    >
                      Kiểm tra chuỗi khu vực
                    </button>
                  )}
                  {author && pending && (
                    <>
                      <button
                        className="button secondary"
                        onClick={() => setAction("delete")}
                      >
                        Xóa nhật ký chờ khóa
                      </button>
                      <button
                        className="button"
                        onClick={() => setAction("edit")}
                      >
                        Chỉnh sửa nhật ký
                      </button>
                    </>
                  )}
                  {author && event.status === "Locked" && (
                    <button
                      className="button"
                      onClick={() => setAction("correct")}
                    >
                      Tạo bản đính chính
                    </button>
                  )}
                </div>
              </section>
              <LineagePanel id={event._id} />
              {(action === "edit" || action === "correct") && (
                <JournalEditor
                  event={event}
                  correction={action === "correct"}
                  onClose={() => setAction(undefined)}
                  onSaved={saved}
                />
              )}
              {action === "delete" && (
                <ConfirmDialog
                  title="Xóa nhật ký chờ khóa"
                  path={`cultivation-events/${event._id}`}
                  method="DELETE"
                  onClose={() => setAction(undefined)}
                  onSaved={saved}
                >
                  <p>
                    Chỉ tác giả được xóa trước thời hạn khóa. Nhật ký đã khóa
                    được giữ nguyên.
                  </p>
                </ConfirmDialog>
              )}
              {action === "chain" && zoneId && (
                <ChainDialog
                  zoneId={zoneId}
                  onClose={() => setAction(undefined)}
                />
              )}
            </>
          );
        }}
      </DataState>
    </>
  );
}
export function JournalEditor({
  event,
  initial,
  correction = false,
  onClose,
  onSaved,
}: {
  event?: Journal;
  initial?: ControlJournalPrefill;
  correction?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const task = useTask();
  const [uncertain, setUncertain] = useState(false);
  const [workConfirmed, setWorkConfirmed] = useState(false);
  const [targetType, setTargetType] = useState<"Zone" | "Tree">(
    event?.target_type ?? "Zone",
  );
  const [zoneId, setZoneId] = useState(
    event?.target_type === "Zone" ? event.target_id : (initial?.zoneId ?? ""),
  );
  const [treeId, setTreeId] = useState(
    event?.target_type === "Tree" ? event.target_id : "",
  );
  const [activity, setActivity] = useState<Activity>(
    event?.action_type ?? initial?.activity ?? "Watering",
  );
  const [duration, setDuration] = useState(
    String(event?.details.duration_minutes ?? initial?.duration ?? ""),
  );
  const [water, setWater] = useState(
    String(event?.details.water_volume_l ?? ""),
  );
  const [note, setNote] = useState(event?.details.note ?? initial?.note ?? "");
  const [activityName, setActivityName] = useState(
    event?.details.activity_name ?? "",
  );
  const [reason, setReason] = useState("");
  const [materials, setMaterials] = useState(
    event?.details.materials?.map((x) => ({
      id: x.material_id,
      quantity: String(x.quantity),
    })) ?? [{ id: "", quantity: "" }],
  );
  return (
    <Modal
      title={
        correction
          ? "Tạo bản đính chính nhật ký"
          : event
            ? "Chỉnh sửa nhật ký chờ khóa"
            : "Thêm nhật ký canh tác"
      }
      onClose={() => {
        if (!task.busy) onClose();
      }}
    >
      <form
        className="workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (uncertain || (initial && !workConfirmed)) return;
          void task.run(async (signal) => {
            const details =
              activity === "Watering"
                ? {
                    duration_minutes: Number(duration),
                    ...(water ? { water_volume_l: Number(water) } : {}),
                    note: note.trim(),
                  }
                : activity === "Other"
                  ? { activity_name: activityName.trim(), note: note.trim() }
                  : {
                      materials: materials.map((x) => ({
                        material_id: x.id,
                        quantity: Number(x.quantity),
                      })),
                      note: note.trim(),
                    };
            if (
              activity !== "Watering" &&
              activity !== "Other" &&
              new Set(materials.map((x) => x.id)).size !== materials.length
            )
              throw new Error("Mỗi vật tư chỉ được xuất hiện một lần.");
            const body = {
              target_type: targetType,
              target_id: targetType === "Zone" ? zoneId : treeId,
              action_type: activity,
              details,
              ...(correction ? { correction_reason: reason.trim() } : {}),
            };
            try {
              await api.request(
                `cultivation-events${event ? `/${event._id}${correction ? "/corrections" : ""}` : ""}`,
                {
                  method: event && !correction ? "PATCH" : "POST",
                  body,
                  signal,
                },
              );
              if (!signal.aborted) onSaved();
            } catch (error) {
              if (
                error instanceof ApiError &&
                (error.status === 0 ||
                  error.status === 409 ||
                  error.status >= 500)
              )
                setUncertain(true);
              throw error;
            }
          });
        }}
      >
        <Notice>
          {correction
            ? "Bản gốc vẫn được giữ. Bản đính chính mới chờ khóa 15 phút và phải tham chiếu phiên bản đã khóa mới nhất."
            : "Có thể sửa hoặc xóa trong 15 phút kể từ khi ghi. Thời hạn không gia hạn khi sửa."}
        </Notice>
        <fieldset
          disabled={task.busy || uncertain}
          className="workflow-fieldset"
        >
          {initial && (
            <>
              <Notice kind="warning">
                Thời lượng điền sẵn chỉ ước tính từ các mốc lệnh, không phải
                thời gian đo hoạt động. Hãy sửa theo thực tế; phun cần nhập vật
                tư và lượng đã dùng. Nhật ký được ghi tại thời điểm bạn lưu.
              </Notice>
              <label>
                <input
                  type="checkbox"
                  required
                  checked={workConfirmed}
                  onChange={(e) => setWorkConfirmed(e.target.checked)}
                />{" "}
                Tôi đã kiểm tra và xác nhận công việc thực tế.
              </label>
            </>
          )}
          {!event && (
            <div className="form-grid">
              <Field label="Đối tượng canh tác">
                <select
                  value={targetType}
                  onChange={(e) =>
                    setTargetType(e.target.value as "Zone" | "Tree")
                  }
                >
                  <option value="Zone">Toàn khu vực</option>
                  <option value="Tree">Một cây</option>
                </select>
              </Field>
              <RelationSelect
                field={{
                  key: "zone_id",
                  label: "Khu vực",
                  relation: {
                    path: "zones",
                    label: (x) => String(x.zone_name),
                  },
                }}
                value={zoneId}
                onChange={(value) => {
                  setZoneId(value);
                  setTreeId("");
                }}
              />
              {targetType === "Tree" && zoneId && (
                <RelationSelect
                  field={{
                    key: "tree_id",
                    label: "Cây",
                    relation: {
                      path: `trees?zone_id=${zoneId}`,
                      label: (x) => `${x.tree_code} · ${x.variety}`,
                    },
                  }}
                  value={treeId}
                  onChange={setTreeId}
                />
              )}
            </div>
          )}
          <Field label="Hoạt động">
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value as Activity)}
            >
              {Object.entries(activityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {activity === "Watering" ? (
            <div className="form-grid">
              <Field label="Thời lượng tưới (phút)">
                <input
                  type="number"
                  required
                  min={0.001}
                  max={10080}
                  step={0.001}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </Field>
              <Field label="Lượng nước (lít, tùy chọn)">
                <input
                  type="number"
                  min={0.001}
                  max={1000000}
                  step={0.001}
                  value={water}
                  onChange={(e) => setWater(e.target.value)}
                />
              </Field>
            </div>
          ) : activity === "Other" ? (
            <Field label="Tên công việc khác">
              <input
                required
                maxLength={200}
                value={activityName}
                onChange={(e) => setActivityName(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <h3 className="workflow-subheading">Vật tư sử dụng</h3>
              {materials.map((material, index) => (
                <div key={index} className="workflow-material-row">
                  <RelationSelect
                    field={{
                      key: `material-${index}`,
                      label: `Vật tư ${index + 1}`,
                      relation: {
                        path: "materials?status=Active",
                        label: (x) => `${x.name} (${x.unit})`,
                      },
                    }}
                    value={material.id}
                    onChange={(value) =>
                      setMaterials((items) =>
                        items.map((x, i) =>
                          i === index ? { ...x, id: value } : x,
                        ),
                      )
                    }
                  />
                  <Field label={`Lượng vật tư ${index + 1}`}>
                    <input
                      required
                      type="number"
                      min={0.001}
                      max={1000000}
                      step={0.001}
                      value={material.quantity}
                      onChange={(e) =>
                        setMaterials((items) =>
                          items.map((x, i) =>
                            i === index
                              ? { ...x, quantity: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={materials.length === 1}
                    onClick={() =>
                      setMaterials((items) =>
                        items.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Bỏ
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button secondary"
                disabled={materials.length >= 20}
                onClick={() =>
                  setMaterials((items) => [...items, { id: "", quantity: "" }])
                }
              >
                Thêm vật tư
              </button>
            </>
          )}
          <Field label="Ghi chú">
            <textarea
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {correction && (
            <Field label="Lý do đính chính">
              <textarea
                required
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
        </fieldset>
        {task.error && <Notice kind="error">{task.error}</Notice>}
        {uncertain && (
          <Notice kind="warning">
            Đóng biểu mẫu và kiểm tra lại trạng thái nhật ký trước khi gửi tiếp.
          </Notice>
        )}
        <div className="workflow-form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={task.busy}
            onClick={onClose}
          >
            Đóng
          </button>
          <button className="button" disabled={task.busy || uncertain}>
            {task.busy ? "Đang ghi…" : "Lưu nhật ký"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function LineagePanel({ id }: { id: string }) {
  const [offset, setOffset] = useState(0);
  const resource = useGet<Page<Journal>>(
    `cultivation-events/${id}/corrections${queryString({ limit: 20, offset })}`,
  );
  return (
    <section className="panel">
      <h2>Lịch sử các phiên bản</h2>
      <p className="muted">
        Phiên bản đã khóa giữ nguyên; bản đính chính đang chờ khóa chưa thay thế
        nội dung đã khóa.
      </p>
      <DataState resource={resource}>
        {(data) => (
          <div className="workflow-timeline">
            {data.items.map((event) => (
              <article key={event._id}>
                <Link to={`/cultivation-events/${event._id}`}>
                  {event.is_correction ? "Bản đính chính" : "Bản gốc"} ·{" "}
                  {dateTime(event.created_at)}
                </Link>
                <LockState event={event} onExpired={resource.reload} />
                <p>{event.correction_reason || event.details.note}</p>
              </article>
            ))}
          </div>
        )}
      </DataState>
      {resource.data && <Pagination {...resource.data} onChange={setOffset} />}
    </section>
  );
}
function ChainDialog({
  zoneId,
  onClose,
}: {
  zoneId: string;
  onClose: () => void;
}) {
  const resource = useGet<{
    valid: boolean;
    locked_events: number;
    tail_hash: string | null;
    checked_at: string;
    algorithm: string;
    failure: { code: string; event_id: string | null } | null;
  }>(`cultivation-events/zones/${zoneId}/chain/verify`);
  return (
    <Modal title="Tính toàn vẹn chuỗi nhật ký" onClose={onClose}>
      <div className="workflow-form">
        <Notice>
          Kiểm tra chuỗi nhật ký đã khóa trong khu vực. Hash không chứng minh
          các thao tác canh tác ngoài thực tế đã xảy ra.
        </Notice>
        <DataState resource={resource}>
          {(data) => (
            <>
              <Notice kind={data.valid ? "success" : "error"}>
                {data.valid
                  ? "Chuỗi nhật ký đã khóa toàn vẹn."
                  : "Phát hiện sai lệch trong chuỗi nhật ký."}
              </Notice>
              <dl className="details">
                <div>
                  <dt>Bản ghi đã khóa</dt>
                  <dd>{number(data.locked_events)}</dd>
                </div>
                <div>
                  <dt>Kiểm tra lúc</dt>
                  <dd>{dateTime(data.checked_at)}</dd>
                </div>
                <div>
                  <dt>Thuật toán</dt>
                  <dd>{data.algorithm}</dd>
                </div>
                <div>
                  <dt>Dấu kiểm chứng cuối chuỗi</dt>
                  <dd className="break-word">
                    {data.tail_hash ?? "Chưa có bản ghi đã khóa"}
                  </dd>
                </div>
              </dl>
              {data.failure && (
                <Notice kind="error">
                  Mã sai lệch: {data.failure.code}
                  {data.failure.event_id && (
                    <Link to={`/cultivation-events/${data.failure.event_id}`}>
                      {" "}
                      · Xem bản ghi liên quan
                    </Link>
                  )}
                </Notice>
              )}
            </>
          )}
        </DataState>
        <button className="button secondary" onClick={resource.reload}>
          Kiểm tra lại
        </button>
      </div>
    </Modal>
  );
}
export function RecentJournals({
  zoneIds,
  mine = false,
  period = "all",
}: {
  zoneIds?: string[];
  mine?: boolean;
  period?: Period;
}) {
  const { api } = useSession();
  const path = `cultivation-events${mine ? "/mine" : ""}`;
  const load = useCallback(
    (signal: AbortSignal) =>
      collectPages<Journal>(
        (offset) =>
          api.request<Page<Journal>>(`${path}?limit=100&offset=${offset}`, {
            signal,
          }),
        (event) => event._id,
      ),
    [api, path],
  );
  const resource = useResource(path, load);
  const trees = useCollection<Tree>("trees", !!zoneIds);
  const today = vietnamDay(Date.now());
  const start = vietnamDay(
    Date.parse(`${today}T12:00:00+07:00`) -
      (period === "7days" ? 6 : period === "30days" ? 29 : 0) * 86400000,
  );
  const data = resource.data
    ?.filter(
      (event) =>
        (!zoneIds ||
          zoneIds.includes(
            event.target_type === "Zone"
              ? event.target_id
              : (trees.data?.find((x) => x.id === event.target_id)?.zone_id ??
                  ""),
          )) &&
        (period === "all" ||
          (vietnamDay(Date.parse(event.created_at)) >= start &&
            vietnamDay(Date.parse(event.created_at)) <= today)),
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 5);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Nhật ký canh tác gần đây</h2>
        <Link to="/cultivation-events">Xem tất cả →</Link>
      </div>
      <DataState resource={resource} empty={data?.length === 0}>
        {() => (
          <div className="workflow-timeline">
            {data?.map((event) => (
              <article key={event._id}>
                <Link to={`/cultivation-events/${event._id}`}>
                  {activityLabels[event.action_type]}
                </Link>
                <p>{event.details.note || "Không có ghi chú"}</p>
                <small>{dateTime(event.created_at)}</small>
                <LockState event={event} onExpired={resource.reload} />
              </article>
            ))}
          </div>
        )}
      </DataState>
    </section>
  );
}
