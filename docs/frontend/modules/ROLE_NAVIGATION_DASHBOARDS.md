# Điều hướng và dashboard theo vai trò

Ngày21/10/2026, branch `feat/web-role-navigation-dashboard` từ source tích hợp `feat/offline-demo-telemetry@1cd9447`. Đợt này chỉ thay frontend và tài liệu; không đổi API/backend/database, quy trình duyệt, auth/session, OTP, hardware hoặc bộ nhận diện. Không có AI trong điều hướng hay dashboard.

## Cấu trúc điều hướng

`components/navigation.ts` là cấu hình dùng chung; một Shell render tất cả vai trò, không có ba sidebar sao chép. Tổng quan đứng riêng; bốn nhóm nghiệp vụ thu gọn, chỉ một nhóm mở tại một thời điểm; Tài khoản/Đăng xuất luôn ở đáy. Nhóm đang chứa URL được đánh dấu và tự mở khi chuyển trang, đường dẫn con có aria-current. Người dùng có thể đóng nhóm đang chọn bằng button; không lưu trạng thái menu vào auth storage.

| Vai trò | Nhóm và chức năng |
| --- | --- |
| Admin | **Tài khoản & HTX**: duyệt Manager, quản lý HTX. **Yêu cầu cần xử lý**: phiếu nghiệp vụ, nhập bù thu hoạch, theo dõi cập nhật HTX. **Danh mục canh tác**: vật tư, tiêu chuẩn/vật tư liên kết. **Tra cứu sản xuất**: Farm/Zone/cây/phân công, canh tác/thu hoạch, IoT/điều khiển ở quyền đọc, thiết bị/cảm biến. |
| Manager | **HTX của tôi**: hồ sơ HTX, yêu cầu cập nhật, thông báo. **Yêu cầu cần xử lý**: phiếu trong scope, gồm Join HTX/đính chính thu hoạch. **Vườn thành viên**: Farm/Zone/cây/phân công được đọc. **Theo dõi sản xuất**: nhật ký, thu hoạch, IoT/control ở quyền đọc và metadata. Không có menu Admin, cấp quyền nhập bù hoặc quản trị danh mục. |
| Farmer | **Vườn của tôi**: danh sách vườn và điểm bắt đầu tạo vườn; mở từng Farm rồi quản lý Zone/cây/phân công/thiết bị bằng các màn hiện có. **Công việc được giao**: khu vực đang phụ trách, phân công/lịch sử. **Canh tác & theo dõi**: khu vực/cây/thiết bị có quyền, nhật ký cá nhân, thu hoạch, giám sát và điều khiển. **Yêu cầu & tra cứu**: phiếu, quyền nhập bù được xem, tiêu chuẩn/vật tư được đọc. |

Không biến Sensor/Actuator thành các mục ngang cấp ở sidebar: vẫn mở được `/sensors`, `/actuators`, các tabs/links trong chi tiết Device. Tương tự, quản lý Zone/cây/phân công đi từ Farm/Zone theo liên kết hiện có. Vật tư liên kết được quản lý trong chi tiết tiêu chuẩn. Màn hình đã có không được dựng lại.

Sidebar mobile giữ breakpoint của Shell, button mở/đóng và backdrop hiện có; thêm Escape để đóng và trả focus về button mở. Groups dùng button native với aria-expanded/aria-controls, không lồng nhiều tầng. CSS mới giới hạn `.role-sidebar`; không thay theme, font, auth panel hoặc animation.

## Dashboard và nguồn dữ liệu

