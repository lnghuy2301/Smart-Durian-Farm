# PostgreSQL catalogs — vật tư, tiêu chuẩn và liên kết

Ngày 2026-10-10. Nhánh **feat/postgres-catalogs**, base **007834f** (HTX workflow đã hoàn tất). Đọc cùng [handoff](MODULE_HANDOFF.md), [thiết kế persistence](PERSISTENCE_DESIGN.md), [foundation](PERSISTENCE_FOUNDATION_IMPLEMENTATION.md), [HTX workflow](POSTGRES_COOPERATIVE_WORKFLOWS_IMPLEMENTATION.md) và ba guides nghiệp vụ Materials/Standards/Standard Materials.

## Phạm vi thực tế

Đã bổ sung PostgreSQL repository và async contracts cho AGRICULTURAL_MATERIALS, FARMING_STANDARDS, STANDARD_MATERIALS, cùng kiểm thử HTTP/database cô lập. Không đổi schema/ERD, không có migration005: migrations001–004 đã đủ constraints của đợt này và giữ nguyên checksum. Không seed/migrate lại database demo; dữ liệu kiểm thử nằm trong database ngẫu nhiên riêng.

**AppModule thông thường vẫn RAM.** Async HTTP ports đã được nối với adapters dùng đúng MaterialsService/StandardsService/StandardMaterialsService hiện có. Zone, Cultivation và Traceability còn gọi các services RAM đồng bộ. Chỉ factory trong `apps/api/integration/catalogs.integration.ts` override ba ports và UserAccounts bằng PostgreSQL; factory chỉ khởi động Auth + catalogs, không AppModule, scheduler, MQTT hoặc các domain khác. Chưa có cờ môi trường bật chế độ database hoàn chỉnh. Không gắn PostgreSQL catalogs vào AppModule trong khi Zone/Cultivation còn đọc RAM; việc chuyển lookup nội bộ sẽ đi cùng adapters của các domain đó.

Các yêu cầu POST/PATCH/GET/DELETE bridge không đổi body/URL/response. Kiểm thử khởi tạo lại app/pool chứng minh dữ liệu danh mục/bridge giữ trong database thật; chưa phải acceptance restart toàn process/backend/hardware. Không có gửi SMS/email/lệnh ESP32 trong đợt này. OTP và luồng HTX không đổi.

## Quy tắc được giữ

- Admin Active tạo/sửa vật tư, tiêu chuẩn, thêm/bỏ bridge; mọi tài khoản Active được đọc. Farmer/Manager không được ghi. Actor lấy từ JWT đã authenticate, không nhận `created_by`/`updated_by` hoặc quyền từ body.
- Vật tư giữ name, material_type (`Fertilizer/Pesticide/Biological`), default_dosage, unit, quarantine_days và status (`Active/Inactive`). Quarantine là integer 0..2147483647. Default dosage là chuỗi, không chuyển thành decimal/liều số. Unit vật tư vẫn chuỗi tối đa10 ký tự; quy định dropdown unit của sensor không áp dụng sang đây.
- Tiêu chuẩn giữ code/name/description/certifying_body/status, description được rỗng nhưng không null; API giới hạn10000 ký tự. Code/tên tiêu chuẩn và tên vật tư **được phép trùng**, theo ERD và API cũ; UUID quyết định identity. Không thêm UNIQUE code/name.
- Tạo mặc định Active. PATCH chỉ sửa fields đã gửi, từ chối null/extra fields/PATCH rỗng. Gửi lại cùng giá trị hợp lệ vẫn thành công như service RAM cũ; một PATCH thành công tăng version và thêm audit. Không hard-delete hai danh mục; dùng Inactive.
- Bridge chỉ có standard_id/material_id, composite PK đã bảo vệ duy nhất cặp. Cho cấu hình cả khi một/both danh mục Inactive; không tự bỏ bridge khi Inactive. N:N: vật tư được thuộc nhiều tiêu chuẩn. DELETE chỉ bỏ bridge, không xóa catalog hoặc thay snapshot canh tác.
- Quy tắc tiêu chuẩn Active khi gắn mới Zone và vật tư Active khi ghi Cultivation giữ tại các nghiệp vụ đó; không chuyển thành điều kiện thêm bridge.

## API, response và Postman

| Endpoint | Quyền | Nội dung |
|---|---|---|
| POST /api/materials | Admin Active | CreateMaterialDto; 201 record gồm đúng fields ERD |
| PATCH /api/materials/:id | Admin Active | UpdateMaterialDto; 200 record |
| GET /api/materials, GET /api/materials/:id | User Active | MaterialListDto hoặc UUID; 200 |
| POST /api/standards | Admin Active | CreateStandardDto; 201 record |
| PATCH /api/standards/:id | Admin Active | UpdateStandardDto; 200 record |
| GET /api/standards, GET /api/standards/:id | User Active | StandardListDto hoặc UUID; 200 |
| POST /api/standards/:standard_id/materials | Admin Active | `{ "material_id": "UUID" }`; 201 đúng hai FK |
| GET /api/standards/:standard_id/materials | User Active | MaterialListDto; 200 page có standard_id |
| DELETE /api/standards/:standard_id/materials/:material_id | Admin Active | 204, không body |

