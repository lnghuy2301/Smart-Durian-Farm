import { useCallback, useState } from "react";
import { useSession } from "../auth/session";
import { ApiError } from "../api/client";
import { collectPages } from "../api/collection";
import { useResource } from "../hooks/useResource";
import { useTask } from "../hooks/useTask";
import { Field, Modal, Notice } from "../components/ui";
import { useCollection } from "./shared";
import type { AssignmentHistory, Farm, Zone, Page } from "../types/api";

interface Farmer {
  id: string;
  user_name: string;
  phone_number: string;
}
export function eligibleBackdateZones(
  farmer: string,
  farms: Farm[],
  zones: Zone[],
  assignments: AssignmentHistory[],
) {
  const owned = new Set(
    farms.filter((f) => f.owner_id === farmer).map((f) => f.id),
  );
  const assigned = new Set(
    assignments
      .filter((a) => a.assignment.user_id === farmer && a.active)
      .map((a) => a.assignment.zone_id),
  );
  return zones.filter((z) => owned.has(z.farm_id) || assigned.has(z.id));
}

export function HarvestBackdateEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const task = useTask();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [farmer, setFarmer] = useState<Farmer>();
  const [farm, setFarm] = useState(""),
    [zone, setZone] = useState("");
  const [day, setDay] = useState(""),
    [expires, setExpires] = useState(""),
    [reason, setReason] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const load = useCallback(
    (signal: AbortSignal) =>
      search.length >= 2
        ? api.request<{ items: Farmer[]; has_more: boolean }>(
            `users/farmers?q=${encodeURIComponent(search)}`,
            { signal },
          )
        : Promise.resolve({ items: [], has_more: false }),
    [api, search],
  );
  const results = useResource(`backdate-farmers:${search}`, load);
  const farms = useCollection<Farm>("farms", !!farmer);
  const zones = useCollection<Zone>("zones", !!farmer);
  const farmerId = farmer?.id;
  const loadAssignments = useCallback(
    (signal: AbortSignal) =>
      farmerId
        ? collectPages<AssignmentHistory>(
            (offset) =>
              api.request<Page<AssignmentHistory>>(
                `zone-assignments?limit=100&offset=${offset}`,
                { signal },
              ),
            (a) => a.assignment.id,
          )
        : Promise.resolve([]),
    [api, farmerId],
  );
  const assignments = useResource(
    `backdate-assignments:${farmerId ?? ""}`,
    loadAssignments,
  );
  const allowed = farmer
    ? eligibleBackdateZones(
        farmer.id,
        farms.data ?? [],
        zones.data ?? [],
        assignments.data ?? [],
      )
    : [];
  const choices = (farms.data ?? []).filter((f) =>
    allowed.some((z) => z.farm_id === f.id),
  );
  const scopeLoading = farms.loading || zones.loading || assignments.loading;
  const scopeError = farms.error || zones.error || assignments.error;
  const selectedZone = allowed.find((z) => z.id === zone && z.farm_id === farm);
  return (
    <Modal
      title="Cấp quyền nhập bù"
      onClose={() => {
        if (!task.busy) onClose();
      }}
    >
      <form
        className="workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !farmer ||
            !selectedZone ||
            uncertain ||
            scopeLoading ||
            scopeError
          )
            return;
          void task.run(async (signal) => {
            try {
              await api.request("harvest-backdate-permissions", {
                method: "POST",
                signal,
                body: {
                  user_id: farmer.id,
                  zone_id: selectedZone.id,
                  harvest_date: day,
                  expires_at: new Date(expires).toISOString(),
                  reason: reason.trim(),
                },
              });
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
        <fieldset
          className="workflow-fieldset"
          disabled={task.busy || uncertain}
        >
          <Field label="Tìm Farmer theo tên hoặc số điện thoại">
            <div className="actions">
              <input
                value={query}
                maxLength={100}
                placeholder="Nhập tên hoặc số điện thoại"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setFarmer(undefined);
                  setSearch("");
                  setFarm("");
                  setZone("");
                }}
              />
              <button
                type="button"
                className="button secondary"
                disabled={query.trim().length < 2 || results.loading}
                onClick={() => {
                  setSearch(query.trim());
                  results.reload();
                }}
              >
                Tìm Farmer
              </button>
            </div>
          </Field>
          {results.error && (
            <Notice kind="error">{results.error.message}</Notice>
          )}
          {search &&
            !results.loading &&
            !results.error &&
            !results.data?.items.length && (
              <Notice>Không tìm thấy Farmer Active phù hợp.</Notice>
            )}
          {!!results.data?.items.length && (
            <Field label="Người được cấp quyền">
              <select
                required
                value={farmer?.id ?? ""}
                onChange={(e) => {
                  setFarmer(
                    results.data?.items.find((f) => f.id === e.target.value),
                  );
                  setFarm("");
                  setZone("");
                }}
              >
                <option value="">Chọn Farmer</option>
                {results.data.items.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.user_name} · {f.phone_number}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {results.data?.has_more && (
            <Notice>
              Còn nhiều kết quả; nhập tên hoặc số điện thoại cụ thể hơn.
            </Notice>
          )}
          <div className="form-grid">
            <Field label="Vườn của Farmer">
              <select
                required
                value={farm}
                disabled={!farmer || scopeLoading || !!scopeError}
                onChange={(e) => {
                  setFarm(e.target.value);
                  setZone("");
                }}
              >
                <option value="">Chọn vườn</option>
                {choices.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.address}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Khu vực được cấp quyền">
              <select
                required
                value={zone}
                disabled={!farm || scopeLoading || !!scopeError}
                onChange={(e) => setZone(e.target.value)}
              >
                <option value="">Chọn khu vực</option>
                {allowed
                  .filter((z) => z.farm_id === farm)
                  .map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.zone_name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Ngày thu hoạch">
              <input
                required
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
            <Field label="Hạn sử dụng">
              <input
                required
                type="datetime-local"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </Field>
          </div>
          {scopeError && <Notice kind="error">{scopeError.message}</Notice>}
          {farmer && !scopeLoading && !scopeError && !allowed.length && (
            <Notice>
              Farmer chưa có khu vực thuộc vườn sở hữu hoặc phân công đang hiệu
              lực.
            </Notice>
          )}
          <Field label="Lý do cấp quyền">
            <textarea
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </fieldset>
        {task.error && <Notice kind="error">{task.error}</Notice>}
        {uncertain && (
          <Notice kind="warning">
            Kết quả chưa chắc chắn. Đóng form và kiểm tra danh sách quyền trước
            khi cấp lại.
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
          <button
            className="button"
            disabled={
              task.busy ||
              uncertain ||
              !selectedZone ||
              scopeLoading ||
              !!scopeError
            }
          >
            {task.busy ? "Đang lưu…" : "Lưu thông tin"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