| Phần | Nguồn và cách tính |
| --- | --- |
| Admin | Manager chờ duyệt từ `GET users/pending-managers`, đặt lên trước các thống kê HTX/Farm/Zone hiện có; `RequestInbox` đặt phiếu cần chữ ký Admin/đính chính thu hoạch vườn độc lập lên trước. Cấp nhập bù là link đến màn hiện có, không tự tạo một số lượng “đơn xin nhập bù” khi API không có loại đơn này. |
| Manager | Đọc đủ trang `cooperatives`, chọn đúng `manager_id===user.id`; không lấy phần tử đầu làm authority. Không có HTX thì hướng dẫn liên hệ Admin, không gọi hàng loạt dữ liệu để dựng số liệu. HTX chưa có Farm thì chỉ hiện hồ sơ/hướng dẫn, phiếu Join và thống kê thật, không lặp nhiều bảng sản xuất rỗng; số0 là kết quả từ API. Khi có Farm, giữ thống kê thành viên/phân công/thu hoạch Confirmed theo bộ lọc và Việt Nam calendar của `managerOverview`, thêm inbox trước bảng dài. |
| Farmer — Vườn của tôi | Đọc đủ trang `farms`, lọc từng `owner_id===user.id`; Zone sở hữu lấy từ `zones` với farm_id thuộc tập này. Thẻ hiển thị tối đa3 Farm rồi link danh sách. Không có Farm được duyệt thì có hướng dẫn và link gửi đề xuất tạo vườn, không đòi is_owner=true. |
| Farmer — Công việc được giao | Đọc đủ trang `zone-assignments`, giữ assignment.user_id của tài khoản, active từ API và Zone còn trong danh sách `zones` hiện hành. Không đọc hồ sơ riêng của Farm giao việc để suy quyền. Dashboard hiển thị tối đa3 khu; `/assigned-work` hiển thị20 khu/trang và links đến Zone, nhật ký, thu hoạch, IoT của khu. |
| Farmer — lịch sử | Link `/cultivation-events?mine=1` dùng API `/cultivation-events/mine`; `/assignments` giữ màn lịch sử hiện có. Không lọc bỏ history chỉ vì assignment đã hết hạn; chỉ khu “đang phụ trách” loại assignment không active. Không cấp lại quyền IoT hoặc quyền tạo mới từ history. |
| Inbox | Chỉ đọc các `*-requests?status=Pending`, lấy đủ các trang100 bằng collectPages, đếm sau điều kiện cần xem xét. Farmer đọc tám loại phiếu; Admin/Manager ưu tiên Farm/thu hoạch. Lời mời dùng riêng assignment-requests. Không POST/PATCH từ dashboard. |

`needsReview` là gợi ý điều hướng: phiếu có required_approvals cần chữ ký chưa ký, đúng user_id hoặc vai trò khi user_id=null; harvest Confirm cần owner, Correct cần Manager đúng cooperative_id hoặc Admin khi Farm độc lập. Hành động phê duyệt vẫn nằm ở RequestsPage và backend, giữ nguyên các kiểm tra/chữ ký/version/scope thực tế. Không dùng số Pending toàn phạm vi làm số phiếu chắc chắn người dùng được duyệt.

Mỗi nguồn có loading/error/empty riêng. Inbox lỗi một loại phiếu hiển thị “Chưa tải được”, không giả số0 hoặc tiếp tục hiện count cũ; retry có chủ ý. Workspace lỗi không giữ Farm/Zone của snapshot trước; thống kê và nguồn độc lập khác vẫn hoạt động. Nút Làm mới dashboard Farmer/Admin cập nhật cả workspace/inbox tương ứng. Workspace Farmer dùng polling15s/visibility hiện có, lỗi xóa snapshot; không background polling khi tab bị ẩn. Mọi request vẫn dùng ApiClient/abort/session hiện có, không tạo client authority khác hoặc lưu dữ liệu/role tùy ý vào storage.

## Quyền và URL trực tiếp

Hai ngữ cảnh Farmer là cách trình bày, **không phải hai role backend**. Farmer có thể đồng thời thấy Farm sở hữu và công việc ở Farm khác. `dashboardContext.farmerContext` không dùng is_owner làm điều kiện quyền; mở Zone của người khác vẫn không có nút sửa metadata dù tài khoản có is_owner=true do sở hữu một Farm khác.

Giữ nguyên RecordTools/HarvestTools/Cultivation/IoT/control và API scope. Ẩn menu không cấp hoặc chặn thêm quyền đọc các resource dùng chung: URL `/farms/:id`, `/zones/:id`, `/trees/:id`, `/sensors/:id`, `/actuators/:id`, nhật ký và thu hoạch tiếp tục dùng màn/kiểm tra quyền hiện có. URL không thuộc scope vẫn do API từ chối, UI hiển thị lỗi và không dựng bản ghi giả.

`routeRoles` chỉ khai báo các trang có vai trò cố định: Admin guard cho Manager approval/create-edit HTX; Admin/Manager cho cooperative-updates; Manager cho farm-notifications; Farmer cho `/assigned-work` mới. RoleGuard không thay AuthProvider hay route protected hiện có. Quyền nhập bù vẫn giữ màn đọc theo API và chỉ Admin có nút cấp/thu hồi. Public QR vẫn ngoài AuthProvider.

