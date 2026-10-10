# PostgreSQL Users/Auth — adapter và hợp đồng bất đồng bộ

Tiếp nối hiện hành2026-10-10: PG Users/Manager approval và HTX workflow email→SMS/history, async Coop service/scheduler đã hoàn tất trong adapters; **226 backend/51 DB** và checks đạt. [Guide mới nhất](POSTGRES_COOPERATIVE_WORKFLOWS_IMPLEMENTATION.md). AppModule vẫn RAM; HTTP PG/restart dựng riêng Auth/Users/HTX, chưa full backend/hardware. Tiếp catalog/các domain/Mongo, không làm lại Users/HTX. test:persistence hiện bốn suites; phần “session tiếp theo” cũ bên dưới đã được thay trong phạm vi này.

**Tiếp nối hiện hành2026-10-10:** feat/postgres-users-cooperatives từcb2a4d6 đã hoàn tất UserManagement async/email lease và PG registration/Admin approve–reject Manager atomic với HTX; isolated Auth+Users HTTP restart, registry/lifecycle/notifications và migration003 đã kiểm thử. **226 backend/37 DB/8 web/29 browser**, checks đạt. [Guide mới thay phần “session tiếp theo” tương ứng của mốc này](POSTGRES_USERS_COOPERATIVES_IMPLEMENTATION.md). AppModule vẫn RAM; Manager email→SMS edit workflow/scheduler và các domain phụ thuộc còn chưa wiring. Những mô tả UsersService/email “chưa async”, “chưa test HTTP registration/approval” phía dưới chỉ áp dụng mốc cb2a4d6; không áp dụng adapter mới. test:persistence hiện chạy ba suites.

Ngày 2026-10-10. Nhánh **feat/postgres-users-auth**, base **2b6db5f** (persistence foundation). Đọc cùng [thiết kế persistence](PERSISTENCE_DESIGN.md), [migration/seed](PERSISTENCE_FOUNDATION_IMPLEMENTATION.md), [Users](USERS_IMPLEMENTATION.md) và [Auth](AUTH_IMPLEMENTATION.md).

## Phạm vi thực tế

Đã triển khai PostgresUsersRepository cho đọc tài khoản/version, chống trùng phone/email, tạo Farmer/Manager từ dữ liệu đã được service kiểm tra, danh sách Manager Pending và đổi password hash + thu hồi JWT + audit trong cùng transaction. AuthService/Guard hiện dùng hợp đồng async, có adapter memory cùng instance với các module cũ. Auth riêng với repository PostgreSQL đã được kiểm thử HTTP qua hai lần dựng ứng dụng, pool và provider mới.

**AppModule/API chạy bình thường vẫn RAM.** Chưa bật storage database toàn ứng dụng, chưa chuyển UsersService/EmailVerificationService/CooperativesService và những service phân quyền đang dùng MockUserStore. Chưa nghiệm thu đăng ký qua HTTP với proof email và duyệt Manager–HTX bằng PostgreSQL. Không dùng UUID seed để test các API RAM, không chỉ thay Auth provider trong AppModule rồi trộn tài khoản database với Farm/HTX RAM. Đây là adapter Users/Auth của đợt PostgreSQL, chưa phải toàn bộ đợt persistence hoặc demo SMS/hardware thật.

Không có quyết định nghiệp vụ mới cần hỏi trong phần này. Không thêm/sửa .env, dependencies, DTO, route, topic MQTT, schema ERD, migration đã apply hoặc dữ liệu database demo. Migration 001/002 giữ nguyên checksum. Không tự push/merge. Postman cũ tiếp tục dùng cho API hiện tại; không sửa các collection riêng hoặc thêm scripts/environment.

## Source và instance

| File | Vai trò |
|---|---|
| apps/api/src/auth/user-accounts.ts | UserRecord/PublicUser, whitelist response, AccountSnapshot và abstract UserAccounts async |
| apps/api/src/auth/account-identity.ts | Chuẩn hóa email/identity phone dùng chung; login vẫn exact theo phone lưu |
| apps/api/src/auth/mock-user.store.ts | Adapter async trả bản sao; giữ sync methods cho domain chưa chuyển |
| apps/api/src/auth/auth.module.ts | UserAccounts dùng useExisting: MockUserStore; không tạo store thứ hai |
| apps/api/src/auth/auth.service.ts | Await đọc/ghi; recheck sau verify password; OTP gắn token version; không tự mutate user |
| apps/api/src/auth/password.ts | Kiểm tra định dạng scrypt do hệ thống sinh; không đổi format/cost/hash hiện có |
| apps/api/src/persistence/postgres-users.repository.ts | SQL parameterized, mapping, transaction, lỗi an toàn; nhận pool từ bên ngoài |
| apps/api/test/auth-accounts.test.ts | Race snapshot/revoke, OTP version, ghi bị từ chối hoặc lỗi |
| apps/api/integration/users-auth.integration.ts | PostgreSQL thật, unique đồng thời, rollback, metadata hỏng và Auth HTTP restart |

