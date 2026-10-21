# Backend database runtime và nghiệm thu tích hợp

Ngày 20/10/2026. Nhánh `feat/database-runtime-integration` kế thừa Cultivation `1a8a8bb` và task journal `b6d3ed1`. **AppModule đã có runtime database thống nhất**: 13 bảng nghiệp vụ PostgreSQL, ba collections MongoDB, các workflow/context/head/counters kỹ thuật. HTTP, Auth, MQTT, workers và QR dùng chung nguồn dữ liệu; không còn ghép HTTP database với metadata RAM trong chế độ database. Hai module AI vẫn hoãn theo quyết định của người dùng.

## Chạy và cấu hình

Đã có PostgreSQL/Mongo replica set trong Docker Compose, schema/seed và thông tin kết nối trong `.env`. Không đổi broker/topic/firmware hoặc credentials. `.env` được giữ nguyên; không cần thêm biến để nhận mặc định mới:

| Cấu hình | Kết quả |
| --- | --- |
| `NODE_ENV=development`, không khai báo BUSINESS_STORAGE | `database` |
| `NODE_ENV=test`, không khai báo BUSINESS_STORAGE | `memory`, để fixtures hiện có cô lập |
| `BUSINESS_STORAGE=database` | Explicit database, dùng trong integration/browser tests |
| `BUSINESS_STORAGE=memory` | Legacy RAM đầy đủ cho thử nghiệm cô lập, không phải persistence |
| Giá trị khác | Từ chối config |

`.env.example` đã có `BUSINESS_STORAGE=database`. `AUTH_MODE=mock` hiện vẫn là cổng bật Auth cho development/test; **tên này không quyết định nơi lưu dữ liệu**. Database mode không tạo MockUserStore/tài khoản demo lúc boot; tài khoản đến từ seed trước đó. Production Auth/deployment vẫn là đợt cấu hình riêng.

Từ root repository:

```powershell
docker compose -p smart-durian-farm up -d
npm run db:status
npm run db:migrate
npm run build
npm run start --workspace @smart-durian/api
```

Muốn watch backend: `npm run dev:api`. Không chạy seed lại để sửa login; seed không ghi đè password/identity/dữ liệu đang có. Seed mới chỉ dùng khi chuẩn bị database mới theo [foundation](PERSISTENCE_FOUNDATION_IMPLEMENTATION.md).

Startup kiểm tra ledger migration, Mongo writable replica set, đủ collections/validators/indexes mong đợi, trước khi task engine hay receiver khởi động. Thiếu/sai database trả lỗi cố định và yêu cầu `db:status/db:migrate`; không tự migrate, tạo collection trống, seed hoặc fallback RAM. Migration014 mở rộng technical-state validator, không thay nội dung business records. Health ready kiểm tra kết nối, không phải chứng nhận hardware hoặc mọi workflow đã được nghiệm thu ngoài thực địa.

## Dùng chung instance và lifecycle

`DatabaseRuntimeModule` tạo mỗi DynamicModule một lần, truyền cùng object vào các imports. Một `DatabaseService` sở hữu một PG pool và MongoClient; health/repositories/workers cùng dùng nó. `PersistenceRuntimeModule` tạo một bundle repositories, controllers nhận async ports trỏ vào đúng bundle. Concrete task/cultivation providers sở hữu init/destroy hooks; token ports là useExisting aliases, không thêm hook owner hoặc Map authority thứ hai.

Auth/Users/HTX dùng PG accounts, registry, approvals và technical requests. OTP/email/SMS sessions chưa xong vẫn RAM và phải verify lại sau restart; tài khoản đã xác minh, nội dung đã duyệt và đề xuất nghiệp vụ lưu bền. HTX lifecycle/bootstrap dùng cùng registry. Không tái đăng ký AuthModule/UsersStore ở mỗi module.