## Source thay đổi

- `components/navigation.ts`, `Shell.tsx`, `RoleNavigation.css`: cấu hình/group selection/accordion, account navigation và guard dùng chung.
- `App.tsx`: thêm route frontend `/assigned-work`, nối RoleGuard cho các trang vốn có vai trò cụ thể.
- `pages/Dashboards.tsx`, `ManagerDashboard.tsx`: ưu tiên nội dung theo role, giữ thống kê từ API thật và các màn đã có.
- `pages/FarmerWorkspace.tsx`, `dashboardContext.ts`: hai ngữ cảnh, active assignments/history, owner_id từng Farm.
- `pages/RequestInbox.tsx`, `RoleDashboards.css`: phiếu cần chú ý, empty/error/retry và bố cục responsive.
- `test/role-navigation.test.ts`, `role-navigation-browser.mjs`, `e2e.mjs`, `eslint.config.mjs`: regression và fixtures mới; chỉ dữ liệu test cô lập.

## Tái lập kiểm thử

Từ root, dependencies hiện có, không cần đổi `.env`, migrate/seed hoặc bật MQTT thật:

```powershell
npm run lint:web
npm run typecheck:web
npm run test:web
npm run build:web
npm run test:web:e2e
npm run test:e2e:database --workspace @smart-durian/web
npm run format:check --workspace @smart-durian/web
```

E2E memory dùng Nest/API thật với stores test và MQTT TCP loopback; database browser suite dùng random fixture PG/Mongo riêng theo runtime guide. Không dùng dữ liệu demo đang có, không SMTP/SMS/hardware thật và không đọc root `.env`. Với database suite cần test containers theo [runtime guide](../../DATABASE_RUNTIME_IMPLEMENTATION.md). Browser dùng Edge/Chrome hiện có, tùy chọn WEB_TEST_BROWSER theo README web.

Các case mới:

1. Admin: Manager Pending thật, phiếu Farm cần chữ ký, bốn group, chỉ một group mở và active đúng khi nhập URL con.
2. Farmer chưa có Farm/phân công: thấy hướng dẫn gửi đề xuất, lời mời cần phản hồi; URL Admin/HTX OTP/thông báo Manager bị guard đúng.
3. Farmer chỉ nhận việc: nhận lời mời qua màn cũ, thấy Zone được giao; không đọc được hồ sơ riêng Farm và không có nút sửa Zone.
4. Farmer vừa sở hữu vừa nhận việc: auth/me.is_owner=true nhưng thẻ sở hữu chỉ chứa Farm của mình; Zone người khác không có nút sửa, Zone thuộc Farm mình vẫn sửa được.
5. End assignment: bỏ current work; vẫn mở được mine journal và lịch sử phân công. Không mất quyền lịch sử hoặc có quyền IoT từ history.
6. Manager: HTX chưa có vườn hiển thị hướng dẫn và số0 thật; không menu hệ thống/chủ vườn; sau có pending Join thì inbox phản ánh đúng scope.
7. Responsive cả ba role tại1366×640 và320×740; không body overflow, Escape/đổi route đóng mobile menu, group hiện tại rõ.
8. Lỗi API workspace/inbox: xóa dữ liệu cũ đúng phần, không giả0, retry tải lại được.

Kết quả: **16/16 web unit (5 tests mới),54/54 browser memory/API (8 checks mới) và4/4 browser full database/MQTT TCP; lint/typecheck/build/format đạt**. Không sửa backend nên không chạy lại toàn backend/persistence suites; browser fixtures vẫn gọi backend thật cho các luồng liên quan. Unit tests kiểm tra menu không trùng/role-specific, nested route matching, mixed ownership/history và các nhánh signature/harvest review. Ảnh review/report trong `apps/web/test-results/` (ignored): role-admin-navigation, role-farmer-mixed-desktop, role-manager-empty-join, role-farmer-mobile-work cùng các ảnh hồi quy trước đó.

Kiểm thử tự động chứng minh cách hiển thị/scope với fixture; không thay thế nghiệm thu tài khoản SMS/email/ESP32 thật. Không thêm endpoint/provider hoặc hiển thị AI như chức năng đã hoạt động.
