# IoT metadata — quy tắc hiện hành

Cập nhật21/10/2026. Hợp nhất các checkpoint metadata cũ; [runtime database](DATABASE_RUNTIME_IMPLEMENTATION.md), [Device adapter](POSTGRES_DEVICES_IMPLEMENTATION.md), [Sensor adapter](POSTGRES_SENSORS_IMPLEMENTATION.md), [Actuator adapter](POSTGRES_ACTUATORS_IMPLEMENTATION.md). Source schema cuối là migrations001–014; nguồn ERD/IoT spec riêng không bị ghi đè.

## Định danh và trạng thái

- Device UUID là PK nội bộ; station_id UNIQUE NOT NULL/bất biến, Zone không chuyển. Chỉ đăng ký khi đã lắp: installed_at/cost bắt buộc. Status Active/Inactive/Maintenance là quản trị, khác connectivity và physical state.
- last_seen_at nullable, receiver-only, monotonic; client không sửa. Presence không tăng metadata version/audit mỗi packet hoặc bị proposal cũ ghi đè.
- Sensor type bất biến với sáu giá trị air_temperature/air_humidity/soil_moisture/soil_temperature/soil_ph/soil_ec. Unit trim1..16 sửa được; không còn enum hai đơn vị cũ. Ngưỡng cùng null hoặc đủ cặp min<max; đổi unit không tự convert thresholds/readings.
- Sensor unique(Device UUID,stream), Actuator unique(Device UUID,capability); giữ định danh kể cả Inactive. Actuator purpose watering/spraying/shared bất biến. Hardware identifiers khác UUID record.
- Bộ demo six streams301–306 và bơm2/van3/4 theo [MQTT implementation](MQTT_COMMUNICATION_IMPLEMENTATION.md); router resolve metadata, không ép ID cho mọi Device tương lai.

## Quyền và API giữ nguyên

Chủ Farmer Active tạo/sửa trực tiếp; Admin đọc tất cả nhưng ghi qua proposal Create/Update cần đúng chủ duyệt. Manager chỉ đọc Farm hiện thuộc HTX; Farmer có Accepted assignment chỉ đọc trong [start,end). Scope/list/history/lookup dùng shared Auth/Farms/Zones/Devices, không tạo store trùng.

| Module | Route |
|---|---|
| Devices | GET/POST /api/devices; GET/PATCH /:id; GET /by-station/:stationId; GET /:id/trees; GET /:id/history |
| Sensors | GET/POST /api/sensors; GET/PATCH /:id; GET /by-stream/:deviceId/:dataStreamId; GET /:id/history |
| Actuators | GET/POST /api/actuators; GET/PATCH /:id; GET /by-capability/:deviceId/:capabilityId; GET /:id/history |
| Admin proposal | POST /api/{devices,sensors,actuators}/requests; POST /:id/update-requests |
| Review | GET /api/{device,sensor,actuator}-requests; GET /:id; PATCH /:id/approve {}; PATCH /:id/reject {reason?} |

List limit 1..100 (default20), offset0..100000 (default0), q≤100. Device filter zone_id/status; Sensor device_id/sensor_type/status; Actuator device_id/purpose/status. Request filter Pending/Accepted/Rejected. POST201, GET/PATCH200. JWT Bearer bắt buộc. 400 validation/no-op/immutable, 401 JWT, 403 role/state, 404 missing/outside read scope, 409 unique/stale/proposal, 429 capacity.

Device immutable id/station_id/zone_id; Sensor immutable id/device_id/data_stream_id/sensor_type; Actuator immutable id/device_id/capability_id/purpose. PATCH Sensor sửa name/unit/ngưỡng/status; Actuator chỉ name/status. Name1..80. Metadata data_stream_id string1..50 [A-Za-z0-9_-], exact; numeric MQTT stream sẽ chuyển thành string ở gateway. capability_id body JSON number nguyên1..Number.MAX_SAFE_INTEGER, không string/rounded bigint. Sensor ngưỡng cùng null hoặc đủ hai decimal(7,2) và min<max; PATCH xét cặp sau ghép.

Proposal không reserve mã; Create recheck unique khi approve. Update giữ version/snapshot, một Pending Update/entity; chủ sửa khiến proposal stale409, reject rồi tạo lại. Reviewer đúng chủ, proposer Admin Active, context hiện tại. Commit database transaction gồm record/request/version/audit trước Accepted, response deep copy. recordSeen không tăng version hoặc ghi audit metadata; dữ liệu hiện tại last_seen_at được giữ khi duyệt, không lấy giá trị cũ của proposal ghi đè. Timestamp chỉ tăng, bản tin xử lý trễ không làm lùi last_seen_at.

## Tái lập

Import collections Devices/Sensors/Actuators JSON trực tiếp, copy JWT/UUID thủ công. Database mode dùng tài nguyên đã có, restart không phải tạo lại fixtures; test memory mới mất dữ liệu. Owner trực tiếp, Admin đề xuất/chủ duyệt, Manager/Farmer chỉ đọc đúng scope. Không chèn SQL để bỏ metadata/proposal/audit.

[Trạm thật](REAL_HARDWARE_DATABASE_READINESS.md) đã đủ six streams và three actuators;303 expected unit cũ% có thể sửa%rH qua API đúng quyền, raw readings giữ nguyên. MQTT nhận các stream đã đăng ký, không tự tạo metadata. ACK taskId/status/action chỉ receipt; không dùng short ACK legacy hoặc metadata Active để kết luận relay đã bật.

Source/tests/quyền/history/locks/migrations chi tiết ở ba adapter guides phía trên. Regression dùng fake providers, metadata fixtures và broker loopback; không đọc .env thật hoặc điều khiển hardware trong automated tests. Hardware thật và Configuration cuối còn theo [kế hoạch](IMPLEMENTATION_PLAN.md).
