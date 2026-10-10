# Persistence foundation — migration, schema và seed demo

Tiếp nối hiện hành2026-10-10: **feat/postgres-users-cooperatives** từcb2a4d6 đã có async Users/email lease, PG registration/Manager approval HTTP restart riêng và cooperative registry/lifecycle/version/audit/notifications. **226 backend/37 DB/8 web/29 browser**, checks đạt. Migration003 certificate UNIQUE bổ sung đã Applied local, giữ nguyên001/002 và dữ liệu demo, không chạy seed lại. [Guide hiện hành](POSTGRES_USERS_COOPERATIVES_IMPLEMENTATION.md). AppModule còn RAM; Manager email→SMS workflows/scheduler/các repositories khác chưa wiring. Hướng dẫn foundation/số216/16 bên dưới là kết quả lịch sử, lệnh test:persistence hiện đã chạy cả ba suites.

Tiếp nối2026-10-10: adapter Users/Auth đã triển khai trên **feat/postgres-users-auth** từ2b6db5f, kiểm thử221 backend/26 DB integration tests và Auth HTTP restart riêng. [Guide và phạm vi](POSTGRES_USERS_AUTH_IMPLEMENTATION.md). AppModule toàn dự án vẫn RAM; Users/email/HTX và domain repositories chưa wiring. Các số216/16 và giới hạn của foundation dưới đây là kết quả của đợt foundation, chưa bao gồm adapter mới.

Ngày 2026-10-10. Nhánh **feat/persistence-foundation**, base **622a189** từ docs/persistence-design; kế thừa QR/Cultivation/backend/frontend hiện có. Đọc cùng [thiết kế đã chốt](PERSISTENCE_DESIGN.md), [profile seed](PERSISTENCE_SEED_SPEC.md) và [handoff](MODULE_HANDOFF.md).

## Kết quả và giới hạn

Đã có CLI migration/status/seed, 13 bảng PostgreSQL nghiệp vụ, 4 bảng kỹ thuật dùng chung và ledger migration. MongoDB có 3 collections nghiệp vụ cùng PERSISTENCE_STATE nội bộ. Các migration được quản lý checksum, khóa đồng thời và chạy lại an toàn. Seed nằm trong một transaction PostgreSQL, chạy lại giữ UUID/password/status/nội dung đã sửa.

**API nghiệp vụ vẫn dùng RAM.** CLI đã tạo bảng và seed database demo local nhưng chưa thay các store/services/guards/workers bằng repository database. IDs từ output seed chưa thể dùng với các API đang chạy RAM; chưa có chế độ database/fallback tự động. Nghiệm thu này không tuyên bố luồng HTTP giữ dữ liệu sau restart hoặc hardware đã kết nối. Việc mở client database mới đã được kiểm thử; restart toàn backend với adapters database là đợt tiếp theo.

Không thêm endpoint API, không sửa frontend hoặc MQTT/DOCX/ERD/Postman riêng. Tiếp tục dùng các collection Postman hiện có; không thêm scripts/environments phức tạp. CLI không khởi tạo Nest/Auth/SMS/SMTP/MQTT, không tự gửi tin hoặc command, không seed telemetry/ACK/nhật ký đã Locked giả. Không tạo hai collections AI hoặc bảng QR.

## Source và contract

| File trong apps/api/src/persistence | Mục đích |
|---|---|
| postgres-schema.ts | SQL migration 001: bảng/FK/unique/check/index/trigger theo ERD và quyết định mới nhất |
| mongo-schema.ts | Migration 002: validators/indexes; BSON Date/ObjectId; PERSISTENCE_STATE có payload riêng từng kind |
| migrations.ts | Manifest/checksum/ledger/session advisory lock; status và runner |
| transactions.ts | Một PoolClient cho transaction; helper khóa Farm/batch trước câu ghi |
| seed-config.ts | Validate tài khoản/namespace/allowlist/DTO installed_at/cost trước khi kết nối seed |
| seed.ts | Profile durian-demo-v1, manifest seed_key, giữ dữ liệu đã có và báo conflict |
| mappers.ts | numeric/bigint/timestamp/ObjectId mapping; roundtrip không đổi canonical hash v1 |
| contracts.ts | Contracts async/unit of work cho adapters đợt sau, chưa đăng ký DI |
| cli.ts | Lệnh status/migrate/seed, dotenv local, đóng pool/client và log không có secrets |

