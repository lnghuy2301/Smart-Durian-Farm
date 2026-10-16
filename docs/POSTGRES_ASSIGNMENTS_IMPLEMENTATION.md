# PostgreSQL USERS_ZONES — lời mời, nhận việc và lịch sử

Bàn giao2026-10-16 trên **feat/postgres-assignments-persistence**, kế thừa Zone **cddede5**, Sensor46a03b7 và frontend024214b. [Bảng tiến độ hiện hành](BACKEND_PROGRESS_CURRENT.md). Nghiệp vụ từ [ASSIGNMENTS_IMPLEMENTATION.md](ASSIGNMENTS_IMPLEMENTATION.md) giữ nguyên; đợt này chuyển lưu trữ, không dựng lại module phân công.

## Source và giới hạn runtime

`src/assignments/assignment-records.ts` là async port cho hai controllers; `memory-assignment-records.ts` delegate đúng AssignmentsService qua useExisting. Store được ZonesModule cung cấp một lần để Zone/domain services RAM cùng thấy phân công, không tạo Map/store trùng. Regression test xác nhận lời mời/nhận việc/Zone read/end dùng chung store.

`src/persistence/postgres-assignments.repository.ts` nhận pool, Users/Farms/Zones repositories đã có, không tự tạo pool/cache hoặc seed. `assignment-mappers.ts` kiểm tra business record, snapshot, thời gian, phiên bản và từng chữ ký; Zone repository cũng dùng **cùng mapper phân công** để kiểm tra quyền đọc. Snapshot farm_id phải khớp parent hiện tại vì chuyển Zone sang Farm khác chưa được phép. Metadata thiếu/sai không cấp quyền.

**AppModule chính vẫn dùng RAM**. Fixture HTTP riêng chỉ gồm Auth/Users/Standards/Farm/Zone/Assignment ports PostgreSQL; unused RAM stores không hydrate và không được dùng làm nguồn dữ liệu. Không bật riêng port PG trong AppModule khi Tree/Harvest/telemetry/tasks/Cultivation/QR còn sync RAM. Hai helpers public assertCanWork/assertCanCorrect đã có bản async PG cho đợt wiring sau, chưa âm thầm đổi consumers hiện tại.

## API giữ nguyên

Prefix `/api`, JWT tài khoản Active. UUID là định danh, mọi resource vẫn kiểm tra phạm vi trên server.

| Method/path | Quyền/kết quả |
| --- | --- |
| POST /zones/:id/assignment-requests | Chủ Farm hoặc Admin, input user_id + start_date/end_date tùy chọn |
| GET /assignment-requests; GET /assignment-requests/:id | Admin, chủ, người nhận; Manager theo HTX hiện tại |
| PATCH /assignment-requests/:id/approve | Farmer thuộc bên còn phải chấp nhận, body {} |
| PATCH /assignment-requests/:id/reject | Chủ/người đề xuất rút lời mời, người nhận từ chối Assign; reason tùy chọn |
| GET /zone-assignments; GET /zone-assignments/:id | Admin/chủ/Manager trong phạm vi; người nhận giữ lịch sử mình |
| GET /zone-assignments/mine | Chỉ lịch sử user hiện tại |
| PATCH /zone-assignments/:id/end | Chủ Farmer trực tiếp; body {} |
| POST /zone-assignments/:id/end-requests | Admin đề xuất End, chủ chấp nhận; body {} |

Danh sách dùng limit1–100, offset0–100000; lịch sử thêm zone_id, lời mời thêm status. Tổng đúng ngay cả offset vượt trang cuối. Business assignment chỉ năm fields id/user_id/zone_id/start_date/end_date. History GET/list thêm snapshot/accepted_at/active/correction_grace_days/correction_deadline như API cũ. Endpoint end trực tiếp vẫn trả AssignmentHistory, không tự thêm fields khác. Không field kỹ thuật/request version lộ qua response; không PATCH raw ngày/người nhận/Zone, không xóa lịch sử.

Input whitelist, UUIDv4 canonical lowercase. ISO8601 phải có timezone, lưu UTC. start_date bỏ trống lấy giờ backend khi đề xuất; end_date null/bỏ trống không định hạn. Ngày kết thúc phải sau max(start_date,giờ đề xuất). 400 input/UUID;403 sai bên/role/inactive;404 ngoài phạm vi;409 overlap/stale/terminal/interval hết hạn;503 lỗi DB/metadata/version. Chữ ký cùng bên đã ghi khi request còn Pending trả403 vì không còn bên cần chấp nhận; request terminal trả409. Không fallback RAM.

## Luồng nhận việc và thu hồi

Chủ đề xuất → chỉ Assignee phải chấp nhận. Admin đề xuất → Owner và Assignee, thứ tự tùy ý; chỉ đủ mới INSERT USERS_ZONES. Admin giao cho chính chủ: một lần chủ chấp nhận điền hai mục đích. Chủ tự giao vẫn có một chấp nhận rõ ràng. Manager/Admin không được nhận việc, Farmer thường không quản lý Zone của người khác.

