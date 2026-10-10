# PostgreSQL workflow sửa HTX — email rồi SMS, lịch sử và scheduler

Ngày 2026-10-10. Nhánh **feat/postgres-cooperative-workflows**, base **9c328a4**. Kế thừa Users/Auth và registry/lifecycle HTX PostgreSQL đã hoàn tất; không triển khai lại các module đó. Đọc [handoff](MODULE_HANDOFF.md), [đợt Users/HTX trước](POSTGRES_USERS_COOPERATIVES_IMPLEMENTATION.md), [nghiệp vụ/API HTX](COOPERATIVES_IMPLEMENTATION.md), [thiết kế persistence](PERSISTENCE_DESIGN.md) và [foundation](PERSISTENCE_FOUNDATION_IMPLEMENTATION.md).

## Phạm vi thực tế

CooperativesService dùng UserAccounts + CooperativeRecords bất đồng bộ. MemoryCooperativeRecords nhận đúng MockUserStore, MockCooperativeStore và FarmsService đang dùng chung; chỉ chuyển ownership của Maps workflow/notification từ service sang adapter, không tạo registry thứ hai. Service giữ phiên OTP, cooldown, attempts và khóa thao tác trong RAM.

PostgresCooperativeRecords lưu nội dung/trạng thái/version/lịch sử vào technical.workflow_requests và technical.audit_events, sử dụng đúng PostgresCooperativesRepository của Users approval và cùng Pool. Commit Manager sửa HTX gồm dữ liệu HTX + entity version + request Accepted + audit trong một transaction. Registry/lifecycle/notifications đợt trước được dùng lại. Có seam CooperativesModule.forRecords để kiểm thử/wiring repository; worker async chạy bootstrap và mỗi 60 giây, coalesce các sweep đồng thời, catch lỗi nền và kiểm tra lại chu kỳ sau.

**AppModule chạy bình thường vẫn dùng memory adapter.** Chưa bật chế độ database toàn backend khi Farm/catalog/Zone và các domain khác còn RAM. Isolated integration dựng AuthModule + UsersModule + CooperativesModule với PostgreSQL, không dựng toàn AppModule và không nối hardware. Không dùng UUID seed với HTTP RAM. HTTP routes/DTO/response fields/Postman không đổi; không thêm khóa .env.

Phạm vi OTP đợt này là **một process backend**. Khi bật database runtime sau này phải giữ cấu hình này; session OTP/rate-limit chưa có điều phối nhiều replica. PostgreSQL locks/indexes bảo vệ ghi đồng thời, nhưng không có nghĩa OTP đã hỗ trợ chạy nhiều process cùng lúc. Không bật nhiều instances: bootstrap một instance mới sẽ kết thúc các request chưa hoàn tất của session cũ.

## Các quyết định giữ nguyên

- Admin Active tạo/sửa HTX trực tiếp, gồm certificate_number; gắn Manager chỉ qua USERS approve atomic như đợt trước.
- Manager Active của HTX chỉ đề xuất cooperative_name, director, address, contact_number. Nội dung cố định; muốn đổi phải hủy/tạo lại. Không sửa chứng nhận hoặc Manager.
- Xác minh email tài khoản trước, SMS tới phone_number tài khoản sau; không dùng contact_number mới của HTX làm nơi nhận OTP.
- Email OTP 10 phút; email đúng cấp thêm 10 phút để bắt đầu SMS; SMS có cửa sổ riêng 5 phút. Năm lần nhập sai, cooldown 60 giây, không tự retry provider.
- Trước khi ghi chính thức, recheck Active/Manager/scope, identity, token_version, phiên bản HTX, trạng thái/revision request và deadline. Reset mật khẩu/thu hồi phiên hoặc Admin sửa HTX làm request cũ thất bại; không ghi đè thay đổi mới.
- Restart giữ nội dung đã commit và toàn bộ đề xuất/lịch sử. Phiên xác minh chưa hoàn tất trở thành Expired, giữ proposed_changes và dấu thời gian lịch sử; tạo request mới và xác minh từ đầu. Không reset gmail_verify hoặc password User đã lưu.
- Farmer đọc danh bạ HTX, không đọc request Manager; Admin đọc mọi request, Manager chỉ đọc request mình. Chỉ Manager gửi request được verify/cancel. Accepted không sửa/hủy/replay.

## Source và ownership

