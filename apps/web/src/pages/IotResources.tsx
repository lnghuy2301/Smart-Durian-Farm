import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, dateTime, number } from "../components/ui";
import { ResourceList, treeDefinition, type Definition } from "./Resources";
import { RecordTools } from "../workflows/RecordTools";
import { HistoryPanel } from "../workflows/shared";
import type { Actuator, Device, Sensor } from "../types/api";
const statusFilter = { key: "status", label: "Trạng thái cấu hình", options: [["Active", "Đang sử dụng"], ["Inactive", "Ngừng sử dụng"]] as [string, string][] };
const sensorNames: Record<Sensor["sensor_type"], string> = { air_temperature: "Nhiệt độ không khí", air_humidity: "Độ ẩm không khí", soil_moisture: "Độ ẩm đất" };
const purposeNames: Record<Actuator["purpose"], string> = { watering: "Tưới nước", spraying: "Phun thuốc", shared: "Dùng chung" };
export const sensorDefinition: Definition<Sensor> = {
  path: "sensors", title: "Cảm biến", subtitle: "Thông tin cấu hình cảm biến; đơn vị lịch sử do trạm cung cấp.", search: "Tìm tên hoặc mã luồng", name: (x) => x.name,
  relationships: ["device_id"], filters: [statusFilter, { key: "sensor_type", label: "Loại cảm biến", options: Object.entries(sensorNames) }],
  columns: [{ label: "Loại", value: (x) => sensorNames[x.sensor_type] }, { label: "Luồng", value: (x) => x.data_stream_id }, { label: "Đơn vị", value: (x) => x.unit }, { label: "Ngưỡng", value: (x) => x.min_threshold === null ? "Không cấu hình" : `${x.min_threshold} – ${x.max_threshold}` }, { label: "Trạng thái", value: (x) => <Badge status={x.status} /> }],
  detail: [{ label: "Tên", value: (x) => x.name }, { label: "Loại", value: (x) => sensorNames[x.sensor_type] }, { label: "Luồng dữ liệu", value: (x) => x.data_stream_id }, { label: "Đơn vị", value: (x) => x.unit }, { label: "Ngưỡng tối thiểu", value: (x) => x.min_threshold ?? "Không cấu hình" }, { label: "Ngưỡng tối đa", value: (x) => x.max_threshold ?? "Không cấu hình" }, { label: "Trạng thái", value: (x) => <Badge status={x.status} /> }],
  links: (x) => <Link className="button secondary" to={`/devices/${x.device_id}`}>Về trạm IoT</Link>, extra: (x) => <HistoryPanel path={`sensors/${x.id}/history`} />,
};
export const actuatorDefinition: Definition<Actuator> = {
  path: "actuators", title: "Bơm / van", subtitle: "Cấu hình thiết bị chấp hành theo mã phần cứng.", search: "Tìm tên hoặc mã khả năng", name: (x) => x.name, relationships: ["device_id"],
  filters: [statusFilter, { key: "purpose", label: "Mục đích", options: Object.entries(purposeNames) }],
  columns: [{ label: "Mã khả năng", value: (x) => x.capability_id }, { label: "Mục đích", value: (x) => purposeNames[x.purpose] }, { label: "Trạng thái", value: (x) => <Badge status={x.status} /> }],
  detail: [{ label: "Tên", value: (x) => x.name }, { label: "Mã khả năng phần cứng", value: (x) => x.capability_id }, { label: "Mục đích", value: (x) => purposeNames[x.purpose] }, { label: "Trạng thái cấu hình", value: (x) => <Badge status={x.status} /> }],
  links: (x) => <Link className="button secondary" to={`/devices/${x.device_id}`}>Về trạm IoT</Link>, extra: (x) => <HistoryPanel path={`actuators/${x.id}/history`} />,
};
export const deviceDefinition: Definition<Device> = {
  path: "devices", title: "Thiết bị IoT", subtitle: "Quản lý trạm, cảm biến và bơm/van; trạng thái quản trị tách biệt với kết nối.", search: "Tìm mã trạm", name: (x) => x.station_id, relationships: ["zone_id"],
  filters: [{ ...statusFilter, label: "Trạng thái quản trị", options: [...statusFilter.options, ["Maintenance", "Bảo trì"]] }],
  columns: [{ label: "Ngày lắp", value: (x) => dateTime(x.installed_at) }, { label: "Chi phí", value: (x) => number(x.cost) }, { label: "Trạng thái quản trị", value: (x) => <Badge status={x.status} /> }, { label: "Tín hiệu gần nhất", value: (x) => dateTime(x.last_seen_at) }],
  detail: [{ label: "Mã trạm", value: (x) => x.station_id }, { label: "Ngày lắp", value: (x) => dateTime(x.installed_at) }, { label: "Chi phí", value: (x) => number(x.cost) }, { label: "Trạng thái quản trị", value: (x) => <Badge status={x.status} /> }, { label: "Tín hiệu gần nhất", value: (x) => dateTime(x.last_seen_at) }, { label: "Khu vực", value: (x) => <Link to={`/zones/${x.zone_id}`}>Xem khu vực lắp đặt</Link> }],
  links: (x) => <Link className="button secondary" to={`/iot?zone_id=${x.zone_id}`}>Giám sát tín hiệu và cảm biến</Link>, extra: (x) => <DeviceChildren key={x.id} device={x} />,
};
function DeviceChildren({ device }: { device: Device }) {
  const [tab, setTab] = useState("sensors"); const [revision, setRevision] = useState(0);
  const tabs = [["sensors", "Cảm biến"], ["actuators", "Bơm / van"], ["history", "Lịch sử cấu hình"], ["trees", "Cây trong khu vực"]];
  return <section className="panel"><div className="workflow-tabs" role="tablist" aria-label="Thông tin trạm">{tabs.map(([value, label]) => <button key={value} id={`device-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls="device-tab-content" className={`button secondary ${tab === value ? "selected" : ""}`} onClick={() => setTab(value)}>{label}</button>)}</div><div role="tabpanel" id="device-tab-content" aria-labelledby={`device-tab-${tab}`}>
    {tab === "sensors" && <><RecordTools path="sensors" context={{ device_id: device.id }} onSaved={() => setRevision((x) => x + 1)} /><ResourceList key={`sensors/${revision}`} definition={{ ...sensorDefinition, fixedFilters: { device_id: device.id } }} nested detailPath="sensors" /></>}
    {tab === "actuators" && <><RecordTools path="actuators" context={{ device_id: device.id }} onSaved={() => setRevision((x) => x + 1)} /><ResourceList key={`actuators/${revision}`} definition={{ ...actuatorDefinition, fixedFilters: { device_id: device.id } }} nested detailPath="actuators" /></>}
    {tab === "history" && <HistoryPanel path={`devices/${device.id}/history`} />}
    {tab === "trees" && <ResourceList definition={{ ...treeDefinition, path: `devices/${device.id}/trees`, relationships: undefined, filters: undefined, search: "", title: "Cây trong khu vực lắp đặt" }} nested detailPath="trees" />}
  </div></section>;
}