Mọi lần approve kiểm tra lại proposer Active/đúng role, current owner, các bên Farmer Active và snapshot Zone cho Assign. JSONB không giữ thứ tự key: so sánh từng field whitelist thay vì JSON.stringify snapshot, tránh false conflict khi đọc lại DB. Chủ đổi tên/tiêu chuẩn/diện tích Zone trước nhận việc →409, phải reject/lập lại. Snapshot lúc đã nhận giữ nguyên khi Zone đổi về sau.

start_date bản ghi khi đủ duyệt = max(ngày dự kiến,giờ chấp nhận cuối), không cấp quyền lùi về trước. Request giữ ngày dự kiến. Nếu đã hết end_date thì409, không ghi chữ ký cuối. Khoảng `[start_date,end_date)`; một Zone chỉ một phân công giao nhau, khoảng liền kề được phép, Farmer được nhận nhiều Zone. Pending Assign giao nhau cũng chặn lời mời mới; reject giải phóng. Pending ở đây **có giữ khoảng**, khác Pending tạo Zone vốn không giữ diện tích.

Chủ kết thúc trực tiếp ở giờ server. Admin chỉ đề xuất End, đúng Owner chấp nhận, không cần Assignee chấp nhận thu hồi. Vẫn kết thúc được khi Assignee Locked. Chỉ End khi đang hiệu lực, chưa đến start hoặc đã hết thì409. DB đòi end_date>start_date; nếu kết thúc đúng cùng millisecond bắt đầu thì409, không viết interval rỗng hoặc tự tăng thời gian lên tương lai. Chưa có hủy/đổi lịch phân công đã nhận nhưng chưa bắt đầu. Không tự xóa lời mời End đang Pending khi chủ kết thúc trực tiếp; lời mời đó lỗi thời, có thể reject.

Hết phân công: mất quyền làm việc/live Zone, vẫn xem lịch sử mình. Manager scope dựa HTX hiện tại; Farm Leave mất quyền đọc cả lời mời và lịch sử của Farm. Người nhận không được đọc toàn Farm chỉ nhờ nhận Zone.

Correction dùng assignment_id/zone_id/author_id/created_at từ context event gốc **đã lưu trên server**. Chỉ tác giả, event được tạo trong interval gốc, giờ tạo không ở tương lai; đang hiệu lực hoặc trước đúng end_date+15×24h. Đúng deadline thì hết quyền. Phân công mới không gia hạn lịch sử cũ. Hết phân công không được tạo nhật ký/điều khiển dù còn correction. Chủ có policy nhật ký riêng của Cultivation; không đổi helper phân công để nới quyền.

## Lưu trữ và transaction

public.users_zones giữ năm business fields; technical.entity_metadata entity_type users_zones giữ accepted_at UTC +zone_snapshot cùng version, bảo toàn seed_key/source. technical.workflow_requests module assignments giữ Assign/End, Pending/Accepted/Rejected; target_key là Zone UUID với Assign, assignment UUID với End; requested_by là proposer; expected_version null vì kiểm tra snapshot/chữ ký cụ thể. Payload đúng mười fields zone_id/owner_id/user_id/proposed_role/start_date/end_date/assignment_id/zone_snapshot/required_approvals/rejection_reason. Accepted Assign điền assignment_id vào payload, target_key vẫn Zone. technical metadata assignment_requests giữ version. Không thêm bảng nghiệp vụ/lời mời riêng.

Mapper kiểm tra UUID/time canonical, snapshot đúng shape/Zone/Farm, metadata version>=1 và trong miền số nguyên an toàn; required_approvals đúng số lượng/thứ tự/purpose/user theo proposer/action. Pending không được có resolved fields hoặc đủ mọi chữ ký; Accepted có đủ chữ ký/resolver đúng bên; Rejected chỉ resolver được phép, có thể giữ chữ ký trước đó. Không tự suy ra acceptance từ một dòng USERS_ZONES hoặc default metadata trống. Seed đã được duyệt có accepted_at/snapshot nên đọc được mà không cần bịa lời mời lịch sử.

READ COMMITTED, một client tới COMMIT. Khóa users UUID tăng dần → user metadata cùng thứ tự → HTX hiện tại nếu có → parent Farm → Zone → assignment nếu có → request. Hint chỉ tìm context trước khóa; đọc lại owner/membership/request sau khi đợi. Context đổi → rollback trước khi ghi và retry tối đa4; không retry DB/COMMIT không rõ. Không khóa thêm user sau parent. Parent/Zone locks serialize kiểm tra cả lịch đã nhận lẫn Pending proposals; exclusion constraint001 bảo vệ accepted intervals, partial UNIQUE008 bảo vệ một End Pending (lowercase target). Direct SQL không phải API business writer thay adapter.

