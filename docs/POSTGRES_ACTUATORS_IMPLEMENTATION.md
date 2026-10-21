# Actuators — PostgreSQL metadata, capability và workflow

Ngày19/10/2026. Nhánh **feat/postgres-actuators-persistence**, base Sensor **9571247**, kế thừa các modules/frontend đã giao. Đây là adapter cuối cho13 bảng PostgreSQL nghiệp vụ; **chưa có nghĩa AppModule đã chuyển database**, vì còn Mongo/async consumers/wiring. [Progress hiện hành](BACKEND_PROGRESS_CURRENT.md), [Sensor/parent lock guide](POSTGRES_SENSORS_IMPLEMENTATION.md), [kế hoạch tuần/hardware](IMPLEMENTATION_PLAN.md).

ActuatorRecords async seam dùng MemoryActuatorRecords/useExisting gọi đúng ActuatorsService đang được control service sử dụng. Không có store thứ hai. HTTP PG kiểm thử riêng với shared Pool/Users/Farm/Zone/Tree/Device; không bật riêng Actuator HTTP còn task/MQTT đọc RAM. Module này không publish MQTT, đổi task protocol/recipe/ACK semantics hoặc tự điều khiển hardware.

## Contract và API

ACTUATORS đúng6 fields: id UUID do backend sinh, device_id UUID FK, name varchar80, purpose watering|spraying|shared, capability_id bigint, status Active|Inactive. Unique **(device_id,capability_id)**, không global capability. Inactive giữ cặp mã. id/device_id/purpose/capability_id bất biến tại API và SQL trigger; không chuyển Device/Zone hoặc xóa Actuator. purpose không UNIQUE: metadata generic có thể chứa nhiều capabilities cùng mục đích.

capability_id là **number nguyên dương<=Number.MAX_SAFE_INTEGER(9007199254740991)**, không UUID/string/NaN/Infinity/float/unsafe integer. PostgreSQL driver trả bigint string, mapper kiểm tra safeInteger rồi serialize number; không để làm tròn định tuyến sai relay. Path parameter chuyển số theo DTO, trusted repository lookup cũng chặn string/null/unsafe trước query. MQTT wire taskingCapabilityId dùng capability_id, taskId do task allocator sinh là identifier riêng.

name trim đầu/cuối,1–80 ký tự; PATCH name/status phải có ít nhất một thay đổi thật, null/unknown fields bị400. PATCH tên không kích hoạt Actuator Inactive. Active/Inactive mô tả khả dụng metadata, **không phải ON/OFF relay**; không có action/current_state/manual confirmed fields trong API metadata. Inactive/Maintenance parent Device vẫn cho sửa cấu hình; Start control kiểm tra status riêng, Stop giữ rule đã chốt.

Owner Farmer tạo/sửa trực tiếp; Admin đề xuất owner duyệt; Manager/worker chỉ đọc. Admin global/owner ownFarm/Manager HTX hiện tại/Farmer Accepted trong[start,end). Hết phân công mất cả metadata history IoT. Actor luôn từ JWT, kiểm tra Active/role/version/proposer/owner/parents lại sau lock; không cấp quyền bằng biết UUID.

Base `/api`, JWT. Postman Actuators-Local-Test JSON hiện có, copy JWT/UUID thủ công; không scripts/environment mới:

| Endpoint | Input/quyền |
| --- | --- |
| GET `/actuators` | limit1–100,offset0–100000,q<=100,device_id,status,purpose; literal name/capability search; total đúng scope trước page |
| GET `/actuators/:uuid` | Current read scope |
| GET `/actuators/by-capability/:deviceId/:capabilityId` | Device UUID+numeric capability, current read scope |
| GET `/actuators/:uuid/history` | Paged metadata history, current read scope |
| POST `/actuators` | Owner; device_id/name/purpose/capability_id, status tùy chọn mặc địnhActive |
| PATCH `/actuators/:uuid` | Owner; name/status; không nhận điều khiển ON/OFF |
| POST `/actuators/requests` | Admin Create proposal, chưa tạo official/reserve pair |
| POST `/actuators/:uuid/update-requests` | Admin Update proposal; chỉ một Pending/Actuator |
| GET `/actuator-requests[/:uuid]` | Admin hoặc owner snapshot; worker/Manager không thấy |
| PATCH `/actuator-requests/:uuid/approve` | Owner body `{}`, apply official/version/history/Accepted atomic |
| PATCH `/actuator-requests/:uuid/reject` | Owner, reason tùy chọn; không đổi official metadata |

Pending Create không reserve pair; nếu owner/proposal khác đăng ký trước thì approve409 và request vẫn Pending cho owner reject. Owner update làm proposal stale409; parent Device.status/last_seen changes không tăng child version. Proposer Locked/demoted thì không apply; stale owner có thể reject snapshot request nhưng không apply nếu current ownership/parents lệch. Terminal chỉ xử lý một lần. Metadata API không tự mở task hoặc sửa bơm/van khi tạo/duyệt record.

