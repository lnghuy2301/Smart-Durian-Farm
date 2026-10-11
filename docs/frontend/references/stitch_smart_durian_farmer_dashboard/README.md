# Mẫu giao diện Stitch do người dùng cung cấp

Ngày tiếp nhận: 2026-10-08. Nguồn: người dùng xác nhận đây là HTML và ảnh thiết kế của mình. Các file giữ ở thư mục tài liệu, không được đóng gói vào ứng dụng hoặc chạy các script Demo Switcher trên web triển khai.

| Thư mục | Nguồn còn giữ | Cách sử dụng |
| --- | --- | --- |
| `agritech_durian_os/` | `DESIGN.md` | Tham khảo bố cục, kích thước chạm, typography; màu thương hiệu theo kit Smart Durian đã chốt. |
| `login_register/` | `code.html`, `screen.png` | Đăng nhập và đăng ký; chỉ dùng role Farmer/Manager, chủ Farm không phải role thứ tư. |
| `interface_farmer/` | `code.html`, `screen.png` | Bố cục dashboard Farmer, dữ liệu phải lấy trong scope hiện tại của API. |
| `interface_admin/` | `code.html`, `screen.png` | Dashboard Admin và drawer duyệt Manager hiện có trong HTML này. |
| `interface_manager/` | `code.html`, `screen.png`, `README.md` | Mẫu riêng mới được người dùng xác nhận triển khai ngày 2026-10-08. Bản cũ trùng Admin đã bỏ; DESIGN dùng nguồn chung. |
| `cooperative management_admin/` | `code.html`, `screen.png` | Nguồn HTML chung cho list/detail/create/edit HTX Admin. |
| `approve manager_admin/` | `screen.png` | Ảnh thực tế là form sửa HTX; HTML trùng SHA-256 với `cooperative management_admin/code.html`, đã bỏ bản trùng. Form duyệt Manager tham khảo drawer trong `interface_admin/code.html`. |
| `manage_farm and zone/` | `code.html`, `screen.png` | Quản lý vườn/khu vực; chủ sở hữu, đề xuất, phân công và tham gia HTX theo API. |
| `manage_tree/` | `code.html`, `screen.png` | Danh sách cây, bộ lọc, chi tiết, lịch sử và đề xuất metadata. |
| `manage_harvest/` | `code.html`, `screen.png` | Nháp thu hoạch, xác nhận, đính chính và quyền nhập bù. |
| `cultivation_event/` | `code.html`, `screen.png` | Nhật ký dạng thẻ, ba loại hoạt động, hạn khóa và lịch sử đính chính. |
| `manage_IoT/` | `code.html`, `screen.png` | Registry thiết bị/cảm biến/bơm van; không coi metadata là điều khiển phần cứng. |
| `manage_HTX/` | `code.html`, `screen.png` | Trùng cả HTML/ảnh với `cooperative management_admin`; giữ nguồn người dùng và dùng chung component hiện có. |

Sáu mẫu quản lý bổ sung được đối chiếu ngày 2026-10-11. Danh mục route/API, branch, kiểm tra và cách tái lập nằm trong [hồ sơ triển khai](../../REFERENCE_WORKFLOWS_IMPLEMENTATION.md).

## Khác biệt phải xử lý khi triển khai

- Bộ màu trong DESIGN/HTML khác bộ nhận diện đã chọn: dùng JSON/CSS của `assets/brand/Smart_Durian_Brand_Kit/` làm chuẩn.
- Các tên, ảnh người dùng, thống kê, biểu đồ, logs, số điện thoại hỗ trợ và trạng thái Gateway trong HTML là dữ liệu mẫu; không đưa vào ứng dụng như dữ liệu API.
- Đăng ký Farmer không nhận tên/địa chỉ Farm hoặc Zone tham gia; đăng ký Manager xác minh email rồi tạo tài khoản Pending, chưa OTP điện thoại. Farm/assignment có workflow riêng.
- Hiện có API Cultivation và public QR; giao diện đã tích hợp theo hợp đồng backend. Chưa có API thống kê tổng tài khoản, danh bạ Farmer, AI hoặc cảnh báo pin/sim. API actuator tasks có hợp đồng riêng; mẫu registry IoT chỉ quản lý metadata, không biến status thành nút điều khiển. Người dùng xác nhận giữ nhập mã tài khoản tạm thời; không tạo nút tác vụ giả.
- Admin duyệt Manager yêu cầu tạo/gắn HTX; reject chỉ nhận `{}`, không có lý do hoặc gửi email thông báo. Manager không được gọi API Admin.
- Farm không có `farm_name`; hiển thị chứng nhận/địa chỉ. HTX không trả tên/email/phone của Manager; chỉ thể hiện đã/chưa gắn, không lấy người đại diện làm tên Manager.
- Không tự thêm rule stale 2 chu kỳ hoặc coi status metadata là relay on/off; connectivity theo API MQTT, raw unit/time theo Telemetry.

## Dọn cấu trúc trước khi code

Đã đối chiếu SHA-256 trước khi xóa HTML/ảnh Manager cũ trùng Admin và HTML approve manager_admin trùng cooperative management_admin ở commit cleanup `2f4a65b`. Khi nhận mẫu Manager mới, bỏ thêm `interface_manager/DESIGN.md` trùng `agritech_durian_os/DESIGN.md`; README Manager liên kết nguồn chung. Giữ nguyên HTML/ảnh Manager mới. Bỏ sáu placeholder `.gitkeep` tại apps/api, apps/web, apps/mobile, ai và hai thư mục tham khảo HTML/images rỗng. Thư mục mobile/ai chỉ tạo lại khi bắt đầu phần việc đó. Giữ source backend, dependencies, `.env` và các sửa/xóa riêng của người dùng ở ERD/MQTT/Postman. Không sửa HTML/ảnh gốc còn lại.
