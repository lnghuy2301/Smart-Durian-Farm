# PostgreSQL Zones — dữ liệu, đề xuất và quyền đọc

Ngày bàn giao 2026-10-16; nhánh `feat/postgres-zone-persistence` kế thừa `46a03b7` và toàn bộ frontend `024214b`. Không triển khai lại nghiệp vụ Zone. [Trạng thái backend hiện hành](BACKEND_PROGRESS_CURRENT.md) là điểm bắt đầu cho session sau; các checkpoint cũ chỉ mô tả thời điểm bàn giao của chúng.

## Phạm vi và source

`src/zones/zone-records.ts` là port async cho hai controllers hiện có; `MemoryZoneRecords` gọi đúng một `ZonesService` qua useExisting, không tạo Map/store khác. Các domain RAM vẫn dùng ZonesService/FarmAreaBudget/MockZoneAssignmentStore cũ. Test regression xác nhận ghi qua port được domain service nhìn thấy và cùng kiểm tra ngân sách diện tích.

`src/persistence/postgres-zones.repository.ts` thực hiện port PostgreSQL, nhận pool/users/farms/catalogs có sẵn. Không tạo pool/store/cache riêng hoặc tự seed. `zone-mappers.ts` kiểm tra dữ liệu Zone, expected version, workflow payload và Accepted assignment context. `zone-workflow-schema.ts` là migration007 bổ sung; migrations001–006 không sửa.

**AppModule chính vẫn dùng RAM**. Fixture HTTP riêng chỉ ghép Auth/Users/Farm/Standards/Zones ports PostgreSQL với các repositories cùng pool. Memory services trong fixture không được dùng làm nguồn dữ liệu, không hydrate Map từ database. Không override riêng ZoneRecords trong AppModule: Tree/assignments/harvest/IoT/QR đang gọi domain services RAM và phải chuyển async đồng bộ trước khi bật database runtime toàn hệ thống.

## API và nghiệp vụ giữ nguyên

Prefix `/api`, tất cả yêu cầu cần JWT của tài khoản Active. UUID biết được không cấp quyền. Field Zone vẫn đúng bảy trường: id, farm_id, standard_id, zone_name, area_size, longitude, latitude; không thêm metadata kỹ thuật vào response.

| API | Quyền và kết quả |
| --- | --- |
| GET /zones; GET /zones/:id | Admin; chủ Farm; Manager của HTX hiện tại; Farmer có phân công Accepted đang hiệu lực |
| POST /zones; PATCH /zones/:id | Chỉ đúng chủ Farmer, áp dụng trực tiếp |
| POST /zones/requests | Admin đề xuất tạo, chưa sinh Zone chính thức |
| POST /zones/:id/update-requests | Admin đề xuất sửa, giữ snapshot/version hiện tại |
| GET /zone-requests; GET /zone-requests/:id | Admin hoặc chủ Farmer được ghim trên đề xuất |
| PATCH /zone-requests/:id/approve | Đúng chủ Farmer, Pending → Accepted và áp dụng nội dung |
| PATCH /zone-requests/:id/reject | Đúng chủ Farmer, Pending → Rejected; reason tùy chọn |

Danh sách Zone: limit1–100, offset0–100000, q tìm literal trong tên và farm_id tùy chọn; danh sách requests thêm status. Tổng vẫn trả đúng khi offset vượt trang cuối. Tên Zone không UNIQUE. Không xóa/chuyển Zone sang Farm khác. DTO chặn null/field lạ/owner/status, diện tích tối thiểu0.001 và tối đa ba chữ số thập phân; tọa độ tối đa bảy chữ số thập phân. UUID đầu vào canonical lowercase, payload kỹ thuật không nhận từ client.

Một Zone chỉ có một Admin Update Pending. Create chưa có Zone UUID nên nhiều Create Pending được phép, **không giữ chỗ diện tích**. Chủ vẫn sửa trực tiếp lúc đang chờ; version thay đổi khiến duyệt proposal cũ409. Chủ từ chối rồi Admin tạo proposal mới. Request terminal không duyệt/từ chối lần nữa. Rejection không áp nội dung, có thể giải phóng proposal lỗi thời hoặc Admin đã bị khóa. Approval recheck chủ Active/Farmer, Admin đề xuất Active/đúng role, version, tiêu chuẩn và tổng diện tích.

Tiêu chuẩn chỉ bắt buộc Active khi gắn mới; giữ nguyên tiêu chuẩn cũ Inactive vẫn sửa được field khác. Farmer nhận việc không có quyền ghi metadata. Dòng USERS_ZONES một mình không cấp quyền: phải có accepted_at UTC và zone_snapshot hợp lệ trong entity_metadata, khớp Zone/Farm, cùng interval `[start_date,end_date)` tại thời điểm đọc. Metadata thiếu/sai không cấp quyền. Hết hạn không đọc live Zone qua endpoint này; lịch sử riêng/snapshot thuộc module phân công. Phân công không cấp quyền đọc toàn Farm. Manager scope dựa membership hiện tại, mất ngay sau Farm Leave.

403: sai role/không phải owner hoặc user không Active;404: resource ngoài phạm vi/không tồn tại;400: input/UUID/no-op;409: capacity/standard Inactive/proposal slot/stale/terminal;503: DB/metadata hỏng/version hết miền an toàn. Lỗi DB được sanitize, không fallback RAM.

## Lưu trữ, transaction và logic khó