Task engine giữ PG session advisory lease một controller, durable numeric allocator/order/receipts Mongo và runtime queues/modes riêng. Startup đánh dấu Pending cũ Failed, mode Unknown, **không gửi lệnh lúc boot**. Start kế tiếp phải Reset OFF2→ACK→OFF3→ACK→OFF4→ACK rồi valve ON→ACK→pump ON→ACK; Stop/recovery giữ quy tắc đã chốt. ACK chỉ chứng minh hardware nhận command, physical_state luôn Unknown. Chi tiết [task journal](MONGO_ACTUATOR_TASKS_IMPLEMENTATION.md).

Cultivation giữ context/assignment gốc và hash v1. Burst nhiều Pending quá hạn được khóa theo từng transaction tối đa512 bản ghi sớm nhất, head/context/ledger atomic trong từng đợt; tiếp tục đến hết trước mutation/đọc catch-up. Hỏng hoặc mất kết nối thì giữ phần đã commit, lần sau tiếp đúng head; không hash lại Locked, không gia hạn deadline, không nâng timeout10s. Catch-up10.000 bản ghi có thể mất lâu hơn một request UI; đây là giới hạn prototype, không hứa realtime cho nhập hàng loạt. [Guide](MONGO_CULTIVATION_IMPLEMENTATION.md).

## MQTT và truy xuất QR

Receiver async dùng DeviceRecords/SensorRecords/TelemetryRecords/ActuatorTaskRecords chung với HTTP. Topic vẫn `publish/station/{stationId}` lên và `subscribe/station/{stationId}` xuống; station bất biến ánh xạ UUID Device, không là secret/FK. Sáu streams301–306, raw units nguyên văn; backend measured_at tại packet arrival, received_at tại bước ghi Mongo. Không nhận timestamp client/firmware mới, không convert unit và không sinh cultivation log từ ACK.

ACK được correlate với arrival time trước khi await presence write. Lookup/persistence failure bị bắt và ghi diagnostic code cố định, không unhandled promise/provider payload. Device last_seen_at monotonic trong PG. Telemetry adapter recheck metadata/locks trước commit, không tin lookup chẩn đoán trước đó. Retained/malformed/unregistered packets không refresh presence hoặc ghi readings. Diagnostic RAM tối đa200, không dùng làm lịch sử nghiệp vụ; giới hạn đồng thời200 handlers, quá tải từ chối an toàn. Diagnostic chứa readings được lọc theo assignment hiện hành trước pagination, phân công mới không mở gói cũ.

QR async đọc PG metadata, Mongo Locked Cultivation và PG approved Harvest. Projection whitelist dùng chung với RAM; mọi gốc/correction Locked của lineage liên quan đều hiển thị, nhãn applies/latest/target giữ nguyên cả khi A→B. Pending/correction_reason/note/tác giả/UUID fields/GPS/địa chỉ/số chứng nhận/IoT không công khai. tree_code vẫn là mã công khai `DRN-UUID` đã chốt, nên chuỗi mã có thể chứa UUID; không thêm field ID nội bộ riêng. Harvest Pending sửa giữ nội dung đã duyệt. Public URL từ cấu hình, không Host/JWT.

## Source cần đọc ở session sau

| File | Vai trò |
| --- | --- |
| `src/app.module.ts`, `config/environment.ts` | Chọn trọn vẹn database hoặc memory |
| `persistence/database-runtime.module.ts` | Shared imports, controllers, receiver |
| `persistence/persistence-runtime.module.ts`, `runtime-repositories.ts` | Preflight, một bundle/pool/client, lifecycle aliases |
| `auth/auth.module.ts`, `users/users.module.ts` | Database bindings, không tạo MockUserStore |
| `persistence/database-mqtt.service.ts`, `mqtt/mqtt-diagnostics.ts` | Async hardware routing/diagnostics |
| `persistence/database-traceability-records.ts`, `traceability/cultivation-projection.ts` | Public whitelist/lineage với database |
| `persistence/mongo-cultivation.store.ts` | Catch-up512, atomic head và bounded snapshot |
| `integration/database-runtime.integration.ts` | Full AppModule HTTP, fake transport, new app và separate Node process restart, startup refusal |
| `apps/web/test/database-runtime-browser.mjs` | Existing UI + full database + MQTT.js TCP loopback + app restart |

