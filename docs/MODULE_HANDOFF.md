# Bàn giao các module — đọc đầu session

Checkpoint22/10 — `feat/web-readable-business-information` kế thừa `4091de9`: [hiển thị nghiệp vụ tiếng Việt](frontend/modules/READABLE_BUSINESS_INFORMATION.md). Sửa Diff/lịch sử dùng chung, tên người/HTX/Zone/cây thay tham chiếu thô khi có quyền, ngày giờ Việt Nam/số tiếng Việt; giữ mã hồ sơ/lô/hardware. API đọc `display-references/{kind}/{id}` xác thực và phân quyền nguồn trước khi tra tên, chỉ trả nhãn; cùng repository memory/database, không migration/seed/.env/đổi MQTT. Tên tham chiếu là tên hiện tại; snapshot giữ nguyên và trường không còn đọc được vẫn giữ mã. Đạt 249/249 backend,18/18 web unit,54/54 browser memory và5/5 browser database/MQTT TCP; lint/typecheck/build đạt. Khởi động lại API/web để có controller mới; không push/merge.

Checkpoint mới22/10 — `feat/rich-operational-dataset`: người dùng chốt lịch sử khoảng1 tháng, ưu tiên ĐBSCL, giữ Tây Nguyên; cho phép Manager Active/Pending và membership tạo sẵn trong profile nội bộ, không coi là OTP thật. [Guide/source/tài khoản/giới hạn](RICH_OPERATIONAL_DATASET.md). CLI thêm3 HTX,5 Farm,10 Zone,360 cây,8 Farmer,3 Manager,130 nhật ký và160 thu hoạch qua workflow. .env có REFERENCE_FARMER_* đã xác nhận mật khẩu, REFERENCE_MANAGER_* để trống cho đăng ký thật và các nhóm tài khoản tạo sẵn. Những key này không tự tạo/sửa user. Giữ dữ liệu cũ/hardware/.env cũ, backup trước/sau, lease và checkpoint/resume. Không tái triển khai module hoặc mở quyền backdate trong HTTP.

Checkpoint22/10 — `feat/realistic-operational-data` kế thừa `d649de1`: [chuẩn hóa dữ liệu khởi tạo](OPERATIONAL_DATA_REFRESH.md). Người dùng cho phép đổi riêng SIM_DEMO_001/002 thành B48A0A6C912E/C8F09E7D2B14, giữ UUID/Mongo và station thật. Tên nghiệp vụ khởi tạo không còn nhãn demo; nguồn gốc GeneratedInitialization giữ nội bộ. Không đổi credentials/roles/xác minh/ownership hoặc giả Manager Active. CLI backup tự động, preview/apply có guard nguồn hiện hành, rollback trigger và audit; seed CLI mới không tạo Manager placeholder. Không chạy seed cũ để ghi đè dữ liệu mới.

Checkpoint frontend21/10 — `feat/web-role-navigation-dashboard` kế thừa source tích hợp `1cd9447`: một Shell/cấu hình menu dùng chung, bốn nhóm thu gọn cho mỗi vai trò, account ở đáy; không đưa mọi bảng thành mục ngang cấp. Admin ưu tiên Manager/phiếu cần xử lý; Manager đúng HTX/Join/correction và hướng dẫn khi chưa có dữ liệu; Farmer tách Vườn của tôi/Công việc được giao, quyền chủ theo owner_id từng Farm, giữ lịch sử tác giả sau End. `/assigned-work` chỉ là route frontend, tái sử dụng các API/màn hiện có. [Guide menu/API/quyền/source/tái lập](frontend/modules/ROLE_NAVIGATION_DASHBOARDS.md). **16/16 web unit,54/54 browser memory/API +4/4 database/MQTT TCP; web lint/typecheck/build/format đạt**. Backend/DB/API/auth/session/OTP/.env/brand/private sources giữ nguyên, không endpoint/library/AI/live hardware. Các mốc backend dưới đây tiếp tục có hiệu lực; đợt này không chạy lại toàn backend/persistence suites vì không sửa backend. Nhánh chỉ local, không push/merge.

Checkpoint mới21/10: branch `feat/offline-demo-telemetry` kế thừa `71fb723`. Đã chuẩn bị sáu Sensor mỗi Device mẫu và nạp1.440 readings riêng SIM_DEMO_001/002; trạm thật/.env/MQTT=false giữ nguyên. DB local240 PG rows/1.441 Mongo documents; backup/restore-check khớp. [Source/commands/tests/giới hạn](OFFLINE_DEMO_TELEMETRY.md). Không chạy lại seed telemetry vì journal đã có dữ liệu; không xóa counter/collections. Backend248 tests, integration liên quan31 tests, lint/typecheck/build đạt. AI vẫn cần chốt model/provider/corpus trước khi code.

