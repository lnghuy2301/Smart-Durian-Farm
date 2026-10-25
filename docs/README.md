# Mục lục tài liệu Smart Durian Farm

Cập nhật 21/10/2026. Đọc checkpoint hiện hành trước các báo cáo từng module. Kết quả kiểm thử của một đợt không chứng minh hardware thật đã hoạt động.

## Điểm bắt đầu

Mới24/10: [Backend theo PDF](BACKEND_PDF_REQUIREMENTS.md), [Postman nhập tay](postman/Backend-PDF-Changes.postman_collection.json). Schema local016, danh mục17 vật tư; không cần seed lại để đăng nhập.

| Cần làm | Tài liệu |
| --- | --- |
| Xem tiến độ | [BACKEND_PROGRESS_CURRENT](BACKEND_PROGRESS_CURRENT.md) |
| Tiếp tục lập trình | [MODULE_HANDOFF](MODULE_HANDOFF.md), [IMPLEMENTATION_NOTES](IMPLEMENTATION_NOTES.md) |
| Hiểu quy tắc | [PROJECT_BUILD_SPEC](PROJECT_BUILD_SPEC.md) |
| Chọn việc tiếp theo | [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) |
| Chạy database/API/MQTT/QR chung | [DATABASE_RUNTIME_IMPLEMENTATION](DATABASE_RUNTIME_IMPLEMENTATION.md) |
| Vẽ sơ đồ | [CURRENT_SYSTEM_DIAGRAMS](CURRENT_SYSTEM_DIAGRAMS.md) |
| Hiểu lần dọn này | [PROJECT_CLEANUP](PROJECT_CLEANUP.md) |

## Nguồn dữ liệu và mức ưu tiên

1. Quyết định trực tiếp mới nhất của người dùng; nếu thay đổi nghiệp vụ chưa rõ, hỏi và chờ.
2. Checkpoint hiện hành, workflow đã duyệt, source và migration cuối cùng: dùng để xác nhận điều đã triển khai. Nếu chúng mâu thuẫn, ghi vấn đề để xử lý, không tự đổi quy tắc.
3. [ERD_DIAGRAM.xml](ERD_DIAGRAM.xml) và [IOT_CORE_TABLES_SPEC](IOT_CORE_TABLES_SPEC.md) là nguồn thiết kế do người dùng quản lý; có thể còn khác enum/constraints đã duyệt sau đó. Schema vật lý phải đọc đủ migrations, không chỉ ERD ban đầu.
4. [MQTT_HARDWARE_PROTOCOL_FINAL_v1.0](MQTT_HARDWARE_PROTOCOL_FINAL_v1.0.md) là nguồn giao thức cuối đã được người dùng kiểm thử hardware, đóng băng version1.0; [DOCX hiện có](MQTT_Configuration_Smart_Farm_Durian_v1.0.docx) giữ để đối chiếu. Bản FINAL thay thế VERIFIED/DOCX cũ về protocol. [Đối chiếu tích hợp](MQTT_FINAL_INTEGRATION.md) ghi rõ quyết định purpose bất biến, recipe lấy metadata và Active bắt buộc cho mọi ON/OFF đã triển khai.

Các guide `*_IMPLEMENTATION.md` ghi cả phạm vi và kết quả ở thời điểm module được tạo. Mô tả RAM, số tests hoặc việc còn thiếu ở checkpoint cũ không thay thế trạng thái runtime hiện hành. Không sửa migrations đã Applied để khớp tài liệu cũ.

## Nghiệp vụ

