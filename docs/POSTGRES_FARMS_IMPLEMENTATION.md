# PostgreSQL Farm — dữ liệu, duyệt đối ứng, lịch sử và thông báo

Tiếp nối2026-10-16: [Zone persistence](POSTGRES_ZONES_IMPLEMENTATION.md) đã dùng cùng parent Farm lock trước SUM/ghi, có test race Farm shrink/Zone insert; **231 backend/103 DB** tổng hiện hành. [Progress/việc tiếp theo](BACKEND_PROGRESS_CURRENT.md): USERS_ZONES persistence; AppModule vẫn RAM. Các đoạn “Zone tiếp theo” và kết quả228/85 ở dưới là checkpoint Farm ban đầu.

Ngày **2026-10-11**. Nhánh **feat/postgres-farm-workflows**, base **bcf8715** (PostgreSQL catalogs). Đọc cùng [handoff](MODULE_HANDOFF.md), [Farm API](FARMS_IMPLEMENTATION.md), [nghiệp vụ Farm đã chốt](FARMS_WORKFLOW_DESIGN.md), [persistence design](PERSISTENCE_DESIGN.md), [catalogs](POSTGRES_CATALOGS_IMPLEMENTATION.md) và [HTX workflow](POSTGRES_COOPERATIVE_WORKFLOWS_IMPLEMENTATION.md). Guides cũ mô tả checkpoint RAM; các câu “chưa tạo bảng/chưa chốt storage kỹ thuật” đã được thay thế bởi quyết định dùng bốn bảng technical trong đợt persistence.

## Phạm vi và giới hạn runtime

Đã bổ sung FarmRecords async, memory wrapper dùng đúng FarmsService hiện có và PostgreSQL adapter lưu FARMS + workflow_requests + entity_metadata + audit_events + notifications. HTTP paths/body/status/response và quyền nghiệp vụ giữ nguyên. Không thêm cột/bảng Farm nghiệp vụ, không UNIQUE chứng nhận Farm, không đổi ownership/membership qua PATCH thông tin.

**AppModule đầy đủ vẫn RAM.** Farm controllers đã dùng async port; domain Zone/Tree/assignment/IoT/Harvest/Cultivation/QR và HTX memory lifecycle vẫn đọc cùng FarmsService RAM. Factory đầu `apps/api/integration/farm-workflows.integration.ts` chỉ dựng Auth/Users/Farm với provider overrides PostgreSQL và cùng pool; các memory providers còn được cấp phát bởi forMock không phục vụ các HTTP ports đã override. Factory không đưa Zone RAM/MQTT/HTX scheduler vào và không mở public database mode. `/api/cooperatives` vẫn thuộc module HTX, không thuộc isolated factory Farm; API đó đã có adapter/test riêng ở đợt HTX.

Chưa có env flag bật toàn AppModule database. Không copy overrides Farm vào AppModule còn domain RAM. `loadOnClient` là helper backend cho adapter Zone tương lai dùng cùng client/parent lock, không route bypass quyền. Khi chuyển Zone và các domain sau, phải chuyển lookup Farm async cùng lúc; chưa nối frontend với các UUID seed DB trong đợt này.

Đã kiểm thử đọc/duyệt qua HTTP sau khi tạo app/pool mới với database thật; chưa full-process restart toàn backend/ESP32/Twilio/SMTP. Farm Pending và chữ ký đã có vẫn giữ qua restart; đây là đề xuất nghiệp vụ, không phải OTP session. Quy tắc OTP phải xác minh lại sau restart của Auth/HTX vẫn giữ nguyên. Không điều khiển/gửi tin phần cứng hoặc sửa frontend/.env ở đợt này.

## Nghiệp vụ được giữ

| Thao tác | Farmer chủ đề xuất | Admin đề xuất | Manager |
|---|---|---|---|
| Create/Update | Admin Active duyệt | Đúng chủ Farmer Active duyệt | Không đề xuất/duyệt |
| Join | Admin +Manager HTX duyệt | Chủ Farmer +Manager HTX duyệt | Duyệt bổ sung, thứ tự tùy ý |
| Leave | Admin duyệt | Chủ Farmer duyệt | Không duyệt; nhận notification sau Accepted |

