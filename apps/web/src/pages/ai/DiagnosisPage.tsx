import { useCallback, useEffect, useState } from "react";
import "./DiagnosisHistory.css";
import { Link, useSearchParams } from "react-router-dom";
import {
  Camera,
  ImagePlus,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { useSession } from "../../auth/session";
import { useResource } from "../../hooks/useResource";
import { useTask } from "../../hooks/useTask";
import { ConfirmDialog, useCollection } from "../../workflows/shared";
import {
  DataState,
  Field,
  Notice,
  Pagination,
  dateTime,
} from "../../components/ui";
import type { Page, Zone } from "../../types/api";
import {
  validateImage,
  type AiModel,
  type AiStatus,
  type Diagnosis,
} from "./types";

function useImageUrl(blob?: Blob) {
  const [value, setValue] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setValue({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return value?.blob === blob ? value?.url : undefined;
}

export function DiagnosisPage({ status }: { status?: AiStatus }) {
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  const [revision, setRevision] = useState(0);
  return (
    <>
      <div className="ai-page-intro">
        <h2>Kiểm tra ảnh sâu bệnh</h2>
        <p>
          Chụp rõ dấu hiệu trên cây sầu riêng. AI đưa ra gợi ý để bạn đối chiếu
          tại vườn.
        </p>
      </div>
      {id ? (
        <DiagnosisDetail key={id} id={id} />
      ) : (
        <UploadDiagnosis
          status={status}
          onSaved={(record) => {
            setRevision((value) => value + 1);
            setParams({ id: record.id });
          }}
        />
      )}
      <DiagnosisHistory
        revision={revision}
        selected={id}
        onDeleted={(deletedId) => {
          if (id === deletedId) setParams({});
          setRevision((value) => value + 1);
        }}
      />
    </>
  );
}

function UploadDiagnosis({
  status,
  onSaved,
}: {
  status?: AiStatus;
  onSaved: (record: Diagnosis) => void;
}) {
  const { api } = useSession();
  const [file, setFile] = useState<File>();
  const [zoneId, setZoneId] = useState("");
  const [showZone, setShowZone] = useState(false);
  const zones = useCollection<Zone>("zones", showZone);
  const task = useTask();
  const preview = useImageUrl(file);
  const loadModel = useCallback(
    (signal: AbortSignal) =>
      status?.image_service_enabled
        ? api.request<AiModel>("ai/model", { signal, timeoutMs: 45000 })
        : Promise.resolve(null),
    [api, status?.image_service_enabled],
  );
  const model = useResource(
    `ai/model:${status?.image_service_enabled}`,
    loadModel,
  );
  const ready = !!status?.image_service_enabled && !!model.data;
  function choose(selected?: File) {
    if (!selected || task.busy) return;
    setFile(undefined);
    void task.run(async (signal) => {
      await validateImage(selected);
      signal.throwIfAborted();
      setFile(selected);
    });
  }
  return (
    <>
      {status && !status.image_service_enabled && (
        <Notice>
          Tính năng phân tích ảnh chưa được bật. Bạn có thể xem lịch sử đã lưu
          bên dưới.
        </Notice>
      )}
      {model.error && (
        <Notice kind="warning">
          Chưa kết nối được mô hình nhận diện.{" "}
          <button className="button secondary" onClick={model.reload}>
            Kiểm tra lại mô hình
          </button>
        </Notice>
      )}
      <div className="ai-diagnosis-grid">
        <section className="panel ai-upload" aria-label="Ảnh cần kiểm tra">
          <h3>1. Chọn ảnh cần kiểm tra</h3>
          <div className={`ai-photo ${preview ? "has-photo" : ""}`}>
            {preview ? (
              <img src={preview} alt="Ảnh bạn chọn để kiểm tra" />
            ) : (
              <>
                <ImagePlus size={42} />
                <p>
                  Chụp gần dấu hiệu bất thường,
                  <br />
                  đủ sáng và không bị nhòe.
                </p>
              </>
            )}
          </div>
          {file && (
            <p className="table-note">
              {file.name} ·{" "}
              {(file.size / 1024 / 1024).toLocaleString("vi-VN", {
                maximumFractionDigits: 2,
              })}{" "}
              MB
            </p>
          )}
          <div className="ai-photo-actions">
            <label className="button secondary ai-file-button">
              <ImagePlus size={18} /> Chọn ảnh
              <input
                aria-label="Chọn ảnh sâu bệnh"
                type="file"
                accept="image/jpeg,image/png"
                disabled={task.busy}
                onChange={(event) => {
                  choose(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <label className="button secondary ai-file-button">
              <Camera size={18} /> Chụp ảnh
              <input
                aria-label="Chụp ảnh tại vườn"
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                disabled={task.busy}
                onChange={(event) => {
                  choose(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="table-note">
            Một ảnh JPEG hoặc PNG, tối đa 5 MB. Ảnh chỉ được gửi khi bạn bấm
            Phân tích ảnh.
          </p>
          <details
            className="ai-optional"
            onToggle={(event) => setShowZone(event.currentTarget.open)}
          >
            <summary>Gắn với khu vực vườn (không bắt buộc)</summary>
            {showZone && (
              <DataState resource={zones}>
                {(items) => (
                  <Field label="Khu vực của ảnh">
                    <select
                      disabled={task.busy}
                      value={zoneId}
                      onChange={(event) => setZoneId(event.target.value)}
                    >
                      <option value="">Không gắn khu vực</option>
                      {items.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.zone_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </DataState>
            )}
          </details>
          {zoneId && !showZone && (
            <p className="table-note">
              Ảnh sẽ được gắn với khu vực đã chọn. Mở mục trên để đổi hoặc bỏ
              liên kết.
            </p>
          )}
          {task.error && (
            <Notice kind="error">
              {task.error} Nếu kết nối bị ngắt, hãy kiểm tra lịch sử trước khi
              gửi lại.
            </Notice>
          )}
          <button
            className="button full"
            disabled={!file || !ready || task.busy}
            onClick={() =>
              void task.run(async (signal) => {
                const body = new FormData();
                body.append("image", file!);
                if (zoneId) body.append("zone_id", zoneId);
                const record = await api.request<Diagnosis>("ai/diagnoses", {
                  method: "POST",
                  body,
                  signal,
                  timeoutMs: 45000,
                });
                onSaved(record);
              })
            }
          >
            {task.busy
              ? "Đang xử lý ảnh…"
              : model.loading && status?.image_service_enabled
                ? "Đang kiểm tra mô hình…"
                : "Phân tích ảnh"}
          </button>
        </section>
        <section
          className="panel ai-result-placeholder"
          aria-label="Hướng dẫn xem kết quả"
        >
          <h3>2. Xem gợi ý và đối chiếu</h3>
          <Camera size={40} />
          <p>Kết quả sẽ hiện ở đây sau khi phân tích.</p>
          <p className="muted">
            AI gợi ý tối đa 3 khả năng. Mô hình hiện chưa có lớp cây khỏe mạnh
            hoặc ảnh ngoài phạm vi, vì vậy không thể xác nhận cây không mắc
            bệnh.
          </p>
          <details className="ai-optional">
            <summary>Mẹo chọn ảnh và phạm vi nhận diện</summary>
            <p>
              Lấy nét vào dấu hiệu cần kiểm tra, giữ máy chắc tay và dùng ánh
              sáng tự nhiên.
            </p>
            {model.data && (
              <p>
                Các nhóm mô hình hỗ trợ:{" "}
                {model.data.classes.map((item) => item.label_vi).join(", ")}.
              </p>
            )}
          </details>
        </section>
      </div>
    </>
  );
}

function DiagnosisDetail({ id }: { id: string }) {
  const { api } = useSession();
  const load = useCallback(
    (signal: AbortSignal) =>
      api.request<Diagnosis>(`ai/diagnoses/${encodeURIComponent(id)}`, {
        signal,
      }),
    [api, id],
  );
  const resource = useResource(`ai/diagnoses/${id}`, load);
  return (
    <>
      <div className="ai-toolbar">
        <Link className="button secondary" to="/ai/diagnoses">
          <ImagePlus size={18} /> Kiểm tra ảnh mới
        </Link>
        <button className="button secondary" onClick={resource.reload}>
          <RefreshCw size={16} /> Tải lại kết quả
        </button>
      </div>
      <DataState resource={resource}>
        {(record) => <DiagnosisResult key={record.id} record={record} />}
      </DataState>
    </>
  );
}

function DiagnosisResult({ record }: { record: Diagnosis }) {
  const { api } = useSession();
  const [feedback, setFeedback] = useState(record.user_feedback);
  const task = useTask();
  // Always construct the authenticated endpoint from the record ID; never use
  // an arbitrary image_url from data as a credential-bearing request target.
  const load = useCallback(
    (signal: AbortSignal) =>
      api.request<Blob>(`ai/diagnoses/${record.id}/image`, {
        signal,
        responseType: "blob",
      }),
    [api, record.id],
  );
  const image = useResource(`ai/image/${record.id}`, load);
  const url = useImageUrl(image.data);
  return (
    <div className="ai-diagnosis-grid">
      <section className="panel" aria-label="Ảnh đã kiểm tra">
        <h3>Ảnh đã kiểm tra</h3>
        <DataState resource={image}>
          {() =>
            url ? (
              <img
                className="ai-saved-photo"
                src={url}
                alt="Ảnh đã gửi để kiểm tra sâu bệnh"
              />
            ) : (
              <p role="status">Đang mở ảnh…</p>
            )
          }
        </DataState>
        <p className="table-note">
          {dateTime(record.created_at)} ·{" "}
          {record.zone_id ? (
            <Link to={`/zones/${record.zone_id}`}>Đã gắn khu vực</Link>
          ) : (
            "Không gắn khu vực"
          )}
        </p>
      </section>
      <section className="panel ai-predictions" aria-label="Gợi ý từ ảnh">
        <span className="section-label">KẾT QUẢ THAM KHẢO</span>
        <h3>Gợi ý từ ảnh của bạn</h3>
        <ol>
          {record.ai_predictions.map((item, index) => (
            <li key={item.class_id}>
              <div>
                <span className="ai-rank">{index + 1}</span>
                <strong>{item.label_vi || item.label}</strong>
              </div>
              <span>
                Điểm mô hình:{" "}
                <strong>
                  {item.confidence.toLocaleString("vi-VN", {
                    maximumFractionDigits: 6,
                  })}
                </strong>{" "}
                / 1
              </span>
            </li>
          ))}
        </ol>
        <Notice kind="warning">
          Đây là gợi ý phân loại, chưa phải kết luận bệnh. Điểm mô hình dùng để
          xếp hạng các khả năng, không phải tỷ lệ chắc chắn cây mắc bệnh.
        </Notice>
        <p className="muted">
          Đối chiếu dấu hiệu tại vườn; nếu cây bị ảnh hưởng nặng hoặc chưa rõ
          nguyên nhân, hãy trao đổi với cán bộ kỹ thuật trước khi xử lý.
        </p>
        <div className="ai-feedback">
          <h4>Gợi ý có phù hợp với quan sát của bạn?</h4>
          <div className="ai-toolbar">
            {[true, false].map((value) => (
              <button
                key={String(value)}
                className={`button secondary ${feedback === value ? "selected" : ""}`}
                aria-pressed={feedback === value}
                disabled={task.busy}
                onClick={() =>
                  void task.run(async (signal) => {
                    const updated = await api.request<Diagnosis>(
                      `ai/diagnoses/${record.id}/feedback`,
                      {
                        method: "PATCH",
                        body: { user_feedback: value },
                        signal,
                      },
                    );
                    setFeedback(updated.user_feedback);
                  })
                }
              >
                {value ? <ThumbsUp size={17} /> : <ThumbsDown size={17} />}{" "}
                {value ? "Phù hợp" : "Chưa phù hợp"}
              </button>
            ))}
          </div>
          {feedback !== null && (
            <p className="table-note">Đã ghi nhận đánh giá của bạn.</p>
          )}
          {task.error && <Notice kind="error">{task.error}</Notice>}
        </div>
      </section>
    </div>
  );
}

function DiagnosisHistory({
  revision,
  selected,
  onDeleted,
}: {
  revision: number;
  selected: string | null;
  onDeleted: (id: string) => void;
}) {
  const { api } = useSession();
  const [offset, setOffset] = useState(0);
  const [deleting, setDeleting] = useState<Diagnosis>();
  const path = `ai/diagnoses?limit=10&offset=${offset}`;
  const load = useCallback(
    (signal: AbortSignal) => api.request<Page<Diagnosis>>(path, { signal }),
    [api, path],
  );
  const history = useResource(`${path}:${revision}`, load);
  return (
    <details className="panel ai-history" open={!!selected}>
      <summary>Lịch sử kiểm tra ảnh của tôi</summary>
      <div className="ai-toolbar">
        <p className="table-note">
          Chỉ hiển thị các lần kiểm tra trong tài khoản của bạn.
        </p>
        <button className="button secondary" onClick={history.reload}>
          Làm mới lịch sử ảnh
        </button>
      </div>
      <DataState resource={history}>
        {(data) =>
          data.items.length ? (
            <ul className="ai-history-list">
              {data.items.map((item) => (
                <li key={item.id} className="ai-diagnosis-entry">
                  <Link
                    aria-current={selected === item.id ? "page" : undefined}
                    to={`?id=${item.id}`}
                  >
                    <strong>
                      {item.ai_predictions[0]?.label_vi ||
                        item.ai_predictions[0]?.label ||
                        "Xem gợi ý đã lưu"}
                    </strong>
                    <span>{dateTime(item.created_at)}</span>
                    <span className="ai-history-open">Xem lại →</span>
                  </Link>
                  <button
                    type="button"
                    className="button secondary ai-delete-chat"
                    aria-label={`Xóa lần kiểm tra ảnh: ${dateTime(item.created_at)}`}
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 size={17} /> Xóa
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ai-empty">
              Bạn chưa có lần kiểm tra ảnh nào. Chọn ảnh ở phía trên để bắt đầu.
            </p>
          )
        }
      </DataState>
      {history.data && <Pagination {...history.data} onChange={setOffset} />}
      {deleting && (
        <ConfirmDialog
          title="Xóa lịch sử kiểm tra ảnh"
          method="DELETE"
          path={`ai/diagnoses/${encodeURIComponent(deleting.id)}`}
          onClose={() => setDeleting(undefined)}
          onSaved={() => {
            const deletedId = deleting.id;
            setDeleting(undefined);
            if (offset > 0 && history.data?.items.length === 1)
              setOffset(Math.max(0, offset - 10));
            history.reload();
            onDeleted(deletedId);
          }}
        >
          <p>
            Xóa kết quả kiểm tra và ảnh đã lưu? Bạn không thể khôi phục sau khi
            xóa.
          </p>
        </ConfirmDialog>
      )}
    </details>
  );
}
