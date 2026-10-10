import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { apiBaseUrl, publicApi, queryString } from "../api/client";
import { Brand } from "../components/Brand";
import {
  Badge,
  DataState,
  Notice,
  Pagination,
  dateTime,
  number,
} from "../components/ui";
import { useResource } from "../hooks/useResource";
import type { Page } from "../types/api";
import type {
  TraceSummary,
  TraceTarget,
  TraceVersion,
  TraceHarvest,
} from "../types/traceability";
import "./Traceability.css";

const actionNames = {
  Watering: "Tưới nước",
  Spraying: "Phun",
  Fertilizing: "Bón phân",
};
function Target({ target }: { target: TraceTarget }) {
  return target.type === "Tree" ? (
    <span>
      Cây{" "}
      <Link to={`/trace/${encodeURIComponent(target.label)}`}>
        {target.label}
      </Link>
    </span>
  ) : (
    <span>Toàn khu vực {target.label}</span>
  );
}

export function TraceabilityPage() {
  const { treeCode = "" } = useParams();
  const path = `traceability/trees/${encodeURIComponent(treeCode)}`;
  const load = useCallback(
    (signal: AbortSignal) => publicApi.request<TraceSummary>(path, { signal }),
    [path],
  );
  const summary = useResource(path, load);
  const qrUrl = `${apiBaseUrl.replace(/\/$/, "")}/${path}/qr.svg`;
  // Trang nằm ngoài AuthProvider/ProtectedLayout: không khôi phục phiên, không
  // gửi JWT, không lấy thông tin cá nhân hoặc đưa dữ liệu private lên public UI.
  return (
    <main className="trace-page">
      <header className="trace-header">
        <Brand />
        <Link to="/login">Đăng nhập quản lý</Link>
      </header>
      <div className="trace-container">
        <div className="trace-title">
          <div>
            <p className="eyebrow">SMART DURIAN</p>
            <h1>Truy xuất nguồn gốc</h1>
          </div>
          <button className="button secondary" onClick={summary.reload}>
            <RefreshCw size={16} />
            Tải lại thông tin cây
          </button>
        </div>
        <DataState resource={summary}>
          {(data) => (
            <>
              <section className="panel trace-hero" aria-label="Thông tin cây">
                <div>
                  <h2>{data.tree.variety}</h2>
                  <p className="trace-code">{data.tree.tree_code}</p>
                  <div className="trace-facts">
                    <div>
                      <span>Trạng thái cây</span>
                      <Badge status={data.tree.status} />
                    </div>
                    <div>
                      <span>Ngày trồng</span>
                      <strong>{dateTime(data.tree.plant_date)}</strong>
                    </div>
                    <div>
                      <span>Khu vực</span>
                      <strong>{data.zone.name}</strong>
                    </div>
                    <div>
                      <span>Hợp tác xã</span>
                      <strong>
                        {data.cooperative?.name ?? "Nông trại độc lập"}
                      </strong>
                    </div>
                    <div>
                      <span>Tiêu chuẩn đang gắn</span>
                      <strong>
                        {data.standard.code} · {data.standard.name}
                      </strong>
                      <Badge status={data.standard.status} />
                    </div>
                  </div>
                  <p className="trace-caption">
                    Tiêu chuẩn đang gắn là thông tin quản lý, không thay thế
                    giấy chứng nhận.
                  </p>
                </div>
                <div className="trace-qr">
                  <img
                    src={qrUrl}
                    width={240}
                    height={240}
                    alt={`Mã QR truy xuất cây ${data.tree.tree_code}`}
                  />
                  <a
                    className="button secondary"
                    href={qrUrl}
                    download={`${data.tree.tree_code}-qr.svg`}
                  >
                    <Download size={16} />
                    Tải mã QR SVG
                  </a>
                  <a
                    className="trace-url"
                    href={data.trace_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Đường dẫn truy xuất <ExternalLink size={14} />
                  </a>
                </div>
              </section>
              <CultivationHistory key={`cultivation/${treeCode}`} path={path} />
              <HarvestHistory key={`harvests/${treeCode}`} path={path} />
            </>
          )}
        </DataState>
        <footer className="trace-footer">
          Smart Durian · Nhật ký canh tác và hồ sơ thu hoạch
        </footer>
      </div>
    </main>
  );
}

function CultivationHistory({ path }: { path: string }) {
  const [offset, setOffset] = useState(0);
  const requestPath = `${path}/cultivation${queryString({ limit: 20, offset })}`;
  const load = useCallback(
    (signal: AbortSignal) =>
      publicApi.request<Page<TraceVersion>>(requestPath, { signal }),
    [requestPath],
  );
  const resource = useResource(requestPath, load);
  return (
    <section className="panel trace-section" aria-label="Lịch sử canh tác">
      <div className="trace-section-heading">
        <div>
          <h2>Lịch sử canh tác</h2>
          <p>Bản gốc và các lần chỉnh sửa đã khóa, theo thứ tự từng nhật ký.</p>
        </div>
        <button className="button secondary" onClick={resource.reload}>
          Tải lại nhật ký
        </button>
      </div>
      <DataState resource={resource}>
        {(data) =>
          data.items.length ? (
            <div className="trace-versions">
              {data.items.map((version) => (
                <article
                  className={`trace-version ${version.is_latest ? "current" : ""}`}
                  key={`${version.history_key}/${version.version}`}
                >
                  <div className="trace-version-heading">
                    <h3>{actionNames[version.action_type]}</h3>
                    <span className="trace-version-label">
                      {version.is_correction ? "Bản chỉnh sửa" : "Bản gốc"} ·
                      Phiên bản {version.version}/{version.latest_version}
                    </span>
                    {version.is_latest && (
                      <span className="trace-current">Bản mới nhất</span>
                    )}
                  </div>
                  <p className="trace-target">
                    <strong>Phạm vi phiên bản: </strong>
                    <Target target={version.target} />
                  </p>
                  {!version.latest_applies_to_tree && (
                    <Notice kind="warning">
                      Bản mới nhất áp dụng cho{" "}
                      <Target target={version.latest_target} />. Nội dung hiện
                      tại không áp dụng cho cây đang xem.
                    </Notice>
                  )}
                  {!version.is_latest && (
                    <p className="trace-caption">
                      Đây là lịch sử trước khi chỉnh sửa; xem phiên bản{" "}
                      {version.latest_version} để biết nội dung hiện tại.
                    </p>
                  )}
                  <p className="trace-caption">
                    {version.applies_to_tree
                      ? "Phiên bản này áp dụng cho cây đang xem."
                      : "Phiên bản này không áp dụng cho cây đang xem."}
                  </p>
                  <div className="trace-event-details">
                    {version.action_type === "Watering" ? (
                      <p>
                        Thời lượng:{" "}
                        <strong>
                          {number(version.details.duration_minutes!)} phút
                        </strong>
                        {version.details.water_volume_l != null && (
                          <>
                            {" "}
                            · Lượng nước:{" "}
                            <strong>
                              {number(version.details.water_volume_l)} lít
                            </strong>
                          </>
                        )}
                      </p>
                    ) : (
                      <ul>
                        {version.details.materials?.map((material, index) => (
                          <li key={index}>
                            {material.name}:{" "}
                            <strong>
                              {number(material.quantity)} {material.unit}
                            </strong>
                            {!material.standard_linked && (
                              <span className="trace-outside">
                                Ngoài tiêu chuẩn khi nhập
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="trace-caption">
                      Tiêu chuẩn lúc nhập:{" "}
                      {version.details.standard_snapshot.code} ·{" "}
                      {version.details.standard_snapshot.name}
                    </p>
                    <p className="trace-caption">
                      Nhập hệ thống: {dateTime(version.entered_at)} · Khóa:{" "}
                      {dateTime(version.locked_at)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="data-state">
              Chưa có nhật ký đã khóa liên quan đến cây này.
            </div>
          )
        }
      </DataState>
      {resource.data && <Pagination {...resource.data} onChange={setOffset} />}
    </section>
  );
}

function HarvestHistory({ path }: { path: string }) {
  const [offset, setOffset] = useState(0);
  const requestPath = `${path}/harvests${queryString({ limit: 20, offset })}`;
  const load = useCallback(
    (signal: AbortSignal) =>
      publicApi.request<Page<TraceHarvest>>(requestPath, { signal }),
    [requestPath],
  );
  const resource = useResource(requestPath, load);
  return (
    <section className="panel trace-section" aria-label="Lịch sử thu hoạch">
      <div className="trace-section-heading">
        <div>
          <h2>Lịch sử thu hoạch</h2>
          <p>Nội dung đã xác nhận; giữ bản đã duyệt trong lúc chờ chỉnh sửa.</p>
        </div>
        <button className="button secondary" onClick={resource.reload}>
          Tải lại thu hoạch
        </button>
      </div>
      <DataState resource={resource}>
        {(data) =>
          data.items.length ? (
            <div className="trace-harvests">
              {data.items.map((harvest, index) => (
                <article
                  className="trace-harvest"
                  key={`${harvest.harvest_date}/${harvest.batch_code}/${index}`}
                >
                  <div>
                    <h3>{harvest.batch_code}</h3>
                    <Badge status="Confirmed" />
                  </div>
                  <p>Mùa vụ: {harvest.season_name}</p>
                  <p>
                    Ngày thu hoạch thực tế:{" "}
                    <strong>
                      {harvest.harvest_date.split("-").reverse().join("/")}
                    </strong>
                  </p>
                  <p>
                    <strong>{number(harvest.fruit_count)} quả</strong> ·{" "}
                    <strong>{number(harvest.total_weight_kg)} kg</strong>
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <div className="data-state">Chưa có thu hoạch được xác nhận.</div>
          )
        }
      </DataState>
      {resource.data && <Pagination {...resource.data} onChange={setOffset} />}
    </section>
  );
}