Page gồm items/total/limit/offset. Limit mặc định20, 1..100; offset mặc định0, 0..100000. Query q tối đa100 ký tự, tìm substring không phân biệt hoa/thường, vẫn phân biệt dấu. Material tìm tên, standard tìm tên hoặc code. `status` trong bridge query lọc **status vật tư**, không phải tiêu chuẩn. Không filter status thì gồm Inactive. SQL dùng strpos và parameters nên %, _, dấu nháy là ký tự literal; không thành wildcard/SQL. Total và page cùng một SQL snapshot, offset quá cuối trả items=[] và total đúng. PostgreSQL sắp xếp UUID tăng dần để pagination ổn định; RAM vẫn theo thứ tự thêm. API trước chưa cam kết thứ tự, không có field sort mới. Khi dữ liệu thay đổi giữa hai lần gọi page, client có thể cần tải lại.

UUID sai/DTO sai/field thừa/null/PATCH rỗng400; UUID hợp lệ không tồn tại hoặc bridge đã bỏ404; thêm cặp đã có409; thiếu/hết hạn JWT hoặc account không Active khi AuthGuard authenticate401; Active Farmer/Manager ghi403; lỗi database/audit hoặc version không hợp lệ/hết giới hạn503 với thông báo đã sanitize. Gọi port trực tiếp có account không Active403; quyền luôn kiểm tra lại tại repository sau khi lấy lock.

Import các JSON hiện có: `docs/postman/Materials-Local-Test.postman_collection.json`, `Standards-Local-Test.postman_collection.json`, `Standard-Materials-Local-Test.postman_collection.json`. Login → copy JWT vào Authorization Bearer bằng tay → tạo/copy UUID từ response → gắn/query/bỏ bridge. Raw JSON; không scripts/environment mới. Với AppModule hiện tại sử dụng UUID API RAM, không dán UUID PostgreSQL seed vào đó. Chưa có public command khởi động isolated factory như runtime database; muốn tái lập PostgreSQL ngay dùng integration suite phía dưới. Không sửa các collection riêng của người dùng.

## Code, DI và transaction

- `apps/api/src/catalog/catalog-records.ts`: MaterialRecords/StandardRecords/StandardMaterialRecords, mọi method async và có actorId; không lộ metadata/version/audit trong responses.
- `catalog/memory-catalog-records.ts`: wrappers inject UserAccounts và đúng services đã có; modules alias bằng useExisting. Không chứa Map hoặc sao chép dữ liệu danh mục. Direct domain tests/callers vẫn thấy thay đổi của async HTTP ports.
- `catalog/catalog-validation.ts`: PostgreSQL port kiểm tra lại DTO/UUID ngay cả khi gọi ngoài controller, trim text, từ chối input không phải object/null/unknown fields. HTTP vẫn dùng ValidationPipe whitelist/forbidNonWhitelisted hiện có.
- Controllers của ba modules inject ports, truyền `request.user.id`; giữ AuthGuard và AdminGuard. Module exports cả sync service hiện tại và port để chuyển domain ở các đợt sau.
- `persistence/postgres-catalog.repository.ts`: một instance nhận shared Pool và PostgresUsersRepository; materials/standards/links chỉ là ba views, không mở Pool/timer/cache/seed riêng. Mỗi thao tác chạy một READ COMMITTED transaction/client bằng inPostgresTransaction, không gọi pool.query bên trong transaction. Không fallback RAM nếu DB lỗi.

Lock order: user row → user metadata → catalog row. Recheck Active/Admin sau lock, để thao tác đang chờ không dùng quyền đã bị thu hồi. PATCH khóa row trước khi đọc/merge và chỉ UPDATE fields đã gửi; hai Admin sửa khác field giữ cả hai thay đổi. Cùng field thì áp dụng tuần tự theo thứ tự lấy lock, không thêm optimistic If-Match vào contract cũ. Các lượt đọc cũng giữ user lock trong transaction ngắn để kiểm tra quyền nhất quán; cần đánh giá throughput khi chuyển full runtime, không mở transaction qua await provider/hardware.

Bridge khóa Standard → Material theo thứ tự cố định, kiểm tra tồn tại, rồi INSERT/DELETE. Cặp duplicate chỉ ánh xạ constraint standard_materials_pkey thành409. Hai DELETE cạnh tranh chỉ một thành công, lượt sau404. Cần giữ thứ tự khóa này trong domain adapters tiếp theo, đặc biệt khi phối hợp catalog–Zone. Database FK/PK là lớp bảo vệ cuối. Query identifiers chỉ từ whitelist nội bộ, tất cả giá trị dùng parameters.

