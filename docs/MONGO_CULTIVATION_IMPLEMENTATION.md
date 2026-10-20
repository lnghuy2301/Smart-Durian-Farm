# Cultivation MongoDB — nhật ký, context và chuỗi theo Zone

Ngày 20/10/2026. Nhánh `feat/mongo-cultivation-persistence`, commit `1a8a8bb`, kế thừa task journal `b6d3ed1`. Đây là adapter nghiệp vụ MongoDB cuối cùng; 13 bảng PostgreSQL và ba collections MongoDB đều đã có adapters. **Checkpoint adapter ban đầu dùng AppModule RAM**; nhánh kế tiếp đã nối [database runtime/MQTT/QR](DATABASE_RUNTIME_IMPLEMENTATION.md) và bổ sung catch-up tối đa512 records mỗi transaction cho burst10.000 overdue. Không coi fixture/loopback là nghiệm thu ESP32 thật.

## API và quy tắc

Giữ nguyên JWT, DTO, response và các routes `/api/cultivation-events`: GET danh sách, `/mine`, `/:id`, `/:id/corrections`, `/zones/:zoneId/chain/verify`; POST tạo, POST `/:id/corrections`, PATCH/DELETE `/:id`. ID event là ObjectId hex24, đối tượng Zone/Tree/User vẫn UUID. Client không được gửi tác giả, timestamps, hash hoặc private context.

Chủ Farmer tạo trực tiếp; Farmer khác cần assignment Accepted đang hiệu lực `[start,end)`. Admin/Manager chỉ đọc; Manager trong HTX hiện tại. Worker đang làm xem toàn Zone; hết việc chỉ giữ nhật ký mình tạo, không được verify toàn chuỗi Zone hoặc tạo mới. Chỉ tác giả được sửa/xóa Pending hoặc tạo correction. Owner-author phải còn sở hữu Farm; assignee dùng **assignment và created_at gốc**, hạn correction kết thúc trước `end_date +15 ngày`; phân công mới không gia hạn lịch sử cũ. Backend recheck thời gian ngay trong callback mutation sau các await.

Pending có `lock_at=created_at+15 phút`, sửa không đổi deadline. Đến deadline không sửa/xóa; worker 30 giây, startup và HTTP transaction tự catch-up. Correction tham chiếu bản Locked mới nhất; một lineage chỉ có một Pending cuối cùng, không rẽ nhánh. Được đổi target/action trong cùng Zone; đổi action cần nhập lại details. Gốc Locked giữ nguyên. Watering: thời lượng, lượng nước tùy chọn; Spraying/Fertilizing: tối đa20 vật tư Active, snapshot tên/đơn vị/liều mặc định/cách ly/tiêu chuẩn. Ngoài tiêu chuẩn được ghi kèm cảnh báo. Snapshot đã lưu không đổi theo catalog sau này.

Chuỗi SHA-256 v1 theo Zone gồm cả log Zone và log Tree, chỉ Locked, thứ tự `lock_at` rồi `_id`. Genesis `previous_hash=null`. BSON mapping chỉ đổi ObjectId/date đã chỉ định; không normalize JSON details, giữ nguyên canonical hash. Đây là cơ chế kiểm tra lịch sử, không phải blockchain hay chữ ký chống người có toàn quyền database viết lại cả chuỗi.

## Lưu trữ và transaction

`CULTIVATION_EVENTS` giữ đúng16 fields hiện có, không thêm metadata quyền vào business document. `PERSISTENCE_STATE` lưu:

| kind / key | Dữ liệu |
| --- | --- |
| `CultivationContext` / event hex24 | Zone/Farm/author/assignment gốc, original_created_at BSON Date, root_id BSON ObjectId |
| `ZoneChainHead` / Zone UUID | count, hash, last_event_id BSON ObjectId, last_lock_at BSON Date |
| `CultivationLedger` / global | revision safe integer, event_ids ObjectId[]; toàn cục tối đa10.000, không eviction |

Migration mới **014_cultivation_ledger** mở rộng validator technical-state bằng kind ledger. Không sửa source/checksum001–013 hoặc tạo thêm collection/bảng nghiệp vụ. DDL có thể chạy lại sau gián đoạn; chỉ ledger migration PostgreSQL được ghi khi bước Mongo hoàn tất. Migration không seed hay sửa nội dung records.

Mỗi thay đổi dùng Mongo snapshot transaction +majority, deadline10s. Tạo event/context, xóa Pending/context, lock event/head và cập nhật revision/IDs commit hoặc rollback cùng nhau. Đợt runtime sửa trường hợp10.000 Pending quá hạn vượt deadline: khóa tối đa512 records sớm nhất mỗi transaction, commit head và tiếp tục catch-up trước callback nghiệp vụ. Gián đoạn sau một đợt giữ phần đã commit; lần sau tiếp từ head đó, không hash lại Locked. Mọi writer tranh một ledger revision để serialize capacity và correction qua nhiều process/Zone. Driver retry chỉ chạy callback thuần đồng bộ; không email/MQTT/PG writes trong callback. Duplicate key khi bootstrap có retry giới hạn sau transaction abort; không tự replay uncertain commit. Capacity đầy trả429, không xóa Locked hoặc tự tăng cap.

