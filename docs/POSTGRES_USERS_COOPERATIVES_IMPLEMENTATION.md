# PostgreSQL Users và danh mục HTX — giao dịch duyệt Manager

**Tiếp nối2026-10-10:** workflow Manager sửa HTX email→SMS/history và CooperativesService/CooperativeRecords async/scheduler đã triển khai trên feat/postgres-cooperative-workflows từ9c328a4, migration004 bổ sung Applied, **226 backend/51 DB** và checks đạt. [Guide mới](POSTGRES_COOPERATIVE_WORKFLOWS_IMPLEMENTATION.md). AppModule vẫn RAM; các mô tả “workflow/service/scheduler chưa chuyển” và bước2/3 Session tiếp theo bên dưới chỉ áp dụng checkpoint9c328a4. Tiếp catalog PG, không triển khai lại Users/HTX. test:persistence hiện bốn suites.

Ngày 2026-10-10. Nhánh **feat/postgres-users-cooperatives**, base **cb2a4d6** của feat/postgres-users-auth. Đọc cùng [bàn giao](MODULE_HANDOFF.md), [Users/Auth adapter](POSTGRES_USERS_AUTH_IMPLEMENTATION.md), [foundation](PERSISTENCE_FOUNDATION_IMPLEMENTATION.md), [thiết kế persistence](PERSISTENCE_DESIGN.md) và [báo cáo rà soát](PROJECT_REVIEW_20261010.md).

## Phạm vi đã làm và giới hạn

UsersService và EmailVerificationService dùng hợp đồng UserManagement bất đồng bộ. Có adapter memory dùng đúng MockUserStore/MockCooperativeStore hiện có, và adapter PostgreSQL cho đăng ký, danh sách Manager Pending, duyệt/từ chối và đọc danh mục HTX. PostgreSQL giữ User Active + tạo/gắn HTX + metadata/version + audit trong cùng transaction. Đã kiểm thử luồng Auth/Users HTTP với database qua hai lần dựng ứng dụng/pool/provider mới.

PostgresCooperativesRepository có danh mục Admin tạo/sửa, quyền đọc, created_at/version bền vững và vòng đời HTX chưa có Manager: cảnh báo sau 7 ngày, xem xét xóa sau 30 ngày, chặn xóa khi còn tham chiếu, lưu thông báo dedup/snapshot và audit.

**AppModule chạy bình thường vẫn RAM.** Chưa bật chế độ database toàn backend. CooperativesService, đề xuất sửa của Manager qua email rồi SMS, lịch sử workflow và scheduler production chưa chuyển sang adapter PostgreSQL. HTTP integration chỉ override UserAccounts và UserManagement trong ứng dụng AuthModule + UsersModule riêng; không trộn Auth database với Farm/Zone/HTX memory của AppModule. Không dùng UUID seed với HTTP RAM. Không có route mới, thay đổi DTO/Postman hoặc khóa .env mới.

## Source và instance dùng chung

| Source | Trách nhiệm |
|---|---|
| apps/api/src/users/user-management.ts | Hợp đồng async cho đăng ký/duyệt Manager |
| apps/api/src/users/memory-user-management.ts | Dùng các store memory hiện có, giữ ghi User/HTX đồng bộ trong adapter |
| apps/api/src/users/users.module.ts | Factory nhận đúng shared stores; export UserManagement, không tạo Map thứ hai |
| apps/api/src/users/users.service.ts | Validate DTO, hash, giữ proof, await adapter; không tự đổi status User |
| apps/api/src/users/email/email-verification.service.ts | Lease proof email với trạng thái committing |
| apps/api/src/persistence/postgres-user-management.ts | Nối Users và HTX repositories cùng pool do caller cung cấp |
| apps/api/src/persistence/postgres-users.repository.ts | loadOnClient đọc snapshot trên client transaction đang dùng |
| apps/api/src/persistence/postgres-cooperatives.repository.ts | Registry, duyệt Manager, lifecycle/notifications trong PostgreSQL |
| apps/api/src/cooperatives/cooperative-lifecycle.ts | Hằng số 7/30 ngày dùng chung RAM/PostgreSQL |
| apps/api/src/persistence/cooperative-schema.ts | Migration bổ sung 003, certificate_number unique |
| apps/api/test/registration-lease.test.ts | 5 kiểm thử lease/replay/rollback/expiry/restart |
| apps/api/integration/users-cooperatives.integration.ts | Database thật, concurrency/rollback/HTTP restart/lifecycle |

