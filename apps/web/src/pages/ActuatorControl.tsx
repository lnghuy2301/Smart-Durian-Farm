import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Droplets,
  Hand,
  Radio,
  RefreshCw,
  ShieldCheck,
  SprayCan,
} from "lucide-react";
import { ApiError } from "../api/client";
import { useSession } from "../auth/session";
import { useTask } from "../hooks/useTask";
import {
  Badge,
  DataState,
  Field,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  dateTime,
} from "../components/ui";
import { useCollection } from "../workflows/shared";
import type { Device, Farm, Zone } from "../types/api";
import {
  coreInterval,
  loadControl,
  loadTasks,
  recipeReady,
  stopMetadataReady,
  scopedTask,
  startMetadataReady,
  taskInterval,
} from "../control/data";
import { useControlPolling } from "../control/useControlPolling";
import {
  modeNames,
  operationNames,
  type AcceptedControl,
  type ControlOperation,
} from "../control/types";
import { controlTime, TaskBadge, TaskProgress } from "../control/TaskProgress";
import { ControlReadings } from "../control/ControlReadings";
import "../control/control.css";

interface FarmScope {
  id: string;
  label: string;
}

export function ActuatorControlPage() {
  const [params, setParams] = useSearchParams();
  const farms = useCollection<Farm>("farms");
  const zones = useCollection<Zone>("zones");
  const devices = useCollection<Device>("devices");
  const [accessError, setAccessError] = useState("");
  // Assigned Farmers can read Zones/Devices without access to the owner's Farm profile.
  // These are selector scopes built from authorized responses, not synthetic Farm records.
  const scopes: FarmScope[] = (farms.data ?? []).map((farm) => ({
    id: farm.id,
    label: `${farm.certificate_number} · ${farm.address}`,
  }));
  for (const zone of zones.data ?? []) {
    if (!scopes.some((scope) => scope.id === zone.farm_id))
      scopes.push({
        id: zone.farm_id,
        label: `Khu vực được phân công · ${zone.zone_name}`,
      });
  }
  const wantedDevice = devices.data?.find(
    (item) => item.id === params.get("device_id"),
  );
  const wantedZone = zones.data?.find(
    (item) => item.id === (wantedDevice?.zone_id ?? params.get("zone_id")),
  );
  const wantedFarm = scopes.find(
    (item) => item.id === (wantedZone?.farm_id ?? params.get("farm_id")),
  );
  const device = wantedFarm && wantedZone ? wantedDevice : undefined;
  const error = farms.error || zones.error || devices.error;
  const loading = farms.loading || zones.loading || devices.loading;
  const reload = useCallback(() => {
    farms.reload();
    zones.reload();
    devices.reload();
  }, [farms.reload, zones.reload, devices.reload]);
  const denied = useCallback(
    (failure: Error) => {
      if (failure instanceof ApiError && [403, 404].includes(failure.status)) {
        setAccessError(
          "Không còn truy cập được trạm hoặc lệnh đã chọn. Vui lòng chọn lại trong phạm vi hiện tại.",
        );
        setParams({}, { replace: true });
        reload();
      }
    },
    [setParams, reload],
  );
  function select(key: string, value: string) {
    setAccessError("");
    const next = new URLSearchParams();
    if (key !== "farm_id" && wantedFarm) next.set("farm_id", wantedFarm.id);
    if (key === "device_id" && wantedZone) next.set("zone_id", wantedZone.id);
    if (value) next.set(key, value);
    setParams(next);
  }
  return (
    <div className="actuator-control">
      <PageHeader
        title="Điều khiển tưới / phun"
        subtitle="Chọn đúng khu vực, gửi lệnh và theo dõi phản hồi của thiết bị."
        actions={
          <Link className="button secondary" to="/iot">
            Giám sát IoT
          </Link>
        }
      />
      {accessError && <Notice kind="warning">{accessError}</Notice>}
      <section className="panel control-selector">
        <div className="control-section-title">
          <h2>Chọn nơi cần chăm sóc</h2>
          <span className="muted">Vườn → Khu vực → Trạm</span>
        </div>
        <DataState
          resource={{
            loading,
            error,
            data: !loading && !error ? true : undefined,
            reload,
          }}
        >
          {() => (
            <>
              <div className="control-selection-grid">
                <Field label="Vườn trồng">
                  <select
                    value={wantedFarm?.id ?? ""}
                    onChange={(event) => select("farm_id", event.target.value)}
                  >
                    <option value="">Chọn vườn</option>
                    {scopes.map((farm) => (
                      <option key={farm.id} value={farm.id}>
                        {farm.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Khu vực">
                  <select
                    disabled={!wantedFarm}
                    value={wantedZone?.id ?? ""}
                    onChange={(event) => select("zone_id", event.target.value)}
                  >
                    <option value="">Chọn khu vực</option>
                    {zones.data
                      ?.filter((zone) => zone.farm_id === wantedFarm?.id)
                      .map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.zone_name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Trạm điều khiển">
                  <select
                    disabled={!wantedZone}
                    value={device?.id ?? ""}
                    onChange={(event) =>
                      select("device_id", event.target.value)
                    }
                  >
                    <option value="">Chọn trạm</option>
                    {devices.data
                      ?.filter((item) => item.zone_id === wantedZone?.id)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.station_id}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              {!scopes.length && (
                <p>Bạn chưa có vườn trong phạm vi truy cập.</p>
              )}
              {wantedZone &&
                !devices.data?.some(
                  (item) => item.zone_id === wantedZone.id,
                ) && <p>Khu vực này chưa có trạm trong phạm vi truy cập.</p>}
              {params.get("device_id") && !device && (
                <Notice kind="warning">
                  Không tìm thấy trạm được liên kết trong phạm vi truy cập. Hãy
                  chọn lại trạm.
                </Notice>
              )}
            </>
          )}
        </DataState>
      </section>
      {!loading && !error && device && wantedFarm && wantedZone ? (
        <ControlWorkspace
          key={device.id}
          device={device}
          farm={wantedFarm}
          zone={wantedZone}
          onFailure={denied}
        />
      ) : (
        !loading &&
        !error && (
          <section className="panel control-empty">
            <Droplets size={36} />
            <h2>Sẵn sàng chọn trạm</h2>
            <p>
              Chọn vườn, khu vực và trạm để xem trạng thái trước khi thao tác.
            </p>
          </section>
        )
      )}
    </div>
  );
}
function ControlWorkspace({
  device,
  farm,
  zone,
  onFailure,
}: {
  device: Device;
  farm: FarmScope;
  zone: Zone;
  onFailure: (error: Error) => void;
}) {
  const { api, user } = useSession();
  const [confirm, setConfirm] = useState<"Watering" | "Spraying">();
  const [focus, setFocus] = useState("");
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const issuedVersion = useRef(0);
  const mutation = useTask();
  const load = useCallback(
    (signal: AbortSignal) => loadControl(api, device.id, signal),
    [api, device.id],
  );
  const core = useControlPolling(device.id, load, coreInterval, onFailure);
  const state = core.data?.state;
  const liveId =
    core.data?.active?.response_payload.parent_task_id ||
    core.data?.active?._id ||
    "";
  const selectedId = focus || liveId;
  const taskLoad = useCallback(
    (signal: AbortSignal) =>
      loadTasks(api, device.id, selectedId, offset, status, signal),
    [api, device.id, selectedId, offset, status],
  );
  const tasks = useControlPolling(
    `${device.id}/${selectedId}/${offset}/${status}`,
    taskLoad,
    taskInterval,
    onFailure,
  );
  useEffect(() => {
    if (
      !mutation.busy &&
      !core.refreshing &&
      !core.error &&
      core.version > issuedVersion.current
    )
      setAwaiting(false);
  }, [core.version, core.refreshing, core.error, mutation.busy]);
  const data = core.data;
  const controller = user.role === "Farmer";
  const recipe = !!data && recipeReady(data.actuators);
  const locked =
    mutation.busy ||
    awaiting ||
    uncertain ||
    !state ||
    !state.broker_ready ||
    !recipe;
  const startReady =
    !locked &&
    !state?.busy &&
    ["Unknown", "Off"].includes(state?.acknowledged_mode ?? "");
  const stopping =
    state?.busy &&
    (data?.active?.response_payload.operation === "Stop" ||
      data?.active?.response_payload.operation === "RecoveryStop");
  const canStop = !locked && !stopping && !!data && stopMetadataReady(data);
  function check() {
    if (mutation.busy) return;
    issuedVersion.current = core.version;
    setAwaiting(true);
    setUncertain(false);
    mutation.setError("");
    core.reload();
    tasks.reload();
  }
  function send(operation: ControlOperation) {
    if (
      !controller ||
      (operation === "Stop"
        ? !canStop
        : !startReady || !data || !startMetadataReady(data, operation))
    )
      return;
    void mutation.run(async (signal) => {
      issuedVersion.current = core.version;
      setAwaiting(true);
      setConfirm(undefined);
      try {
        const result = await api.request<AcceptedControl>(
          `actuator-tasks/devices/${device.id}/commands`,
          { method: "POST", body: { operation }, signal },
        );
        if (signal.aborted) return;
        scopedTask(result.task, device.id);
        // Follow the current workflow; pin a historical task only after an explicit history click.
        setFocus("");
        setOffset(0);
        setStatus("");
      } catch (failure) {
        if (!signal.aborted) {
          setUncertain(true);
          onFailure(
            failure instanceof Error
              ? failure
              : new Error("Không gửi được lệnh."),
          );
        }
        throw failure;
      } finally {
        if (!signal.aborted) {
          core.reload();
          tasks.reload();
        }
      }
    });
  }
  const progress = tasks.data;
  return (
    <>
      <div className="control-workspace">
        <section className="panel control-station">
          <div className="control-section-title">
            <div>
              <span className="section-label">TRẠM ĐANG CHỌN</span>
              <h2>
                <Radio size={23} />
                {device.station_id}
              </h2>
            </div>
            <Badge status={data?.device.status ?? device.status} />
          </div>
          <p className="control-location">
            <strong>{zone.zone_name}</strong>
            <span>{farm.label}</span>
          </p>
          <DataState resource={core}>
            {(current) => (
              <>
                <p
                  className={`control-connection ${current.state.broker_ready ? "control-connection-ready" : ""}`}
                >
                  {current.state.broker_ready
                    ? "Kênh gửi lệnh đã sẵn sàng"
                    : "Kênh gửi lệnh chưa sẵn sàng"}
                </p>
                <div className="control-state-grid">
                  <div>
                    <span>Phản hồi nhận lệnh</span>
                    <strong>
                      {modeNames[current.state.acknowledged_mode]}
                    </strong>
                    {current.state.busy && (
                      <small>
                        Đang xử lý:{" "}
                        {current.active
                          ? operationNames[
                              current.active.response_payload.operation
                            ]
                          : "lệnh của trạm"}
                      </small>
                    )}
                  </div>
                  <div>
                    <span>Trạng thái bơm / van thực tế</span>
                    <strong>Chưa xác định</strong>
                    <small>Chưa có dữ liệu đo xác nhận.</small>
                  </div>
                </div>
                <p className="control-receipt-note">
                  <ShieldCheck size={18} />
                  ACK chỉ xác nhận thiết bị đã nhận lệnh, chưa xác nhận bơm/van
                  thực tế đã bật hoặc tắt.
                </p>
              </>
            )}
          </DataState>
        </section>
        <section
          className="panel control-actions"
          aria-label="Thao tác điều khiển"
        >
          <div className="control-section-title">
            <h2>Thao tác</h2>
            <button
              className="icon-button"
              aria-label="Kiểm tra lại trạng thái điều khiển"
              disabled={mutation.busy}
              onClick={check}
            >
              <RefreshCw size={19} />
            </button>
          </div>
          <p className="muted">
            Lệnh sẽ gửi đến <strong>{device.station_id}</strong> ·{" "}
            {zone.zone_name}.
          </p>
          {controller ? (
            <>
              <button
                className="control-command control-water"
                disabled={
                  !startReady || !data || !startMetadataReady(data, "Watering")
                }
                onClick={() => setConfirm("Watering")}
              >
                <Droplets size={28} />
                <span>
                  <strong>Tưới nước</strong>
                  <small>Mở van tưới, sau đó bật bơm</small>
                </span>
              </button>
              <button
                className="control-command control-spray"
                disabled={
                  !startReady || !data || !startMetadataReady(data, "Spraying")
                }
                onClick={() => setConfirm("Spraying")}
              >
                <SprayCan size={28} />
                <span>
                  <strong>Phun thuốc</strong>
                  <small>Mở van phun, sau đó bật bơm</small>
                </span>
              </button>
              <button
                className="control-command control-stop"
                disabled={!canStop}
                onClick={() => send("Stop")}
              >
                <Hand size={28} />
                <span>
                  <strong>Dừng</strong>
                  <small>
                    {stopping
                      ? "Đang gửi chuỗi lệnh dừng…"
                      : "Gửi lệnh tắt bơm trước, đóng van sau"}
                  </small>
                </span>
              </button>
              <div className="control-guidance" role="status">
                {uncertain
                  ? "Chưa rõ kết quả gửi lệnh. Kiểm tra lại trạng thái trước khi gửi tiếp."
                  : mutation.busy || awaiting
                    ? "Đang gửi hoặc kiểm tra trạng thái mới…"
                    : !state
                      ? "Cần tải được trạng thái hiện tại để thao tác."
                      : !state.broker_ready
                        ? "Chưa kết nối được kênh gửi lệnh. Không có lệnh chờ gửi ngầm."
                        : !recipe
                          ? "Trạm chưa có đủ cấu hình bơm, van tưới và van phun."
                          : stopping
                            ? "Đang chờ phản hồi chuỗi Dừng. Không gửi thêm lệnh Dừng trùng."
                            : state.busy
                              ? "Đang xử lý lệnh. Bạn có thể chọn Dừng để ngắt chuỗi lệnh hiện tại."
                              : state.acknowledged_mode === "Watering" ||
                                  state.acknowledged_mode === "Spraying"
                                ? "Chọn Dừng và đợi đủ phản hồi trước khi chuyển tưới / phun."
                                : data?.device.status !== "Active"
                                  ? "Trạm đang ngừng sử dụng hoặc bảo trì. Không thể gửi lệnh bật hoặc tắt."
                                  : "Chọn Tưới nước hoặc Phun thuốc. Mỗi lần chỉ chạy một chế độ."}
              </div>
              {data &&
                recipe &&
                data.device.status === "Active" &&
                (!startMetadataReady(data, "Watering") ||
                  !startMetadataReady(data, "Spraying")) && (
                  <Notice kind="warning">
                    Bơm hoặc van tương ứng đang ngừng sử dụng. Chỉ bật khi cấu
                    hình được kích hoạt; lệnh tắt cũng cần thiết bị đang Active.
                  </Notice>
                )}
            </>
          ) : (
            <Notice>
              Bạn có quyền xem. Chỉ chủ vườn hoặc Farmer đang được phân công mới
              được gửi lệnh.
            </Notice>
          )}
          {mutation.error && <Notice kind="error">{mutation.error}</Notice>}
          {(uncertain || core.error) && (
            <button
              className="button secondary"
              disabled={mutation.busy}
              onClick={check}
            >
              Kiểm tra lại trạng thái
            </button>
          )}
          {state?.reset_required && !state.busy && (
            <p className="control-help">
              Lần bật tiếp theo, hệ thống sẽ gửi lệnh chuẩn bị bơm và hai van
              trước khi bật. Hãy theo dõi từng bước phản hồi.
            </p>
          )}
          <Link to={`/devices/${device.id}`}>Xem cấu hình trạm →</Link>
        </section>
      </div>
      <section className="panel control-progress" aria-label="Tiến trình lệnh">
        <div className="control-section-title">
          <div>
            <h2>Tiến trình lệnh</h2>
            <p>
              Mỗi bước chờ phản hồi riêng
              {state
                ? `, tối đa ${state.ack_timeout_ms / 1000} giây mỗi bước`
                : ""}
              .
            </p>
          </div>
          {focus && (
            <button className="button secondary" onClick={() => setFocus("")}>
              Theo dõi lệnh mới nhất
            </button>
          )}
        </div>
        <DataState resource={tasks}>
          {() =>
            progress?.root ? (
              <>
                {progress.linked.some(
                  (task) => task.response_payload.operation === "RecoveryStop",
                ) && (
                  <Notice kind="warning">
                    Lệnh bật chưa hoàn tất. Hệ thống đã tạo Dừng phục hồi; kiểm
                    tra riêng tiến trình bên dưới, chưa kết luận thiết bị đã
                    tắt.
                  </Notice>
                )}
                {progress.linked
                  .filter((task) => task.response_payload.operation === "Reset")
                  .map((task) => (
                    <TaskProgress
                      key={task._id}
                      task={task}
                      timeout={state?.ack_timeout_ms ?? 10000}
                      actuators={data?.actuators}
                    />
                  ))}
                <TaskProgress
                  task={progress.root}
                  timeout={state?.ack_timeout_ms ?? 10000}
                  actuators={data?.actuators}
                />
                {progress.linked
                  .filter(
                    (task) =>
                      task.response_payload.operation === "RecoveryStop",
                  )
                  .map((task) => (
                    <TaskProgress
                      key={task._id}
                      task={task}
                      timeout={state?.ack_timeout_ms ?? 10000}
                      actuators={data?.actuators}
                    />
                  ))}
              </>
            ) : (
              <div className="control-empty">
                <ClockIcon />
                <p>
                  Chưa có lệnh. Tiến trình sẽ xuất hiện khi có thao tác tại trạm
                  này.
                </p>
              </div>
            )
          }
        </DataState>
      </section>
      <section className="panel">
        <ControlReadings
          deviceId={device.id}
          zoneId={zone.id}
          onFailure={onFailure}
        />
      </section>
      <section className="panel control-history" aria-label="Lịch sử lệnh">
        <div className="control-section-title">
          <div>
            <h2>Lịch sử lệnh</h2>
            <p>Thời điểm do máy chủ ghi nhận · giờ Việt Nam.</p>
          </div>
          <Field label="Trạng thái lệnh">
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">Tất cả</option>
              <option value="Pending">Đang chờ phản hồi</option>
              <option value="Confirmed">Đã nhận đủ ACK</option>
              <option value="Failed">Lệnh chưa hoàn tất</option>
            </select>
          </Field>
        </div>
        <DataState resource={tasks} empty={progress?.page.items.length === 0}>
          {(current) => (
            <div className="control-history-list">
              {current.page.items.map((task) => (
                <article key={task._id}>
                  <div>
                    <strong>
                      {operationNames[task.response_payload.operation]}
                    </strong>
                    <TaskBadge task={task} />
                  </div>
                  <dl>
                    <div>
                      <dt>Tạo lệnh</dt>
                      <dd>{controlTime(task.created_at)}</dd>
                    </div>
                    <div>
                      <dt>Bắt đầu gửi</dt>
                      <dd>{controlTime(task.sent_at)}</dd>
                    </div>
                    <div>
                      <dt>Nhận đủ ACK</dt>
                      <dd>{controlTime(task.confirmed_at)}</dd>
                    </div>
                  </dl>
                  <button
                    className="button secondary"
                    onClick={() => setFocus(task._id)}
                  >
                    Xem tiến trình
                  </button>
                </article>
              ))}
            </div>
          )}
        </DataState>
        {progress && <Pagination {...progress.page} onChange={setOffset} />}
        <small className="muted">
          Cập nhật khi trang đang mở. Kiểm tra thành công:{" "}
          {core.checkedAt ? dateTime(core.checkedAt) : "Chưa có"}.
        </small>
      </section>
      {confirm && (
        <Modal
          title={
            confirm === "Watering"
              ? "Bắt đầu tưới nước?"
              : "Bắt đầu phun thuốc?"
          }
          onClose={() => setConfirm(undefined)}
        >
          <div className="control-confirm">
            <p>
              Gửi lệnh đến <strong>{device.station_id}</strong> tại{" "}
              <strong>{zone.zone_name}</strong>.
            </p>
            <p>{farm.label}</p>
            <Notice>
              {confirm === "Spraying"
                ? "Kiểm tra khu vực, dung dịch và người tại vườn trước khi phun."
                : "Kiểm tra khu vực và nguồn nước trước khi tưới."}{" "}
              Hệ thống chờ phản hồi từng bước, không tự xác nhận thiết bị đã
              chạy.
            </Notice>
            <div className="control-confirm-actions">
              <button
                className="button secondary"
                onClick={() => setConfirm(undefined)}
              >
                Quay lại
              </button>
              <button
                className="button"
                disabled={
                  !startReady || !data || !startMetadataReady(data, confirm)
                }
                onClick={() => send(confirm)}
              >
                {confirm === "Watering" ? "Gửi lệnh tưới" : "Gửi lệnh phun"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function ClockIcon() {
  return <RefreshCw size={28} aria-hidden="true" />;
}
