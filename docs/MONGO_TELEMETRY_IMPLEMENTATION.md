# Telemetry — MongoDB FIFO bền vững và quyền PostgreSQL

Ngày19/10/2026. Nhánh **feat/mongo-telemetry-persistence**, base Actuator **8926d68**. Đã có13 PG business-table adapters; module này tiếp Mongo đầu tiên. [Progress](BACKEND_PROGRESS_CURRENT.md), [kế hoạch tuần/hardware](WEEKLY_COMPLETION_PLAN_20261019.md), [contract telemetry](IOT_TELEMETRIES_IMPLEMENTATION.md), [persistence design](PERSISTENCE_DESIGN.md), [MQTT/sáu streams](MQTT_PROTOCOL_REVIEW_20261014.md).

**AppModule hiện vẫn RAM**: TelemetryRecords HTTP seam dùng MemoryTelemetryRecords/useExisting và đúng TelemetryService/TelemetryStore mà MqttService đang gọi. Không chuyển riêng HTTP sang Mongo còn receiver ghi RAM. DatabaseTelemetryRecords được kiểm thử với HTTP app riêng, shared PostgreSQL ports và MongoClient mới; MQTT receiver toàn runtime sẽ chuyển await/async cùng tasks/Cultivation/guards/QR ở đợt wiring. Các tests gọi facade record nội bộ, không phải nghiệm thu MQTT→Mongo trên ESP32 thật.

## Quyết định giữ nguyên và API

Hardware gửi khoảng15s/packet; không throttle xuống15 phút hoặc tự đổi firmware. Mỗi reading một document IOT_TELEMETRIES đúng7 fields: `_id`ObjectId→hex24 HTTP, device_idUUID, data_stream_idstring, measured_at,received_at,valueNumber,unitstring. Không thêm station/sensor/Zone/type/sequence vào bảng nghiệp vụ. Station topic→Device.station_id→DeviceUUID→(deviceUUID,stream). Sáu mappings301/C,302/%,303/%RH,304/C,305/H+,306/μS/cm; nhận future streams đã đăng ký, không cap306 hoặc global UNIQUE stream.

measured_at là lúc backend nhận packet, proxy cho thời điểm đo vì firmware hiện không gửi clock. received_at lấy từ clock backend tại bước chuẩn bị ghi batch Mongo, UTC ISO trên API/BSON Date trong DB; có thể bằng measured_at ở độ phân giải ms. Không khẳng định đây là clock đo thực ESP32 hoặc Mongo cluster logical time. FIFO dựa insertion order bền vững, không dùng hai timestamps/ObjectId để suy thứ tự. Hai packets cùng giá trị vẫn ghi riêng; không có messageID/exactly-once/dedup-value.

Raw unit/value giữ nguyên; metadata Sensor.unit đổi hoặc khác incoming unit không convert lịch sử/ngưỡng. Unit tối đa16 ký tự, stream1–50ASCII segment, finite numeric. Ingest kiểm tra cả batch trước ghi; duplicate stream/unknown/inactive Sensor hoặc malformed reading không ghi nửa packet. Device Inactive/Maintenance bỏ qua batch như RAM service; receiver hiện vẫn tự lọc readings hợp lệ trước gọi domain. ACK/retained/unknown/station mismatch do MQTT router xử lý, không ghi thành telemetry hoặc auto-register metadata. Không có API nhập/xóa/đổi telemetry.

JWT private dưới `/api`, paths/query/shape giữ nguyên:

| Route | Kết quả |
| --- | --- |
| GET `/telemetry/devices/:uuid/latest` | Mới nhất mỗi stream còn trong FIFO, theo quyền rồi mới chọn latest/page |
| GET `/telemetry/devices/:uuid/history` | NewestInserted trước, queryreceived_at[from,to), stream exact nếu có |

limit1–100 mặc định20,offset0–100000; data_stream_id optional exact string; from/to chỉ history, ISO có timezone/from<to. Unknown fields/invalid UUID/query400;401 JWT;403 internal Active;404missing/out-of-scope;503 DB/corrupt ordering/metadata, sanitized không connectionstrings/fallback. `total` sau scope/query/latest nhưng trước pagination, đúng cả page trống vượt cuối.