Repository không tự tạo Pool/Nest/DatabaseService hoặc đóng pool của caller. Khi wiring đợt sau, dùng **DatabaseService.postgres** của DatabaseModule đang có. AuthGuard đã await authenticate; không thay contract guard/response. Memory adapter giữ fixture .user/.version và aliases TestUser/UserRole/UserStatus cho tests/domain cũ.

## Dữ liệu và ghi atomic

AccountSnapshot gồm UserRecord và tokenVersion từ cùng một SELECT (user + metadata). Không giữ live object khi await. publicUser chỉ trả các fields hiện có, không password/hash, tokenVersion, entity version, metadata hoặc provenance seed.

Metadata users có entity_type='users', entity_key=UUID dạng string, version >=1 và data.token_version là JSON integer không âm trong miền an toàn của JavaScript. Đây là hai phiên bản khác nhau: version phục vụ concurrency entity; token_version phục vụ thu hồi JWT. Thiếu metadata, token_version kiểu string/âm/vượt miền, hash hỏng hoặc entity version vượt miền: **503**, không mặc định version0 hoặc tái tạo metadata. Phải xác định dữ liệu bị sửa từ đâu; không dùng seed/reset để vượt qua lỗi.

Tạo tài khoản qua createRegisteredUser:

1. Service phải validate DTO, xác minh proof email còn hạn và giữ quyền sử dụng proof trong suốt await transaction. Repository chỉ nhận passwordHash và verifiedEmail nội bộ; không nhận email_verification_token/OTP từ HTTP hay lưu proof.
2. Farmer Active, email có thể null, is_owner=false. Manager bắt buộc verifiedEmail đúng gmail chuẩn hóa, status Pending. Không tạo Admin công khai, không nhận id/status/is_owner/gmail_verify/version từ client.
3. INSERT users → metadata token_version0/entity version1 → audit AccountRegistered → commit cùng PoolClient. UNIQUE database quyết định cuối cùng dù assertAvailable đã pass.
4. Audit chỉ chứa role/status, actor là user vừa tạo; không chứa hash/password/phone/email/OTP/proof. Lỗi bất kỳ rollback cả user/metadata/audit.

**verifiedEmail là đầu vào tin cậy giữa services, không phải bằng chứng được client tự khai.** HTTP registration vẫn dùng store cũ tới đợt wiring Users/email. Không thể gọi consumeForRegistration callback đồng bộ hiện có rồi await SQL: đợt sau phải có lease/state committing để chặn hai lần dùng proof, giữ snapshot proof đúng phone/email và xử lý rollback/timeout không rõ kết quả commit. Kiểm tra proof trước ghi, không trả “đăng ký thất bại” chỉ vì hết hạn sau một commit đã thành công.

Phone đăng ký chống trùng 0/84/+84 qua index hiện có; lookup login giữ nguyên dạng phone đã lưu. Email trim/lowercase/unique khi không null. Trùng phone/email trả409 bằng thông báo hiện có, không trả SQL detail hoặc nội dung trùng. Giới hạn100 users của RAM là giới hạn fixture, không áp thành giới hạn database.

Đổi mật khẩu:

1. Auth đọc snapshot Active, kiểm tra OTP/challenge/token version và giữ busy trong lúc Verify/hash/ghi. Challenge gắn tokenVersion lúc gửi OTP; thay đổi tài khoản làm proof cũ không còn dùng được.
2. Sau khi provider xác minh, đánh dấu consumed và clear trước await hash/DB. Nếu DB lỗi, yêu cầu OTP mới (có cooldown); không phục hồi OTP có thể đã bị provider sử dụng.
3. Repository BEGIN READ COMMITTED, khóa users trước rồi metadata, đọc lại status/version sau khi chờ khóa. Không còn Active/version không đúng: trảfalse và Auth400; không đổi password/version/audit.
4. UPDATE password, tăng entity version, jsonb_set chỉ token_version+1 (giữ seed_key/provenance/metadata khác), append PasswordReset audit, COMMIT. Cả hai counter phải nằm trong miền safe integer. Hai reset dùng cùng expectedTokenVersion chỉ một commit.
5. Token cũ bị từ chối bằng lookup version/status ở mỗi authenticate. User khác giữ version/password. Hash/password không xuất hiện trong audit.

