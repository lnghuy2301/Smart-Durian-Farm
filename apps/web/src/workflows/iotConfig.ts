import type { InputField } from "./shared";
const catalogStatus: InputField = { key: "status", label: "Trạng thái cấu hình", options: [["Active", "Đang sử dụng"], ["Inactive", "Ngừng sử dụng"]] };
const deviceRelation: InputField = { key: "device_id", label: "Trạm IoT", createOnly: true, relation: { path: "devices", label: (x) => String(x.station_id) } };
export const deviceFields: InputField[] = [
  { key: "zone_id", label: "Khu vực lắp đặt", createOnly: true, relation: { path: "zones", label: (x) => String(x.zone_name) } },
  { key: "station_id", label: "Mã trạm phần cứng", createOnly: true, maxLength: 50, pattern: "[A-Za-z0-9_-]+", hint: "Giữ đúng chữ hoa/thường của mã được cấu hình trên trạm." },
  { key: "installed_at", label: "Ngày lắp đặt", type: "datetime-local" },
  { key: "cost", label: "Chi phí", type: "number", min: 0, max: 99999999.99, step: 0.01 },
  { key: "status", label: "Trạng thái quản trị", options: [["Active", "Đang sử dụng"], ["Inactive", "Ngừng sử dụng"], ["Maintenance", "Bảo trì"]] },
];
export const sensorFields: InputField[] = [deviceRelation,
  { key: "name", label: "Tên cảm biến", maxLength: 80 },
  { key: "sensor_type", label: "Loại cảm biến", createOnly: true, options: [["air_temperature", "Nhiệt độ không khí"], ["air_humidity", "Độ ẩm không khí"], ["soil_moisture", "Độ ẩm đất"]] },
  { key: "data_stream_id", label: "Mã luồng dữ liệu", createOnly: true, pattern: "[A-Za-z0-9_-]+", maxLength: 50 },
  { key: "unit", label: "Đơn vị cấu hình", maxLength: 16, hint: "Đơn vị cấu hình không ghi đè đơn vị trạm gửi trong lịch sử." },
  { key: "min_threshold", label: "Ngưỡng tối thiểu", type: "number", nullable: true, required: false, min: -99999.99, max: 99999.99, step: 0.01 },
  { key: "max_threshold", label: "Ngưỡng tối đa", type: "number", nullable: true, required: false, min: -99999.99, max: 99999.99, step: 0.01 }, catalogStatus,
];
export const actuatorFields: InputField[] = [deviceRelation,
  { key: "name", label: "Tên bơm / van", maxLength: 80 },
  { key: "purpose", label: "Mục đích", createOnly: true, options: [["watering", "Tưới nước"], ["spraying", "Phun thuốc"], ["shared", "Dùng chung"]] },
  { key: "capability_id", label: "Mã khả năng phần cứng", createOnly: true, type: "number", min: 1, max: Number.MAX_SAFE_INTEGER, step: 1 }, catalogStatus,
];
