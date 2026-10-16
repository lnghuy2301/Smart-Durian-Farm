# PostgreSQL Trees — metadata, đề xuất và lịch sử

Nhánh **feat/postgres-trees-persistence**, base **87c069b**, kế thừa Zone cddede5/Sensor46a03b7/frontend024214b. [Trạng thái hiện hành](BACKEND_PROGRESS_CURRENT.md). Nghiệp vụ/API của TREES_IMPLEMENTATION.md giữ nguyên; đợt này chuyển lưu trữ.

## Source và ranh giới runtime

TreeRecords là port async; MemoryTreeRecords dùng useExisting và gọi đúng TreesService trong AppModule, không tạo Map/store thứ hai. Regression test xác nhận controller port/domain/trace lookup cùng thấy cây, lời mời và snapshots.

PostgresTreesRepository nhận pool/Users/Farms/Zones đã có; không tự tạo pool/cache, hydrate RAM hoặc seed. tree-mappers.ts kiểm tra Tree/workflow/history, decimal/date/version và identity. domain-access.ts giữ primitives user→HTX→Farm→Zone lock/current-role recheck, không sở hữu pool/transaction; zone-read-scope.ts là SQL scope nội bộ chung với Zone repository, Accepted assignment evidence cũng dùng chung mapper hiện có.

**AppModule chính vẫn RAM.** Fixture HTTP riêng chỉ Auth/Users/Farm/Standards/Zone/Tree dùng PG ports/cùng pool, unused TreesService không hydrate. Không bật PG Tree HTTP riêng trong AppModule khi Harvest/IoT/Cultivation/QR còn đọc RAM sync. getRecord/getTraceRecordByCode/loadOnClient là trusted internal lookups, controller quản lý chỉ gọi methods có scope. Public QR phải whitelist như hiện có, không expose raw TreeRecord do có UUID/GPS.

## API và nghiệp vụ

JWT Active cho mọi API quản lý, prefix /api. GET /trees với q/zone_id/status/limit/offset; GET /trees/:id; GET /trees/by-code/:treeCode; GET /trees/:id/history. POST /trees và PATCH /trees/:id chỉ chủ Farmer. POST /trees/requests và POST /trees/:id/update-requests chỉ Admin. GET /tree-requests và GET /tree-requests/:id chỉ Admin/chủ ghim trên proposal. PATCH /tree-requests/:id/approve hoặc reject chỉ đúng chủ Farmer; approve body {}, reject reason tùy chọn.

Admin đọc mọi cây, chủ đọc Farm mình, Manager đọc trong HTX hiện tại, Assignee đọc đúng Zone khi đã Accepted và trong `[start,end)`. Manager/Assignee không sửa. Hết phân công mất Tree live/code/history scope, chỉ giữ lịch sử phân công riêng. Farm Leave làm Manager mất scope Tree/history ngay. Resource ngoài phạm vi404, danh sách rỗng; biết UUID/tree_code không cấp quyền.

Backend sinh id UUIDv4 và tree_code=`DRN-${id}`, cố định 40 ký tự. id/zone_id/tree_code bất biến, không chuyển Zone/hard-delete. Collision thử tối đa3 lần bằng INSERT ON CONFLICT DO NOTHING, không abort transaction giữa lần thử hoặc ghi đè cây cũ; hết lần409. Tên giống không UNIQUE, không giới hạn số cây theo diện tích khi chưa có nghiệp vụ đó.

Create input zone_id/variety/plant_date/longitude/latitude, status tùy chọn mặc định Active; có thể tạo Dead/Removed để nhập hiện trạng. PATCH chỉ năm fields variety/plant_date/longitude/latitude/status; bỏ status giữ nguyên trạng thái, cho khôi phục Active khi sửa nhầm. Date ISO timezone chuẩn hóa UTC, giữ rule hiện tại chưa cấm plant_date tương lai. String trim, coordinates numbers tối đa7 decimals, không null/field lạ. UUID canonical lowercase, by-code vẫn đúng DRN-UUID lowercase. Empty/no-op400, cả timestamp khác timezone nhưng cùng thời điểm cũng là no-op.

Một Pending Update mỗi cây; Create Pending chưa có tree_id/code nên nhiều đề xuất được phép. Chủ vẫn sửa trực tiếp lúc Pending; version đổi khiến approve409 và giữ Pending, reject rồi đề xuất lại. Approval rechecks owner/Farm/Zone/proposer Admin Active/current version. Rejection không ghi Tree/history và được giải phóng proposal stale/proposer đã Locked. Terminal request không xử lý lần nữa. Actor thực thi ghi/duyệt là owner, proposed_by là Admin khi có proposal; client không nhập các field đó.

PG không áp giới hạn Map5000 cây/2000 requests/10000 snapshots; các giới hạn đó vẫn giữ trên RAM adapter. Database pagination1–100/offset0–100000 và input bounds giữ nguyên. q tìm literal không phân biệt hoa/thường trong code/variety, không dùng %/_ như wildcard; offset quá cuối vẫn có total đúng.