Bộ hardware demo cố định2/shared(bơm),3/watering(van tưới),4/spraying(van phun); API generic vẫn cho capability khác. Recipe control kiểm tra đúng metadata, không suy từ thứ tự insert hoặc coi mọi station tương lai dùng cùng mã. Dùng Device UUID thực của runtime trong body, ví dụ `{"device_id":"<DEVICE_UUID>","name":"Bơm chung","purpose":"shared","capability_id":2}`. Seed PG UUID chưa dùng với API RAM tới khi full runtime chuyển đồng bộ.

## Source, metadata và transaction

`src/actuators/actuator-records.ts`, `memory-actuator-records.ts`, controller/module: async contract/shared RAM seam; getRecord/getRecordByCapability nội bộ trusted, không endpoint bỏ quyền. `persistence/postgres-actuators.repository.ts`: same Pool/client/PostgresDomainAccess/PostgresDevicesRepository, bounded UUID collision3attempts, global parent/user order. `actuator-mappers.ts`: strict6-field record/7-key workflow/5-key history payload, safe numeric/canonical UUID/name/enum/version. Missing/corrupt record/request/version/history trả503, không fallback RAM/version0.

READ COMMITTED: users sorted→user metadata→HTX→Farm→Zone→Device→Actuator→request. Hints chỉ chọn tập lock, read lại Active/role/owner/parents/version sau khi đợi; context thay đổi rollback trước ghi rồi retry tối đa4, không retry DB/uncertain COMMIT. Không giữ transaction qua MQTT/SMS/email. Parent Device lock trước child, immutable relationships rechecked; presence metadata bảo trì không làm stale child proposal.

technical.entity_metadata namespaces actuators/actuator_requests; safe version>=1, increment giữ seed_key. workflow_requests moduleactuators actionCreate|Update/statusPending|Accepted|Rejected, target nullableCreate chưaAccepted, expected_version nullCreate/snapshotVersionUpdate. Payload device_id/zone_id/farm_id/owner_id/proposed_changes/actuator_snapshot/rejection_reason; request metadata version cũng validate. audit_events ActuatorCreated/ActuatorUpdated giữ before/after/proposed_by/request_id/actor/time/version append-only, request audit riêng. Official+version+audit+terminal atomic; audit lỗi rollback cả official và Accepted.

400 input/null/no-op/unsafe number;403 Active/role;404 outside scope/missing;409 capability/Pending/stale/terminal/UUID exhausted;503 sanitized DB/malformed state, không driver/credentials. Cạnh tranh pair dùng unique+ON CONFLICT DO NOTHING; pair conflict không đổi capability hoặc overwrite. PG bỏ các Map capacity limits5000Actuators/2000requests/10000history, API paging giữ bounds. Sau mất COMMIT response phải read lại trước retry; POST chưa có idempotency key.

Migration **013_actuator_workflow** chỉ thêm partial UNIQUE lower(target_key) cho moduleactuators/Pending/non-null target.001–012 giữ source/checksum; duplicate cũ rollback, không tự xóa/gộp/seed để chữa. Không thêm business fields/table hoặc thay capability mappings. Local001–013 Applied ngày19/10; hash/count13 bảng business+4 technical trước/sau giữ nguyên, không reseed.

## Kiểm thử và tái lập

Root: `docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d` → `npm run test:persistence` → `npm test` → `npm run lint`/`typecheck`/`build` → `npm run test:web:e2e`. Down đúng fixture/project khi không còn cần, không -v/reset/clean/main compose down.13 suites dùng random sdf_persistence_test_{32hex},PG15432/Mongo27028 riêng, không `.env`/provider/hardware. Windows fallback Node local bins theo [Tree guide](POSTGRES_TREES_IMPLEMENTATION.md); compile .integration-dist exit0 trước node --test với13 integration paths từ package.json.

Kết quả **238/238 backend,200/200 persistence(13 suites),37/37 browser**; API lint/typecheck/build đạt. Web source không đổi, checkpoint8/8 unit/quality checks giữ nguyên. Actuator16 DB tests kể cả wrapper và10 RAM Actuator tests đã đạt riêng. Coverage: three-purpose/pump+valves/no control side effect, exactMAX_SAFE_INTEGER roundtrip/history/search, composite uniqueness/immutable SQL/status preserving patch, current Accepted/ManagerJoinLeave scopes, proposals/nullabletarget/stale/revoked proposer/terminal/race, bounded UUID, parent Maintenance/presence, audit rollback, DTO/search/paging/corrupt state/revocation while waiting/fresh HTTP app-pool-restart. Không ESP32/Twilio/SMTP thật; local migration audit giữ nguyên dữ liệu như bên trên.

Tiếp Mongo telemetry→tasks→Cultivation, rồi async HTTP/MQTT/guards/workers/QR/database AppModule cùng authority, restart/frontend/ESP32 acceptance. [Tasks control API](ACTUATOR_TASKS_IMPLEMENTATION.md), [UI brief cho bên thứ3](frontend/ACTUATOR_CONTROL_DESIGN_BRIEF.md). Không hỏi lại hardware/seed/rules, không tự đổi firmware, .env hoặc nguồn ERD/MQTT/Postman/UI riêng; chỉ explicit stage/local commit, không tự push/merge.
