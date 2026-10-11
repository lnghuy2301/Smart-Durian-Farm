import type { InputField } from "./shared";
export const coordinates: InputField[] = [
  { key: "latitude", label: "Vĩ độ", type: "number", min: -90, max: 90, step: 0.0000001 },
  { key: "longitude", label: "Kinh độ", type: "number", min: -180, max: 180, step: 0.0000001 },
];
export const area: InputField = { key: "area_size", label: "Diện tích", type: "number", min: 0.001, max: 9999.999, step: 0.001 };
export const farmFields: InputField[] = [
  { key: "certificate_number", label: "Số chứng nhận vườn", maxLength: 18 },
  { key: "address", label: "Địa chỉ vườn", type: "textarea", maxLength: 255 }, area, ...coordinates,
];
export const zoneFields: InputField[] = [
  { key: "farm_id", label: "Vườn trồng", createOnly: true, relation: { path: "farms", label: (x) => `${x.certificate_number} · ${x.address}` } },
  { key: "zone_name", label: "Tên khu vực", maxLength: 255 }, area,
  { key: "standard_id", label: "Tiêu chuẩn canh tác", relation: { path: "standards?status=Active", label: (x) => `${x.code} · ${x.name}` } },
  ...coordinates,
];