## Lưu trữ và transaction

public.trees đúng8 fields. entity_metadata type trees/tree_requests giữ version, không làm mất seed_key/source. workflow_requests module trees/action Create|Update/status Pending|Accepted|Rejected; target_key nullable Tree UUID, requested_by Admin, expected_version null với Create hoặc version snapshot với Update. Payload đúng6 fields zone_id/farm_id/owner_id/proposed_changes/tree_snapshot/rejection_reason. Accepted Create điền target Tree mới, snapshot/expected version vẫn null. Không thêm bảng business/QR.

Lịch sử metadata Tree dùng technical.audit_events, entity_type trees, action TreeCreated/TreeUpdated; actor_id/changed_at/id từ event. Payload đúng proposed_by/request_id/version/before/after. API map action thành Create/Update và trả đúng TreeMetadataHistory. Thứ tự version tăng rồi audit id, không phụ thuộc hai changed_at có thể trùng nhau/clock rollback. Seed có version1 nhưng không bịa lịch sử Create đã xảy ra trước adapter; lần sửa đầu có before snapshot và version2. Đây là metadata history, không Cultivation/hash-chain/blockchain.

Audit append-only trigger001 chặn UPDATE/DELETE; fixture kiểm tra trigger giữ nguyên và thêm riêng một malformed INSERT để kiểm tra mapper503, không tắt trigger bảo vệ. History snapshots phải đúng identity/code/Zone/fields/status/date và proposed_by/request_id cùng null hoặc cùng UUID. Không tuyên bố ngăn được operator có quyền sửa schema/giả lập INSERT; không public audit raw.

READ COMMITTED, một client tới COMMIT. Read khóa actor/current metadata, lấy scope và page từ SQL. Write đọc hint để biết parent/users; khóa users UUID tăng dần→metadata→HTX hiện tại→Farm→Zone→Tree nếu có→workflow nếu có. Đọc lại role/Active/owner/membership/request/version sau khi chờ. Context đổi thì rollback trước mọi ghi/retry tối đa4, không retry lỗi DB/COMMIT không rõ. Giữ parent order với Zone/Assignments/Farm adapters.

Tree data/version/audit và request terminal/version/audit commit cùng nhau; bất kỳ lỗi nào rollback tất cả. Không self-deadlock bằng gọi repository public mở transaction khác từ trong transaction đang giữ user locks; dùng trusted loadOnClient/client của caller. Metadata thiếu/sai hoặc overflow Number.MAX_SAFE_INTEGER trả503, không fallback RAM.

Migration009_tree_workflow chỉ tạo partial UNIQUE lower(target_key) cho module trees/status Pending/nonnull target.001–008/checksums không sửa. Duplicate cũ gồm UUID khác case làm migrate rollback và giữ rows/ledger, không tự gộp/xóa. Không chạy seed để chữa migration. COMMIT response mất thì đọc request/Tree trước retry; POST Create chưa có idempotency key.

## Tái lập và nghiệm thu

Từ root, Docker Desktop chạy:

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

test:persistence gồm9 suites; random database sdf_persistence_test_{32hex}, ports15432/27028, cleanup chỉ database fixture. Không .env/SMTP/SMS/MQTT hardware thật, không down -v/main Compose down/reset/clean. Windows fallback từ apps/api: local Node tsc ra .integration-dist, chờ exit0 rồi node --test --test-concurrency=1 với9 integration paths trong package.json; backend node --test --test-concurrency=2 .integration-dist/test. Local bins lint/typecheck/build theo guide Assignments. Browser fallback từ apps/web node test/e2e.mjs. Postman Trees collection hiện có không đổi; nhập JSON/JWT/UUID thủ công.

Kết quả **233/233 backend,131/131 persistence** (=118 cũ +12 Tree subcases và wrapper), **37/37 browser**; API lint/typecheck/build đạt. Web source không đổi, checkpoint8 unit/quality checks trước đó giữ nguyên. Tests mới gồm migration duplicate/rollback, default/immutable code/date/status/history, owner/Admin scopes và competing approvals, stale/rejection/Locked proposer, assignment expiry, Manager Join/Leave, DTO/no-op/canonical ID/literal search, bounded UUID collision, append-only/audit rollback, bad metadata/history/request/overflow, owner bị revoke khi chờ lock và HTTP fresh app/pool/history không hydrate RAM.

Demo hiện có: npm run build→db:status→db:migrate→db:status, không reseed.009 đã Applied local; SHA-256/count13 business tables +4 technical trước/sau giữ nguyên, ledger chỉ thêm009. DB UUID không dùng với API RAM; full-process database/QR/hardware acceptance còn sau adapters phụ thuộc. Tiếp Harvest, Device/Sensor/Actuator PG, rồi Mongo và shared runtime. Giữ nguồn riêng, không push/merge, chỉ stage paths thuộc module; điểm nghiệp vụ mới chưa rõ phải hỏi/chờ.
