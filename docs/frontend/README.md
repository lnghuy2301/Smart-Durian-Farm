# Tài nguyên frontend và hướng dẫn module

Cập nhật điều hướng/dashboard21/10 — `feat/web-role-navigation-dashboard` từ `1cd9447`: sidebar dùng một cấu hình theo vai trò, bốn nhóm thu gọn; dashboard ưu tiên phiếu cần xử lý và dữ liệu công việc thật. Farmer có hai ngữ cảnh Vườn của tôi/Công việc được giao, owner xét từng Farm.owner_id, không dùng is_owner để mở quyền. Có `/assigned-work` frontend và link lịch sử cá nhân sau End; Manager không thấy menu quản trị/chủ vườn. [Cấu trúc menu, nguồn API, quyền, source và tái lập](modules/ROLE_NAVIGATION_DASHBOARDS.md). **16/16 unit,54/54 browser memory/API +4/4 browser database/MQTT TCP; lint/typecheck/build/format đạt**. Giữ API/backend/database/auth/OTP/brand và các thay đổi riêng; không AI hoặc lệnh hardware thật.

Cập nhật21/10/2026. Các workflow web và màn hình điều khiển đã có; backend development dùng shared database runtime. [Chạy web](../../apps/web/README.md), [runtime](../DATABASE_RUNTIME_IMPLEMENTATION.md), [workflows UI](REFERENCE_WORKFLOWS_IMPLEMENTATION.md), [control](modules/ACTUATOR_CONTROL_WEB.md). Các guide cũ ghi checkpoint triển khai; dùng [tiến độ hiện hành](../BACKEND_PROGRESS_CURRENT.md) để xác định phần còn thiếu.

Brand kit chính thức giữ tại assets/brand; HTML/screenshots riêng là nguồn thiết kế, không xóa chỉ vì không import runtime.

| Thư mục | Nội dung |
| --- | --- |
| `assets/brand/Smart_Durian_Brand_Kit/` | Nguồn chung của bộ nhận diện đã chọn: logo, favicon, icon app, pattern, guideline, tokens JSON/CSS. |
| `docs/frontend/references/stitch_smart_durian_farmer_dashboard/` | HTML, ảnh và DESIGN do người dùng cung cấp; mỗi màn hình một thư mục, có manifest giải thích nguồn dùng chung. |

Các đường dẫn trong bảng tính từ thư mục gốc dự án. Đã bỏ các thư mục/placeholder rỗng trước khi triển khai. Xem [manifest mẫu Stitch](references/stitch_smart_durian_farmer_dashboard/README.md).

## Cách đặt tài nguyên

Cỡ chữ web và cân đối responsive sau khi thiết kế được duyệt: [hướng dẫn thay đổi và kiểm tra](UI_READABILITY.md).

- Mẫu giao diện tham khảo đặt trong `docs/frontend/references/`, tách khỏi tài nguyên chạy của ứng dụng. Tài nguyên thương hiệu gốc giữ tại `assets/brand/`.
- Logo, favicon, icon app, pattern và tokens giữ tại nguồn chung `assets/brand/`. Chỉ tạo thư mục public trong app khi có tài nguyên thực sự cần dùng; bản sao phục vụ build phải có cách đồng bộ với nguồn chung.
- Tài nguyên tạm đặt tên có hậu tố `-temporary` và ghi trạng thái tạm bên dưới; không coi là nhận diện chính thức.
- Giữ nguyên file gốc được cung cấp. Với tài nguyên bên ngoài, ghi nguồn và quyền sử dụng; chưa rõ quyền thì chỉ ghi nhận làm tham khảo, chưa đưa vào ứng dụng.

## Ghi nhận tài nguyên

Điền thêm một dòng khi đưa tài nguyên vào. Kit còn 46 file sau khi bỏ PNG 180px trùng hoàn toàn; nguồn icon 180px là [apple-touch-icon.png](../../assets/brand/Smart_Durian_Brand_Kit/02_Favicon/apple-touch-icon.png). Không tạo lại hoặc đổi màu logo.

| File/thư mục | Nguồn hoặc người cung cấp | Quyền sử dụng | Mục đích / màn hình | Trạng thái: tham khảo, tạm, chính thức |
| --- | --- | --- | --- | --- |
| `assets/brand/Smart_Durian_Brand_Kit/` | Người dùng cung cấp và xác nhận ngày 2026-10-08 | Người dùng chọn sử dụng trong toàn dự án; kit không kèm file font | Web, React Native, tài liệu/slide | Chính thức được chọn cho dự án |

Người dùng đã cung cấp mẫu và yêu cầu triển khai ngày 2026-10-08. Chỉ tích hợp các API/nghiệp vụ đã xác nhận; module nào thiếu quyết định thì hỏi trước và tiếp tục các phần độc lập. Không push/merge.