| Source | Trách nhiệm |
|---|---|
| apps/api/src/cooperatives/cooperative-records.ts | Hợp đồng async, dữ liệu workflow không chứa OTP, whitelist changes và state transitions |
| apps/api/src/cooperatives/memory-cooperative-records.ts | Adapter RAM dùng shared stores, quy tắc lifecycle/notification như cũ |
| apps/api/src/cooperatives/cooperatives.service.ts | Điều phối email→SMS, chứng cứ RAM, thao tác exclusive, worker async |
| apps/api/src/cooperatives/cooperatives.module.ts | forMock giữ normal runtime; forRecords nhận provider cùng registry/pool |
| apps/api/src/cooperatives/cooperatives.types.ts | Public request giữ nguyên; revision/sessionId/smsActive chỉ nội bộ |
| apps/api/src/persistence/postgres-cooperative-records.ts | SQL workflow, CAS, atomic apply/audit, expiry/restart, mapping và lỗi an toàn |
| apps/api/src/persistence/postgres-cooperatives.repository.ts | Shared transaction/lock hooks và scheduled lifecycle dùng lại registry |
| apps/api/src/persistence/cooperative-workflow-schema.ts | Migration004 partial UNIQUE active request theo Manager |
| apps/api/integration/cooperative-workflows.integration.ts | PostgreSQL/HTTP fixture, rollback/races/restart/unknown outcomes |
| apps/api/test/cooperatives.test.ts | Giữ 14 business tests, await API async và signals provider thay timing assumptions |

Không repository nào tự tạo Pool, database connection, Nest store hoặc gửi email/SMS. Khi wiring toàn ứng dụng, factory dùng **DatabaseService.postgres**, PostgresUsersRepository và PostgresCooperativesRepository cùng instance với PostgresUserManagement. Không thêm adapter PG song song với một registry HTX khác trong cùng request flow.

## Dữ liệu lưu và dữ liệu không lưu

workflow_requests dùng module='cooperatives', action='ManagerUpdate'; id UUID, target_key=HTX UUID, requested_by=Manager, expected_version=HTX version, status/created_at/resolved_at/resolved_by. Payload whitelist:

```json
{
  "cooperative_id": "<HTX UUID>",
  "proposed_changes": { "address": "Địa chỉ đề xuất" },
  "expires_at": "<UTC ISO>",
  "email_verified_at": null,
  "token_version": 1,
  "revision": 1,
  "session_id": "<UUID phiên backend>"
}
```

session_id là dấu nhận biết lần chạy backend, không token xác thực và không public. revision tăng mỗi lần đổi trạng thái; expected_version giữ phiên bản HTX lúc đề xuất. Token version khác entity version, không gộp. Bốn fields proposed_changes được kiểm tra tên/kiểu/giới hạn khi mapping; metadata hỏng trả 503, không fallback RAM hoặc tự dựng lại.

Không lưu OTP, salt/digest, Twilio proof/SID, account email/phone, password/hash hoặc các counters/cooldown OTP vào workflow/audit. Service giữ những dữ liệu phiên cần thiết trong RAM và xóa khi Accepted/Cancelled/Failed/Expired/shutdown. Public request chỉ trả fields hợp đồng cũ, không revision/session/version/private evidence. Đã kiểm thử whitelist cả database và HTTP response.

Audit append cùng transaction; Requested, Transition, Accepted và Expired ghi trạng thái/fields/request ID, không chứng cứ OTP. Chấp thuận có resolved_by=Manager. Expiry/restart là sự kiện backend, resolved_by=null, audit dùng requested_by làm ngữ cảnh chủ request và payload reason=Deadline hoặc BackendRestart; không diễn giải thành Manager tự thực hiện thao tác Expired. HTX lifecycle dùng Admin Active chọn nội bộ làm audit actor; nếu không có Admin Active, job không tự xóa HTX thiếu audit context hợp lệ. Không có API cho client tự chọn actor/clock của job.

## Ghi atomic và xử lý race

Thứ tự khóa chung: User → metadata User → HTX → metadata HTX → workflow request. Callback dùng cùng PoolClient với registry; không pool.query chen trong transaction. Đọc lại context sau khi chờ lock. SQL dùng placeholders; không ghép ID/body client vào câu lệnh.

Insert kiểm tra một active request dưới User lock; index004 bảo vệ uniqueness ở database. Save các bước xác minh/Accepted dùng revision + session/context đúng, không lấy status/verified flags từ body. Accepted chỉ sau SmsChecking với email_verified_at đã có; ghi bốn fields HTX, tăng entity version, chốt request/audit và commit cùng nhau. Lỗi ở audit rollback mọi thay đổi trong transaction đó.