Response storage vẫn capacity_readings10000/evictionOldestInserted; adapter DB trả **modeMongoDB**, RAM trảMemory. Field names khác giữ nguyên. Khi cutover runtime cần cập nhật unionmode/nhãn “RAM” ở frontend nếu còn hardcode; module này không đổi UI/auth/design riêng. Postman IOT-Telemetries-Local-Test collection hiện có dùng JSON/copyJWT/UUID thủ công, không scripts/environment mới. UUID seed PG chỉ dùng HTTP khi runtime đã chuyển database đồng bộ.

## Quyền hiện hành

Admin global, owner toàn Device của Farm mình, Manager Farm thuộc HTX hiện tại. Farmer khác cần Accepted đang hiệu lực `[start,end)` và chỉ readings có **received_at nằm trong phân công hiện tại**. Hết phân công mất cả latest/history IoT; phân công mới không mở lại readings cũ. Scope được kiểm tra ngay khi FIFO rỗng và metadata Inactive. End/Inactive không xóa readings, owner/Admin vẫn đọc trong retention. Khác với quyền tác giả giữ lịch sử Harvest/Cultivation đã chốt.

DatabaseTelemetryRecords dùng PostgresDomainAccess và PostgresAssignmentsRepository.activeOnClient chung, không copy acceptance logic sang một Map. Read giữ locks users sorted→user metadata→HTX→Farm→Zone→Device trong PG, kiểm tra current scopes/assignment sau khi đợi rồi đọc một Mongo snapshot. End/role/HTX changes tuân cùng parent/user order, không lấy snapshot ownership cũ cấp quyền. Ingest không có HTTP actor: khóa Device→Sensors UUIDsorted và recheck Active/mapping, không lấy user/Farm lock muộn. Metadata writers đã khóa Device trước child, nên không đảo thứ tự; status đổi trong lúc chờ được đọc lại trước ghi.

## Mongo transaction, thứ tự và giới hạn

`src/persistence/mongo-telemetry.store.ts` dùng shared MongoClient/Db, không pool/client riêng hoặc cache latest/counter RAM. `PERSISTENCE_STATE` kindTelemetryInsertionCounter/keyglobal, `_id=telemetry-insertion:global`, payload đúngsequence+retained_ids. Sequence là safe integer số readings từng insert; retained_ids ObjectIds từ cũ→mới, tối đa10000. Counter schema/index đã có ở foundation002, không thêm bảng/collection/business field hoặc sửa checksum001–013.

Append snapshot counter+records→validate→insertMany packet→delete evicted IDs→updatecounter cùng **Mongo snapshot transaction/majority writeConcern**. Cạnh tranh tranh cùng counter document nên Mongo transient conflict retry giữ thứ tự commit toàn hệ thống. Lần khởi tạo counter trùng key chỉ retry transaction đã rollback tối đa4; driver tự xử lý commit retry khi kết quả chưa rõ, adapter không replay callback vì uncertain COMMIT. Nếu sequence exhausted thì503, không reset/wrap hoặc tái sử dụng thứ tự.

Reads cũng dùng Mongo snapshot transaction: validate shape/count/unique IDs/sequence/record fields, trả records theo retained_ids đảo ngược. Giữ đúng10000 trên mọi Device; stream có reading cuối bị evict thì biến khỏi latest, không latest cache ngoài FIFO. Counter thiếu khi đã có data, orphan record, missing/duplicate referenced IDs, bad dates/numbers/UUID/state đều503; không tự adopt order theo ObjectId/time, sửa counter hoặc xóa records để chữa. Empty fresh store hợp lệ và GET không tự tạo counter.

Driver hiện tại và session CSOT từng phát `maxTimeMS` trên getMore non-awaitData, Mongo trả code2 khi đọc đủ nhiều records. Đã tái lập tại10000, sửa cursor bằng batchSize+limit10000: schema giới hạn kích thước7field/document và toàn journal nên snapshot nằm dưới16MiB, đọc một batch và vẫn giữ transaction timeout10s/mọi invariant. Không tắt deadline/giảm capacity/bỏ integrity checks hoặc upgrade dependency để né lỗi. Full-capacity+rollback test xác nhận đường sửa; temporary debug chỉ ở compiledfixture ignored đã bị compile ghi đè, không logs driver/payload trong source.