| Nhóm | Hướng dẫn |
| --- | --- |
| Auth / Users / OTP | [Auth](AUTH_IMPLEMENTATION.md), [Users](USERS_IMPLEMENTATION.md), [Twilio](TWILIO_VERIFY_INTEGRATION.md) |
| HTX / Manager | [HTX](COOPERATIVES_IMPLEMENTATION.md), [workflow lưu bền](POSTGRES_COOPERATIVE_WORKFLOWS_IMPLEMENTATION.md) |
| Danh mục | [Vật tư](MATERIALS_IMPLEMENTATION.md), [tiêu chuẩn](STANDARDS_IMPLEMENTATION.md), [liên kết](STANDARD_MATERIALS_IMPLEMENTATION.md) |
| Farm / Zone / phân công | [Farm workflow](FARMS_WORKFLOW_DESIGN.md), [Farm API](FARMS_IMPLEMENTATION.md), [Zone](ZONES_IMPLEMENTATION.md), [phân công](ASSIGNMENTS_IMPLEMENTATION.md) |
| Cây / thu hoạch | [Cây](TREES_IMPLEMENTATION.md), [thu hoạch workflow](TREE_HARVESTS_WORKFLOW_DESIGN.md), [thu hoạch API](TREE_HARVESTS_IMPLEMENTATION.md) |
| Nhật ký | [Workflow](CULTIVATION_EVENTS_WORKFLOW_DESIGN.md), [API](CULTIVATION_EVENTS_IMPLEMENTATION.md), [Mongo/hash-chain](MONGO_CULTIVATION_IMPLEMENTATION.md) |
| IoT metadata | [Device](POSTGRES_DEVICES_IMPLEMENTATION.md), [Sensor](POSTGRES_SENSORS_IMPLEMENTATION.md), [Actuator](POSTGRES_ACTUATORS_IMPLEMENTATION.md) |
| MQTT / telemetry | [Communication](MQTT_COMMUNICATION_IMPLEMENTATION.md), [telemetry workflow](IOT_TELEMETRIES_WORKFLOW_DESIGN.md), [Mongo telemetry](MONGO_TELEMETRY_IMPLEMENTATION.md) |
| Điều khiển | [Workflow](ACTUATOR_TASKS_WORKFLOW_DESIGN.md), [API](ACTUATOR_TASKS_IMPLEMENTATION.md), [Mongo journal](MONGO_ACTUATOR_TASKS_IMPLEMENTATION.md) |
| QR public | [Workflow](QR_TRACEABILITY_WORKFLOW_DESIGN.md), [API](QR_TRACEABILITY_IMPLEMENTATION.md) |

## Persistence, demo và frontend

- [Bộ dữ liệu vận hành một tháng](RICH_OPERATIONAL_DATASET.md): quyết định mới22/10 về Manager khởi tạo, vùng ĐBSCL/Tây Nguyên, workflow/hash-chain, backup/resume và đăng nhập từng vai trò.

- [Chuẩn hóa dữ liệu khởi tạo22/10](OPERATIONAL_DATA_REFRESH.md): profile tên/nội dung nghiệp vụ mới, ngoại lệ đổi hai station mô phỏng, backup và cách kiểm tra giao diện từng vai trò.

- [Persistence design](PERSISTENCE_DESIGN.md): phân chia PG/Mongo và metadata kỹ thuật.
- [Foundation](PERSISTENCE_FOUNDATION_IMPLEMENTATION.md): CLI, migration/seed và nguyên tắc không ghi đè.
- [Seed spec hiện hành](PERSISTENCE_SEED_SPEC.md), [chuẩn bị hardware thật](REAL_HARDWARE_DATABASE_READINESS.md).
- [IoT demo offline](OFFLINE_DEMO_TELEMETRY.md): chuẩn bị Sensor mẫu và lịch sử1.440 readings riêng hai Device mô phỏng, không cần hardware/MQTT.
- [Backup/restore CLI](DATABASE_BACKUP_RESTORE.md), [demo readiness21/10](DEMO_READINESS_20261021.md): thao tác vận hành, role/HTX scope và báo cáo kiểm chứng thực tế.
- Các guide `POSTGRES_*_IMPLEMENTATION.md`: SQL, quyền, locks, proposals, restart và tái lập riêng từng adapter.
- [Frontend](frontend/README.md), [các workflow UI](frontend/REFERENCE_WORKFLOWS_IMPLEMENTATION.md), tài liệu từng màn hình trong `frontend/modules/`.
- [Thông tin hiển thị tiếng Việt](frontend/modules/READABLE_BUSINESS_INFORMATION.md): tên liên quan theo quyền xem, ngày giờ Việt Nam, số và mã tra cứu.
- [Checklist nghiệm thu từng module/vai trò](MODULE_ACCEPTANCE_CHECKLIST.md); bản có thông tin đăng nhập `LOCAL_MODULE_ACCEPTANCE.private.md` chỉ mở tại máy, được Git bỏ qua.
- `postman/`: import collection cần dùng, thay JWT/UUID/OTP thủ công; giữ các collection người dùng đang chỉnh.
- [SpeedSMS](SPEEDSMS_INTEGRATION.md) còn là provider tương thích được source/tests sử dụng. Demo hiện tại ưu tiên Twilio; không xóa adapter chỉ vì không dùng trong buổi demo.

Không cần gửi `.env`, token, OTP, mật khẩu hoặc dump dữ liệu thật cho AI vẽ sơ đồ. Gửi mục lục này, checkpoint và đúng nhóm workflow/source liên quan.
# Đăng ký Manager gặp lỗi kết nối

[Chẩn đoán lỗi email/ECONNRESET, chạy API ổn định và kiểm tra danh sách chờ duyệt](MANAGER_REGISTRATION_TROUBLESHOOTING.md).