Không tự duyệt/từ chối yêu cầu mình. Bên đã duyệt không quyết định lại. Một request Join đủ hai chữ ký mới Accepted; sau chữ ký đầu vẫn Pending và Farm chưa đổi. Rejected không đổi Farm/version/is_owner/membership. Một Farm có tối đa một Pending request; Create chưa có farm_id nên nhiều đề xuất tạo Farm cho cùng Farmer được phép. Không có API cancel/amend proposal, chuyển chủ hoặc xóa Farm.

Farmer Create cho mình; Admin bắt buộc owner_id Farmer Active. Create Accepted mới INSERT Farm độc lập (hai membership fields null), đặt USERS.is_owner=true nếu chưa true, tăng user entity version nhưng **không tăng token_version/thu hồi JWT**. Farmer được sở hữu nhiều Farm và chứng nhận Farm được trùng như ERD cũ. Update chỉ năm fields FarmDetailsDto; không thay owner/membership. Proposed changes/snapshot nằm riêng; thông tin chính chỉ đổi lúc chữ ký cuối được chấp nhận.

Join yêu cầu Farm độc lập, HTX đang có Manager Active. Reviewer Manager gắn cố định lúc đề xuất, phải còn quản lý đúng HTX lúc quyết định. Join Accepted đặt cooperative_id và join_cooperative_date theo UTC server. Phải Leave trước khi Join HTX khác. Leave Accepted xóa cả membership fields và giữ quyền sở hữu; recipient là Manager hiện tại của HTX, role phải vẫn Manager. Manager Locked vẫn được lưu notification và đọc khi Active trở lại; không cần chữ ký Manager hoặc gửi SMS/email.

Mỗi approve kiểm tra owner Farmer Active, proposer còn Active/đúng role, Farm owner/version đúng snapshot; Join kiểm tra current Manager/Active. Bước cuối còn recheck tất cả người đã ký hiện vẫn Active/đúng role/id yêu cầu. Nếu thất bại, không ghi chữ ký mới hoặc dữ liệu chính. Reviewer còn quyền và chưa ký có thể reject kể cả version/proposer đã stale để giải phóng slot. Nếu cả reviewer phù hợp đã mất quyền hoặc bên còn lại đã ký và không được quyết định lại, request vẫn Pending cho đến khi context được khôi phục; chưa thêm cơ chế Admin cưỡng chế/hủy. Đây là giới hạn luồng cũ được giữ, cần thảo luận nếu muốn thêm sau.

Admin đọc toàn bộ; Farmer chỉ Farm/yêu cầu thuộc mình, assignment không mở đọc toàn Farm. Manager đọc Farm hiện thuộc HTX mình và Join requests đã/chờ mình tham gia khi còn quản lý HTX đó. Join snapshot cho phép đọc trước membership. Sau Leave, Manager mất đọc Farm hiện tại nhưng vẫn xem lịch sử Join nếu còn quản lý HTX. Notifications chỉ cho Manager nhận đúng recipient_id; không lộ notifications Farm của Manager khác hoặc HTX workflow admin.

## API, DTO và Postman

Tất cả endpoints cần JWT Active; actorId lấy từ AuthGuard, không nhận quyền/actor/date/version/signature từ JSON.

| Endpoint | Nội dung/kết quả |
|---|---|
| GET /api/farms, GET /api/farms/:id | Farm đã duyệt trong scope; page hoặc record200 |
| POST /api/farms/requests | CreateFarmRequestDto; 201 Pending, farm_id=null |
| POST /api/farms/:id/update-requests | UpdateFarmRequestDto; 201 Pending |
| POST /api/farms/:id/join-requests | `{ "cooperative_id": "UUID" }`; 201 Pending |
| POST /api/farms/:id/leave-requests | `{}`; 201 Pending |
| GET /api/farm-requests, GET /api/farm-requests/:id | Request/snapshot/signatures trong scope200 |
| PATCH /api/farm-requests/:id/approve | `{}`; 200 Pending hoặc Accepted |
| PATCH /api/farm-requests/:id/reject | `{}` hoặc reason1..500 ký tự; 200 Rejected |
| GET /api/farm-notifications | Manager recipient; page200 |

