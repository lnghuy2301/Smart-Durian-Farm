// Generated initialization content, not verified people, certificates or field
// observations. Provenance stays private in entity_metadata/audit; the UI uses
// these ordinary business labels. Account/hardware identifiers are separate.
export const OPERATIONAL_NAMES = {
  admin: 'Trần Quốc Huy', farmer: 'Nguyễn Minh Quân', worker: 'Lê Văn Phúc',
  cooperative: 'HTX Sầu Riêng Phước An', director: 'Nguyễn Thanh Bình',
};
export const OPERATIONAL_STANDARDS = [
  { code: 'QT-SR-01', name: 'Quy trình chăm sóc sầu riêng', description: 'Quản lý tưới, dinh dưỡng và ghi chép theo từng khu vực sản xuất.', certifying_body: 'Bộ phận kỹ thuật hợp tác xã' },
  { code: 'IPM-SR-01', name: 'Quản lý dịch hại tổng hợp trên sầu riêng', description: 'Theo dõi dịch hại, vệ sinh vườn và ghi nhận vật tư sử dụng theo cây hoặc khu vực.', certifying_body: 'Bộ phận kỹ thuật hợp tác xã' },
  { code: 'QT-SR-2024', name: 'Quy trình chăm sóc sầu riêng năm 2024', description: 'Phiên bản quy trình được lưu để đối chiếu lịch sử sản xuất.', certifying_body: 'Bộ phận kỹ thuật hợp tác xã' },
];
export const OPERATIONAL_MATERIALS = ['Phân hữu cơ vi sinh', 'Phân NPK 16-16-8', 'Chế phẩm Trichoderma', 'Chế phẩm sinh học bảo vệ cây trồng', 'Chế phẩm cải tạo đất'];
export const OPERATIONAL_DOSAGE = 'Theo nhãn sản phẩm và kế hoạch chăm sóc được phê duyệt';
export const OPERATIONAL_FARMS = [
  { address: 'Khu sản xuất Phước An, Krông Pắc, Đắk Lắk', certificate_number: 'HS-KP-2026-001' },
  { address: 'Khu sản xuất Cái Bè', certificate_number: 'HS-CB-2026-002' },
  { address: 'Khu sản xuất Đạ Huoai, Lâm Đồng', certificate_number: 'HS-DH-2026-003' },
];
export const OPERATIONAL_ZONES = ['Khu Ri6 phía Đông', 'Khu Monthong phía Tây', 'Khu Ri6 ven mương', 'Khu Monthong trung tâm', 'Khu Ri6 sườn đồi', 'Khu Monthong chân đồi'];
export const SENSOR_NAMES = ['Nhiệt độ không khí', 'Độ ẩm không khí', 'Độ ẩm đất', 'Nhiệt độ đất', 'pH đất', 'EC đất'];
export const OPERATIONAL_STATIONS = ['B48A0A6C912E', 'C8F09E7D2B14'] as const;

type Table = 'users' | 'cooperatives' | 'farming_standards' | 'agricultural_materials' | 'farms' | 'zones';
export interface ContentReplacement { table: Table; key: string; before: Record<string, string>; after: Record<string, string> }
export const CONTENT_REPLACEMENTS: ContentReplacement[] = [
  ...[['admin', 'Admin demo', OPERATIONAL_NAMES.admin], ['primary-farmer', 'Chủ vườn demo', OPERATIONAL_NAMES.farmer], ['sample-farmer', 'Farmer mẫu', OPERATIONAL_NAMES.worker]].map(([key, before, after]) => ({ table: 'users' as const, key, before: { user_name: before }, after: { user_name: after } })),
  { table: 'cooperatives', key: 'cooperative-unmanaged', before: { cooperative_name: 'HTX Sầu Riêng Demo', director: 'Ban quản trị mẫu', certificate_number: 'DEMO-HTX-001', address: 'Địa chỉ HTX minh họa — Đắk Lắk' },
    after: { cooperative_name: OPERATIONAL_NAMES.cooperative, director: OPERATIONAL_NAMES.director, certificate_number: 'HS-HTX-2026-001', address: 'Khu sản xuất Phước An, Krông Pắc, Đắk Lắk' } },
  ...OPERATIONAL_STANDARDS.map((after, i) => ({ table: 'farming_standards' as const, key: `standard-${i}`,
    before: { code: ['DEMO-VIETGAP', 'DEMO-IPM', 'DEMO-OLD'][i], name: ['Thực hành VietGAP (mẫu)', 'Quản lý dịch hại tổng hợp (mẫu)', 'Quy trình cũ (mẫu)'][i], description: 'Dữ liệu minh họa, không phải chứng nhận hoặc hướng dẫn liều dùng thực tế.', certifying_body: 'Đơn vị minh họa' }, after })),
  ...OPERATIONAL_MATERIALS.map((name, i) => ({ table: 'agricultural_materials' as const, key: `material-${i}`,
    before: { name: ['Phân hữu cơ vi sinh (mẫu)', 'NPK cho cây trưởng thành (mẫu)', 'Chế phẩm Trichoderma (mẫu)', 'Vật tư bảo vệ thực vật (mẫu)', 'Vật tư ngưng dùng (mẫu)'][i], default_dosage: 'Theo nhãn sản phẩm; dữ liệu demo không chỉ định liều' },
    after: { name, default_dosage: OPERATIONAL_DOSAGE } })),
  ...OPERATIONAL_FARMS.map((after, i) => ({ table: 'farms' as const, key: `farm-${i}`,
    before: { address: ['Vườn demo Krông Pắc, Đắk Lắk', 'Vườn demo Cái Bè, Tiền Giang', 'Vườn demo Đạ Huoai, Lâm Đồng'][i], certificate_number: `DEMO-FARM-00${i + 1}` }, after })),
  ...OPERATIONAL_ZONES.map((name, i) => ({ table: 'zones' as const, key: `zone-${i}`,
    before: { zone_name: i === 0 ? 'Khu A — trạm ESP32 thật' : `Khu ${i + 1} — dữ liệu mẫu` }, after: { zone_name: name } })),
];