Deadline kiểm tra lại **sau khi đợi khóa**: không dựa vào lần service đọc trước await. Provider đợi cũng có thể bị expiry, Admin edit, token revocation; kết quả về muộn không ghi HTX.

Expiry/restart cũng lấy User/HTX locks trước request. Nếu khóa request trước rồi append audit có FK User, có thể đảo thứ tự với approve/apply và gây deadlock. Cleanup recheck terminal state dưới lock; Accepted thắng trước thì cleanup bỏ qua. Các requests/history tham chiếu HTX vẫn chặn lifecycle xóa, kể cả đã kết thúc.

Các writers Farm/workflow ở đợt tiếp phải khóa HTX cha trước khi tạo tham chiếu và tuân thủ thứ tự khóa. JSONB đa hình chưa có FK; không tuyên bố arbitrary raw SQL đã được bảo vệ chỉ vì sweep kiểm tra các references.

## Lỗi mạng, retry và proof cleanup

- Provider gửi/check lỗi hoặc kết quả chưa rõ: clear chứng cứ, chốt Failed nếu database còn truy cập được; không retry cùng proof.
- Mất response sau commit bước trung gian: revision cache có thể cũ. Chỉ cho cleanup Failed/Expired cùng session/context đọc trạng thái mới nhất dưới lock và giữ nội dung authoritative; không nới CAS cho bước áp dụng HTX.
- Mất response sau commit Accepted: API có thể trả 503 nhưng record đã Accepted. Cleanup không đổi terminal Accepted sang Failed. Client đọc GET request/HTX để đối chiếu; không tự gửi lại SMS Verify hoặc tạo đề xuất giống hệt trước khi đối chiếu.
- Database vẫn không truy cập được thì chưa thể ghi Failed; phiên OTP vẫn bị loại bỏ, các thao tác trả 503. Khi DB hoạt động lại, đọc để đối chiếu, expiry hoặc restart sẽ chốt active request; không giả báo đã lưu Failed thành công.
- Cleanup proof là idempotent. Clear SMS của phiên cũ chỉ một lần; response/cleanup cũ đến trễ không được clear OTP của request mới cùng phone sau khi slot cũ giải phóng. Chứng cứ HTX vẫn tách khỏi provider reset mật khẩu.

## Migration004 và local demo

004_cooperative_workflow thêm partial UNIQUE(requested_by) trong workflow_requests cho module/action HTX và sáu status active: EmailPending, EmailSending, EmailVerified, SmsSending, SmsPending, SmsChecking. Accepted/Cancelled/Expired/Failed vẫn giữ lịch sử và giải phóng slot. Không thêm bảng nghiệp vụ, không sửa migrations001–003/checksum đã Applied.

Nếu database cũ có hai active request cùng Manager, migration thất bại/rollback và ledger chưa Applied. Cần đối chiếu dữ liệu và thống nhất cách chốt requests, không tự xóa/gộp record. Integration test tình huống này chỉ xử lý các dòng fixture mình tạo trong database test riêng.

Local2026-10-10: 001–003 Applied, chạy migrate thêm004, status cả bốn Applied. Chỉ thêm index, không seed lại, không đổi .env, UUID hoặc dữ liệu demo. Module không cần cấu hình mới; TWILIO_HTX_VERIFY_SERVICE_SID/HTX_SMS_ALLOWED_PHONES và SMTP hiện có tiếp tục dùng. Không gửi tin hoặc lệnh hardware thật khi migration/test.

Tái lập cập nhật database demo từ root, sau build backend:

```powershell
npm run db:status
npm run db:migrate
npm run db:status
```

Fallback từ apps/api: node dist/persistence/cli.js status, node dist/persistence/cli.js migrate, rồi status lại. Không chạy db:seed để xử lý lỗi migration hoặc đổi dữ liệu đang có. Factory ứng dụng PostgreSQL kiểm thử nằm ngay đầu integration/cooperative-workflows.integration.ts, thể hiện chính xác các repositories cùng pool và provider overrides; dùng để đọc/tái lập fixture, không copy thành chế độ AppModule nửa database/nửa memory.

## API và thao tác Postman

Giữ nguyên endpoints trong [guide HTX](COOPERATIVES_IMPLEMENTATION.md); import JSON trực tiếp, copy JWT/UUID/OTP bằng tay. Dùng các UUID của API RAM khi chạy AppModule hiện tại; không copy UUID seed PostgreSQL vào đó. Không scripts/environment mới.

