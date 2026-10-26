import { CatalogTools, StandardMaterialPanel } from "../workflows/CatalogTools";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ReadableValue,
  ReferenceScope,
  RecordReference,
} from "../components/ReadableValue";
import { calendarDate } from "../components/presentation";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Search, RefreshCw } from "lucide-react";
import { queryString } from "../api/client";
import { useSession } from "../auth/session";
import { useResource } from "../hooks/useResource";
import { RecordTools, recordConfigs } from "../workflows/RecordTools";
import { RelationSelect, type Values } from "../workflows/shared";
import { HarvestTools } from "../workflows/HarvestTools";
import { WorkflowStats } from "../workflows/WorkflowStats";
import {
  Badge,
  DataState,
  Field,
  Notice,
  PageHeader,
  Pagination,
  dateTime,
  number,
} from "../components/ui";
import type {
  Page,
  Material,
  Standard,
  Farm,
  Zone,
  Tree,
  Harvest,
} from "../types/api";

interface Column<T> {
  label: string;
  value: (item: T) => ReactNode;
}
interface Filter {
  key: string;
  label: string;
  options: [string, string][];
}
export interface Definition<T extends { id: string }> {
  path: string;
  title: string;
  subtitle: string;
  search: string;
  name: (item: T) => string;
  columns: Column<T>[];
  filters?: Filter[];
  relationships?: string[];
  fixedFilters?: Record<string, string>;
  detail: Column<T>[];
  links?: (item: T) => ReactNode;
  extra?: (item: T) => ReactNode;
}
const statusFilter: Filter = {
  key: "status",
  label: "Trạng thái",
  options: [
    ["Active", "Đang sử dụng"],
    ["Inactive", "Ngừng sử dụng"],
  ],
};
const materialType: Filter = {
  key: "material_type",
  label: "Loại vật tư",
  options: [
    ["Fertilizer", "Phân bón"],
    ["Pesticide", "Thuốc bảo vệ thực vật"],
    ["Biological", "Chế phẩm sinh học"],
  ],
};
const typeNames: Record<Material["material_type"], string> = {
  Fertilizer: "Phân bón",
  Pesticide: "Thuốc bảo vệ thực vật",
  Biological: "Chế phẩm sinh học",
};
export const materialDefinition: Definition<Material> = {
  path: "materials",
  title: "Danh mục vật tư",
  subtitle: "Thông tin vật tư và thời gian cách ly trong hệ thống.",
  search: "Tìm theo tên vật tư",
  name: (x) => x.name,
  filters: [materialType, statusFilter],
  columns: [
    { label: "Loại vật tư", value: (x) => typeNames[x.material_type] },
    {
      label: "Liều mặc định",
      value: (x) =>
        x.default_dosage_value != null && x.dosage_basis
          ? `${number(x.default_dosage_value)} ${x.unit}/${x.dosage_basis}`
          : x.default_dosage,
    },
    { label: "Cách ly", value: (x) => `${x.quarantine_days} ngày` },
    { label: "Trạng thái", value: (x) => <Badge status={x.status} /> },
  ],
  detail: [
    { label: "Tên vật tư", value: (x) => x.name },
    { label: "Loại vật tư", value: (x) => typeNames[x.material_type] },
    {
      label: "Liều mặc định",
      value: (x) =>
        x.default_dosage_value != null && x.dosage_basis
          ? `${number(x.default_dosage_value)} ${x.unit}/${x.dosage_basis}`
          : x.default_dosage,
    },
    { label: "Đơn vị", value: (x) => x.unit },
    { label: "Thời gian cách ly", value: (x) => `${x.quarantine_days} ngày` },
    { label: "Trạng thái", value: (x) => <Badge status={x.status} /> },
  ],
};
export const standardDefinition: Definition<Standard> = {
  path: "standards",
  title: "Tiêu chuẩn canh tác",
  subtitle: "Tra cứu tiêu chuẩn và các vật tư được liên kết.",
  search: "Tìm mã hoặc tên tiêu chuẩn",
  name: (x) => x.name,
  filters: [statusFilter],
  columns: [
    { label: "Mã", value: (x) => x.code },
    { label: "Đơn vị chứng nhận", value: (x) => x.certifying_body },
    { label: "Trạng thái", value: (x) => <Badge status={x.status} /> },
  ],
  detail: [
    { label: "Tên tiêu chuẩn", value: (x) => x.name },
    { label: "Mã tiêu chuẩn", value: (x) => x.code },
    { label: "Mô tả", value: (x) => x.description || "Chưa có mô tả" },
    { label: "Đơn vị chứng nhận", value: (x) => x.certifying_body },
    { label: "Trạng thái", value: (x) => <Badge status={x.status} /> },
  ],
  extra: (standard) => (
    <StandardMaterialPanel key={standard.id} standardId={standard.id} />
  ),
};
const coordinates = <T extends { longitude: number; latitude: number }>(x: T) =>
  `${number(x.latitude)}, ${number(x.longitude)}`;
