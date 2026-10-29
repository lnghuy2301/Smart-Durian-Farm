# Mục lục hiện hành — 28/10/2026

## Bắt đầu tại đây

- [Sáu điều chỉnh giao diện29/10](frontend/modules/USABILITY_UPDATES_20261029.md), [API tìm Farmer nhập bù](ADMIN_HARVEST_BACKDATE_PICKER.md), [xóa lịch sử ảnh](AI_DIAGNOSIS_HISTORY_DELETION.md).

- [Tiến độ và việc còn lại](BACKEND_PROGRESS_CURRENT.md).
- [Chạy4 terminal và checklist nghiệm thu](RUN_AND_FULL_ACCEPTANCE.md).
- [Đặc tả nghiệp vụ](PROJECT_BUILD_SPEC.md), [ghi chú kỹ thuật](IMPLEMENTATION_NOTES.md), [kế hoạch](IMPLEMENTATION_PLAN.md), [bàn giao session](MODULE_HANDOFF.md).
- [Nhật ký từ phiên tưới/phun](CONTROL_SESSION_JOURNAL.md), [bổ sung lịch sử canh tác](CULTIVATION_HISTORY_ENRICHMENT.md).
- [Groq chatbot hiện được chọn](GROQ_CHATBOT_IMPLEMENTATION.md), [ảnh/RAG/corpus](AI_RAG_CORPUS_IMPLEMENTATION.md), [Python/model](../ai/README.md).
- [Sơ đồ hệ thống](CURRENT_SYSTEM_DIAGRAMS.md), [dọn dự án và kiểm chứng](PROJECT_CLEANUP.md).

## Nguồn thiết kế

Ưu tiên quyết định trực tiếp mới nhất của người dùng, đặc tả hiện hành và source/migrations đã chốt. [ERD](ERD_DIAGRAM.xml), [IoT spec](IOT_CORE_TABLES_SPEC.md), PDF yêu cầu và các nguồn thiết kế do người dùng quản lý được giữ nguyên; schema vật lý phải đọc đủ18 migrations.

[MQTT FINAL v1.0](MQTT_HARDWARE_PROTOCOL_FINAL_v1.0.md) là nguồn giao thức cuối. [VERIFIED](MQTT_HARDWARE_PROTOCOL_VERIFIED.md) và [DOCX cũ](MQTT_Configuration_Smart_Farm_Durian_v1.0.docx) chỉ để đối chiếu, không dùng ghi đè FINAL. Quyết định nghiệp vụ bổ sung được mô tả trong [tích hợp FINAL](MQTT_FINAL_INTEGRATION.md).

## Nghiệp vụ và API

| Nhóm | Tài liệu |
| --- | --- |
| Auth/Users/OTP | [Auth](AUTH_IMPLEMENTATION.md), [Users](USERS_IMPLEMENTATION.md), [Twilio](TWILIO_VERIFY_INTEGRATION.md), [chẩn đoán Manager](MANAGER_REGISTRATION_TROUBLESHOOTING.md) |
| HTX | [HTX](COOPERATIVES_IMPLEMENTATION.md), [workflow lưu bền](POSTGRES_COOPERATIVE_WORKFLOWS_IMPLEMENTATION.md) |
| Vật tư/tiêu chuẩn | [Vật tư](MATERIALS_IMPLEMENTATION.md), [tiêu chuẩn](STANDARDS_IMPLEMENTATION.md), [liên kết](STANDARD_MATERIALS_IMPLEMENTATION.md) |
| Farm/Zone | [Farm workflow](FARMS_WORKFLOW_DESIGN.md), [Farm API](FARMS_IMPLEMENTATION.md), [Zone](ZONES_IMPLEMENTATION.md) |
| Phân công | [Assignment](ASSIGNMENTS_IMPLEMENTATION.md), [tìm Farmer tên/phone](ASSIGNMENT_FARMER_SEARCH.md) |
| Cây/thu hoạch | [Tree](TREES_IMPLEMENTATION.md), [Harvest workflow](TREE_HARVESTS_WORKFLOW_DESIGN.md), [Harvest API](TREE_HARVESTS_IMPLEMENTATION.md) |
| Canh tác/QR | [Workflow](CULTIVATION_EVENTS_WORKFLOW_DESIGN.md), [API](CULTIVATION_EVENTS_IMPLEMENTATION.md), [hash-chain](MONGO_CULTIVATION_IMPLEMENTATION.md), [QR](QR_TRACEABILITY_WORKFLOW_DESIGN.md) |
| IoT metadata | [Device](POSTGRES_DEVICES_IMPLEMENTATION.md), [Sensor](POSTGRES_SENSORS_IMPLEMENTATION.md), [Actuator](POSTGRES_ACTUATORS_IMPLEMENTATION.md) |
| MQTT/telemetry | [Communication](MQTT_COMMUNICATION_IMPLEMENTATION.md), [workflow](IOT_TELEMETRIES_WORKFLOW_DESIGN.md), [Mongo](MONGO_TELEMETRY_IMPLEMENTATION.md) |
| Điều khiển | [Workflow](ACTUATOR_TASKS_WORKFLOW_DESIGN.md), [API](ACTUATOR_TASKS_IMPLEMENTATION.md), [Mongo](MONGO_ACTUATOR_TASKS_IMPLEMENTATION.md) |
| AI | [Backend/quyền](AI_BACKEND_IMPLEMENTATION.md), [weights](AI_MODEL_AND_CORPUS_INTEGRATION.md), [corpus](AI_RAG_CORPUS_IMPLEMENTATION.md), [Groq](GROQ_CHATBOT_IMPLEMENTATION.md), [Gemini tùy chọn](GEMINI_CHATBOT_IMPLEMENTATION.md) |

## Dữ liệu, kiểm thử và giao diện

- [Database runtime](DATABASE_RUNTIME_IMPLEMENTATION.md), [persistence design](PERSISTENCE_DESIGN.md), [seed spec](PERSISTENCE_SEED_SPEC.md), [backup/restore](DATABASE_BACKUP_RESTORE.md).
- [Bộ dữ liệu1 tháng](RICH_OPERATIONAL_DATASET.md), [chuẩn hóa dữ liệu](OPERATIONAL_DATA_REFRESH.md), [telemetry offline](OFFLINE_DEMO_TELEMETRY.md), [hardware metadata](REAL_HARDWARE_DATABASE_READINESS.md).
- Các guide POSTGRES_* và MONGO_* giữ chi tiết adapter/constraints/locks/tests; không xóa chỉ vì được tạo ở session cũ. Câu “RAM/chưa làm” tại checkpoint cũ không thay thế tiến độ hiện hành.
- [Frontend](frontend/README.md), [workflow UI](frontend/REFERENCE_WORKFLOWS_IMPLEMENTATION.md), các màn trong frontend/modules.
- [Checklist từng module](MODULE_ACCEPTANCE_CHECKLIST.md); tài khoản/mật khẩu trong LOCAL_MODULE_ACCEPTANCE.private.md tại máy, không chia sẻ hoặc commit.
- [Postman](postman/README.md): JSON trực tiếp, JWT/UUID/OTP nhập tay.
- SpeedSMS còn được source/config/tests dùng; [guide](SPEEDSMS_INTEGRATION.md) giữ cho chế độ tương thích.

Khi gửi tài liệu cho AI vẽ sơ đồ, dùng đặc tả + sơ đồ hệ thống + workflow của module + source/schema liên quan. Không gửi .env, private guide, database dump, OTP hoặc key.
