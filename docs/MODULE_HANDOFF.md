# Bàn giao các module — đọc đầu session

Cập nhật 21/10/2026. Source tích hợp nền `1f6c1fd`; lần dọn tài liệu trên `chore/project-cleanup`. Không coi tên nhánh/commit trong guide cũ là trạng thái GitHub hiện tại; kiểm tra git trước khi làm. [Mục lục](README.md), [tiến độ](BACKEND_PROGRESS_CURRENT.md).

## Đọc và kiểm tra

1. Đọc AGENTS.md nếu có, kiểm tra `git status`, branch và log; giữ mọi sửa đổi riêng.
2. Đọc [quy tắc nghiệp vụ](PROJECT_BUILD_SPEC.md), [ghi chú kỹ thuật](IMPLEMENTATION_NOTES.md), [kế hoạch](IMPLEMENTATION_PLAN.md).
3. Đọc [runtime guide](DATABASE_RUNTIME_IMPLEMENTATION.md), nguồn ERD/MQTT và workflow/adapter của module liên quan.
4. Khi nghiệp vụ chưa rõ hoặc tài liệu nguồn mâu thuẫn, hỏi và chờ trước phần phụ thuộc.

## Trạng thái bàn giao

Đã có Auth/Users/Manager/HTX, danh mục, Farm/Zone/phân công, Tree/Harvest, IoT metadata, MQTT/telemetry/tasks, Cultivation và QR; 13 bảng nghiệp vụ PostgreSQL + ba domain Mongo đã nối cùng database runtime cho HTTP/Auth/workers/MQTT/QR. Không triển khai lại các module này.

Development mặc định database; test mặc định memory; override `BUSINESS_STORAGE`. Auth `mock` vẫn phục vụ development/test và có thể đọc tài khoản PG. OTP dở xác minh lại sau restart; dữ liệu đã duyệt, token version và proposals lưu bền. Startup không tự migrate/seed/fallback RAM.

Migrations001–014 đã Applied local tại checkpoint20/10. Trạm thật có đủ301–306 và bơm2/van3/4. Sensor303 expected unit cũ `%` còn giữ nguyên; chỉnh qua API theo [readiness](REAL_HARDWARE_DATABASE_READINESS.md) nếu cần `%RH`. Không reseed/reset volume để chữa unit hay mật khẩu.

Kết quả nghiệm thu tự động của source nền:240 backend,263 persistence/17 suites,8 web unit,46 browser memory +4 browser database/MQTT TCP; quality checks đạt. Đây là checkpoint trước lần dọn, không thay thế báo cáo kiểm tra mới hoặc nghiệm thu ESP32 thật.

## Quy tắc tiếp tục

- Mỗi module/đợt riêng một branch kế thừa source tích hợp mới nhất, tránh bắt đầu từ main cũ làm mất modules.
- Không push/merge tự động. Giữ secrets, ERD/MQTT/Postman/UI/assets riêng; không reset/clean/stage-all.
- HTTP/MQTT/workers/QR dùng chung instance/pool/client/repository; không đăng ký store authority thứ hai.
- Không sửa migration đã Applied; thêm migration mới khi schema thay đổi được duyệt.
- Postman JSON literal, JWT/UUID/OTP nhập tay. Không thêm script/environment phức tạp.
- Code comment logic khó; cập nhật workflow/API/giới hạn/tests/cách tái lập sau mỗi thay đổi.

## Việc tiếp theo

[Kế hoạch hiện hành](IMPLEMENTATION_PLAN.md): nhận bản MQTT Configuration cuối, so sánh packet/ACK/topic/config với source; chỉ sửa sai khác đã thống nhất. Nghiệm thu hardware thật và demo ba role, backup/restore, triển khai môi trường đích. AI và Android chưa triển khai, không đánh dấu đã có.

Các báo cáo checkpoint trùng đã bỏ trong [đợt dọn](PROJECT_CLEANUP.md); lịch sử commit vẫn còn. Các guide module giữ để tra cứu chi tiết, nhưng không dùng câu “runtime còn RAM” ở checkpoint cũ làm backlog mới.
