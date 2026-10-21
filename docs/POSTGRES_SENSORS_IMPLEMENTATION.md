# Sensors — PostgreSQL metadata, streams và workflow

Ngày19/10/2026. Nhánh **feat/postgres-sensors-persistence** kế thừa Device **9ec5f29**, không tạo lại Sensor nghiệp vụ/MQTT. [Progress](BACKEND_PROGRESS_CURRENT.md), [kế hoạch tuần/hardware](IMPLEMENTATION_PLAN.md), [Device shared context](POSTGRES_DEVICES_IMPLEMENTATION.md), [quyết định6 streams](MQTT_COMMUNICATION_IMPLEMENTATION.md).

**AppModule vẫn RAM**, chờ tất cả adapters/async consumers/Mongo được chuyển đồng bộ. SensorRecords async controller seam dùng MemorySensorRecords/useExisting và đúng SensorsService đang được MQTT gọi, không tạo store thứ hai. PG HTTP kiểm thử riêng có Users/Farm/Zone/Tree/Device/Sensor cùng database; không override một mình Sensor controller trong runtime chính. Schema/migration/adapter không tự đổi authority của receiver.

## Contract và quy tắc giữ nguyên

SENSORS đúng9 fields id/device_id/name/sensor_type/data_stream_id/unit/min_threshold/max_threshold/status. Device FK là DEVICES.id UUID, không station. Backend sinh Sensor UUID độc lập. Composite **UNIQUE(device_id,data_stream_id)**; stream đúng chuỗi ASCII `[A-Za-z0-9_-]` dài1–50, phân biệt hoa/thường; cùng stream ở hai Device hợp lệ. Inactive vẫn giữ cặp mã. id/device_id/data_stream_id/sensor_type bất biến cả API và SQL identity trigger. Không di chuyển/xóa Sensor hoặc tự đăng ký từ packet MQTT.

Sáu types đã được user chốt: air_temperature,air_humidity,soil_moisture,soil_temperature,soil_ph,soil_ec. Bộ demo301/C,302/%,303/%rH,304/C,305/H+,306/µS/cm. Đây là mapping được đăng ký bằng metadata, không hardcode mọi station hoặc giới hạn stream tới306. unit là varchar16 không rỗng, sửa được và trim đầu/cuối; không áp lại enum hai đơn vị cũ đã được thay bởi spec hardware. Lịch sử readings giữ raw unit/value, sửa unit metadata không convert readings hoặc min/max cũ.

name1–80 ký tự sau trim; statusActive|Inactive. Thresholds numeric(7,2) trong[-99999.99,99999.99], tối đa2 số thập phân; **cả hai null hoặc cả hai số với min<max**. Create bỏ cả hai mặc địnhnull. PATCH bỏ field giữ nguyên; null tường minh chỉ xóa ngưỡng nếu sau merge cả cặp cùngnull. PATCH một ngưỡng được nếu cặp sau merge hợp lệ; gửi một số khi ngưỡng kia null bị400. Không tự áp range vật lý pH/EC chưa được chốt. PATCH name/unit không kích hoạt Sensor Inactive. Metadata vẫn chỉnh được khi Device Inactive/Maintenance; telemetry/control kiểm tra status riêng.

Owner Farmer tạo/sửa trực tiếp. Admin chỉ đề xuất owner duyệt; Manager/worker chỉ đọc. Scope Admin global/owner ownFarm/Manager HTX hiện tại/Farmer Accepted trong[start,end); hết phân công mất cả Sensor history, không giữ quyền IoT lịch sử. Actor lấy JWT, current Active/role/owner/proposer/version/parents được recheck sau khi chờ lock. Snapshot proposal không công khai cho Manager/worker.

## API hiện có, không đổi payload/routes

Base `/api`, Bearer JWT. Postman Sensors-Local-Test collection hiện có dùng JSON và copy JWT/UUID thủ công; không scripts/environment mới. Device UUID từ runtime đang chạy, seed PG chưa dùng được ở API RAM.

| Endpoint | Input/kết quả |
| --- | --- |
| GET `/sensors` | limit1–100/offset0–100000/q<=100/device_id/status/sensor_type; literal search name/stream; total trước page và đúng scope |
| GET `/sensors/:uuid` | Sensor scoped |
| GET `/sensors/by-stream/:deviceId/:dataStreamId` | Lookup đúng Device UUID+exact stream với current read scope |
| GET `/sensors/:uuid/history` | Paged metadata snapshots; current scope |
| POST `/sensors` | Owner; device_id/name/sensor_type/data_stream_id/unit, thresholds/status tùy chọn |
| PATCH `/sensors/:uuid` | Owner; name/unit/min_threshold/max_threshold/status, ít nhất một thay đổi thật; id/Device/type/stream bị400 |
| POST `/sensors/requests` | Admin Create proposal, chưa có official Sensor; không reserve pair |
| POST `/sensors/:uuid/update-requests` | Admin Update proposal, chỉ một Pending/target |
| GET `/sensor-requests[/:uuid]` | Admin hoặc owner snapshot; Manager/worker404 hoặc list rỗng |
| PATCH `/sensor-requests/:uuid/approve` | Owner body `{}`; apply official/version/history/Accepted atomic |
| PATCH `/sensor-requests/:uuid/reject` | Owner, reason tùy chọn; giữ official data; terminal một lần |

Pending Create không đặt chỗ stream: owner trực tiếp hoặc proposal khác duyệt trước cùng pair thì lần duyệt sau409/request vẫn Pending; owner từ chối và lập lại nếu cần. Pair đã đăng ký bị409 cả khi Inactive. Cạnh tranh khác Device không gây global-stream conflict. Owner sửa official metadata làm proposal Update stale409; presence/Device.status update không tăng Sensor version, không làm stale proposal. Proposer bị Locked/demoted thì không apply. Owner snapshot được reject stale request nhưng không apply nếu owner/Farm/Zone/Device hiện tại không còn khớp.