Chữ ký cuối +INSERT/End assignment +accepted snapshot/version +request terminal/version +audit cùng transaction. Lỗi audit/version/DB rollback tất cả, không mất chữ ký cũ hoặc lộ quyền sớm. Các event audit: AssignmentRequestCreated/AssignmentApprovalAdded/AssignmentRequestAccepted/AssignmentRequestRejected, AssignmentAccepted/AssignmentEnded; không SMS/email/OTP. Không giữ transaction qua provider/MQTT.

Các loadOnClient/activeOnClient là trusted internal lookups. Domain ghi dữ liệu sau này phải giữ các user/parent locks trên **cùng transaction** tới commit và đọc lại active context ngay khi ghi/thực thi. Gọi helper public rồi chờ lâu hoặc dùng bằng chứng client không bảo đảm quyền vẫn hiệu lực. Không mở transaction repository khác từ trong transaction hiện tại để reacquire cùng user lock.

COMMIT thành công nhưng response mất: đọc lại lời mời/phân công trước khi retry. Không idempotency key cho POST; không tự gửi lại lời mời hoặc gộp signature dựa suy đoán. Request/metadata corrupt trả503 và giữ nguyên dữ liệu, không xóa/reset để chữa.

## Migration và tái lập

008_assignment_workflow chỉ thêm partial UNIQUE Pending End;001–007/source checksums bất biến. Duplicate cũ gồm UUID khác case làm migrate fail/rollback, giữ nguyên rows/ledger; phải đối chiếu, không tự gộp/xóa. Không chạy seed để chữa migration. Demo hiện có container/volume thì Docker Desktop chạy, `docker compose start postgres mongodb`; `npm run db:status` → `npm run db:migrate` → `npm run db:status`. Local Applied status/data hash được ghi ở [bảng tiến độ](BACKEND_PROGRESS_CURRENT.md). Không thay .env, không lấy DB UUID dùng với API RAM.

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

Tám suites dùng random databases sdf_persistence_test_{32hex}, ports15432/27028; chỉ cleanup DB của suite. Không .env/provider thật/MQTT hardware, không down -v hoặc main Compose down. Windows fallback từ apps/api: compile bằng local Node tsc ra .integration-dist, chờ exit0 rồi chạy `node --test --test-concurrency=1` với tám đường dẫn integration trong package.json; backend `node --test --test-concurrency=2 .integration-dist/test`. Lint/typecheck/build theo guide Zone; browser từ apps/web `node test/e2e.mjs`.

Kết quả **232/232 backend,118/118 persistence** (=103 cũ +14 Assignment subcases và wrapper), **8/8 web unit,37/37 browser**; API/web lint/typecheck/build và web formatting đạt. Suite mới bao phủ migration collision/rollback, nhận việc/snapshot, dual/self signatures và cạnh tranh, Pending reservation/adjacency/future/late/expired, snapshot stale, End/Locked recipient, lịch sử/correction gốc/deadline/assignment mới, revoked signature/actor đang chờ lock, Manager Join/Leave/mine-only, strict DTO/canonicalUUID/malformed evidence/version overflow, audit rollback và HTTP fresh app/pool/partial signature/history. Full AppModule process restart và ESP32 thật vẫn là acceptance sau khi hoàn tất adapters phụ thuộc.

Lượt regression đầu có231/232: recovery timeout test dùng35ms thật khiến Reset ban đầu có thể timeout khi máy bận, recovery_task_id chưa được tạo nên test đọc id null. Ba tests Missing Reset ACK/Partial Start timeout/Recovery timeout đã chuyển Date.now và setTimeout sang TestContext mock timers; advance đúng deadline từng bước và await lượt microtask trước bước kế. Giữ đủ assertions Failed/Unknown/không đóng van/không gửi ON/late ACK bị bỏ qua; không đổi production code, ACK10s hoặc quyền đọc task. Full232 sau sửa đạt; DB118/browser37 cũng đạt. Không tăng timeout/sleep để che lỗi.

Local migration008 đã Applied sau khi integration pass, sources001–007 bất biến. Audit count/SHA-25613 business tables +4 technical trước/sau giữ nguyên; ledger chỉ thêm008. Không seed lại, không sửa .env hoặc gửi command thật.

Session sau kế thừa nhánh mới nhất, đọc bảng progress/handoff/AGENTS nếu có. Tiếp Tree/Harvest/Device/Sensor/Actuator PG → telemetry/tasks/Cultivation Mongo → async guards/QR/shared database DI → restart/frontend/hardware acceptance. AI để sau. Mỗi module branch riêng, nguồn riêng giữ nguyên, không stage-all/reset/clean/push/merge. Chỉ hỏi nghiệp vụ mới chưa rõ; không hỏi lại user seed/phone/station/rules đã chốt.
