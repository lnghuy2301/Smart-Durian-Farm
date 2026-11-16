import { useCallback, useState } from "react";
import { useSession } from "../auth/session";
import { queryString } from "../api/client";
import { useResource } from "../hooks/useResource";
import { DataState, Field, Notice } from "../components/ui";
import { EditorDialog } from "./shared";

interface Candidate {
  id: string;
  user_name: string;
  phone_number: string;
  previously_assigned: boolean;
}
interface Results {
  items: Candidate[];
  has_more: boolean;
}
export function AssignmentInviteDialog({
  zoneId,
  onClose,
  onSaved,
}: {
  zoneId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const [draft, setDraft] = useState(""),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Candidate>();
  const [error, setError] = useState("");
  const path = `zones/${zoneId}/assignment-candidates${queryString({ q: query })}`;
  const load = useCallback(
    (signal: AbortSignal) => api.request<Results>(path, { signal }),
    [api, path],
  );
  const resource = useResource(path, load);
  function search() {
    const value = draft.trim();
    setSelected(undefined);
    if (value && [...value].length < 2) {
      setError("Nhập ít nhất 2 ký tự tên hoặc 4 chữ số điện thoại.");
      return;
    }
    setError("");
    if (value === query) resource.reload();
    else setQuery(value);
  }
  return (
    <EditorDialog
      title="Mời phụ trách khu vực"
      path={`zones/${zoneId}/assignment-requests`}
      fields={[
        {
          key: "start_date",
          label: "Bắt đầu",
          type: "datetime-local",
          required: false,
        },
        {
          key: "end_date",
          label: "Kết thúc dự kiến",
          type: "datetime-local",
          required: false,
          nullable: true,
        },
      ]}
      allowEmpty
      transform={(body) => {
        if (!selected)
          throw new Error(
            "Chọn nông dân từ kết quả tìm kiếm trước khi gửi lời mời.",
          );
        return { ...body, user_id: selected.id };
      }}
      onClose={onClose}
      onSaved={onSaved}
    >
      <Field
        label="Tìm nông dân bằng tên hoặc số điện thoại"
        hint="Tên từ 2 ký tự, điện thoại từ 4 chữ số. Chọn đúng người theo cả tên và số điện thoại."
      >
        <input
          maxLength={100}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSelected(undefined);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              search();
            }
          }}
        />
      </Field>
      <div className="actions">
        <button type="button" className="button secondary" onClick={search}>
          Tìm nông dân
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setDraft("");
            setQuery("");
            setSelected(undefined);
            setError("");
            resource.reload();
          }}
        >
          Người từng được phân công
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {draft.trim() === query && !error ? (
        <>
          <p>
            {query
              ? "Kết quả tìm kiếm"
              : "Nông dân từng được phân công tại vườn này"}
          </p>
          <DataState
            resource={resource}
            empty={resource.data?.items.length === 0}
          >
            {(data) => (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Họ tên</th>
                        <th>Số điện thoại</th>
                        <th>Chọn người nhận</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((person) => (
                        <tr key={person.id}>
                          <td>
                            {person.user_name}
                            {person.previously_assigned && (
                              <small>Đã làm việc tại vườn</small>
                            )}
                          </td>
                          <td>{person.phone_number}</td>
                          <td>
                            <button
                              className="button secondary"
                              type="button"
                              aria-label={`Chọn ${person.user_name} · ${person.phone_number}`}
                              aria-pressed={selected?.id === person.id}
                              onClick={() => setSelected(person)}
                            >
                              {selected?.id === person.id ? "Đã chọn" : "Chọn"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.has_more && (
                  <Notice>
                    Còn kết quả khác. Nhập tên hoặc số điện thoại cụ thể hơn.
                  </Notice>
                )}
              </>
            )}
          </DataState>
        </>
      ) : (
        <p>Nhấn Tìm nông dân để tải kết quả mới.</p>
      )}
      {selected && (
        <Notice kind="success">
          Đã chọn: {selected.user_name} · {selected.phone_number}
        </Notice>
      )}
      <p className="muted">
        Chưa có tài khoản? Hãy gửi người nhận đường dẫn trang Đăng ký của hệ
        thống, rồi tìm lại sau khi họ đăng ký. Lời mời xuất hiện trong tài khoản
        người nhận, không tự gửi SMS.
      </p>
      <p className="muted">
        Để trống ngày bắt đầu để áp dụng khi hoàn tất chấp thuận. Farmer phải
        nhận lời; cùng một khu vực không có các phân công chồng lấn.
      </p>
    </EditorDialog>
  );
}