Ví dụ body, thay placeholder bằng Device UUID thật:

```json
{"device_id":"<DEVICE_UUID>","name":"EC đất","sensor_type":"soil_ec","data_stream_id":"306","unit":"µS/cm","min_threshold":null,"max_threshold":null,"status":"Active"}
```

Không gửi station thay UUID, numeric data_stream_id thay string, hoặc field do backend quản lý. HTTP rejects unknown fields/null ngoài ngưỡng; trusted PG methods cũng validate DTO thay vì dựa riêng ValidationPipe.

## Source, metadata, locks và lỗi

`src/sensors/sensor-records.ts` async contract, `memory-sensor-records.ts` shared RAM wrapper, controller/module giữ route và inject port. `persistence/postgres-sensors.repository.ts` dùng shared Pool/PostgresDomainAccess/PostgresDevicesRepository; trusted getRecord/getRecordByStream/loadOnClient dành nội bộ. `sensor-mappers.ts` validate9-field record, numeric finite, canonical UUID, text trimmed, nullable pairs, workflow/history shape/version. `integration/sensor-workflows.integration.ts` là suite DB mới; `test/sensors.test.ts` kiểm tra port==MemorySensorRecords và cùng service stream lookup.

READ COMMITTED trên cùng client. Khóa users sorted→user metadata→HTX→Farm→Zone→Device→Sensor→request; re-read sau khi đợi. Related users owner/proposer được lấy trước parent locks. Thay context thì rollback trước business writes và retry tối đa4, không retry DB lỗi/COMMIT chưa rõ. Parent Device được load+lock trước child, kiểm tra parent Zone và workflow parent IDs. Owner/Manager scope không lấy từ snapshot cũ để apply.

technical.entity_metadata namespaces sensors/sensor_requests giữ safe version>=1; tăng version merge không ghi đè seed_key. workflow_requests module sensors,Create|Update/Pending|Accepted|Rejected,target_key nullableCreate chưaAccepted,expected_version nullCreate/snapshotVersionUpdate. Payload7 keys device_id/zone_id/farm_id/owner_id/proposed_changes/sensor_snapshot/rejection_reason; request metadata version cũng kiểm tra. Không thêm bảng nghiệp vụ.

audit_events SensorCreated/SensorUpdated before/after/proposed_by/request_id/actor/version/time append-only. Official+entity/request version+history+Accepted cùng transaction; lỗi audit rollback cả official lẫn terminal. Numeric ID generation UUID collision có tối đa3 attempts/ON CONFLICT DO NOTHING, không overwrite row cũ; pair conflict409 ngay. Không mang Map limits5000Sensors/2000requests/10000history sang DB; pagination giữ bounds.

400 DTO/null/no-op/ngưỡng;403 current role/Active;404 ngoài scope/missing;409 pair/Pending/stale/terminal/collision;503 DB/metadata/request/history malformed với message sanitized, không driver/secret/fallback RAM hoặc version0. Request proposal/historical unit snapshot không đổi sau cập nhật. Sau mất COMMIT response, tải lại record/request trước retry; POST chưa có idempotency key.

Migration **012_sensor_workflow** chỉ thêm partial UNIQUE lower(target_key) cho module sensors/Pending/target_key NOT NULL.001–011 immutable; duplicate Pending cũ rollback và không Applied, không tự xóa/gộp/seed để chữa. Local001–012 đã Applied ngày19/10; đối chiếu hash/count13 bảng business +4 bảng technical trước/sau giữ nguyên. Không seed lại demo hoặc rewrite legacy303unit.

## Kiểm thử và tái lập

Từ root: `docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d` → `npm run test:persistence` → `npm test` → `npm run lint`/`typecheck`/`build` → `npm run test:web:e2e`; khi không còn cần fixture thì down đúng compose/project, không -v/reset/clean/main compose down.12 persistence suites dùng random sdf_persistence_test_{32hex}, PostgreSQL15432/Mongo27028 riêng, không .env/Twilio/SMTP/ESP32 thật. Windows fallback Node local bins theo [Tree guide](POSTGRES_TREES_IMPLEMENTATION.md); compile .integration-dist exit0 trước chạy12 integration paths từ package.json.

Kết quả **237/237 backend,184/184 persistence(12 suites),37/37 browser; API lint/typecheck/build đạt**. Sensor17 DB tests kể cả wrapper và11 RAM Sensor tests; web source không đổi, checkpoint8/8 unit/quality checks giữ nguyên. Test gồm sáu types/future stream/raw units, composite identity/case/DB immutable triggers, threshold merge/null/status/history, Accepted/ManagerJoinLeave scopes, proposal snapshots/stale/revoked Admin, races/partial unique migration/UUID collision, Inactive parent/presence, audit rollback, DTO/paging/search, malformed metadata/request/history, owner revoke khi chờ lock và fresh HTTP app/pool/restart. Local012 Applied với dữ liệu giữ nguyên như audit bên trên.

Tiếp Actuator PG branch từ Sensor hoàn tất→3 Mongo domains→async shared database runtime→restart/frontend/hardware acceptance. Không topic/firmware/.env/private ERD/MQTT/Postman/UI changes hoặc push/merge. Giữ sáu Sensor decision, không hỏi lại seed/station/phone/rules đã chốt. [Brief control UI](frontend/ACTUATOR_CONTROL_DESIGN_BRIEF.md) dành bên thiết kế; module này chỉ backend/docs.
