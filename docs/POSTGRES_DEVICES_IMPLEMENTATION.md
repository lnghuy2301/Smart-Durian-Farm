# Device — PostgreSQL adapter, presence và duyệt metadata

Cập nhật2026-10-17. Nhánh **feat/postgres-devices-persistence**, base Harvest **c781a91**; kế thừa frontend024214b và các adapters hiện có. Không triển khai lại Device API/MQTT hoặc thay đổi topic/firmware. Đọc [progress hiện hành](BACKEND_PROGRESS_CURRENT.md), [hợp đồng MQTT đã đối chiếu](MQTT_PROTOCOL_REVIEW_20261014.md) và nguồn MQTT_HARDWARE_PROTOCOL_VERIFIED.md/IOT_CORE_TABLES_SPEC.md riêng của người dùng.

AppModule hiện vẫn dùng RAM cho nghiệp vụ. DeviceRecords là seam async; MemoryDeviceRecords dùng **useExisting**, gọi đúng DevicesService mà Sensors/Actuators/MQTT đang dùng. PostgreSQL được kiểm thử trong HTTP app riêng với shared pool và toàn bộ Users/Farm/Zone/Tree phụ thuộc cũng trỏ DB. Không chỉ override Device HTTP trong AppModule khi receiver/guards còn đọc RAM. Schema/adapter hoàn tất chưa phải hardware acceptance.

## Nguồn và dữ liệu

- `apps/api/src/devices/device-records.ts`: async contract cho controller và các consumers sẽ chuyển ở đợt wiring; trusted getRecord/getRecordByStationId/recordSeen không phải API công khai.
- `memory-device-records.ts`, `devices.module.ts`, `devices.controller.ts`: một shared RAM store, API payload/routes giữ nguyên.
- `persistence/postgres-devices.repository.ts`: shared Pool/client, transactional metadata/proposal/history, current scope/role/version rechecks và monotonic presence.
- `persistence/device-mappers.ts`: numeric→JSON number, timestamptz→UTC ISO, strict record/request/history shape/UUID/enum/version. Missing/corrupt metadata trả503, không tự version0/fallback RAM.
- `persistence/device-workflow-schema.ts`, migration011_device_workflow: partial UNIQUE lower(target_key) cho module devices/status Pending. Giữ nguyên001–010/checksums; không thêm bảng nghiệp vụ.
- `integration/device-workflows.integration.ts`, `test/devices.test.ts`: real DB/concurrency/fresh app/pool và shared RAM seam tests.

DEVICES vẫn đúng7 fields: id UUID, zone_id UUID, station_id varchar50, installed_at timestamptz NOT NULL, cost numeric(10,2) NOT NULL, status Active|Inactive|Maintenance, last_seen_at nullable. installed_at/cost bắt buộc lúc đăng ký, không đăng ký trước lắp đặt; cost từ0 đến99999999.99, tối đa2 số thập phân. installed_at nhận ISO có timezone và trả UTC; không tự suy ra ngày lắp hardware.

Backend sinh UUID độc lập với station_id. station_id giữ đúng chữ hoa/thường, chỉ `[A-Za-z0-9_-]`,1–50 ký tự, UNIQUE toàn hệ thống. `ExactCase` và `exactcase` khác station. id/zone_id/station_id bất biến; SQL triggers cũng chặn sửa. Inactive/Maintenance vẫn giữ station, không đăng ký lại ở Zone khác. Không auth_token, không coi station là secret. Sensors/Actuators/telemetry/tasks dùng **Device UUID**, không dùng station làm FK.

Một Zone có nhiều Device; tất cả cây hiện tại trong Zone thuộc phạm vi ảnh hưởng của mỗi Device đó. Endpoint affected Trees dùng Tree repository cùng DB/permissions, gồm cả Dead/Removed để mô tả phạm vi, không lưu TREES.device_id hoặc danh sách cây cần đồng bộ. Không có chức năng chuyển Zone/xóa Device.

## API và quyền giữ nguyên

Tất cả route private dưới `/api`, JWT actor; client không gửi actor/version/history/last_seen_at.

