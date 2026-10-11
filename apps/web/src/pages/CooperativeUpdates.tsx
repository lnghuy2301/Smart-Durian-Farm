import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, queryString } from "../api/client";
import { useSession } from "../auth/session";
import { useTask } from "../hooks/useTask";
import {
  DataState,
  Field,
  Notice,
  PageHeader,
  Pagination,
  dateTime,
} from "../components/ui";
import {
  ConfirmDialog,
  Diff,
  EditorDialog,
  useGet,
  type InputField,
} from "../workflows/shared";
import type { Cooperative, Page } from "../types/api";
interface UpdateRequest {
  id: string;
  cooperative_id: string;
  manager_id: string;
  proposed_changes: Record<string, string>;
  status:
    | "EmailSending"
    | "EmailPending"
    | "EmailVerified"
    | "SmsSending"
    | "SmsPending"
    | "SmsChecking"
    | "Accepted"
    | "Cancelled"
    | "Expired"
    | "Failed";
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  email_verified_at: string | null;
}
const labels: Record<UpdateRequest["status"], string> = {
  EmailSending: "Đang gửi email",
  EmailPending: "Chờ xác minh email",
  EmailVerified: "Email đã xác minh",
  SmsSending: "Đang gửi SMS",
  SmsPending: "Chờ xác minh điện thoại",
  SmsChecking: "Đang kiểm tra SMS",
  Accepted: "Đã áp dụng",
  Cancelled: "Đã hủy",
  Expired: "Hết hạn",
  Failed: "Không hoàn tất",
};
const fields: InputField[] = [
  { key: "cooperative_name", label: "Tên hợp tác xã", maxLength: 40 },
  { key: "director", label: "Người đại diện / giám đốc", maxLength: 40 },
  { key: "address", label: "Địa chỉ", type: "textarea", maxLength: 255 },
  {
    key: "contact_number",
    label: "Điện thoại liên hệ",
    maxLength: 14,
    pattern: "[+]?[0-9]{9,13}",
  },
];
export function ManagerCooperativeEdit({
  cooperative,
  onSaved,
}: {
  cooperative: Cooperative;
  onSaved: () => void;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (user.role !== "Manager" || cooperative.manager_id !== user.id)
    return null;
  return (
    <>
      <div className="workflow-navigation actions">
        <button className="button" onClick={() => setOpen(true)}>
          Yêu cầu cập nhật HTX
        </button>
        <Link className="button secondary" to="/cooperative-updates">
          Xác minh và lịch sử yêu cầu
        </Link>
      </div>
      {open && (
        <EditorDialog
          title="Cập nhật thông tin HTX"
          fields={fields}
          initial={{ ...cooperative }}
          before={{ ...cooperative }}
          path={`cooperatives/${cooperative.id}/update-requests`}
          onClose={() => setOpen(false)}
          onSaved={(result) => {
            setOpen(false);
            onSaved();
            const request = result as UpdateRequest;
            navigate(`/cooperative-updates${queryString({ id: request.id })}`);
          }}
        >
          <Notice>
            Thông tin chỉ áp dụng sau khi xác minh email rồi điện thoại của tài
            khoản Manager. Số chứng nhận do Admin quản lý.
          </Notice>
        </EditorDialog>
      )}
    </>
  );
}
export function CooperativeUpdatesPage() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const selected = params.get("id");
  const value = Number(params.get("offset") ?? 0);
  const offset =
    Number.isInteger(value) && value >= 0 && value <= 100000 ? value : 0;
  const resource = useGet<Page<UpdateRequest>>(
    `cooperative-update-requests${queryString({ offset, limit: 20 })}`,
  );
  return (
    <>
      <PageHeader
        title="Yêu cầu cập nhật hợp tác xã"
        subtitle="Xác minh theo hai bước và theo dõi kết quả áp dụng."
        actions={
          <button className="button secondary" onClick={resource.reload}>
            Làm mới
          </button>
        }
      />
      {user.role === "Farmer" ? (
        <Notice kind="warning">Trang này dành cho Admin và Manager.</Notice>
      ) : (
        <>
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
                        <th>Yêu cầu</th>
                        <th>Thời gian gửi</th>
                        <th>Trạng thái</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((item) => (
                        <tr key={item.id}>
                          <td className="break-word">
                            <strong>
                              {item.proposed_changes.cooperative_name ||
                                "Cập nhật thông tin HTX"}
                            </strong>
                            <small>{item.id}</small>
                          </td>
                          <td>{dateTime(item.created_at)}</td>
                          <td>{labels[item.status]}</td>
                          <td>
                            <button
                              className="button secondary"
                              onClick={() =>
                                setParams({
                                  id: item.id,
                                  offset: String(offset),
                                })
                              }
                            >
                              Xem yêu cầu
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DataState>
            {resource.data && (
              <Pagination
                {...resource.data}
                onChange={(next) => setParams({ offset: String(next) })}
              />
            )}
          </section>
          {selected && (
            <CooperativeVerification
              key={selected}
              id={selected}
              onChanged={resource.reload}
            />
          )}
        </>
      )}
    </>
  );
}
function CooperativeVerification({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}) {
  const { api, user } = useSession();
  const resource = useGet<UpdateRequest>(`cooperative-update-requests/${id}`);
  const task = useTask();
  const [otp, setOtp] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const request = resource.data;
  useEffect(() => {
    if (
      !request ||
      ["Accepted", "Cancelled", "Expired", "Failed"].includes(request.status)
    )
      return;
    const timer = setTimeout(
      resource.reload,
      Math.max(0, Date.parse(request.expires_at) - Date.now()) + 250,
    );
    return () => clearTimeout(timer);
  }, [request, resource.reload]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cooldown]);
  function check() {
    if (task.busy) return;
    setUncertain(false);
    task.setError("");
    resource.reload();
    onChanged();
  }
  function mutate(action: string, body = {}) {
    if (uncertain) return;
    void task.run(async (signal) => {
      try {
        await api.request(`cooperative-update-requests/${id}/${action}`, {
          method: "POST",
          body,
          signal,
        });
        if (!signal.aborted) {
          setOtp("");
          if (action.endsWith("resend") || action.endsWith("send"))
            setCooldown(60);
          resource.reload();
          onChanged();
        }
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 0 || error.status === 409 || error.status >= 500)
        )
          setUncertain(true);
        if (error instanceof ApiError && error.status === 429) setCooldown(60);
        throw error;
      }
    });
  }
  return (
    <section className="panel workflow-summary">
      <div className="panel-heading">
        <h2>Xác minh yêu cầu</h2>
        <button
          className="button secondary"
          disabled={task.busy}
          onClick={check}
        >
          Kiểm tra trạng thái
        </button>
      </div>
      <DataState resource={resource}>
        {(item) => {
          const own = item.manager_id === user.id && user.role === "Manager";
          const verifying =
            own &&
            Date.parse(item.expires_at) > Date.now() &&
            ["EmailPending", "EmailVerified", "SmsPending"].includes(
              item.status,
            );
          return (
            <>
              <Notice kind={item.status === "Accepted" ? "success" : "info"}>
                {labels[item.status]} · Hạn hiện tại:{" "}
                {dateTime(item.expires_at)}
              </Notice>
              <Diff
                changes={item.proposed_changes}
                labels={Object.fromEntries(
                  fields.map((field) => [field.key, field.label]),
                )}
              />
              {verifying && (
                <div className="workflow-form">
                  {["EmailPending", "SmsPending"].includes(item.status) && (
                    <form
                      className="workflow-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        mutate(
                          item.status === "EmailPending"
                            ? "email/verify"
                            : "sms/verify",
                          { otp },
                        );
                      }}
                    >
                      <Field
                        label={
                          item.status === "EmailPending"
                            ? "Mã xác minh email"
                            : "Mã xác minh điện thoại"
                        }
                      >
                        <input
                          required
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={otp}
                          disabled={task.busy || uncertain}
                          onChange={(e) =>
                            setOtp(e.target.value.replace(/\D/g, ""))
                          }
                        />
                      </Field>
                      <button
                        className="button"
                        disabled={task.busy || uncertain}
                      >
                        Xác minh mã
                      </button>
                    </form>
                  )}
                  <div className="actions">
                    {item.status === "EmailPending" && (
                      <button
                        className="button secondary"
                        disabled={task.busy || uncertain || !!cooldown}
                        onClick={() => mutate("email/resend")}
                      >
                        {cooldown
                          ? `Gửi lại sau ${cooldown}s`
                          : "Gửi lại mã email"}
                      </button>
                    )}
                    {(item.status === "EmailVerified" ||
                      item.status === "SmsPending") && (
                      <button
                        className="button"
                        disabled={task.busy || uncertain || !!cooldown}
                        onClick={() => mutate("sms/send")}
                      >
                        {cooldown
                          ? `Gửi lại sau ${cooldown}s`
                          : item.status === "EmailVerified"
                            ? "Gửi mã xác minh điện thoại"
                            : "Gửi lại mã điện thoại"}
                      </button>
                    )}
                    <button
                      className="button secondary"
                      disabled={task.busy || uncertain}
                      onClick={() => setCancel(true)}
                    >
                      Hủy yêu cầu
                    </button>
                  </div>
                </div>
              )}
              {!own && (
                <p className="muted">
                  Chỉ Manager gửi yêu cầu được xác minh. Admin có thể theo dõi
                  kết quả.
                </p>
              )}
              {task.error && <Notice kind="error">{task.error}</Notice>}
              {uncertain && (
                <Notice kind="warning">
                  Kết quả thao tác chưa xác định hoặc hồ sơ đã thay đổi. Kiểm
                  tra trạng thái trước khi gửi tiếp.
                </Notice>
              )}
              {item.status === "Accepted" && (
                <Link
                  className="button"
                  to={`/cooperatives/${item.cooperative_id}`}
                >
                  Xem thông tin HTX đã cập nhật
                </Link>
              )}
              {cancel && (
                <ConfirmDialog
                  title="Hủy yêu cầu cập nhật"
                  path={`cooperative-update-requests/${id}/cancel`}
                  onClose={() => setCancel(false)}
                  onSaved={() => {
                    setCancel(false);
                    resource.reload();
                    onChanged();
                  }}
                >
                  <p>
                    Nội dung hiện tại của HTX giữ nguyên. Các mã của yêu cầu này
                    sẽ không dùng để cập nhật nữa.
                  </p>
                </ConfirmDialog>
              )}
            </>
          );
        }}
      </DataState>
    </section>
  );
}
