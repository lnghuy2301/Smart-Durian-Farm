import type { InputField } from "./shared";
export const harvestFields: InputField[] = [
  {
    key: "tree_id",
    label: "Cây thu hoạch",
    createOnly: true,
    relation: { path: "trees", label: (x) => `${x.tree_code} · ${x.variety}` },
  },
  { key: "season_name", label: "Tên mùa vụ", maxLength: 50 },
  {
    key: "harvest_date",
    label: "Ngày thu hoạch",
    type: "date",
  },
  {
    key: "fruit_count",
    label: "Số quả",
    type: "number",
    min: 1,
    max: 2147483647,
    step: 1,
  },
  {
    key: "total_weight_kg",
    label: "Khối lượng (kg)",
    type: "number",
    min: 0.01,
    max: 99999.99,
    step: 0.01,
  },
  { key: "batch_code", label: "Mã lô thu hoạch", maxLength: 50 },
];
