# Dọn dự án ngày 21/10/2026

Nhánh `chore/project-cleanup`, từ `1f6c1fd`. Phạm vi là tài liệu, công cụ thử API và output sinh tự động; không thay đổi nghiệp vụ, schema, migration, database hoặc giao thức hardware.

## Phần đã hợp nhất

- README gốc, MODULE_HANDOFF, IMPLEMENTATION_NOTES, IMPLEMENTATION_PLAN và PROJECT_BUILD_SPEC chỉ mô tả trạng thái/rule hiện hành; bỏ các đoạn checkpoint lặp và backlog đã hoàn tất.
- Foundation/IoT metadata/demo UUID bỏ hoặc điều chỉnh hướng dẫn RAM cũ; Auth mock chuyển sang nhập tay và không còn hướng dẫn restart để khôi phục mật khẩu trong database mode.
- PERSISTENCE_DESIGN/PERSISTENCE_SEED_SPEC đồng bộ database runtime và sáu Sensors, giữ seed không ghi đè và một bảng nghiệp vụ TREE_HARVESTS.
- CURRENT_SYSTEM_DIAGRAMS thay sơ đồ RAM/readiness-only bằng kiến trúc database, quan hệ nghiệp vụ và sequence hiện hành. Mermaid source chưa được kiểm bằng renderer; workflow guides giữ các nhánh lỗi chi tiết.
- MQTT_COMMUNICATION_IMPLEMENTATION hợp nhất communication/contract v1/review sáu streams. Nguồn VERIFIED/DOCX riêng của người dùng không sửa; chờ Configuration cuối trước khi thay protocol.
- docs/README là mục lục; README web/frontend sửa mô tả storage cũ. Liên kết tới file đã xóa chuyển sang guide hiện hành.

## File bỏ vì đã có bản thay thế

| File cũ trong docs | Nguồn thay thế |
| --- | --- |
| PROJECT_REVIEW_20261007.md | BACKEND_PROGRESS_CURRENT.md và workflow/adapter guides |
| PROJECT_READINESS_REVIEW_20261007.md | BACKEND_PROGRESS_CURRENT.md, DATABASE_RUNTIME_IMPLEMENTATION.md |
| PROJECT_REVIEW_20261010.md | BACKEND_PROGRESS_CURRENT.md, DATABASE_RUNTIME_IMPLEMENTATION.md |
| HARVEST_PERSISTENCE_REVIEW_20261016.md | POSTGRES_HARVESTS_IMPLEMENTATION.md và rule correction đã chốt |
| NEXT_DELIVERY_PLAN.md | IMPLEMENTATION_PLAN.md |
| WEEKLY_COMPLETION_PLAN_20261019.md | IMPLEMENTATION_PLAN.md, giữ checklist nghiệm thu hardware |
| BRANCH_INTEGRATION.md | MODULE_HANDOFF.md; trạng thái remote phải kiểm tra lại khi release |
| MQTT_CONTRACT_V1_IMPLEMENTATION.md | MQTT_COMMUNICATION_IMPLEMENTATION.md |
| MQTT_PROTOCOL_REVIEW_20261014.md | MQTT_COMMUNICATION_IMPLEMENTATION.md và POSTGRES_SENSORS_IMPLEMENTATION.md |

Lịch sử commit vẫn chứa các checkpoint cũ; không tạo thêm thư mục archive trùng nội dung trong workspace.

## Source, Postman và output

- Bỏ `apps/api/src/persistence/contracts.ts`: ba interfaces scaffolding không có import/reference; runtime đã có các async ports/repositories cụ thể. Giữ main.ts/main.tsx vì là entrypoints.
- Hai collection nền Auth-Local-Test/Smart-Durian-Farm chuyển sang URL/JSON literal, bỏ scripts/variables. Bỏ hai environment files Local/Twilio cũ; copy JWT/UUID/OTP thủ công. Không sửa collection Users/Twilio mà người dùng đang chỉnh. Xem [Postman README](postman/README.md).
- Dọn các thư mục output `.test-dist`, `.integration-dist`, `test-results` nằm đúng workspace sau kiểm tra. Giữ dependencies và build `dist` phục vụ lệnh start; outputs có thể tái tạo từ npm scripts. Không chạy git clean/reset hoặc xóa Docker volumes.
- Giữ memory adapters và test fixtures: còn được chế độ memory/test sử dụng. Giữ SpeedSMS provider/config/test vì vẫn có đường cấu hình và imports; demo ưu tiên Twilio không có nghĩa adapter là file chết.
- Giữ brand kit và HTML/screenshots gốc; alias @brand dùng tài nguyên chung. Không xóa biến thể logo/icon chỉ vì chưa xuất hiện trên một màn hình.

## Giữ nguyên và giới hạn

`.env`, ERD, IoT spec, MQTT VERIFIED/DOCX, Postman riêng, AuthIntroPanel và các mẫu/ảnh riêng giữ nguyên. Các file đã bị người dùng xóa trước đợt này không được khôi phục hoặc stage hộ. Không thêm dữ liệu, migrate/seed, gửi mail/SMS/MQTT, push/merge hoặc đổi credentials.

Xóa output không thay cơ chế retention dữ liệu. Các guide module vẫn giữ chi tiết implementation/test tại mốc riêng; đọc [mục lục](README.md) và checkpoint hiện hành trước khi dùng câu “RAM/chưa làm” từ lịch sử.

## Kiểm chứng

- Backend: lint, typecheck, build và **240/240 unit/HTTP/loopback tests** đạt.
- Web: lint, typecheck, build, formatting và **8/8 unit tests** đạt, gồm cả source riêng đang có trong workspace nhưng không sửa/stage hộ.
- npm wrapper trên máy báo EPERM khi lstat đường user profile; kiểm tra được chạy thành công bằng Node gọi trực tiếp local TypeScript/ESLint/Vitest/Vite/Prettier như scripts tương ứng. Không thay config hệ thống để vượt lỗi.
- Postman:21 collections JSON hợp lệ, không còn scripts hoặc variables `{{...}}`; hai collection riêng Users/Twilio không đổi byte.
- Đối chiếu SHA-256 của `.env` và23 files riêng khác trước/sau: không thay đổi. Các deletion riêng ban đầu không được phục hồi hoặc đưa vào commit đợt dọn.
- Không có file bitmap/vector trùng byte trong assets và public đã rà. Memory adapters/SpeedSMS có imports/consumers thật nên giữ.
- Dọn4 thư mục output kiểm thử,991 files khoảng45MiB; bỏ cả compiled stub contracts.js còn sót. Giữ build dist mới và node_modules đang cần.
- Kiểm tra các liên kết Markdown tương đối trong README/docs/assets: không còn target bị thiếu. Chưa kiểm anchors hoặc render Mermaid bằng renderer.

Không chạy lại full persistence/browser suites vì không đổi nghiệp vụ/schema/runtime/UI; các kết quả đó ở checkpoint20/10 vẫn là evidence của revision nền. Không coi kiểm thử unit/loopback là bằng chứng hardware thật đã đạt. Đợt này không đọc/ghi dữ liệu database hoặc gửi lệnh hardware.