Luồng: Manager POST /api/cooperatives/:id/update-requests → lấy request.id → POST /email/verify với OTP email → POST /sms/send với {} → POST /sms/verify với OTP SMS → đọc request Accepted + HTX đã cập nhật. Các bước dưới /api/cooperative-update-requests/:id. Chỉ mock mới GET /test-sms; live trả404. OTP đăng ký/reset/HTX riêng biệt. JWT hết hạn thì login lại, dán JWT mới, tiếp tục nếu request còn hạn và token version không đổi.

Không có endpoint tự đánh dấu Accepted/email_verified/phone_verified hoặc chọn đề xuất khác sau khi đã xác minh. GET/list/worker có thể chốt Expired theo clock backend. Người dùng thấy request cũ Expired sau restart và vẫn đọc được proposed_changes; lập request mới để xác minh lại.

## Kiểm thử và tái lập

Từ root, Docker Desktop đang chạy:

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d
npm run test:persistence
npm test
npm run lint
npm run typecheck
npm run build
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml down
```

test:persistence chạy **bốn suites** tuần tự. Ports15432/27028, credentials fixture cố định, không đọc .env; tạo database sdf_persistence_test_{32hex} rồi cleanup chỉ database đó. Không down Compose demo, không -v/reset/clean. HTTP fixtures dùng capture email/mock SMS, không AppModule/hardware/Twilio thật.

Fallback Windows, từ apps/api:

```powershell
node ../../node_modules/typescript/bin/tsc --outDir .integration-dist
node --test --test-concurrency=1 .integration-dist/integration/persistence.integration.js .integration-dist/integration/users-auth.integration.js .integration-dist/integration/users-cooperatives.integration.js .integration-dist/integration/cooperative-workflows.integration.js
node --test --test-concurrency=2 .integration-dist/test
node ../../node_modules/eslint/bin/eslint.js src test integration
node ../../node_modules/typescript/bin/tsc --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
```

Kết quả cuối: **226/226 backend**, **51/51 persistence** (=37 suites trước +14 workflow gồm13 subcases và wrapper), **29/29 browser**, backend lint/typecheck/build đạt. Có real HTTP/scopes/whitelist, uniqueness race, provider waits/exclusive, Admin edit/revocation, audit rollback, commit response mất ở bước cuối/trung gian, cleanup phiên cũ vs OTP mới, fresh app/pool/providers restart, timeout sau row lock, scheduler/dedup/reference blocking và malformed metadata. Kiểm thử runtime memory HTX cũ giữ14/14; provider signals thay giả định rằng method async đã bắt đầu gửi ngay sau khi gọi. Browser runner dùng API/MQTT/Vite/Chromium fixture local, không .env/broker thật; từ root npm run test:web:e2e hoặc từ apps/web node test/e2e.mjs.

Đây là dựng lại instances/pool trong process test và database thật, chưa full-process restart acceptance toàn backend/ESP32/Twilio/SMTP thật. Không đổi MQTT/ACK10s/firmware, không frontend changes. .env và các source ERD/MQTT/Postman/UI riêng giữ nguyên, chỉ stage files của đợt này; commit local, không tự push/merge.

## Session tiếp theo

1. Đọc AGENTS nếu có; git status/branch/log; guide này + handoff + persistence design/foundation. Base là nhánh tích hợp mới nhất, không main cũ. Không làm lại Users/HTX/workflow đã hoàn tất.
2. **Catalog PostgreSQL đã tiếp nối** trên feat/postgres-catalogs từ007834f: [guide hiện hành](POSTGRES_CATALOGS_IMPLEMENTATION.md). Giữ tên/code được trùng, bridge composite PK/Inactive, default_dosage chuỗi và shared adapters; không cần migration mới. Không triển khai lại catalogs; phần tiếp theo là Farm persistence.
3. Farm → Zone → assignments → Tree/Harvest → IoT metadata; đặc biệt parent locks/sum area, [start,end), assignment context/grace, batch Zone/ngày và everConfirmed. Sau đó Mongo telemetry/tasks/cultivation/context/head.
4. Wiring database toàn AppModule khi mọi domain/read scopes đã chuyển, seed IDs dùng HTTP database, full-process restart/retention/chain checks và hardware thật; sau đó nối frontend database demo. AI để sau. Quyết định đã chốt không hỏi lại; có nghiệp vụ mới chưa rõ thì dừng hỏi và chờ người dùng.