CLI là process riêng, sở hữu và đóng một DatabaseService/pool/client. API AppModule không thêm instance/store hoặc runner tự chạy khi startup. Đợt repository phải tái dùng đúng DatabaseModule của AppModule hiện có và await mọi thao tác.

## Schema và ràng buộc

Tên vật lý PostgreSQL lowercase, cùng field của ERD: users, cooperatives, farms, zones, users_zones, trees, tree_harvests, agricultural_materials, farming_standards, standard_materials, devices, sensors, actuators. Enum nghiệp vụ dùng TEXT + CHECK để dễ đọc/đổi bằng migration mới; giá trị JSON/API không đổi. UUID default gen_random_uuid; timestamps TIMESTAMPTZ; harvest_date DATE; numeric giữ precision/scale ERD. Seed cây sinh tree_code DRN-{id}, không nhập mã hardware làm PK.

Schema technical gồm entity_metadata, workflow_requests, audit_events, notifications và schema_migrations. Bốn bảng đầu là dữ liệu kỹ thuật đã được người dùng chấp thuận; ledger là hạ tầng migration. JSONB chứa payload có loại rõ ràng, không dump toàn bộ store vào một blob. Liên kết đa hình entity_type/entity_key không có FK tự động tới mọi bảng; repository phải kiểm tra trong transaction. audit_events chặn UPDATE/DELETE.

Các bảo vệ đã kiểm thử:

- Phone unique sau chuẩn hóa 0/84/+84; email nullable/chuẩn hóa và unique. Không lưu plaintext password. Một manager_id chỉ gắn tối đa một HTX.
- USERS_ZONES exclusion trên Zone + tstzrange [start,end), end null không có hạn cuối. Chỉ các phân công đã được chấp thuận sẽ được adapter ghi vào bảng chính; lời mời Pending nằm trong workflow_requests.
- Station unique/not null và bất biến; Device installed_at/cost bắt buộc; Tree/Device/Zone không chuyển cha. Sensor loại/stream/device và Actuator purpose/capability/device bất biến, unique theo cặp Device. Sensor.unit vẫn varchar16 editable; hai ngưỡng cùng null hoặc min < max.
- TREE_HARVESTS unique(tree_id,harvest_date); batch_code có index nhưng **không UNIQUE**. Trigger kiểm tra chung Zone/ngày, khóa batch cũ/mới theo thứ tự. updated_by/updated_at cùng null hoặc cùng có giá trị. Quyền đọc/duyệt, everConfirmed, sửa/xóa vẫn phải qua repository/service hiện hành, không suy từ CHECK.
- Trigger kiểm tra tổng diện tích Zone và shrink Farm; standard gắn mới phải Active. Không tự tuyên bố SQL trigger thay toàn bộ quyền hay luồng duyệt.