Create/Update fields: area_size number0.001..9999.999, tối đa3 số lẻ; address trim1..255; certificate_number trim1..18; longitude number-180..180, latitude number-90..90, tối đa7 số lẻ. Không nhận numeric string/null/extra fields. PATCH proposal rỗng hoặc không có giá trị thực sự khác Farm400. Không tự đổi diện tích/precision/coordinates; numeric PostgreSQL được chuyển lại JSON number, timestamptz về canonical UTC ISO. Farm vẫn đúng chín fields ERD, không lộ metadata/expected_version. Lý do từ chối dùng cùng MaxLength DTO khi nhập và đọc lại, kể cả Unicode/emoji; không dùng string.length (UTF-16 units) để chặn sai nội dung500 ký tự đã được API chấp nhận. Kiểm thử500 emoji nhập/xem lại đã đạt.

Page {items,total,limit,offset}; mặc định20/0, limit1..100, offset0..100000. Farm q tối đa100, substring literal không phân biệt hoa/thường, có dấu, tìm address +space +certificate như RAM. %, _, apostrophe không thành SQL wildcard. Request filter status Pending/Accepted/Rejected. Count và page dùng một SQL snapshot; offset quá cuối vẫn giữ total. Farm PG sort UUID; requests/notifications sort created_at rồi UUID. RAM giữ thứ tự thêm; chưa có API sort. Dữ liệu thay đổi giữa hai lần lấy page vẫn có thể khiến client cần tải lại.

DTO/UUID sai400; không có hoặc ngoài scope đọc404; vai trò đề xuất/quyết định sai403; JWT thiếu/sai hoặc non-Active khi authenticate401; Pending trùng/duyệt lặp/stale context/diện tích thiếu409; lỗi database/audit hoặc persisted state/version không hợp lệ503 với thông báo sanitize. Direct port non-Active403; owner/proposer/signature không hợp lệ lúc approve409. Không fallback RAM khi DB lỗi, không gửi SQL detail/URI/số điện thoại/hash trong lỗi.

Import `docs/postman/Farms-Local-Test.postman_collection.json`, thao tác18 requests và copy JWT/UUID/OTP bằng tay theo FARMS_IMPLEMENTATION.md. JSON/path/status không đổi nên không cần sửa collection hoặc scripts/environment. Chạy `npm run dev:api` vẫn RAM: UUID từ API cùng instance, không dùng UUID seed DB. Isolated PostgreSQL factory được tái lập bằng integration suite dưới đây; chưa có CLI khởi động factory thành runtime hoàn chỉnh. Dùng các collection Users/Cooperatives hiện có để demo registration/email approval/danh bạ trong AppModule, không tạo Manager test bỏ xác minh email để test tay.

## Source và data mapping

- `farms/farm-records.ts`: async HTTP contract và FarmPage; `memory-farm-records.ts` inject một FarmsService, không có Map/store mới. Modules alias port bằng useExisting và export cả service cho domain RAM.
- Farm controllers inject FarmRecords; direct synchronous domain callers vẫn dùng FarmsService cũ. `farms/farm-workflow.ts` dùng chung cho memory/PG để tạo approvals, xác định reviewer và recheck chữ ký bước cuối. Không đổi quy tắc memory.
- `farms/farm-validation.ts`: PostgreSQL boundary revalidate DTO/UUID ngay cả ngoài controller; UUID canonical lowercase. `persistence/farm-mappers.ts`: decimal/date/state mapping, kiểm tra cấu trúc proposal/signature/snapshot/action/status, từ chối state sai thay vì đoán/khôi phục chữ ký.
- `persistence/postgres-farms.repository.ts`: nhận shared Pool +PostgresUsersRepository +backend clock, không sở hữu pool/store/timer/cache/seed. `loadOnClient` dùng lại client transaction cho parent Farm ở adapter sau.
- `persistence/farm-workflow-schema.ts`: additive migration005, đăng ký tại migrations.ts; test:persistence chạy đủ sáu suites.

workflow_requests: module='farms', action Create/Update/Join/Leave, status Pending/Accepted/Rejected. id/requested_by/created_at/resolved_at/resolved_by ở columns. target_key=farm_id, null khi Create chưa Accepted. expected_version=version Farm lúc đề xuất, null cho Create. Payload gồm owner_id/proposed_role/proposed_changes/cooperative_id/required_approvals/farm_snapshot/rejected_by/rejection_reason; không lưu cả database vào blob hoặc nhận payload kỹ thuật từ client. Accepted Create cập nhật target_key bằng Farm UUID mới; giữ birth snapshot null/expected_version null. Chữ ký có role/user_id/approved_by/approved_at như API.