Cập nhật21/10/2026. Nhánh hiện hành `feat/database-backup-restore` kế thừa MQTT final `fd7a4fb`, cleanup `92ce66f` và database runtime `1f6c1fd`. Không coi tên nhánh/commit trong guide cũ là trạng thái GitHub hiện tại; kiểm tra git trước khi làm. [Mục lục](README.md), [tiến độ](BACKEND_PROGRESS_CURRENT.md).

## Đọc và kiểm tra

1. Đọc AGENTS.md nếu có, kiểm tra `git status`, branch và log; giữ mọi sửa đổi riêng.
2. Đọc [quy tắc nghiệp vụ](PROJECT_BUILD_SPEC.md), [ghi chú kỹ thuật](IMPLEMENTATION_NOTES.md), [kế hoạch](IMPLEMENTATION_PLAN.md).
3. Đọc [runtime guide](DATABASE_RUNTIME_IMPLEMENTATION.md), nguồn ERD/MQTT và workflow/adapter của module liên quan.
4. Khi nghiệp vụ chưa rõ hoặc tài liệu nguồn mâu thuẫn, hỏi và chờ trước phần phụ thuộc.

## Trạng thái bàn giao

Đã có Auth/Users/Manager/HTX, danh mục, Farm/Zone/phân công, Tree/Harvest, IoT metadata, MQTT/telemetry/tasks, Cultivation và QR; 13 bảng nghiệp vụ PostgreSQL + ba domain Mongo đã nối cùng database runtime cho HTTP/Auth/workers/MQTT/QR. Không triển khai lại các module này.

Development mặc định database; test mặc định memory; override `BUSINESS_STORAGE`. Auth `mock` vẫn phục vụ development/test và có thể đọc tài khoản PG. OTP dở xác minh lại sau restart; dữ liệu đã duyệt, token version và proposals lưu bền. Startup không tự migrate/seed/fallback RAM.

Migrations001–014 đã Applied local. Trạm thật có đủ301–306 và metadata recipe Active. Đợt21/10 đã backup/restore-check và đổi303 expected unit thành%rH,306 thànhµS/cm qua owner repository; ngoài hai metadata/version/audit giữ nguyên. [Readiness](REAL_HARDWARE_DATABASE_READINESS.md). Không reseed/reset volume để chữa unit hay mật khẩu.

Kết quả nghiệm thu tự động của source nền:240 backend,263 persistence/17 suites,8 web unit,46 browser memory +4 browser database/MQTT TCP; quality checks đạt. Đây là checkpoint trước lần dọn, không thay thế báo cáo kiểm tra mới hoặc nghiệm thu ESP32 thật.

## Quy tắc tiếp tục

- Mỗi module/đợt riêng một branch kế thừa source tích hợp mới nhất, tránh bắt đầu từ main cũ làm mất modules.
- Không push/merge tự động. Giữ secrets, ERD/MQTT/Postman/UI/assets riêng; không reset/clean/stage-all.
- HTTP/MQTT/workers/QR dùng chung instance/pool/client/repository; không đăng ký store authority thứ hai.
- Không sửa migration đã Applied; thêm migration mới khi schema thay đổi được duyệt.
- Postman JSON literal, JWT/UUID/OTP nhập tay. Không thêm script/environment phức tạp.
- Code comment logic khó; cập nhật workflow/API/giới hạn/tests/cách tái lập sau mỗi thay đổi.

## Việc tiếp theo

Backup/restore đã triển khai trên `feat/database-backup-restore` kế thừa `fd7a4fb`; [guide](DATABASE_BACKUP_RESTORE.md), [báo cáo demo](DEMO_READINESS_20261021.md). Actual backup/restore-check khớp trước/sau cập nhật owner units303/306, không đổi data ngoài phạm vi. CLI demo-check không lộ identity và không gửi OTP; Manager Active/Join HTX vẫn cần người dùng hoàn tất bằng OTP thật. Quyết định bật MQTT trong .env đang hỏi riêng, không tự đổi cấu hình.

[Kế hoạch hiện hành](IMPLEMENTATION_PLAN.md): đã nhận MQTT FINAL v1.0 hardware-tested. Đọc [đối chiếu final](MQTT_FINAL_INTEGRATION.md); exact units/parser và metadata-based control đã cập nhật. Người dùng chốt purpose bất biến, đúng một mỗi vai trò và Active cho mọi ON/OFF. Nghiệm thu hardware thật và demo ba role, backup/restore, triển khai môi trường đích. AI và Android chưa triển khai, không đánh dấu đã có.

Các báo cáo checkpoint trùng đã bỏ trong [đợt dọn](PROJECT_CLEANUP.md); lịch sử commit vẫn còn. Các guide module giữ để tra cứu chi tiết, nhưng không dùng câu “runtime còn RAM” ở checkpoint cũ làm backlog mới.