Các repositories nhận Pool từ caller; không tự tạo/đóng pool, Nest module, timer hoặc gửi SMS/email/MQTT. Khi chuyển AppModule, dùng DatabaseService.postgres duy nhất của DatabaseModule và cùng repository instance cho mọi scope lookup. Không chỉ đổi Auth provider rồi để các module khác đọc MockUserStore.

## Đăng ký và lease email

Farmer đăng ký Active, email không bắt buộc; Manager cần email thật đã verify, đăng ký Pending; Admin không đăng ký công khai. verifiedEmail là kết quả nội bộ từ EmailVerificationService, không phải trường client tự khai. Định dạng response/phone/email/password giữ nguyên.

1. Validate/preflight rồi hash password. Kiểm tra proof **sau hash**, trước khi bắt đầu ghi; proof hết hạn không tạo tài khoản.
2. Đánh dấu challenge committing trước await adapter. Trong thời gian này không cho replay/resend và không cleanup challenge đang ghi, kể cả khi deadline trôi qua.
3. PostgreSQL ghi account + token/entity metadata + audit atomic; constraints quyết định kết quả cuối cùng sau preflight.
4. Commit thành công consume proof, không kiểm tra deadline lại và trả lỗi sau khi tài khoản đã tồn tại.
5. Lỗi xác định 400/409/429 trước khi ghi thành công: giải phóng lease nếu proof còn hạn; có thể thử lại theo quy tắc hiện có. Lỗi không xác định/503: consume proof vì không chắc commit đã xảy ra; yêu cầu xác minh mới, không tự retry cùng proof.
6. Proof/challenge chưa hoàn tất chỉ ở RAM; restart mất proof. Tài khoản đã verify, status và mật khẩu đã commit vẫn giữ trong database.

consumeForRegistration đồng bộ còn để tương thích kiểm thử cũ; UsersService thực tế dùng consumeForRegistrationAsync. Không dùng callback đồng bộ để khởi chạy SQL rồi bỏ await. Audit không lưu password/hash/OTP/proof/phone/email.

## Duyệt Manager và concurrency

Admin phải Active; target phải Manager Pending có email đã xác minh. Chọn đúng một cooperative_id hoặc nội dung HTX mới. Không ghi đè Manager đang có; một Manager chỉ quản lý một HTX. Reject chỉ đổi Pending sang Reject, không tạo HTX.

Thứ tự khóa: User UUID sắp tăng dần → metadata User → HTX → metadata HTX. Sau khi đợi lock, đọc lại quyền, status, email và manager_id. Duyệt ghi status Active, tăng token_version/entity version, tạo/gắn HTX và append audit trên **cùng PoolClient**. Nếu audit hay bất kỳ câu SQL nào lỗi, rollback tất cả. Không để User Active nhưng không có HTX, hoặc HTX gắn Manager vẫn Pending.

Race giữa hai Admin duyệt cùng Manager/HTX, approve với reject, và tạo HTX cùng số chứng nhận được kiểm thử bằng database thật. Chỉ một transaction thắng; bên thua giữ trạng thái hợp lệ. Unique certificate/manager trả 409; lỗi dữ liệu/driver khác trả 503 an toàn, không fallback RAM. Metadata thiếu/hỏng không tự dựng lại created_at/version vì sẽ làm sai deadline và concurrency.

## Danh mục và vòng đời HTX

Admin tạo HTX chưa có Manager và sửa năm trường hiện hành; không nhận manager_id từ JSON tạo/sửa. Manager đọc HTX mình; HTX khác trả 404. Farmer/Admin đọc danh mục theo quyền hiện hành. Public response chỉ có các fields HTX; metadata/version là hợp đồng nội bộ.

created_at lưu UTC ISO canonical trong technical.entity_metadata ngay khi tạo, version bắt đầu 1. Sửa/gắn Manager tăng version an toàn, giữ metadata khác. Sau restart, không tính lại tuổi HTX từ lúc khởi động.

sweep(adminId) là hook cho scheduler sau này, nhận Admin context nội bộ và clock backend; chưa boot-wire job database. Hook khóa từng HTX theo UUID, đọc lại Manager/deadline sau khi chờ, cảnh báo 7 ngày, xét xóa 30 ngày. Gắn Manager trước thì sweep bỏ qua; sweep xóa trước thì approve không kích hoạt Manager.

Chặn xóa khi còn Farm, workflow của HTX hoặc payload cooperative_id/farm_snapshot.cooperative_id, hoặc notification của module khác tham chiếu HTX. Kiểm tra cả workflow đã kết thúc để giữ lịch sử. Cảnh báo riêng của lifecycle không tự chặn xóa. Dedup theo HTX/type; snapshot tên/ID/deadline và audit còn sau khi HTX bị xóa.