Business data ở public.zones. technical.workflow_requests dùng module='zones', action Create/Update, status Pending/Accepted/Rejected, target_key nullable Zone UUID, requested_by Admin UUID, expected_version nullable. Payload chỉ có farm_id, owner_id, proposed_changes, zone_snapshot, rejection_reason. Accepted Create ghi target_key bằng Zone mới nhưng giữ expected_version/snapshot null. Update luôn giữ bản snapshot gốc. Không thêm bảng Zone proposal riêng.

entity_metadata dùng entity_type zones/zone_requests và canonical UUID, version khởi tạo1 rồi tăng cùng transaction. Seed metadata giữ nguyên. Audit append ZoneCreated/ZoneUpdated/ZoneRequestCreated/ZoneRequestAccepted/ZoneRequestRejected, actor thật, thời gian backend, snapshot trước/sau và request/proposer liên quan; không credential/OTP. Zone edit không tăng Farm version vì bản thân Farm không đổi. Lỗi bất kỳ ở audit/version/request đều rollback cả business data. Không vượt Number.MAX_SAFE_INTEGER.

Mọi ghi dùng READ COMMITTED trên một client: đọc hint → khóa users UUID tăng dần → user metadata cùng thứ tự → HTX hiện tại nếu có → parent Farm → Zone nếu có → workflow request nếu có. Đọc lại Active/role/current owner/membership/request sau khi đợi lock. Nếu context đổi thì rollback trước khi ghi và lấy hint lại, tối đa bốn lượt. Không retry lỗi DB hoặc COMMIT không rõ kết quả.

**Parent Farm phải khóa trước statement SUM** và trước mọi ghi Zone. Farm shrink dùng cùng khóa. Do đó hai Zone writers hoặc một Farm shrink và một Zone insert không commit tổng diện tích vượt Farm. So sánh diện tích ở đơn vị0.001 để tránh sai số0.06+0.039+0.001. Trigger001 là lớp bảo vệ DB bổ sung; adapter không dựa vào snapshot cũ trước khi đợi trigger lock.

Tiêu chuẩn đọc trên **cùng client** với `PostgresCatalogRepository.loadStandardOnClient(...,true)` và FOR SHARE tới COMMIT; concurrent deactivation được kiểm tra sau lock, không mở transaction catalogs.get khác rồi tự chờ lại user lock của mình. Các trusted loadOnClient là lookup nội bộ sau kiểm tra quyền/lock, không expose HTTP. Zone hiện tại không khớp parent Farm đã khóa là lỗi persisted state, không ghi dưới một parent khác.

Migration007 chỉ tạo partial UNIQUE `lower(target_key)` cho module zones/status Pending/target nonnull. Database cũ có duplicate (kể cả UUID khác case) thì migration rollback, giữ nguyên proposals/ledger; cần đối chiếu, không tự gộp/xóa hoặc đánh dấu Applied. Sources/checksums001–006 bất biến.

Nếu response bị mất sau COMMIT, đọc lại Zone/request theo UUID. Không tự retry POST Create vì chưa có idempotency key và có thể tạo thêm Zone. Terminal409 khi gửi lại approve không chứng minh lần trước thất bại.

## Kiểm thử và tái lập

Từ root, Docker Desktop phải chạy:

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d
npm run test:persistence
npm test
npm run lint
npm run typecheck
npm run build
npm run test:web
npm run test:web:e2e
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml down
```

test:persistence gồm **bảy suites**, mỗi suite tạo database `sdf_persistence_test_{32hex}` trên ports15432/27028, chỉ cleanup database của nó. Không `.env`/SMS/email/MQTT thật. Không `down -v`, không reset/clean/main Compose down. Windows fallback: từ apps/api dùng `node ../../node_modules/typescript/bin/tsc --outDir .integration-dist`, chờ exit0 rồi chạy `node --test --test-concurrency=1` với bảy `.integration-dist/integration/*.integration.js` có trong package.json; backend dùng `node --test --test-concurrency=2 .integration-dist/test`. Lint/typecheck/build dùng local Node bins theo guide Farm. Browser fallback từ apps/web: `node test/e2e.mjs`.

Kết quả: **231/231 backend,103/103 persistence** (=85 cũ +17 Zone subcases và wrapper), **8/8 web unit,37/37 browser**. Backend/web lint/typecheck/build và web formatting đạt. Zone integration bao phủ migration duplicate/case/rollback, owner/Admin scopes, Pending slots/concurrent approvals, stale/rejection, exact decimals/capacity/shrink race, standards Inactive/deactivation lock, Manager Join/Leave, Accepted assignment/malformed context/interval boundary, DTO/UUID/pagination/literal search, audit rollback, version overflow/missing metadata, owner bị revoke khi đang chờ lock và fresh app/pool/history. Khôi phục HTTP mới không đồng nghĩa đã nghiệm thu full-process AppModule database/hardware thật.

Demo local dùng container/volume hiện có; build → db:status → db:migrate → db:status. Không seed lại để chữa migration; không đổi dữ liệu demo/.env hoặc station/topic. Đối chiếu hash/count13 bảng nghiệp vụ +4 bảng technical trước/sau migration, ledger được thêm007. Trạng thái Applied cụ thể ghi ở BACKEND_PROGRESS_CURRENT.md.

Session sau kế thừa nhánh mới nhất, giữ frontend/private sources, tiếp **USERS_ZONES persistence**, rồi Tree/Harvest/Device/Sensor/Actuator → Mongo telemetry/tasks/cultivation → full runtime database/restart/QR/frontend/hardware acceptance. AI vẫn để sau. Không hỏi lại những quy tắc đã chốt; chỉ dừng khi gặp nghiệp vụ mới chưa rõ. Chỉ stage paths liên quan, commit local; không tự push/merge.
