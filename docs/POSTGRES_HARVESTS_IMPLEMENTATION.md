# PostgreSQL Harvest — xác nhận, correction, batch và quyền nhập bù

Đợt2026-10-17 trên **feat/postgres-harvests-persistence**, từ Tree5aca62a và review e84703b; kế thừa toàn bộ frontend024214b. [Tiến độ hiện hành](BACKEND_PROGRESS_CURRENT.md). Không triển khai lại API nghiệp vụ; port lưu trữ và rule bổ sung đã được người dùng xác nhận. [Tình huống/quyết định correction](POSTGRES_HARVESTS_IMPLEMENTATION.md).

## Source và runtime

`src/tree-harvests/harvest-records.ts` là port async của ba controllers; MemoryHarvestRecords delegate một TreeHarvestsService/useExisting, không thêm Map/store. Shared regression kiểm tra record, Pending review và public approved contents cùng instance. Các consumers RAM hiện tại/QR vẫn dùng service đó; **AppModule chính vẫn RAM** tới khi đủ adapters và chuyển internal lookups async đồng bộ.

`src/persistence/postgres-harvests.repository.ts` nhận một pool cùng Users/Farms/Zones/Trees/Assignments repositories có sẵn, dùng domain-access trên client của transaction. Không pool/store/cache khác, hydrate toàn database hoặc tự seed. harvest-mappers.ts kiểm tra records/requests/permissions/version/snapshot/nullable fields. Fixture HTTP riêng chỉ ghép các ports PG của Auth/Users/Standards/Farm/Zone/Tree/Harvest, không import AppModule/MQTT hoặc dùng memory data làm authority.

## API, quyền và states giữ nguyên

Prefix `/api`, JWT Active, UUIDv4 canonical lowercase. Cùng JSON/URL Postman hiện có, copy JWT/UUID bằng tay; không scripts/environment mới.

| API | Quyền/kết quả |
| --- | --- |
| GET /tree-harvests; GET /tree-harvests/:id | Admin/chủ/Manager HTX hiện tại/Assignee hiện tại; tác giả Farmer giữ đọc bản ghi mình |
| POST /tree-harvests | Chủ hoặc Farmer Accepted đang hiệu lực của Zone, tạo Draft |
| PATCH /tree-harvests/:id | Tác giả đang có quyền ghi hoặc chủ sửa Draft |
| DELETE /tree-harvests/:id | Cùng quyền, chỉ Draft chưa từng Confirmed |
| PATCH /tree-harvests/:id/submit | Chỉ tác giả có quyền ghi hiện tại; chủ tự nhập auto Confirmed, tác giả khác Pending chờ chủ |
| POST /tree-harvests/:id/correction-requests | Tác giả/chủ yêu cầu sửa Confirmed, reason +changes tùy chọn |
| GET /harvest-requests; GET /harvest-requests/:id | Theo requested_by/editor/author/current owner/current Manager/Admin |
| PATCH /harvest-requests/:id/changes | Người yêu cầu còn quyền ghi hoặc chủ bổ sung/thay nội dung correction |
| PATCH /harvest-requests/:id/approve | Confirm: chủ; Correct: Manager HTX hiện tại, hoặc Admin khi Farm độc lập |
| PATCH /harvest-requests/:id/reject | Người yêu cầu/chủ rút, hoặc đúng reviewer từ chối |
| GET /harvest-backdate-permissions | Admin, người được cấp hoặc chủ Farm của Zone |
| POST /harvest-backdate-permissions | Admin cấp đúng user/Zone/ngày/hạn/reason |
| PATCH /harvest-backdate-permissions/:id/revoke | Admin thu hồi, không xóa lịch sử grant |

Business record đúng12 fields: id/tree_id/created_by/season_name/harvest_date/fruit_count/total_weight_kg/batch_code/status/updated_by/updated_at/created_at. Không nhận status/actors/timestamps/backend IDs trong body. fruit_count integer1–2147483647, weight0.01–99999.99 tối đa2 decimals; season/batch trim1–50. Null/field lạ/no-op/invalid nested changes bị400. List limit1–100/offset0–100000, scope trước pagination, total đúng ngoài trang cuối. q tìm literal season/batch, filter tree_id/zone_id/status; requests filter status/harvest_id.

Chủ không cần assignment để nhập Harvest. Farmer khác cần Accepted trong `[start,end)`, không chỉ một dòng USERS_ZONES. Không tự cấp quyền Farm từ quyền Zone. Tác giả hết phân công chỉ đọc lịch sử mình/gửi reason; không gửi/prepare changes tới khi có quyền hiện tại, chủ có thể chuẩn bị thay. Không áp correction15 ngày của Cultivation sang Harvest. Manager/Admin không nhập/sửa trực tiếp nội dung, reviewer chỉ áp nội dung do editor hợp lệ cung cấp.