**Yêu cầu cho repositories tiếp theo:** khi tạo/sửa Farm hoặc workflow tham chiếu HTX, phải khóa HTX cha trước khi ghi tham chiếu và tuân thủ cùng thứ tự khóa. FK Farm bảo vệ tham chiếu cố định; JSONB đa hình không có FK. Không tuyên bố mọi raw SQL/workflow tương lai đã chống race chỉ nhờ kiểm tra sweep. Quy trình này phải có integration race test khi chuyển từng module.

## Migration 003 và database local

Migration 003_cooperative_certificate thêm UNIQUE index cooperatives_certificate_number, giữ so sánh chính xác như service RAM hiện có. Không sửa SQL/checksum 001/002 đã apply; không cập nhật seed, đổi UUID hoặc xóa dữ liệu để vượt migration.

Nếu database cũ trùng certificate_number, migration 003 thất bại và rollback, ledger không đánh dấu Applied. Xác định các bản ghi trùng để trao đổi cách xử lý nghiệp vụ; không tự đổi số chứng nhận hoặc xóa dòng. Test lỗi này chỉ tạo/xóa fixture trong database test riêng.

Local ngày 2026-10-10: 001/002 đã Applied; chạy db:migrate thêm 003, status cả ba Applied. Chỉ thêm index, không chạy lại seed hay ghi đè dữ liệu demo. .env giữ nguyên. Không push/merge.

## Kiểm thử và tái lập

Từ repository root, Docker Desktop đang chạy:

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d
npm run test:persistence
npm test
npm run lint
npm run typecheck
npm run build
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml down
```

test:persistence hiện chạy ba suites foundation, Users/Auth, Users/HTX tuần tự. Endpoints fixture 15432/27028; không đọc .env, không dùng smart_durian demo DB. Mỗi suite tạo database sdf_persistence_test_{32hex}, cleanup chỉ database đó. Không thêm -v vào Compose down.

Nếu npm wrapper Windows lỗi, từ apps/api:

```powershell
node ../../node_modules/typescript/bin/tsc --outDir .integration-dist
node --test --test-concurrency=1 .integration-dist/integration/persistence.integration.js .integration-dist/integration/users-auth.integration.js .integration-dist/integration/users-cooperatives.integration.js
node --test --test-concurrency=2 .integration-dist/test
node ../../node_modules/eslint/bin/eslint.js src test integration
node ../../node_modules/typescript/bin/tsc --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
```

Kiểm tra database demo bằng CLI riêng, không cùng fixture DB:

```powershell
npm run db:status
npm run db:migrate
npm run db:status
```

Kết quả: **226/226 backend tests**, **37/37 database tests** (16 foundation +10 Users/Auth +11 Users/HTX gồm wrapper). Lint/typecheck/build đạt. Integration bao gồm unique race, audit rollback, real HTTP registration/approval sau dựng ứng dụng mới, email proof mất khi restart, 7/30 ngày/dedup/blocked deletion và sweep–approval race. Các suite dùng email capture/mock OTP/MQTT local; chưa nghiệm thu SMS/ESP32 thật hoặc full-process restart.

Test ACK cũ dùng wall-clock 80/150ms được đổi sang mock Date.now/setTimeout: mỗi bước nhận ACK sau 80ms giả lập, tổng 240ms nhưng timeout được reset từng bước. Không đổi timeout 10 giây, điều khiển hardware hoặc MQTT protocol production.

## Session tiếp theo

1. Đọc AGENTS nếu có, git status/branch/log và handoff; kế thừa nhánh này, giữ riêng mọi ERD/MQTT/Postman/UI sửa/xóa chưa commit.
2. Chuyển workflow sửa HTX của Manager sang technical.workflow_requests + audit/version/history; proof email/SMS chưa xong vẫn RAM và yêu cầu verify lại sau restart. Giữ thứ tự email rồi phone, phạm vi fields và quyền duyệt hiện có; có thắc mắc nghiệp vụ mới thì hỏi trước.
3. Wiring CooperativesService/scheduler qua hợp đồng async cùng repositories, test restart/race/notifications. Chưa bật database toàn AppModule khi Farm/catalog/domain khác còn đọc memory.
4. Catalog → Farm/Zone/assignment/Tree/Harvest/IoT metadata → Mongo telemetry/control/cultivation → DI toàn ứng dụng, process restart và demo hardware thật. AI để sau. Mỗi đợt branch riêng, docs/comments cho logic khó, staging tường minh và không tự push/merge.