| Method/path | Input/quyền |
| --- | --- |
| GET `/devices` | limit1–100,offset0–100000,q tối đa100,zone_id,status; lọc current scope, total đúng cả khi vượt trang cuối |
| GET `/devices/:uuid` | Admin/owner; Manager HTX hiện tại; Farmer Accepted đang hiệu lực |
| GET `/devices/by-station/:stationId` | Cùng read scope; lookup station chính xác, không phải endpoint xác thực hardware |
| GET `/devices/:uuid/history` | Current read scope, pagination; hết phân công không giữ quyền đọc lịch sử IoT |
| GET `/devices/:uuid/trees` | Current scope; cây cùng Zone từ TreeRecords |
| POST `/devices` | Chủ Farmer, zone_id/station_id/installed_at/cost/status tùy chọn mặc địnhActive |
| PATCH `/devices/:uuid` | Chủ Farmer; installed_at/cost/status; ít nhất một thay đổi thật; không gửi giá trị null |
| POST `/devices/requests` | Admin đề xuất tạo với payload như POST; chưa tạo Device |
| POST `/devices/:uuid/update-requests` | Admin đề xuất sửa các fields PATCH; tối đa một Pending trên Device |
| GET `/device-requests[/:uuid]` | Admin hoặc owner trong snapshot; Manager/worker không thấy |
| PATCH `/device-requests/:uuid/approve` | Body `{}`, chỉ owner; tạo/sửa Device+version+history+Accepted atomic |
| PATCH `/device-requests/:uuid/reject` | Owner, reason tùy chọn; giữ nguyên official Device, terminal một lần |

Admin không ghi Device trực tiếp; owner không gửi đề xuất Admin. Manager/worker chỉ đọc theo scope, không duyệt/sửa. Owner và proposer phải Active đúng role khi apply; version, Zone/Farm/owner hiện tại được kiểm tra lại sau lock. Direct owner update làm proposal cũ stale409; owner từ chối và Admin lập đề xuất mới. Chủ cũ trong snapshot có thể từ chối stale request nhưng không apply sau khi ownership thay đổi. Worker End/hết `[start,end)` mất cả Device history, khác quy tắc tác giả giữ lịch sử Harvest/Cultivation.

Pending Create **không đặt chỗ station**: nhiều Admin proposals có thể dùng cùng station chưa đăng ký; owner tạo trực tiếp hoặc một proposal duyệt trước sẽ thắng. Lần duyệt sau409, request vẫn Pending để owner từ chối. Trạm đã có Device thì đề xuất Create bị409 ngay. UNIQUE station chống race cả khác Zone/Farm, không retry đổi station. UUID collision retry tối đa3 lần bằng ON CONFLICT DO NOTHING, không overwrite row cũ hoặc ghi lịch sử nửa chừng.

Postman: dùng JSON và copy JWT/UUID thủ công trong Devices-Local-Test collection hiện có, không cần scripts/environment mới. Ví dụ tạo với Zone UUID thực lấy từ API đang chạy:

```json
{
  "zone_id": "<ZONE_UUID>",
  "station_id": "DEMO_OTHER_STATION",
  "installed_at": "2026-09-01T08:30:00+07:00",
  "cost": 10237500.25,
  "status": "Active"
}
```

UUID placeholder phải thay bằng UUID thật; không đăng ký lại station hardware đã seed. Normal RAM API chưa nhận UUID trong seed PG đến khi chuyển toàn runtime. Không sửa collections riêng của người dùng trong đợt này.

## Presence và giao tiếp hardware

`recordSeen(deviceId,receivedAt)` chỉ receiver nội bộ gọi sau message hợp lệ; receivedAt là thời gian server nhận. Ghi timestamp mới hơn giá trị cũ, normalize UTC, không cho rollback theo message xử lý chậm. Hai receivers đồng thời và owner metadata write đều khóa cùng Device row, metadata UPDATE không chạm last_seen_at. Presence **không tăng entity version, không ghi metadata-history, không đổi status**, vì vậy không làm Admin proposal stale. Proposal/history giữ snapshot presence ở thời điểm tạo/commit; API get trả presence hiện tại.

Maintenance/Inactive là trạng thái quản trị, không tự chuyển Online. Online/Offline suy ra từ last_seen_at theo consumer hiện có; adapter không phát minh ngưỡng hoặc thay MQTT authorization. Trusted presence primitive không tự đọc payload/authenticate hardware; router/receiver kiểm tra device/sensor/task trước khi gọi. Không có endpoint PATCH last_seen_at thủ công. Restart giữ last_seen_at trong PG nhưng timestamp cũ không có nghĩa thiết bị đang Online.

Topic hardware→server `publish/station/{stationId}`, server→hardware `subscribe/station/{stationId}`; station từ topic tìm Device rồi dùng UUID. Parser/router/payload giữ nguyên; ACK taskId/status/action là **đã nhận lệnh**, không phải chứng minh trạng thái vật lý. 10s/step và chuỗi Reset trước lần Start sau restart/mất kết nối giữ nguyên; đợt metadata không tự kết nối/gửi command hoặc replay ON.