entity_metadata: entity_type='farms' hoặc 'farm_requests', entity_key=canonical UUID; version ban đầu1, tăng cùng transaction khi accepted/approval/reject tương ứng. Seed metadata/token_version được giữ nguyên khi user/Farm entity version tăng. Không vượt Number.MAX_SAFE_INTEGER. Actual Farm metadata phải tồn tại/version>=1; workflow shape sai hoặc overflow làm503, không đổi business/signature.

Audit append cùng transaction: FarmRequestCreated/FarmRequestApprovalAdded/FarmRequestAccepted/FarmRequestRejected, FarmCreateApplied/FarmUpdateApplied/FarmJoinApplied/FarmLeaveApplied, FarmOwnershipGranted khi is_owner đổi từfalse. actor_id là người đề xuất/reviewer thực, changed_at backend; payload chỉ action/request/farm/approval role liên quan, không credential/OTP. Không có API audit mới.

Leave notification lưu technical.notifications với type FarmLeftCooperative, recipient_id Manager, dedup_key=`farms:{request_id}:leave`, created_at backend; payload module/farm_id/owner_id/cooperative_id/request_id. Request lock +transaction +unique dedup bảo đảm một thông báo; không dùng ON CONFLICT để che inconsistent state. PG HTX lifecycle đã kiểm tra payload cooperative_id/farm_snapshot và notification references nên lịch sử Farm vẫn chặn xóa HTX thiếu Manager; không cascade hoặc tự unlink references.

## Transaction, lock và đồng thời

Mọi thao tác dùng READ COMMITTED, một client của inPostgresTransaction; không chia BEGIN/data/audit qua pool.query. Không giữ transaction qua SMS/email/MQTT/provider await.

Ghi đọc hint request/Farm/HTX để biết mọi accounts liên quan, rồi khóa **users UUID tăng dần → user metadata tăng dần → HTX UUID tăng dần → Farm → workflow request**. Sau lock đọc lại Active/role/owner/manager/version/signatures. Cùng thứ tự user→HTX với registry/Manager approval/lifecycle. Không khóa thêm user sau khi đã khóa HTX để tránh chu trình chờ với registry.

Nếu chữ ký đầu/Manager/ownership/membership đổi lúc đợi lock, rollback **trước mọi ghi** và đọc hint/khóa lại toàn transaction, tối đa4 lượt. Đây là retry riêng khi lock context đổi, không retry lỗi DB/commit không rõ. Nhờ đó hai reviewer Join gửi đồng thời vẫn có thể trả Pending và Accepted; bước cuối khóa cả người vừa ký và kiểm tra lại quyền của họ. Context đổi liên tục thì409, người dùng tải lại. Duyệt cùng bên hai lượt chỉ một thành công, lượt sau409.

Update Accepted đã khóa parent Farm **trước** statement SUM live Zones; so proposed area với tổng rồi UPDATE Farm. Zone writer phải dùng cùng parent Farm lock trước ghi. Trigger001 tiếp tục bảo vệ ở DB, không thay prelock trong adapter vì snapshot statement bắt đầu trước khi đợi có thể cũ. Hai thao tác shrink/insert Zone cạnh tranh không commit tổng Zone vượt Farm. Đợt Zone persistence tiếp theo phải giữ contract này và lock order user/HTX/Farm khi phối hợp scope.

Request creation đối với Farm có ID giữ parent Farm lock rồi kiểm tra slot; partial UNIQUE005 là lớp bảo vệ cuối. Create chưa có ID không chiếm slot. Chữ ký/dữ liệu/version/is_owner/audit/notification cùng commit; bất cứ bước nào lỗi đều rollback. Rejected chỉ thay request/version/audit, không Farm. Accepted request/lịch sử vẫn giữ, không TTL/xóa. RAM vẫn có hạn demo1000 Farms/2000 requests; PostgreSQL không áp các hạn bộ nhớ đó, read pagination/input vẫn bounded.

Nếu COMMIT thực sự thành công nhưng response bị mất, client đọc lại request bằng id trước khi quyết định lại; terminal409 khi retry không đồng nghĩa thay đổi chưa commit. Không thêm idempotency key cho POST Create nên client nên tra requests trước khi gửi lại. Không tự retry commit hoặc gửi lại proposal vì có thể tạo Farm mới.

## Migration005 và local demo

