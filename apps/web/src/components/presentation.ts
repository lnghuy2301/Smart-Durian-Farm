// Presentation only: API keys, enum values and timestamps are never rewritten.
export function shortTreeCode(value: string): string {
  return /^DRN-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? `Cây SR-${value.slice(-8).toUpperCase()}`
    : value;
}
export const fieldLabels: Record<string, string> = {
  id: "ID hồ sơ",
  _id: "ID nhật ký",
  status: "Trạng thái",
  name: "Tên",
  created_at: "Thời điểm tạo",
  created_by: "Người tạo",
  updated_at: "Cập nhật lần cuối",
  updated_by: "Người cập nhật",
  owner_id: "Chủ vườn",
  user_id: "Người phụ trách",
  farmer_id: "Người ghi nhật ký",
  manager_id: "Người quản lý HTX",
  proposed_by: "Người đề xuất",
  requested_by: "Người gửi yêu cầu",
  changed_by: "Người thay đổi",
  approved_at: "Thời điểm chấp thuận",
  cooperative_id: "Hợp tác xã",
  farm_id: "Vườn",
  zone_id: "Khu vực",
  tree_id: "Cây",
  device_id: "Thiết bị",
  sensor_id: "Cảm biến",
  actuator_id: "Bộ chấp hành",
  standard_id: "Tiêu chuẩn",
  material_id: "Vật tư",
  tree_code: "Mã cây",
  batch_code: "Mã lô",
  station_id: "Mã trạm ESP32",
  harvest_date: "Ngày thu hoạch",
  plant_date: "Ngày trồng",
  installed_at: "Thời điểm lắp đặt",
  join_cooperative_date: "Ngày gia nhập HTX",
  start_date: "Bắt đầu hiệu lực",
  end_date: "Kết thúc hiệu lực",
  accepted_at: "Thời điểm nhận việc",
  expires_at: "Hết hạn lúc",
  fruit_count: "Số quả",
  total_weight_kg: "Khối lượng (kg)",
  season_name: "Mùa vụ",
  variety: "Giống cây",
  cost: "Chi phí (đồng)",
  zone_name: "Tên khu vực",
  area_size: "Diện tích (ha)",
  address: "Địa chỉ",
  longitude: "Kinh độ",
  latitude: "Vĩ độ",
  certificate_number: "Số giấy chứng nhận",
  cooperative_name: "Tên hợp tác xã",
  director: "Giám đốc",
  contact_number: "Số điện thoại liên hệ",
  sensor_type: "Loại cảm biến",
  unit: "Đơn vị",
  min_threshold: "Ngưỡng dưới",
  max_threshold: "Ngưỡng trên",
  data_stream_id: "Mã luồng dữ liệu",
  purpose: "Chức năng",
  capability_id: "Mã điều khiển",
  last_seen_at: "Tín hiệu gần nhất",
  role: "Vai trò",
  reason: "Lý do",
  version: "Phiên bản",
  action: "Thao tác",
  action_type: "Hoạt động",
  target_type: "Loại đối tượng",
  target_id: "Đối tượng áp dụng",
  duration_minutes: "Thời lượng (phút)",
  water_volume_l: "Lượng nước (lít)",
  note: "Ghi chú",
  quantity: "Lượng sử dụng",
  materials: "Vật tư sử dụng",
  material_type: "Loại vật tư",
  default_dosage: "Liều dùng tham khảo",
  quarantine_days: "Số ngày cách ly",
  description: "Mô tả",
  code: "Mã",
  certifying_body: "Đơn vị chứng nhận",
  lock_at: "Hạn khóa nhật ký",
  locked_at: "Thời điểm đã khóa",
  is_correction: "Là bản đính chính",
  correction_reason: "Lý do đính chính",
  assignment_id: "Mã phân công",
  changed_at: "Thời điểm thay đổi",
  deleted_at: "Thời điểm xóa",
  confirmed_at: "Thời điểm xác nhận",
  resolved_at: "Thời điểm xử lý",
  resolved_by: "Người xử lý",
  editor_id: "Người chuẩn bị nội dung sửa",
  actor_id: "Người thực hiện",
  granted_by: "Người cấp quyền",
  revoked_at: "Thời điểm thu hồi",
  request_id: "Mã yêu cầu",
  harvest_id: "Mã hồ sơ thu hoạch",
  correction_grace_days: "Thời hạn đính chính (ngày)",
  correction_deadline: "Hạn đính chính",
  active: "Đang hiệu lực",
};
export const valueLabels: Record<string, string> = {
  Admin: "Quản trị viên",
  Manager: "Quản lý HTX",
  Farmer: "Nhà nông",
  Owner: "Chủ vườn",
  Active: "Đang sử dụng",
  Inactive: "Ngừng sử dụng",
  Pending: "Chờ duyệt",
  Draft: "Bản nháp",
  Confirmed: "Đã xác nhận",
  Locked: "Đã khóa",
  Accepted: "Đã chấp nhận",
  Rejected: "Đã từ chối",
  Reject: "Đã từ chối",
  Cancelled: "Đã hủy",
  Expired: "Đã hết hạn",
  Dead: "Cây chết",
  Removed: "Đã loại bỏ",
  Maintenance: "Bảo trì",
  Online: "Trực tuyến",
  Offline: "Mất kết nối",
  Unknown: "Chưa xác định",
  Create: "Tạo mới",
  Update: "Cập nhật",
  Join: "Gia nhập HTX",
  Leave: "Rời HTX",
  Assign: "Mời phụ trách",
  End: "Kết thúc phân công",
  Confirm: "Xác nhận",
  Correct: "Đính chính",
  watering: "Tưới nước",
  spraying: "Phun thuốc",
  shared: "Bơm dùng chung",
  Watering: "Tưới nước",
  Spraying: "Phun thuốc",
  Fertilizing: "Bón phân",
  Zone: "Khu vực",
  Tree: "Cây",
  air_temperature: "Nhiệt độ không khí",
  air_humidity: "Độ ẩm không khí",
  soil_moisture: "Độ ẩm đất",
  soil_temperature: "Nhiệt độ đất",
  soil_ph: "Độ pH đất",
  soil_ec: "Độ dẫn điện đất",
  Fertilizer: "Phân bón",
  Pesticide: "Thuốc bảo vệ thực vật",
  Biological: "Chế phẩm sinh học",
};
export function calendarDate(value: string | null | undefined): string {
  if (!value) return "Chưa có";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (
    !match ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    return "Ngày không hợp lệ";
  return `${match[3]}/${match[2]}/${match[1]}`;
}
export function displayDateTime(value: string | null | undefined): string {
  if (!value) return "Chưa có";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return calendarDate(value);
  if (!Number.isFinite(Date.parse(value))) return "Thời gian không hợp lệ";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
    hourCycle: "h23",
  }).format(new Date(value));
}
export function displayValue(
  key: string,
  value: unknown,
  references: Record<string, string> = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number")
    return key.endsWith("_id")
      ? String(value)
      : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 }).format(
          value,
        );
  if (Array.isArray(value))
    return (
      value.map((item) => displayValue(key, item, references)).join("; ") || "—"
    );
  if (typeof value === "object")
    return Object.entries(value)
      .map(
        ([k, v]) =>
          `${fieldLabels[k] ?? "Thông tin bổ sung"}: ${displayValue(k, v, references)}`,
      )
      .join(" · ");
  const text = String(value);
  if (references[text] && /_(?:id|by)$/.test(key) && key !== "_id")
    return references[text];
  if (/(?:_at|_date)$/.test(key) && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text))
    return displayDateTime(text);
  // Translate enums only in enum fields. A person's name, note or code is data.
  if (
    [
      "status",
      "role",
      "purpose",
      "sensor_type",
      "material_type",
      "action",
      "action_type",
      "target_type",
    ].includes(key)
  )
    return valueLabels[text] ?? "Chưa có nhãn hiển thị";
  return text;
}
