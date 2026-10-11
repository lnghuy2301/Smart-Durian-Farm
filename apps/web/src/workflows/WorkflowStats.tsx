import { DataState, number } from "../components/ui";
import { useCollection } from "./shared";
export function WorkflowStats({ path, kind }: { path: string; kind: string }) {
  const resource = useCollection<{
    id: string;
    status?: string;
    area_size?: number;
    cooperative_id?: string | null;
    total_weight_kg?: number;
    fruit_count?: number;
  }>(path);
  const data = resource.data ?? [];
  const count = (status: string) =>
    data.filter((x) => x.status === status).length;
  const totals =
    kind === "farms"
      ? [
          ["Vườn phù hợp", data.length],
          [
            "Tổng diện tích",
            data.reduce((sum, x) => sum + (x.area_size ?? 0), 0),
          ],
          ["Đã tham gia HTX", data.filter((x) => x.cooperative_id).length],
        ]
      : kind === "zones"
        ? [
            ["Khu vực phù hợp", data.length],
            [
              "Tổng diện tích",
              data.reduce((sum, x) => sum + (x.area_size ?? 0), 0),
            ],
          ]
        : kind === "tree-harvests"
          ? [
              ["Hồ sơ phù hợp", data.length],
              ["Đã xác nhận", count("Confirmed")],
              [
                "Số quả đã xác nhận",
                data
                  .filter((x) => x.status === "Confirmed")
                  .reduce((sum, x) => sum + (x.fruit_count ?? 0), 0),
              ],
              [
                "Khối lượng xác nhận (kg)",
                data
                  .filter((x) => x.status === "Confirmed")
                  .reduce((sum, x) => sum + (x.total_weight_kg ?? 0), 0),
              ],
            ]
          : [
              [kind === "trees" ? "Cây phù hợp" : "Trạm phù hợp", data.length],
              ["Đang sử dụng", count("Active")],
              [
                kind === "trees" ? "Cây chết" : "Bảo trì",
                count(kind === "trees" ? "Dead" : "Maintenance"),
              ],
              [
                kind === "trees" ? "Đã loại bỏ" : "Ngừng sử dụng",
                count(kind === "trees" ? "Removed" : "Inactive"),
              ],
            ];
  return (
    <DataState resource={resource}>
      {() => (
        <div className="workflow-stats" aria-label="Thống kê theo bộ lọc">
          {totals.map(([label, value]) => (
            <article className="workflow-stat" key={label}>
              <span>{label}</span>
              <strong>{number(Number(value))}</strong>
            </article>
          ))}
        </div>
      )}
    </DataState>
  );
}