Confirm lần đầu giữ updated_by/updated_at null. Correction được duyệt trở Confirmed ngay; updated_by là **editor**, updated_at giờ áp dụng, resolved_by là reviewer. Chờ correction giữ nội dung đã duyệt trên bảng chính; đề xuất tách trong workflow. QR dùng ever_confirmed, chỉ whitelist năm nội dung, không công khai pending changes, reason, actors, UUID hay timestamp kỹ thuật. Confirm Pending lần đầu chưa public. Reject Confirm → Draft; reject Correct → Confirmed giữ nội dung/updated fields cũ.

Một Pending request cho từng record; duyệt/khóa từng record, không khóa cả batch. Terminal actions409; Prepare không áp vào Confirm. Approve rechecks owner/HTX/version, requester Active, editor còn quyền ghi, reviewer hiện tại và constraints. Farm đổi HTX trong lúc Correct Pending thì409, rút/lập lại; không tự đổi reviewer. Requester/chủ có thể rút proposal lỗi thời, không đòi Manager cũ còn HTX.

## Ngày, correction và nhập bù

harvest_date là DATE/ngày thực tế theo lịch Việt Nam, created_at là UTC lúc nhập server. SELECT dùng `harvest_date::text`, tránh pg/host timezone đổi DATE thành JS Date rồi lệch ngày. Mọi timestamp còn lại UTC ISO. harvestDateEpoch chỉ kiểm tra format/leap/year; validateHarvestDate tính tuổi ngày bằng UTC midnight của lịch Việt Nam (+07), không theo timezone của máy hoặc thời lượng24h từ giờ thu hoạch.

Không nhập tương lai; trong7 ngày không cần grant. Hơn7 ngày cần grant đúng user/Zone/ngày, chưa revoke, expiry>giờ kiểm tra, grantor hiện vẫn Admin Active. Grant có thể dùng nhiều cây trong Zone/ngày đó tới expiry, không thêm single-use. Sửa quantity/weight của ngày đã lưu hoặc Confirm lần đầu không xin grant lại chỉ vì thời gian trôi; đổi ngày sang quá hạn rechecks grant của editor lúc đề xuất/prepare/duyệt.

**Rule người dùng đã chốt:** cây Dead/Removed chỉ tạo/sửa Draft ngày cũ. Correction **đổi ngày sang hôm nay** bị400 khi cây Dead/Removed, kiểm tra lúc gửi, prepare và approve. Nếu cây Active lúc đề xuất nhưng Dead trước duyệt vẫn chặn. Giữ nguyên ngày hiện có thì được sửa nội dung, kể cả ngày hiện có là hôm nay; field ngày không đổi được lọc khỏi changes. Sửa ngày sang ngày cũ vẫn theo quyền/batch/7 ngày/grant. Không thêm yêu cầu chứng minh mốc Tree đổi status, không đổi firmware hoặc quy tắc ngày khác. RAM và PG cùng rule, tests cả Dead lẫn Removed.

## Batch, xóa Draft và lịch sử

UNIQUE(tree_id,harvest_date) như schema001; cây có thể ở batch khác vào ngày khác. POST trùng409, client sửa cộng dồn Draft bằng PATCH; không auto-add làm trùng số khi retry. batch_code không UNIQUE, nhiều cây cùng Zone/ngày chia sẻ batch; confirmed một cây vẫn thêm cây khác vào batch. Cùng mã khác Zone hoặc khác ngày bị409.

Mọi create/update/propose/apply/delete khóa batch cũ/mới theo thứ tự cố định bằng lockHarvestBatches trước kiểm tra/ghi. Pending changes chưa giữ official batch/date; nếu conflict xuất hiện sau đề xuất thì approve409/rollback và Pending còn nguyên. Bản chính/version/request/audit cùng transaction, trigger001 là phòng vệ bổ sung.

Chỉ Draft chưa từng Confirmed được delete. Record/metadata chính được xóa, audit và terminal requests giữ nguyên. Confirm từng Rejected rồi Draft bị xóa vẫn GET/list request theo snapshot Tree→current Farm/scope, không inner join duy nhất vào live Harvest. Approve/reject/prepare terminal request409 **trước** lookup Harvest đã xóa. Không xóa grant bound Zone/user/day khi xóa một Draft.

## Lưu trữ, locks và lỗi

Một bảng business public.tree_harvests; metadata type tree_harvests giữ version và **ever_confirmed boolean bắt buộc**, không suy từ status Pending hoặc default false nếu thiếu. Data/version/updated fields/expected request state/ever_confirmed/audit commit atomic; không mất seed metadata. metadata còn có harvest_requests và harvest_backdates versions, không trả HTTP.