Login recheck snapshot sau scrypt để không ký JWT bằng version/status đã thay đổi. Token cấp trước lần thu hồi tiếp theo sẽ bị guard từ chối; không tuyên bố việc ký JWT và mọi thay đổi database có chung transaction. Pending/Reject login403, Locked/sai password401; JWT không hợp lệ/hết hạn/không Active/version cũ401. Database lỗi503, không fallback RAM. SQL UUID/text audit có explicit casts vì cùng UUID được dùng cho polymorphic entity_key TEXT và actor_id UUID.

## Kiểm thử và tái lập

Từ thư mục gốc:

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d
npm run test:persistence
npm test
npm run lint
npm run typecheck
npm run build
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml down
```

Script test:persistence chạy lần lượt suite foundation và Users/Auth. Test không đọc .env; endpoints/credentials fixture cố định của Compose test tại15432/27028. Mỗi suite tạo database sdf_persistence_test_{32hex}, cleanup chỉ database vừa tạo. Không xóa/reset database smart_durian, Docker volumes hoặc tài khoản demo. HTTP test chỉ dựng AuthModule với UserAccounts override, không khởi động toàn AppModule/hardware/SMS/SMTP thật.

Nếu npm wrapper Windows lỗi, từ apps/api dùng local binaries:

```powershell
node ../../node_modules/typescript/bin/tsc --outDir .integration-dist
node --test --test-concurrency=1 .integration-dist/integration/persistence.integration.js .integration-dist/integration/users-auth.integration.js
node --test --test-concurrency=2 .integration-dist/test
node ../../node_modules/eslint/bin/eslint.js src test integration
node ../../node_modules/typescript/bin/tsc --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
```

Integration coverage: giữ seed UUID/owner/UTC; Farmer/Manager registration rules; phone/email UNIQUE race; reset compare-and-write; rollback khi audit lỗi; thiếu/hỏng metadata/hash; status không Active; DB lỗi không fallback. HTTP reset đồng thời chỉ một thành công; dựng ứng dụng + pool + provider mới vẫn login password mới, JWT trước reset bị401, JWT sau reset còn hạn hợp lệ, email đã verify giữ nguyên, OTP chưa hoàn tất bị400. Đây là restart Auth trong cùng test process với instances mới, chưa phải full backend process/HTTP workflows/ESP32 acceptance.

Kết quả cuối: **221/221 backend tests** (5 mới), **26/26 database integration tests** (foundation16 + Users/Auth10 gồm9 subcases và wrapper), lint/typecheck/build đạt. Một lượt chạy có test ACK cũ dùng timeout150ms trượt khi máy bận; case đã pass khi chạy riêng và trong full221 cuối cùng, không tăng timeout10s production hoặc sửa protocol để làm test pass. Đợt này không sửa test/control logic đó; cần ghi nhận nếu scheduler timing tiếp tục ảnh hưởng. Không chạy lại web suite vì không sửa frontend.

## Session tiếp theo

1. Đọc AGENTS nếu có, git status/branch/log, guide này và thiết kế/foundation/seed. Base là nhánh tích hợp mới nhất, không main cũ. Giữ riêng các ERD/MQTT/Postman/UI đã sửa/xóa; không stage tất cả.
2. Tiếp Users/email + HTX repository. Duyệt Manager Active và tạo/gắn HTX phải cùng transaction, validate Admin/Pending/email verify, một Manager/một HTX, không ghi đè manager hiện có. Không chỉ đổi User status rồi await HTX ghi sau.
3. Chuyển HTX lifecycle created_at/version, đề xuất đã qua xác minh, notification dedup/snapshots và deadline7/30 ngày sang durable repositories; proof email/SMS còn dở phải xác minh lại sau restart. Cần giữ uniqueness certificate theo service hiện có bằng cơ chế concurrency rõ ràng; migration bổ sung nếu cần, không sửa 001 đã apply.
4. Sau đó catalog → Farm/Zone/assignment/Tree/Harvest/IoT metadata, await scope lookups và bỏ direct user mutations khi chuyển. Farm owner flag cập nhật cùng transaction Farm, không sửa live user RAM bên ngoài DB.
5. Chỉ bật mode database khi các adapters cần thiết cùng sẵn sàng; không hướng dẫn người dùng demo một AppModule trộn Auth database và domain RAM. Mongo adapters/FIFO/task allocator/context-chain và nghiệm thu full restart vẫn còn sau PostgreSQL.

Không cần người dùng cấp lại station/phone/cost/date hoặc quyết định nghiệp vụ đã chốt. Khi có rule thực sự chưa rõ, hỏi và chờ trả lời trước code. Không tự push/merge nhánh mới.