PG ở facade chỉ **read/lock**, không ghi nghiệp vụ; Mongo là nơi duy nhất ghi readings/counter. Đây không phải distributed transaction hay cross-database FK. Locks giữ reference/status/scopes ổn định trong bước Mongo; PG commit báo lỗi sau Mongo commit vẫn có thể khiến caller nhận lỗi dù Mongo đã ghi. Không tự replay packet để giả exactly-once, không tạo Cultivation từ ACK/reading. Mọi lỗi DB được sanitize và không fallback RAM. Multi-instance/distributed control còn thuộc tasks/runtime acceptance, không suy từ Mongo FIFO transaction.

## Source và kiểm thử tái lập

- `telemetry/telemetry-records.ts`, `memory-telemetry-records.ts`, controller/module/types/service: async seam và storage response type; đúng shared RAM service, không receiver authority mới.
- `persistence/database-telemetry-records.ts`: PG context/wholebatch validation/scoped latest-history/HTTP DTO/date validation/clock.
- `persistence/mongo-telemetry.store.ts`: BSON mapper, private counter, snapshot/append/evict/commit; no local state cache.
- `postgres-sensors.repository.ts`: expose trusted same-client loadByStreamOnClient, reusing mapper and caller-owned locks; public lookup reuses helper.
- `integration/telemetry-persistence.integration.ts`: real Mongo/PG isolated fixture/fresh clients; `test/telemetry.test.ts` shared receiver/port regression.

Root: `docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d` → `npm run test:persistence` → `npm test` → `npm run lint`/`typecheck`/`build` → `npm run test:web:e2e`; down đúng fixture khi không cần, không -v/reset/clean/main compose down.14 suites/randomsdf_persistence_test_{32hex},PG15432/Mongo27028, không .env/Twilio/SMTP/ESP32. Windows local Node fallback theo [Tree guide](POSTGRES_TREES_IMPLEMENTATION.md), compile .integration-dist exit0 trước node--test với14integration paths từ package.json.

Đợt này không chạy CLI/migration/seed hoặc ghi readings vào DB demo local; schema001–013 giữ nguyên, Counter tự khởi tạo transaction khi append thực sự đầu tiên, không khi boot/GET. Testfixture có thể đổi validators để ép lỗi atomicity rồi phục hồi, chỉ đúng random DB test. Không dùng delete/reset fixture làm hướng dẫn chữa data thật.

Kết quả **239/239 backend,216/216 persistence(14 suites),37/37 browser; API lint/typecheck/build đạt**. Suite telemetry16 DB tests kể cả wrapper và11 RAM tests; web source không đổi, checkpoint8/8 unit và quality checks giữ nguyên. Sau hồi quy, case FIFO được tăng cường đảo cả ObjectId lẫn timestamps rồi chạy lại16/16 DB telemetry đạt; production code không đổi ở lượt tăng cường này.

Suite mới kiểm tra empty scope/no auto-init,6+future streams/raw units/two clocks, repeatedvalues/tied-and-reversedtime/ObjectId order, all-or-nothing packet validation, concurrent initialcounter/writes, globalFIFO10000+latest eviction+restart, insert+eviction rollback khi counterupdatefail, counterMAX overflow, Accepted/End/renewal/ManagerJoinLeave, bounded queries/range/page, malformed/orphan/missingstate, corrupt PG metadata/no fallback, lock revocation và HTTP fresh app/pool/Mongo client. Lượt đầu cũng sửa assertion thử RAM actor không tồn tại thành kiểm tra store RAM thực sự rỗng; không nới quyền hoặc sửa status production để khớp assertion sai.

Tiếp **ACTUATOR_TASKS Mongo/private allocator/recovery**→CULTIVATION_EVENTS Mongo/context/head→async shared database runtime/MQTT/guards/workers/QR→restart/API/frontend/ESP32 acceptance. Mỗi module một branch từ newest integration, không quay về main cũ. Rules/seed/phone/station đã chốt không hỏi lại; điểm mới mơ hồ phải hỏi và chờ. .env/private ERD/MQTT/Postman/UI giữ nguyên, không push/merge hoặc gửi hardware commands tự động. [Mẫu control UI cần từ bên thứ3](frontend/ACTUATOR_CONTROL_DESIGN_BRIEF.md).
