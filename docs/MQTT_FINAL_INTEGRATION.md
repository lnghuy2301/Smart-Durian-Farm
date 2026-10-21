# MQTT FINAL v1.0 — đối chiếu và tích hợp

Ngày21/10/2026, nhánh `feat/mqtt-final-contract` từ `92ce66f`. Đã đọc toàn bộ [MQTT_HARDWARE_PROTOCOL_FINAL_v1.0](MQTT_HARDWARE_PROTOCOL_FINAL_v1.0.md). Người dùng xác nhận đây là bản đã kiểm thử trực tiếp hardware và protocol được đóng băng. Nguồn riêng không bị sửa hoặc tự stage.

## Kết quả đối chiếu

| Hạng mục | Source trước đợt này | Xử lý |
| --- | --- | --- |
| Topics publish/station và subscribe/station | Đúng | Giữ nguyên |
| Device UUID khác station, scoped stream/capability | Đúng | Không cần sửa schema |
| Telemetry sensorRecords/numeric stream/result | Đúng | Test đúng packet final, thứ tự stream không cố định |
| Raw units | Parser giữ đúng; seed cũ dùng%RH/Greek mu | Seed mới dùng%rH và micro sign µ U+00B5; không convert readings hoặc overwrite rows cũ |
| Command targets/taskingParameters/action numeric | Đúng | Test exact fields; không thêm errorMessage/token/station field |
| ACK taskId/status/action/Device correlation | Đúng | Bổ sung INVALID_ACK_STATUS cho packet có taskId nhưng status sai; không refresh presence từ ACK lỗi |
| Mapping van theo metadata | Control RAM/PG/Mongo mapper/UI còn gắn3=tưới,4=phun | Đã resolve theo purpose ở RAM/PG/orchestrator/UI và validator journal |
| Điều kiện Active cho OFF | Rule cũ cho Stop/Recovery OFF khi Inactive | Đã chốt và triển khai: mọi ON/OFF cần Device/actuator Active, không ngoại lệ |
| last_seen_at, rejected packets, retained, unknown stream | Đã có | Giữ recheck/persistence/diagnostics/scopes |
| Timeout10s/Reset/Recovery/không replay ON | Theo task spec riêng | Giữ nguyên trừ quyết định trực tiếp mới |

Sáu types đã có trong enum/API/UI và migration006. Units varchar16 đã hỗ trợ đúng final; không cần sửa migrations đã Applied. ACTUATOR_TASKS journal/targets đã lưu đủ command/Device/capability/action/timestamps, nhưng validator cũ vẫn cần bỏ assumption capability cố định cùng đợt mapping. Không được chỉ sửa UI mà để database validator từ chối journal mới.

## Quyết định đã được người dùng chốt

1. Purpose chọn khi đăng ký và bất biến sau đó. Recipe điều khiển phải đúng một shared/một watering/một spraying; nếu thiếu/trùng thì409 trước journal/publication. Đây là kiểm tra cấu hình điều khiển, không thêm UNIQUE(device_id,purpose) vào schema metadata generic hiện có.
2. Mọi command kể cả Stop/Reset/Recovery OFF đều cần Device và actuator nhận lệnh Active. Recheck trước mỗi publication. Nếu status đổi Inactive/Maintenance giữa chuỗi, task lỗi/mode Unknown; không bỏ qua rule để tự tắt, không báo Off giả. Cần khôi phục metadata Active hợp lệ trước khi gửi Dừng mới.

Không còn câu hỏi MQTT đang chờ. Source final đã được tích hợp; không đổi firmware/topics/wire payload hoặc migrations đã Applied.

## Phần đã triển khai

- Resolve recipe từ purpose metadata, snapshot capability cho live run/steps; recheck PG quyền/status dưới locks trước commit/publish. Journal validator chấp nhận sequence capability thực theo số bước/action/ID khác nhau; không đọc lại lịch sử bằng số2/3/4 cố định. UI readiness/nút OFF/labels theo cùng metadata.
- Parser báo INVALID_ACK_STATUS cho ACK-shaped payload có taskId nhưng status không phải ACK; telemetry shape vẫn ưu tiên, Unknown payload bình thường vẫn bị ignore/diagnose.
- Fresh seed units303=%rH và306=µS/cm; giữ idempotency/no-overwrite, metadata/readings cũ nguyên trạng.
- Fixtures fresh seed/full-runtime/browser dùng đúng raw units final. Tests riêng kiểm exact packet, các biến thể unit vẫn không bị chuẩn hóa, command shape và ACK/mismatch.
- Tài liệu hiện hành trỏ bản FINAL, không còn coi bản chưa gửi là backlog. VERIFIED/DOCX nguồn riêng giữ nguyên để người dùng quản lý.

## Kiểm chứng và tái lập

Từ apps/api khi npm wrapper Windows báo EPERM:

```powershell
node ../../node_modules/typescript/bin/tsc --outDir .test-dist
node --test --test-concurrency=2 .test-dist/test/mqtt-final-contract.test.js .test-dist/test/mqtt.test.js .test-dist/test/mqtt-loopback.test.js
```

Kiểm tra đã chạy:25/25 targeted memory control+final packet tests;26/26 task persistence checks;266/266 toàn persistence17 suites;11/11 web unit;46/46 browser memory (bộ control dùng van4 tưới/van3 phun) và4/4 database/MQTT TCP browser. Backend lint/build/typecheck và web lint/typecheck/build đạt. Toàn backend246/246 tests đạt.

Không gửi mail/SMS/command tới hardware thật hoặc đổi dữ liệu demo. Unit spelling cũ vẫn được parser lưu nguyên; seed chỉ đổi defaults của rows mới. Hai nguồn VERIFIED/DOCX cũ không thay FINAL, giữ nguyên file riêng người dùng.

## Source và tái lập session sau

- `actuator-tasks/task-rules.ts`: recipe metadata, start/stop sequence và Active guards.
- `actuator-tasks/actuator-tasks.service.ts`, `actuators/actuators.service.ts`: shared memory mode, per-publication recheck.
- `persistence/postgres-task-access.ts`, `database-actuator-task-records.ts`: authority locks/snapshot sequence, receipt journal, strict OFF checks.
- `persistence/task-mappers.ts`: giữ integrity cấu trúc/timestamps/IDs/ACK của journal cũ và mới mà không hard-code capabilities.
- `apps/web/src/control/data.ts`, `TaskProgress.tsx`, `pages/ActuatorControl.tsx`: role readiness, labels và ON/OFF gating.
- Unit/DB/browser fixtures kiểm van đảo role, thiếu/trùng purpose, Active đổi giữa Reset, recovery thất bại giữ Unknown, receipt/restart/old history.

Các đường API source tính từ apps/api/src. Không tạo store/connection authority thứ hai; không thêm migration vì schema hiện có đủ. Giữ immutable IDs/purpose, physical_state Unknown, ACK10s/step, không auto-ON replay. Broker/config giữ trong .env local.

Tiếp theo: công cụ backup/restore, diễn thử ba role với SMS/email/hardware thật và release/deploy theo đích người dùng. Không tự chọn production Auth/provider/AI/Android hoặc tuyên bố toàn dự án hoàn tất chỉ vì protocol đã được test.