Journal Map chỉ sống trong transaction sau khi hydrate từ Mongo; không cache nghiệp vụ giữa requests, không fallback RAM. Đọc chunk tối đa100 events/context trong một cursor batch, tránh lỗi CSOT/getMore đã xác nhận ở telemetry và tránh vượt16MiB với event nhiều snapshots. Bulk writes giữ giới hạn capacity khả thi; không tắt timeout để vượt lỗi. Đây vẫn là thiết kế bounded snapshot, cần đo lại trước khi tăng10.000 hoặc triển khai lưu lượng lớn.

Snapshot kiểm tra đủ records/context/IDs, private lineage cùng gốc/Zone/tác giả, không branch, head/count/order/hash. Mất context/ledger hoặc dữ liệu hỏng trả503 với thông báo cố định, không auto-repair. API verify được phép báo `valid=false/HASH_MISMATCH/LINK_MISMATCH/HEAD_MISMATCH` khi cấu trúc còn đọc được; lỗi BSON/context/ledger vẫn503. Không dùng verify để cấp quyền truy cập lịch sử người khác.

PostgreSQL giữ quyền và snapshot catalog: users → metadata → HTX → Farm → Zone → target Tree → assignment → Standard → Materials sorted. Locks được giữ qua Mongo commit, không ghi business PG rows từ adapter. List đọc scope PG trên cùng actor transaction trước khi lọc Mongo và pagination; không lấy quyền từ private context do client gửi. Không tuyên bố distributed transaction PG–Mongo; callback sau lỗi commit phải đọc lại trước khi gửi lại mutation.

## Source và wiring

- `cultivation-events/cultivation-records.ts`: async port HTTP/QR và Memory wrapper alias đúng service hiện có.
- `cultivation-events/cultivation-events.store.ts`: journal dùng chung policy lock/order/hash và transaction-local snapshot restore; runtime RAM vẫn một store.
- `persistence/cultivation-mappers.ts`: strict BSON/domain/context/details mapping.
- `persistence/cultivation-state-schema.ts`, `migrations.ts`: append migration014, không sửa002.
- `persistence/mongo-cultivation.store.ts`: atomic snapshot/context/head/ledger, bounded reads/bulk writes.
- `persistence/database-cultivation-records.ts`: shared PG authority/catalog, original assignment policy, startup/timer cleanup, async API.
- `integration/cultivation-persistence.integration.ts`: random real PG/Mongo fixture, fresh clients/HTTP app, scope/deadlines/chain/correction/capacity/failure tests.

Database runtime phải đăng ký concrete `DatabaseCultivationRecords` provider có lifecycle init/destroy rồi alias port đến nó. Chỉ override useExisting alias bằng useValue có thể khiến Nest bỏ lifecycle hooks. Cùng DatabaseService pool/MongoClient/repositories với modules khác; không tạo pool riêng hoặc kết hợp API database với QR/MQTT RAM. Startup lock overdue records; shutdown hủy timer và chờ sweep đang chạy. Lỗi timer không tạo unhandled rejection; request/tick sau dùng transaction mới và không gia hạn deadline.

## Tái lập

Từ root, dependencies đã cài, Node20.19+, Docker Desktop:

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d
npm run test:persistence
npm test
npm run lint
npm run typecheck
npm run build
npm run test:web:e2e
```

Chạy riêng bằng local tools nếu npm wrapper Windows lỗi EPERM:

```powershell
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --outDir apps/api/.integration-dist
node --test --test-concurrency=1 apps/api/.integration-dist/integration/cultivation-persistence.integration.js
```

Compile phải exit0 trước khi test. Suite Cultivation **15/15**, gồm wrapper: concurrent bootstrap, BSON/private context, same-Zone target/action/material snapshot, author-only mutation, Pending deletion, deadline/hash order/Locked rejection, concurrent correction/QR source lineage, assignment end/grace/new assignment, fresh HTTP app/pool/client/startup catch-up/JWT/DTO, rollback, hash tampering, missing context/ledger, DB unavailable, cross-Zone writers, capacity10.000 và không eviction. Tests dùng cổng15432/27028, database ngẫu nhiên `sdf_persistence_test_{32hex}`, tự cleanup đúng database; không đọc `.env`, không gửi OTP/MQTT thật, không thay đổi demo DB hoặc volumes.

Kết quả hồi quy toàn bộ ghi ở handoff/progress sau khi hoàn tất. Browser tests hiện dùng runtime RAM; cần thêm nghiệm thu database runtime trong nhánh tiếp theo. Không đổi Postman JSON vì routes/body/response giữ nguyên. Không sửa `.env`, ERD/MQTT/Postman/giao diện riêng, không push/merge.
