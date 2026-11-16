import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../auth/session";
import { useResource } from "../hooks/useResource";
import { Badge, DataState, Notice, Pagination, number } from "../components/ui";
import { queryString } from "../api/client";
import {
  ConfirmDialog,
  EditorDialog,
  FormFields,
  type InputField,
  type Values,
} from "./shared";
import type { Material, Page } from "../types/api";

const status: InputField = {
  key: "status",
  label: "Trạng thái",
  options: [
    ["Active", "Đang sử dụng"],
    ["Inactive", "Ngừng sử dụng"],
  ],
};
const materialFields: InputField[] = [
  { key: "name", label: "Tên vật tư", maxLength: 255 },
  {
    key: "material_type",
    label: "Loại vật tư",
    options: [
      ["Fertilizer", "Phân bón"],
      ["Pesticide", "Thuốc bảo vệ thực vật"],
      ["Biological", "Chế phẩm sinh học"],
    ],
  },
  {
    key: "default_dosage_value",
    label: "Liều dùng tham khảo",
    type: "number",
    min: 0.001,
    max: 1000000,
    step: 0.001,
  },
  {
    key: "unit",
    label: "Đơn vị liều",
    maxLength: 10,
    hint: "Ví dụ: kg, g, ml, lít.",
  },
  {
    key: "dosage_basis",
    label: "Cơ sở liều",
    maxLength: 60,
    hint: "Ví dụ: cây/lần, 16 lít nước. Nhập theo hướng dẫn của sản phẩm.",
  },
  {
    key: "quarantine_days",
    label: "Thời gian cách ly (ngày)",
    type: "number",
    min: 0,
    max: 2147483647,
    step: 1,
  },
  status,
];
const standardFields: InputField[] = [
  { key: "code", label: "Mã tiêu chuẩn", maxLength: 40 },
  { key: "name", label: "Tên tiêu chuẩn", maxLength: 100 },
  {
    key: "description",
    label: "Mô tả tiêu chuẩn",
    type: "textarea",
    maxLength: 10000,
    required: false,
    includeEmpty: true,
  },
  { key: "certifying_body", label: "Đơn vị chứng nhận", maxLength: 120 },
  status,
];

export function CatalogTools({
  path,
  item,
  onSaved,
}: {
  path: string;
  item?: object;
  onSaved: () => void;
}) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  if (user.role !== "Admin" || !["materials", "standards"].includes(path))
    return null;
  const record = item as (Values & { id: string }) | undefined;
  const legacy =
    path === "materials" && record && record.default_dosage_value == null;
  // Never infer a numeric dose from historical prose. Legacy rows can keep
  // their label on unrelated edits; entering a new dose requires the API pair.
  const fields = (path === "materials" ? materialFields : standardFields).map(
    (field) =>
      legacy && ["default_dosage_value", "dosage_basis"].includes(field.key)
        ? { ...field, required: false }
        : field,
  );
  const title = path === "materials" ? "vật tư" : "tiêu chuẩn";
  return (
    <div className="workflow-tools">
      <button
        className="button secondary"
        onClick={() => {
          setSaved(false);
          setOpen(true);
        }}
      >
        {record ? "Sửa" : "Thêm"} {title}
      </button>
      {saved && <Notice kind="success">Đã lưu {title}.</Notice>}
      {open && (
        <EditorDialog
          title={`${record ? "Sửa" : "Thêm"} ${title}`}
          fields={fields}
          initial={record ?? { status: "Active", quarantine_days: 0 }}
          before={record}
          path={record ? `${path}/${record.id}` : path}
          method={record ? "PATCH" : "POST"}
          transform={(body) =>
            path === "standards" && !record
              ? { ...body, description: body.description ?? "" }
              : body
          }
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setSaved(true);
            onSaved();
          }}
        >
          {legacy && (
            <Notice>
              Liều cũ: {String(record.default_dosage)}. Chỉ điền đồng thời số
              liều và cơ sở khi đã xác định đúng hướng dẫn; lịch sử đã ghi được
              giữ nguyên.
            </Notice>
          )}
        </EditorDialog>
      )}
    </div>
  );
}

