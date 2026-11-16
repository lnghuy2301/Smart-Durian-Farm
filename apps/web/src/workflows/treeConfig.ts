import type { InputField } from "./shared";
import { coordinates } from "./farmZoneConfig";
export const treeFields: InputField[] = [
  {
    key: "zone_id",
    label: "Khu vực trồng",
    createOnly: true,
    relation: { path: "zones", label: (x) => String(x.zone_name) },
  },
  { key: "variety", label: "Giống sầu riêng", maxLength: 80 },
  { key: "plant_date", label: "Ngày trồng", type: "datetime-local" },
  {
    key: "status",
    label: "Trạng thái cây",
    options: [
      ["Active", "Đang sử dụng"],
      ["Dead", "Cây chết"],
      ["Removed", "Đã loại bỏ"],
    ],
  },
  ...coordinates,
];