005_farm_workflow thêm partial UNIQUE **lower(target_key)** cho module farms/status Pending/target nonnull; UUID hoa/thường không mở hai slots. Không thêm bảng nghiệp vụ, không sửa migrations001–004/checksums đã Applied. Nếu database cũ có hai Pending cùng Farm (kể cả khác case), migrate lỗi/rollback, không sửa/xóa requests hoặc đánh dấu Applied. Phải đối chiếu dữ liệu và chốt xử lý, không tự gộp.

Local2026-10-11: Docker Desktop/main PostgreSQL/Mongo ban đầu tắt; đã khởi động lại đúng container/volume hiện có. CLI status xác nhận001–004 Applied/005 Pending → migrate áp **chỉ005** → status cả001–005 Applied. Không seed lại hoặc thay dữ liệu demo/.env. Test dùng database/containers fixture riêng, không thao tác user/hardware thật.

Tái lập trên database demo đã có, từ root:

```powershell
npm run build
npm run db:status
npm run db:migrate
npm run db:status
```

Docker Desktop cần chạy. Database demo đã có containers/volumes thì `docker compose start postgres mongodb`; máy mới xem foundation để setup/migrate/seed riêng, không áp reset/seed lên demo đang dùng. CLI sanitize lỗi; không in .env/connection strings. Có thể dùng node dist/persistence/cli.js status/migrate từ apps/api sau build nếu npm wrapper Windows gặp lỗi. Không dùng db:seed để sửa migration/request thất bại.

## Kiểm thử và tái lập session

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

Sáu suites tuần tự dùng ports15432/27028/credentials fixture cố định, tạo sdf_persistence_test_{32hex} rồi cleanup đúng database đó. Không đọc .env/gửi SMS/email/MQTT; không down demo Compose, không -v/reset/clean. Fixture Manager qua repository registration/verified-email context +registry approval, không seed Active Manager giả vào database demo. Một số SQL trực tiếp chỉ tạo tình huống lỗi/race/revocation trong database test ngẫu nhiên.

Fallback Windows từ **apps/api**, chờ compile exit0 rồi chạy:

```powershell
node ../../node_modules/typescript/bin/tsc --outDir .integration-dist
node --test --test-concurrency=1 .integration-dist/integration/persistence.integration.js .integration-dist/integration/users-auth.integration.js .integration-dist/integration/users-cooperatives.integration.js .integration-dist/integration/cooperative-workflows.integration.js .integration-dist/integration/catalogs.integration.js .integration-dist/integration/farm-workflows.integration.js
node --test --test-concurrency=2 .integration-dist/test
node ../../node_modules/eslint/bin/eslint.js src test integration
node ../../node_modules/typescript/bin/tsc --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
```

Browser fallback từ apps/web: `node test/e2e.mjs`. Fixture API/MQTT/Vite/Chromium loopback, không broker/hardware/.env thật. Kết quả **228/228 backend +85/85 persistence +29/29 browser** (=65 DB cũ +20 Farm gồm19 subcases và wrapper), backend lint/typecheck/build đạt. Bao phủ migration duplicate/case, tạo hai chiều/is_owner/JWT, Pending race/reject, Join signatures/order/scopes, Leave Locked Manager/dedup, revocation/stale version, area race, audit rollback, DTO/mappers/search/pagination, fresh HTTP app/pool/history/notification, actor bị revoke khi đợi lock, competing Admins, malformed workflow/version overflow và HTX history references. Memory regression mới xác nhận async port dùng đúng service/domain store.

Session tiếp: đọc AGENTS nếu có, status/branch/log, handoff/notes/plan/buildspec/ERD và guide này; base nhánh mới nhất. **Zone persistence tiếp theo**, chuyển Standards/Farm lookup async đồng bộ với adapter Zone; giữ chủ Farmer sửa trực tiếp/Admin đề xuất/Manager đọc, Active standard mới và tổng diện tích dưới khóa Farm. Rồi assignments/Tree/Harvest/IoT metadata → Mongo telemetry/tasks/cultivation/context/head → full AppModule database wiring/process restart/hardware/frontend acceptance. Không triển khai lại Users/HTX/catalogs/Farm; AI vẫn để sau.

.env và bảy nguồn ERD/MQTT/Postman/UI riêng được kiểm tra hashes; private deletions/untracked assets giữ nguyên. Chỉ stage source/test/docs của đợt này, commit local, không tự push/merge. Business mới chưa rõ phải hỏi và chờ; quyết định hiện đã chốt không hỏi lại.