export function StandardMaterialPanel({ standardId }: { standardId: string }) {
  const { api, user } = useSession();
  const [offset, setOffset] = useState(0),
    [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Material>();
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState<Values>({
    q: "",
    status: "",
    material_type: "",
  });
  const path = `standards/${standardId}/materials`;
  const query = queryString({
    q: String(filters.q),
    status: String(filters.status),
    material_type: String(filters.material_type),
    limit: 10,
    offset,
  });
  const load = useCallback(
    (signal: AbortSignal) =>
      api.request<Page<Material>>(`${path}${query}`, {
        signal,
      }),
    [api, path, query],
  );
  const resource = useResource(`${path}${query}`, load);
  const reload = () => {
    setOffset(0);
    resource.reload();
  };
  return (
    <section className="panel">
      <h2>Vật tư liên kết</h2>
      {message && <Notice kind="success">{message}</Notice>}
      <p>
        Liên kết hiện tại dùng để đối chiếu nhật ký; thay đổi không ghi đè lịch
        sử đã lưu.
      </p>
      <div className="actions">
        <button className="button secondary" onClick={resource.reload}>
          Tải lại liên kết
        </button>
        {user.role === "Admin" && (
          <button className="button" onClick={() => setAdding(true)}>
            Gắn vật tư
          </button>
        )}
      </div>
      <FormFields
        fields={[
          {
            key: "q",
            label: "Tìm vật tư liên kết",
            required: false,
            maxLength: 100,
          },
          { ...materialFields[1], required: false },
          { ...status, required: false },
        ]}
        values={filters}
        set={(key, value) => {
          setFilters((current) => ({ ...current, [key]: value }));
          setOffset(0);
        }}
      />
      <DataState resource={resource} empty={resource.data?.items.length === 0}>
        {(data) => (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Vật tư</th>
                  <th>Liều tham khảo</th>
                  <th>Trạng thái</th>
                  {user.role === "Admin" && <th>Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((material) => (
                  <tr key={material.id}>
                    <td>
                      <Link to={`/materials/${material.id}`}>
                        {material.name}
                      </Link>
                    </td>
                    <td>
                      {material.default_dosage_value != null &&
                      material.dosage_basis
                        ? `${number(material.default_dosage_value)} ${material.unit}/${material.dosage_basis}`
                        : material.default_dosage}
                    </td>
                    <td>
                      <Badge status={material.status} />
                    </td>
                    {user.role === "Admin" && (
                      <td>
                        <button
                          className="button secondary"
                          onClick={() => setRemoving(material)}
                        >
                          Bỏ liên kết
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>
      {resource.data && <Pagination {...resource.data} onChange={setOffset} />}
      {adding && (
        <EditorDialog
          title="Gắn vật tư vào tiêu chuẩn"
          path={path}
          fields={[
            {
              key: "material_id",
              label: "Vật tư",
              relation: {
                path: "materials",
                label: (value) => String(value.name),
              },
            },
          ]}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setMessage("Đã gắn vật tư. Danh sách vẫn áp dụng bộ lọc hiện tại.");
            reload();
          }}
        >
          <Notice>
            Chọn vật tư trong danh mục. Trạng thái sử dụng vẫn được kiểm tra
            riêng khi ghi nhật ký.
          </Notice>
        </EditorDialog>
      )}
      {removing && (
        <ConfirmDialog
          title="Bỏ liên kết vật tư"
          path={`${path}/${removing.id}`}
          method="DELETE"
          onClose={() => setRemoving(undefined)}
          onSaved={() => {
            setRemoving(undefined);
            setMessage("Đã bỏ liên kết; vật tư vẫn được giữ trong danh mục.");
            reload();
          }}
        >
          <Notice kind="warning">
            Bỏ {removing.name} khỏi tiêu chuẩn? Vật tư và các nhật ký đã ghi vẫn
            được giữ.
          </Notice>
        </ConfirmDialog>
      )}
    </section>
  );
}