Dữ liệu, technical.entity_metadata và technical.audit_events cùng transaction; audit lỗi rollback cả business row/version/link. Metadata entity_type là tên bảng vật lý. Link key `${standard_id}:${material_id}`. Tăng version bằng UPSERT atomic, không vượt Number.MAX_SAFE_INTEGER; state sai/hết giới hạn chặn ghi với503. Seed metadata được merge giữ seed_key/seeded_at; PATCH không ghi đè chúng. UUID canonical lowercase lấy từ row để chữ hoa/thường không tạo hai keys version/audit.

Audit actions: CatalogCreated/CatalogUpdated/StandardMaterialLinked/StandardMaterialUnlinked. Audit lưu actorId từ service context, changed_fields hoặc đúng hai FK, thời điểm backend; không thêm field ngoài ERD, không password/JWT/OTP. Chưa có endpoint audit riêng.

Unlink **giữ metadata**, tăng version và data.linked=false; re-link dùng cùng key/version và linked=true. Không hard-delete metadata để tránh reset version/seed manifest. Seed rerun thấy một bridge demo đã được chủ động bỏ sẽ **báo conflict và rollback**, không tự dựng lại bridge hay ghi đè dữ liệu; đây là hành vi SeedWriter có sẵn. Nếu muốn thay profile seed, phải thảo luận riêng; không chạy seed để khôi phục bridge đã bỏ.

RAM tiếp tục giới hạn1000 rows/catalog và10000 pairs/process. PostgreSQL không áp hạn RAM demo đó; pagination/input vẫn bounded và dữ liệu tồn tại sau restart. Không importer lấy dữ liệu RAM đang chạy, không tạo dữ liệu catalog tự động lúc boot.

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

test:persistence hiện chạy **năm suites tuần tự**, thêm `catalogs.integration.ts` vào bốn suites cũ. Test dùng fixture ports15432/27028, credentials mẫu cố định; không đọc .env, không kết nối database demo, Twilio/SMTP/MQTT thật. Mỗi suite tạo database sdf_persistence_test_{32hex}, cleanup đúng tên đó; không reset/clean, không down Compose demo, không -v.

Fallback Windows từ **apps/api**, chờ compile thành công rồi chạy:

```powershell
node ../../node_modules/typescript/bin/tsc --outDir .integration-dist
node --test --test-concurrency=1 .integration-dist/integration/persistence.integration.js .integration-dist/integration/users-auth.integration.js .integration-dist/integration/users-cooperatives.integration.js .integration-dist/integration/cooperative-workflows.integration.js .integration-dist/integration/catalogs.integration.js
node --test --test-concurrency=2 .integration-dist/test
node ../../node_modules/eslint/bin/eslint.js src test integration
node ../../node_modules/typescript/bin/tsc --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
```

Mỗi lệnh phải đạt exit0 trước khi chốt. **Kết quả cuối: 227/227 backend, 65/65 persistence (=51 cũ +14 catalog gồm13 subcases và wrapper), 29/29 browser; backend lint/typecheck/build đạt.** Browser regression từ apps/web: `node test/e2e.mjs`, dùng API/MQTT/Vite/Chromium fixture, không hardware/.env. Suite catalog gồm seed/duplicates/snapshots, PATCH/seed metadata, literal search/pagination, inactive/N:N/live links, concurrent pair/delete, concurrent PATCH, UUID case canonical, DTO/errors, direct permissions, revoked actor sau row-lock wait, audit rollback, version exhaustion/unlink manifest và HTTP fresh app/pool. Thêm regression async ports dùng đúng store RAM ở catalog.test.ts. .env và8 files riêng được đối chiếu SHA-256 giữ nguyên; deleted files riêng không restore. Commit local, chưa push/merge.

## Session kế tiếp

1. Đọc AGENTS nếu có; kiểm tra git status/branch/log; guide này/handoff/notes/plan/buildspec/ERD và persistence design. Base nhánh tích hợp mới nhất, không main cũ. Không triển khai lại catalogs/Users/HTX đã hoàn tất.
2. **Farm persistence đã tiếp nối** trên feat/postgres-farm-workflows từbcf8715: [guide hiện hành](POSTGRES_FARMS_IMPLEMENTATION.md). Không làm lại Farm; tiếp Zone/assignments, giữ tổng diện tích và [start,end)/correction context; chuyển Farm/catalog lookup sang async cùng các domain đó. Migration005 mới Applied local; trạng thái không có migration005 trong phần trên mô tả riêng đợt catalog trước.
3. Tree/Harvest và IoT metadata → Mongo telemetry/tasks/cultivation/head/context → wiring database toàn AppModule → full-process restart/hash-chain/retention/hardware thật → frontend database demo. Hai module AI tiếp tục để sau.
4. Giữ .env và private ERD/MQTT/Postman/UI edits/deletions; chỉ stage files của đợt làm. Không tự push/merge. Business mới chưa rõ phải hỏi và chờ, không hỏi lại quyết định đã chốt.