Các đường `src`/`integration` trong bảng tính từ `apps/api`. Không sửa source001–013/checksum đã apply, không đổi wire DTO để tiện fixture. Các guide từng adapter tiếp tục mô tả chi tiết quyền/SQL/validation/concurrency.

## Kiểm thử và tái lập

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d
npm run test:persistence
npm test
npm run lint
npm run typecheck
npm run build
npm run test:web:e2e
npm run test:e2e:database --workspace @smart-durian/web
```

Chạy lần lượt các bộ nặng để không tranh CPU ở bài benchmark capacity/deadline. Nếu npm wrapper Windows EPERM: compile bằng `node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --outDir apps/api/.integration-dist`, đợi exit0, rồi chạy Node test file đã compile. Browser database suite dùng compile này, không tự build hoặc đọc `.env`. Backend/fixtures dùng Node tools cài sẵn, không cần thêm thư viện.

Database tests tạo/migrate/seed/drop **chỉ database ngẫu nhiên** trên PG15432/Mongo27028. Main demo5432/27017 và volumes được giữ. Test separate Node process truyền chỉ fixture config qua stdin, không import main/dotenv; kill/restart thật để chứng minh dữ liệu/JWT tồn tại qua process. Broker loopback và ACK mô phỏng không phải ESP32 thật. Bốn browser database checks gồm login+six-stream rendering, Reset/Watering/Stop receipts, backend restart/readings/history/Unknown và public QR mobile. UI chỉ thêm union storage mode và wording dữ liệu lưu bền; không thiết kế lại màn hình riêng của người dùng.

Kết quả: **240/240 backend,263/263 persistence (17 suites),8/8 web unit,46/46 browser RAM +4/4 browser database**, API/web lint/typecheck/build và formatting đạt. Target full database runtime9/9 được chạy lại sau kiểm tra compound-index field order. File test-results/.integration-dist bị ignore; không commit snapshots, log credentials hoặc secret environment. Không thay Postman riêng vì contract/routes/bodies giữ nguyên; JWT/UUID/OTP vẫn nhập tay.

Migration014 đã Applied vào database demo local; so sánh hash/count21 nhóm dữ liệu trước/sau giữ nguyên (13 business+4 technical PG,4 Mongo). Sau đó bổ sung riêng sensor304–306 còn thiếu cho trạm thật, giữ sensor cũ và kiểm tra chạy lại không tạo trùng. Không reseed. Sensor303 còn expected unit cũ `%`; có hướng dẫn Owner PATCH sang `%rH` tại [chuẩn bị trạm thật](REAL_HARDWARE_DATABASE_READINESS.md), không tự ghi đè cấu hình này.

## Còn cần nghiệm thu thực tế

1. ESP32 thật: đúng station/mapping6 sensor, cadence15s, raw unit/presence; quan sát từng relay bằng phần cứng, không kết luận từ ACK.
2. Reset→Start→Stop, ACK thiếu/sai/trễ, disconnect giữa chuỗi, restart server và thử lại Start; kiểm tra journal/history/UI cùng database. Chỉ thử khi người phụ trách phần cứng sẵn sàng, trạm được cô lập và biết rõ tải đang nối.
3. SMS/email demo thật và approval Manager/HTX sau restart; database fixture không gửi provider thật.
4. Backup/restore database, cấu hình deploy/TLS/broker riêng và production Auth khi có môi trường triển khai. Hai module AI chỉ bắt đầu sau khi có model/provider/business specs.

Không tự push/merge hoặc gửi command tới hardware trong nhánh này. Các nhánh local có thể review theo chuỗi task→Cultivation→database runtime, không squash/reset các file riêng.