export const farmDefinition: Definition<Farm> = {
  path: "farms",
  title: "Vườn trồng",
  subtitle: "Các vườn bạn được quyền truy cập.",
  search: "Tìm địa chỉ hoặc số chứng nhận",
  name: (x) => x.certificate_number,
  columns: [
    { label: "Địa chỉ", value: (x) => x.address },
    { label: "Diện tích", value: (x) => number(x.area_size) },
    {
      label: "Hợp tác xã",
      value: (x) =>
        x.cooperative_id ? (
          <RecordReference
            kind="farms"
            id={x.id}
            field="cooperative_id"
            value={x.cooperative_id}
          />
        ) : (
          "Chưa tham gia"
        ),
    },
  ],
  detail: [
    { label: "Số chứng nhận", value: (x) => x.certificate_number },
    {
      label: "Chủ vườn",
      value: (x) => <ReadableValue field="owner_id" value={x.owner_id} />,
    },
    { label: "Địa chỉ", value: (x) => x.address },
    { label: "Diện tích", value: (x) => number(x.area_size) },
    { label: "Vĩ độ, kinh độ", value: coordinates },
    {
      label: "Ngày tham gia HTX",
      value: (x) => dateTime(x.join_cooperative_date),
    },
    {
      label: "Hợp tác xã",
      value: (x) =>
        x.cooperative_id ? (
          <Link to={`/cooperatives/${x.cooperative_id}`}>
            <ReadableValue field="cooperative_id" value={x.cooperative_id} />
          </Link>
        ) : (
          "Chưa tham gia"
        ),
    },
  ],
  links: (x) => (
    <Link className="button secondary" to={`/zones?farm_id=${x.id}`}>
      Các khu vực trong vườn
      <ArrowUpRight size={16} />
    </Link>
  ),
};
export const zoneDefinition: Definition<Zone> = {
  path: "zones",
  title: "Khu vực canh tác",
  subtitle: "Khu vực thuộc vườn của bạn hoặc được phân công đang có hiệu lực.",
  search: "Tìm theo tên khu vực",
  name: (x) => x.zone_name,
  relationships: ["farm_id"],
  columns: [
    { label: "Diện tích", value: (x) => number(x.area_size) },
    { label: "Vĩ độ, kinh độ", value: coordinates },
  ],
  detail: [
    { label: "Tên khu vực", value: (x) => x.zone_name },
    { label: "Diện tích", value: (x) => number(x.area_size) },
    { label: "Vĩ độ, kinh độ", value: coordinates },
    {
      label: "Tiêu chuẩn",
      value: (x) => (
        <Link to={`/standards/${x.standard_id}`}>
          <ReadableValue field="standard_id" value={x.standard_id} />
        </Link>
      ),
    },
    {
      label: "Vườn",
      value: (x) => (
        <Link to={`/farms/${x.farm_id}`}>
          <ReadableValue field="farm_id" value={x.farm_id} />
        </Link>
      ),
    },
  ],
  links: (x) => (
    <>
      <Link className="button secondary" to={`/trees?zone_id=${x.id}`}>
        Cây trong khu vực
        <ArrowUpRight size={16} />
      </Link>
      <Link className="button secondary" to={`/iot?zone_id=${x.id}`}>
        Thiết bị IoT
        <ArrowUpRight size={16} />
      </Link>
    </>
  ),
};
export const treeDefinition: Definition<Tree> = {
  path: "trees",
  title: "Cây trồng",
  subtitle: "Hồ sơ cây theo khu vực trong phạm vi truy cập.",
  search: "Tìm giống hoặc mã cây",
  name: (x) => x.tree_code,
  relationships: ["zone_id"],
  filters: [
    {
      key: "status",
      label: "Trạng thái",
      options: [
        ["Active", "Đang sử dụng"],
        ["Dead", "Cây chết"],
        ["Removed", "Đã loại bỏ"],
      ],
    },
  ],
  columns: [
    { label: "Giống", value: (x) => x.variety },
    { label: "Ngày trồng", value: (x) => dateTime(x.plant_date) },
    { label: "Trạng thái", value: (x) => <Badge status={x.status} /> },
  ],
  detail: [
    { label: "Mã cây", value: (x) => x.tree_code },
    { label: "Giống", value: (x) => x.variety },
    { label: "Ngày trồng", value: (x) => dateTime(x.plant_date) },
    { label: "Trạng thái", value: (x) => <Badge status={x.status} /> },
    { label: "Vĩ độ, kinh độ", value: coordinates },
    {
      label: "Khu vực",
      value: (x) => (
        <Link to={`/zones/${x.zone_id}`}>
          <ReadableValue field="zone_id" value={x.zone_id} />
        </Link>
      ),
    },
  ],
  links: (x) => (
    <>
      <Link className="button secondary" to={`/tree-harvests?tree_id=${x.id}`}>
        Thu hoạch của cây
        <ArrowUpRight size={16} />
      </Link>
      <Link className="button secondary" to={`/trace/${x.tree_code}`}>
        Truy xuất / mã QR
        <ArrowUpRight size={16} />
      </Link>
    </>
  ),
  extra: (x) => <TreeHistory id={x.id} />,
};
export const harvestDefinition: Definition<Harvest> = {
  path: "tree-harvests",
  title: "Hồ sơ thu hoạch",
  subtitle: "Tra cứu hồ sơ thu hoạch được phép truy cập.",
  search: "Tìm mùa vụ hoặc mã lô",
  name: (x) => x.batch_code,
  relationships: ["zone_id", "tree_id"],
  filters: [
    {
      key: "status",
      label: "Trạng thái",
      options: [
        ["Draft", "Bản nháp"],
        ["Pending", "Chờ duyệt"],
        ["Confirmed", "Đã xác nhận"],
      ],
    },
  ],
  columns: [
    { label: "Mùa vụ", value: (x) => x.season_name },
    { label: "Ngày thu hoạch", value: (x) => calendarDate(x.harvest_date) },
    { label: "Khối lượng", value: (x) => `${number(x.total_weight_kg)} kg` },
    { label: "Trạng thái", value: (x) => <Badge status={x.status} /> },
  ],
  detail: [
    { label: "Mã lô", value: (x) => x.batch_code },
    { label: "Mùa vụ", value: (x) => x.season_name },
    { label: "Ngày thu hoạch", value: (x) => calendarDate(x.harvest_date) },
    { label: "Số quả", value: (x) => number(x.fruit_count) },
    { label: "Khối lượng", value: (x) => `${number(x.total_weight_kg)} kg` },
    { label: "Trạng thái", value: (x) => <Badge status={x.status} /> },
    {
      label: "Người tạo",
      value: (x) => <ReadableValue field="created_by" value={x.created_by} />,
    },
    {
      label: "Người cập nhật",
      value: (x) => <ReadableValue field="updated_by" value={x.updated_by} />,
    },
    { label: "Tạo lúc", value: (x) => dateTime(x.created_at) },
    { label: "Cập nhật lúc", value: (x) => dateTime(x.updated_at) },
    {
      label: "Cây",
      value: (x) => (
        <Link to={`/trees/${x.tree_id}`}>
          <ReadableValue field="tree_id" value={x.tree_id} />
        </Link>
      ),
    },
  ],
};
export function ResourcePage<T extends { id: string }>({
  definition,
}: {
  definition: Definition<T>;
}) {
  const { id } = useParams();
  return id ? (
    <ResourceDetail definition={definition} id={id} />
  ) : (
    <ResourceList definition={definition} />
  );
}
export function ResourceList<T extends { id: string }>({
  definition: def,
  nested = false,
  detailPath,
}: {
  definition: Definition<T>;
  nested?: boolean;
  detailPath?: string;
}) {
  const { api } = useSession();
  const [params, setParams] = useSearchParams();
  const prefix = nested ? "linked_" : "";
  const q = (params.get(`${prefix}q`) ?? "").slice(0, 100);
  const offsetValue = Number(params.get(`${prefix}offset`) ?? 0);
  const offset =
    Number.isInteger(offsetValue) && offsetValue >= 0 && offsetValue <= 100000
      ? offsetValue
      : 0;
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const filters: Record<string, string | number | undefined> = {
    ...def.fixedFilters,
    q: def.search ? q : undefined,
    limit: 20,
    offset,
  };
  for (const filter of def.filters ?? []) {
    const value = params.get(`${prefix}${filter.key}`);
    if (value && filter.options.some(([key]) => key === value))
      filters[filter.key] = value;
  }
  for (const key of def.relationships ?? []) {
    const value = params.get(key);
    if (value && !def.fixedFilters?.[key]) filters[key] = value;
  }
  const path = `${def.path}${queryString(filters)}`;
  const load = useCallback(
    (signal: AbortSignal) => api.request<Page<T>>(path, { signal }),
    [api, path],
  );
  const resource = useResource(path, load);
  function change(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(`${prefix}${key}`, value);
      else next.delete(`${prefix}${key}`);
      if (key !== "offset") next.delete(`${prefix}offset`);
      if (key === "zone_id") next.delete(`${prefix}tree_id`);
      return next;
    });
  }
  const title = nested ? (
    <div className="panel-heading">
      <div>
        <h2>{def.title}</h2>
        <p>{def.subtitle}</p>
      </div>
    </div>
  ) : (
    <PageHeader
      title={def.title}
      subtitle={def.subtitle}
      actions={
        <button className="button secondary" onClick={resource.reload}>
          <RefreshCw size={16} />
          Làm mới
        </button>
      }
    />
  );
  return (
    <>
      {title}
      {!nested &&
        ["farms", "zones", "trees", "tree-harvests", "devices"].includes(
          def.path,
        ) && (
          <WorkflowStats
            key={path}
            kind={def.path}
            path={`${def.path}${queryString({ ...filters, limit: undefined, offset: undefined })}`}
          />
        )}
      {!nested && recordConfigs[def.path] && (
        <RecordTools key={def.path} path={def.path} onSaved={resource.reload} />
      )}
      {!nested && def.path === "tree-harvests" && (
        <HarvestTools onSaved={resource.reload} />
      )}
      {!nested && ["materials", "standards"].includes(def.path) && (
        <CatalogTools
          key={def.path}
          path={def.path}
          onSaved={resource.reload}
        />
      )}
      <section className="panel">
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            change("q", search.trim());
          }}
        >
          {def.search && (
            <Field label={def.search}>
              <input
                aria-label={def.search}
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
          )}
          {def.filters?.map((filter) => (
            <Field key={filter.key} label={filter.label}>
              <select
                value={filters[filter.key] ?? ""}
                onChange={(e) => change(filter.key, e.target.value)}
              >
                <option value="">Tất cả</option>
                {filter.options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          {def.search && (
            <button className="button secondary" type="submit">
              <Search size={17} />
              Tìm kiếm
            </button>
          )}
          {!nested &&
            def.relationships?.map((key) => {
              const relationship =
                key === "farm_id"
                  ? {
                      label: "Vườn trồng",
                      path: "farms",
                      name: (x: Values) =>
                        `${x.certificate_number} · ${x.address}`,
                    }
                  : key === "zone_id"
                    ? {
                        label: "Khu vực",
                        path: "zones",
                        name: (x: Values) => String(x.zone_name),
                      }
                    : key === "device_id"
                      ? {
                          label: "Trạm IoT",
                          path: "devices",
                          name: (x: Values) => String(x.station_id),
                        }
                      : {
                          label: "Cây",
                          path: `trees${queryString({ zone_id: typeof filters.zone_id === "string" ? filters.zone_id : undefined })}`,
                          name: (x: Values) => `${x.tree_code} · ${x.variety}`,
                        };
              return (
                <RelationSelect
                  key={key}
                  field={{
                    key,
                    label: relationship.label,
                    required: false,
                    relation: {
                      path: relationship.path,
                      label: relationship.name,
                    },
                  }}
                  value={String(filters[key] ?? "")}
                  onChange={(value) => change(key, value)}
                />
              );
            })}
          {def.relationships?.some((key) => params.has(key)) && (
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                setParams((previous) => {
                  const next = new URLSearchParams(previous);
                  for (const key of def.relationships ?? []) next.delete(key);
                  next.delete("offset");
                  return next;
                })
              }
            >
              Bỏ lọc liên kết
            </button>
          )}
        </form>
        <DataState
          resource={resource}
          empty={resource.data?.items.length === 0}
        >
          {(data) => (
            <div
              className={
                recordConfigs[def.path] || def.path === "tree-harvests"
                  ? "table-scroll workflow-record-scroll"
                  : "table-scroll"
              }
            >
              <table>
                <thead>
                  <tr>
                    <th>{def.title}</th>
                    {def.columns.map((col) => (
                      <th key={col.label}>{col.label}</th>
                    ))}
                    <th>
                      <span className="sr-only">Chi tiết</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link
                          className="item-name"
                          to={`/${detailPath ?? def.path}/${item.id}`}
                        >
                          {def.name(item)}
                        </Link>
                      </td>
                      {def.columns.map((col) => (
                        <td key={col.label}>{col.value(item)}</td>
                      ))}
                      <td>
                        <Link
                          className="icon-button"
                          aria-label={`Xem ${def.name(item)}`}
                          to={`/${detailPath ?? def.path}/${item.id}`}
                        >
                          <ArrowUpRight size={18} />
                        </Link>
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
            total={resource.data.total}
            offset={resource.data.offset}
            limit={resource.data.limit}
            onChange={(value) => change("offset", String(value))}
          />
        )}
      </section>
    </>
  );
}
function ResourceDetail<T extends { id: string }>({
  definition: def,
  id,
}: {
  definition: Definition<T>;
  id: string;
}) {
  const { api, user } = useSession();
  const [message, setMessage] = useState("");
  const path = `${def.path}/${id}`;
  const load = useCallback(
    (signal: AbortSignal) => api.request<T>(path, { signal }),
    [api, path],
  );
  const resource = useResource(path, load);
  return (
    <>
      <PageHeader
        title={`Chi tiết ${def.title.toLocaleLowerCase("vi")}`}
        actions={
          <Link className="button secondary" to={`/${def.path}`}>
            <ArrowLeft size={16} />
            Danh sách
          </Link>
        }
      />
      {message && <Notice kind="success">{message}</Notice>}
      <ReferenceScope kind={def.path} id={id}>
        <DataState resource={resource}>
          {(data) => (
            <>
              <section className="panel">
                <h2 className="break-word">{def.name(data)}</h2>
                {["materials", "standards"].includes(def.path) && (
                  <CatalogTools
                    key={`${def.path}/${id}`}
                    path={def.path}
                    item={data}
                    onSaved={resource.reload}
                  />
                )}
                {recordConfigs[def.path] && (
                  <RecordTools
                    key={`${def.path}/${id}`}
                    path={def.path}
                    item={data}
                    onSaved={() => {
                      setMessage(
                        def.path === "farms" || user.role === "Admin"
                          ? "Đã gửi đề xuất. Mở Phiếu đề xuất để theo dõi phê duyệt."
                          : "Đã lưu thông tin.",
                      );
                      resource.reload();
                    }}
                  />
                )}
                {def.path === "tree-harvests" && (
                  <HarvestTools
                    item={data as unknown as Harvest}
                    onSaved={resource.reload}
                  />
                )}
                <dl className="details">
                  {def.detail.map((field) => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd>{field.value(data)}</dd>
                    </div>
                  ))}
                </dl>
                {def.links && <div className="actions">{def.links(data)}</div>}
              </section>
              {def.extra?.(data)}
            </>
          )}
        </DataState>
      </ReferenceScope>
    </>
  );
}
interface TreeChange {
  id: string;
  action: "Create" | "Update";
  version: number;
  changed_at: string;
  after: Tree;
}
function TreeHistory({ id }: { id: string }) {
  const { api } = useSession();
  const [offset, setOffset] = useState(0);
  const path = `trees/${id}/history${queryString({ limit: 20, offset })}`;
  const load = useCallback(
    (signal: AbortSignal) => api.request<Page<TreeChange>>(path, { signal }),
    [api, path],
  );
  const resource = useResource(path, load);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Lịch sử hồ sơ cây</h2>
      </div>
      <DataState resource={resource} empty={resource.data?.items.length === 0}>
        {(data) => (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Thao tác</th>
                  <th>Phiên bản</th>
                  <th>Giống</th>
                  <th>Trạng thái sau thay đổi</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>{dateTime(row.changed_at)}</td>
                    <td>{row.action === "Create" ? "Tạo cây" : "Cập nhật"}</td>
                    <td>{row.version}</td>
                    <td>{row.after.variety}</td>
                    <td>
                      <Badge status={row.after.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>
      {resource.data && <Pagination {...resource.data} onChange={setOffset} />}
    </section>
  );
}