**Contract khóa bắt buộc cho adapter:** transaction READ COMMITTED gọi lockFarm trước INSERT/PATCH Zone hoặc shrink Farm; lockHarvestBatches trước INSERT/PATCH/review Harvest và khóa cả mã cũ/mới theo thứ tự cố định. Helper khóa trước câu ghi để truy vấn kiểm tra sau khi chờ khóa có snapshot mới. Trigger là phòng vệ; các lệnh SQL tùy ý bỏ helper hoặc isolation khác chưa được nghiệm thu về concurrent aggregate/batch. Không dùng pool.query rời rạc bên trong transaction. [node-postgres transactions](https://node-postgres.com/features/transactions), [PostgreSQL17 ranges/exclusion](https://www.postgresql.org/docs/17/rangetypes.html).

Mongo: IOT_TELEMETRIES unit tối đa16 theo runtime hiện hành, không dùng giới hạn8 cũ của ERD; preserved raw unit. ACTUATOR_TASKS command_id unique/safe JSON integer và index history/Pending. CULTIVATION_EVENTS bắt buộc field/ObjectId/date/hash shape, index tác giả/target/lineage/deadline. Validators không thay kiểm tra quyền, liên kết context hoặc tính hash. PERSISTENCE_STATE kinds: CultivationContext, ZoneChainHead, TelemetryInsertionCounter (retained_ids tối đa10000), TaskIdAllocator. Collection/state vẫn trống sau seed; FIFO/counter allocator/catch-up transaction sẽ thực hiện ở đợt Mongo repository. [Mongo schema validation](https://www.mongodb.com/docs/manual/core/schema-validation/specify-json-schema/).

## Migration: lệnh và phục hồi

Từ thư mục gốc dự án, cấu hình DATABASE_URL/MONGODB_URI trong .env local và dùng Compose hiện có:

```powershell
docker compose up -d postgres mongodb mongo-init
npm run db:status
npm run db:migrate
npm run db:status
```

Không tự migrate khi API boot. PostgreSQL cần quyền CREATE/schema/extension btree_gist; Mongo phải là writable replica set. Không reset database/volume nếu authentication lỗi; kiểm tra cấu hình đang dùng. CLI log lỗi driver bằng mã, không dump SQL detail/URI. Khi migration lịch sử khác checksum/store hoặc có ID lạ/gap, dừng và dùng đúng revision, không chỉnh ledger để vượt qua.

001 SQL + ledger commit/rollback cùng client. 002 Mongo DDL không atomic với PostgreSQL ledger: mỗi thao tác createCollection/collMod/createIndex idempotent và chỉ mark Applied khi toàn bộ thành công. Nếu ngắt giữa 002, giữ nguyên ledger 001 và chạy lại 002 trên cùng revision; không xóa collection để thử lại. Database có bảng/index cùng tên nhưng schema khác có thể báo conflict; không tự bỏ dữ liệu người dùng. Không cung cấp down/reset cho database demo.

Nếu npm wrapper Windows báo EPERM, từ apps/api dùng công cụ local tương đương:

```powershell
node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
node dist/persistence/cli.js status
node dist/persistence/cli.js migrate
node dist/persistence/cli.js seed
```

## Seed demo và cấu hình

Đã đầy đủ các khóa local/example; các khóa DEMO_DEVICE_* được **CLI seed** đọc, không dùng làm global whitelist MQTT:

| Key | Giá trị / nguồn |
|---|---|
| AUTH_TEST_PHONE / AUTH_TEST_PASSWORD | Farmer demo chính từ cấu hình hiện có; không gửi secret trong chat/docs |
| AUTH_TEST_ADMIN_PHONE / AUTH_TEST_ADMIN_PASSWORD | Admin bootstrap từ cấu hình hiện có |
| DEMO_DEVICE_STATION_ID | E08CFE41DCAC local; template để trống cho installation khác |
| DEMO_DEVICE_INSTALLED_AT | 2026-09-01T08:30:00+07:00, lưu UTC; metadata minh họa được cho phép |
| DEMO_DEVICE_COST | 10237500 VNĐ, metadata minh họa được cho phép |

```powershell
npm run db:seed
npm run db:seed
```

Lần đầu profile tạo 99 records có UUID và4 liên kết standard_materials: 4 Users,1 HTX chưa gắn Manager,3 tiêu chuẩn,5 vật tư,3 Farms,6 Zones,54 Trees,2 phân công cùng Zone có khoảng liền kề (một đã hết và một đang hiệu lực),3 Devices,9 Sensors,9 Actuators. Không seed Harvest/Cultivation đã xác nhận trong foundation. Farmer chính sở hữu2 Farms, Farmer mẫu sở hữu Farm còn lại. Farm độc lập; HTX mẫu chưa có Manager và metadata created_at để worker xử lý deadline sau này. Manager mẫu Pending, email demo.invalid chưa verified; cần đăng ký/xác minh thật qua API để demo Active Manager, không duyệt tài khoản mẫu này như đã verified.

Trạm thật ở Zone Khu A; streams301/C,302/%,303/% và capabilities2/shared,3/watering,4/spraying. Hai trạm mô phỏng SIM_DEMO_001/SIM_DEMO_002 nằm ở Zones khác, Inactive/Maintenance. Mọi bảng con dùng Device UUID. last_seen_at null, không bịa Online/readings/ACK/physical state. seed_origin/hardware_bundle/seed_key ở metadata kỹ thuật phân biệt fixture/mô phỏng/bộ thật; dữ liệu mẫu có nhãn trong tên/hướng dẫn.

Chạy lại: reused=99/inserted=0 trên profile chưa thay identity; không reset password/status/verification/token version/cost/UUID. Metadata cũ thắng defaults. Đổi station/phone/Zone bất biến, role/ownership không phù hợp, manifest trỏ record đã xóa hoặc liên kết vật tư bị gỡ: báo conflict và rollback toàn transaction, không khôi phục/ghi đè dữ liệu tùy tiện. Nếu tài khoản Farmer đã có nhưng chưa là owner, seed báo conflict; chuyển ownership qua nghiệp vụ repository ở đợt sau thay vì seed sửa user có sẵn. Các số mẫu không được nằm trong SMS allowlist. CLI output chỉ counts và IDs của trạm/Zone/Farmer chính, không phone/hash/password.

Nghiệm thu local trong đợt này: hai migrations Applied; seed đầu inserted99/reused0, chạy lại inserted0/reused99. Không ghi IDs của installation local vào source; lấy output CLI bằng tay khi adapters database đã được triển khai. .env không đổi nội dung trong đợt foundation, vẫn ngoài Git. Việc kiểm chứng SMS/hardware thật phải do người dùng chủ động thực hiện sau khi API đọc repository.

## Tái lập kiểm thử

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d
npm run test:persistence
npm test
npm run lint
npm run typecheck
npm run build
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml down
```

Compose test dùng ports15432/27028, credentials fixture và tmpfs riêng; không đọc .env để lấy giá trị connection/credentials. Test không khởi tạo Nest hoặc provider thật. Mỗi run tạo database tên sdf_persistence_test_{32hex}, chỉ xóa database đã tạo trên endpoint test; không reset smart_durian hoặc volumes demo. Cần Docker đang chạy và Mongo rs-test có primary; lỗi kết nối không được coi là test pass/skipped. Từ apps/api có thể compile bằng tsc --outDir .integration-dist và chạy node --test .integration-dist/integration/persistence.integration.js khi npm wrapper lỗi.

Đã đạt **216/216 backend tests** (9 mới) và **16/16 persistence integration tests** (15 subcases + wrapper), lint/typecheck/build. Kiểm thử gồm migration concurrent/rerun/checksum/DDL rollback; seed conflict/no-overwrite; identity/composite unique; cạnh tranh diện tích; exclusion khoảng liền kề; batch nhiều cây/cross-Zone/date; rollback record/request/metadata; append-only audit; Mongo validation/transactions; client mới vẫn đọc dữ liệu. Hash v1 roundtrip BSON được kiểm thử độc lập. Không chạy lại web suite vì không sửa frontend; các số web trong bàn giao trước là kết quả đợt QR.

## Session tiếp theo

1. Đọc AGENTS nếu có, git status/branch/log; không checkout main cũ làm mất chuỗi tích hợp hoặc stage toàn bộ workspace.
2. Đọc guide này, thiết kế/profile/handoff và nguồn ERD hiện có. Giữ các file nguồn ERD/MQTT/spec/Postman/UI riêng ngoài commit.
3. Nhánh kế tiếp từ foundation: PostgreSQL repositories. Chuyển từng service/guard/worker sang async, ghi records + workflow + metadata + audit trong cùng transaction; preserving API contracts và shared instances. Ưu tiên Users/Auth/HTX/danh mục, sau đó Farm/Zone/assignments/Trees/Harvest/IoT metadata.
4. Mongo repositories: atomic context/head/event; retention insertion order; ID allocator bền; restart interrupted control giữ Unknown và reset trước Start. Chưa có điểm nghiệp vụ mới cần chốt ở foundation; nếu schema/API/role rule chưa rõ trong adapter thì hỏi trước.
5. Nghiệm thu HTTP/web/Postman/restart và ESP32 thật sau khi adapters hoàn tất. Không gọi receipt ACK là bằng chứng relay hoạt động; không tự tạo Cultivation từ ACK.

Nhánh/commit local; không tự push hoặc merge.