workflow_requests module harvests/action Confirm|Correct/status Pending|Accepted|Rejected, target_key Harvest UUID, requested_by thật, expected_version là version **sau khi chuyển Pending**. Payload đúng7 fields editor_id/owner_id/cooperative_id/reason/proposed_changes/harvest_snapshot/rejection_reason. Snapshot giữ trạng thái Draft/Confirmed trước proposal; prepare chỉ tăng request version, không sửa official Harvest/version hoặc cấp quyền public.

Quyền nhập bù là record riêng module **harvest_backdates**, action Grant, status Active|Revoked, target_key Zone UUID, requested_by Admin cấp quyền, expected_version null. Payload đúng user_id/harvest_date/expires_at/reason/revoked_at; created_at server, khi revoke ghi resolved_by/time và version/audit. Expired vẫn là lịch sử grant Active chưa revoke nhưng không cấp quyền sử dụng; không diễn giải mọi Accepted workflow thành grant. Mappers chặn metadata/request/permission sai shape/null/UUID/date/version/actors.

READ COMMITTED với một client. Khóa users UUID tăng dần→metadata→HTX→Farm→Zone→Tree→Harvest→request, rồi advisory batch locks cố định. Hints chỉ xác định tất cả users cần khóa; đọc lại parent/request/Active/role sau khi đợi. Grantor candidates được lấy trước user locks; nếu grant mới xuất hiện lúc đợi và Admin chưa trong tập đã khóa, rollback **trước ghi** rồi lấy context lại, không khóa user muộn sau parent. Retry context tối đa4, không retry DB/COMMIT không rõ. Test thực tế hai connections tái lập grant vừa xuất hiện, không duplicate record hoặc bypass kiểm tra Admin.

Không giữ transaction qua email/SMS/MQTT. Query/identifiers từ whitelist nội bộ, dữ liệu HTTP parameterized; lỗi driver/mapper503 sanitized, không connection string hoặc fallback RAM. 400 input/date/no-op;403 role/assignment/backdate;404 ngoài scope;409 duplicate/batch/state/HTX/version/repeat. COMMIT response mất thì đọc lại record/request trước retry; POST chưa có idempotency key. PG không áp giới hạn Map5000 records/2000 requests/1000 grants; RAM adapter giữ giới hạn cũ, DB pagination/input bounds vẫn giữ.

Migration010_harvest_workflow thêm partial UNIQUE lower(target_key) cho module harvests/Pending và index lookup grant Active theo Zone/user/day. Không sửa001–009 hoặc thêm bảng business/batch. Duplicate Pending cũ làm migration rollback, không xóa/gộp hoặc đánh dấu Applied; không chạy seed để chữa. Status local/data audit ghi sau khi lệnh thành công ở bảng tiến độ.

## Kiểm thử và tái lập

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

10 suites tạo random sdf_persistence_test_{32hex} trên ports15432/27028, cleanup chỉ DB fixture; không .env/provider/hardware thật. Không reset/clean/down -v/main Compose down. Máy ngủ/tạm dừng lâu có thể làm TCP/JWT/timeouts mất hiệu lực; kiểm tra fixture healthy và chạy lại phiên tests mới, không nới timeout/quyền. Windows fallback dùng local Node bins trong guide Tree; compile .integration-dist exit0 rồi node --test --test-concurrency=1 với10 integration paths trong package.json; backend --test-concurrency=2 .integration-dist/test. Browser từ apps/web node test/e2e.mjs.

Kết quả: **235/235 backend,151/151 persistence (10 suites, Harvest20 tests kể cả wrapper),37/37 browser; API lint/typecheck/build đạt**. Web source không đổi, checkpoint8/8 unit/quality checks giữ nguyên. Migration010 Applied local ngày17/10; hash/count13 bảng business +4 bảng technical trước/sau giống nhau, không reseed hoặc sửa001–009. Suite Harvest kiểm tra collision migration, nullable update/owner auto-confirm/author submit, individual confirmation, shared batch/uniqueness/races, Pending official contents/QR privacy, former author/owner editor, HTX reviewer/stale scope, ngày7/8/grant binding/expiry/revoke/role/race, correction date policy cả3 bước, request history sau Draft deletion, conflicts rechecked at approval, audit rollback, DTO/no-op/precision/search/page, DATE timezone, metadata overflow/corrupt state và fresh HTTP app/pool/another restart. Các tests chỉ fake/loopback, không ESP32/Twilio/SMTP thật.

Session sau đọc progress/handoff/AGENTS nếu có và kế thừa nhánh mới nhất. Tiếp Device/Sensor/Actuator PG→telemetry/tasks/Cultivation Mongo→async shared database runtime/QR→restart/frontend/hardware acceptance. Không hỏi lại rule này, seed/phone/station/duyệt đã chốt. .env/private ERD/MQTT/Postman/UI giữ nguyên, explicit stage paths/commit local, không tự push/merge.