## Transactions và lỗi

READ COMMITTED; thứ tự users UUID→user metadata→HTX→Farm→Zone→Device→request, dùng PostgresDomainAccess chung. Hints trước khóa chỉ để xác định tập users/parent; đọc lại role/status/owner/version sau khi đợi. Parent đổi thì rollback trước business write và lấy context lại, tối đa4; không khóa thêm user muộn hoặc retry lỗi DB/COMMIT chưa rõ. recordSeen chỉ khóa Device, không lấy parent/user lock phía sau nên không đảo thứ tự.

technical.entity_metadata giữ version devices/device_requests, merge tăng version không ghi đè seed_key; safe integer>=1, không overflow. technical.workflow_requests module devices actionCreate|Update statusPending|Accepted|Rejected, target_key nullable cho Create chưa Accepted, expected_version nullableCreate/snapshotversionUpdate. Payload đúng6 keys zone_id/farm_id/owner_id/proposed_changes/device_snapshot/rejection_reason. Request metadata version cũng phải hợp lệ khi đọc/duyệt, không chữa ngầm dữ liệu hỏng.

technical.audit_events DeviceCreated/DeviceUpdated lưu before/after/version/proposed_by/request_id/actor/time append-only; request audit riêng. Ghi official/meta/audit/terminal request cùng transaction; lỗi audit rollback tất cả. Không xóa Device hay lịch sử. 400 DTO/null/no-op;403 role/Active;404 ngoài scope/missing;409 station/UUID/version/Pending/đã xử lý;503 DB/metadata lỗi với message sanitized, không driver/connection strings/fallback. Sau COMMIT response mất, đọc lại record/request trước retry; POST chưa có idempotency key. PG không mang giới hạn Map1000/requests2000/history10000 sang DB; API pagination giữ bounds.

Migration011 từ chối nếu dữ liệu cũ có duplicate Pending target (kể cả khác chữ hoa UUID), rollback và không ghi Applied; không tự xóa/gộp/seed để chữa. Local001–011 đã Applied ngày17/10, hash/count13 bảng nghiệp vụ +4 bảng technical trước/sau giống nhau; không reseed hoặc sửa001–010.

## Kiểm thử, tái lập và bước sau

Từ root:

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d
npm run test:persistence
npm test
npm run lint
npm run typecheck
npm run build
npm run test:web:e2e
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml down
```

11 suites tạo random database sdf_persistence_test_{32hex}, PostgreSQL15432/Mongo27028 riêng, không đọc .env/provider/hardware. Cleanup chỉ DB fixture. Không down -v/reset/clean/main compose down. Windows fallback local Node bins trong [Tree guide](POSTGRES_TREES_IMPLEMENTATION.md); compile .integration-dist exit0 trước node --test --test-concurrency=1 với11 integration paths từ package.json. Nếu máy ngủ lâu, xác nhận containers healthy và chạy lại bằng process/JWT mới, không nới timeout/quyền.

Kết quả: **236/236 backend,167/167 persistence (11 suites),37/37 browser; API lint/typecheck/build đạt**. Web source không đổi, checkpoint8/8 unit và quality checks giữ nguyên. Suite mới16 tests kể cả wrapper: duplicate migration rollback, station uniqueness/case/immutability/races, install fields/status preserving patch/history, current Accepted/Manager Join-Leave scopes, stale/revoked proposer/terminal races, bounded UUID, monotonic presence/proposal independence/concurrent write, affected Trees, audit rollback, strict DTO/paging/literal search, corrupt metadata/request/history, revocation while lock waits và HTTP fresh app/pool/restart. Fixture certificate quá24 ký tự ở lượt đầu đã sửa về đúng contract rồi chạy lại toàn bộ, không nới schema/validation. Không gọi Twilio/SMTP/ESP32 thật.

Tiếp Sensor PostgreSQL trên branch mới kế thừa Device, Actuator PG→Mongo telemetry/tasks/Cultivation→async consumers/guards/QR và database AppModule đồng bộ→process/frontend/hardware acceptance. Không quay về main cũ, không hỏi lại enum6 Sensor/units/immutable type/hardware identifiers/seed đã chốt. Không tự push/merge. .env/ERD/MQTT/Postman/frontend riêng giữ nguyên, không tạo lại các guide cũ người dùng đã xóa.
