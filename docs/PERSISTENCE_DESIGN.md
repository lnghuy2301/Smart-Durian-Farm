# Persistence — thiết kế và kế hoạch chuyển từ RAM

**Device persistence2026-10-17:** feat/postgres-devices-persistence từ Harvest **c781a91** hoàn tất PostgreSQL Device metadata/proposals/history, async port dùng cùng RAM store và presence đơn điệu không tăng metadata version. **236 backend/167 persistence/37 browser**, API lint/typecheck/build đạt;011 Applied local, hash/count13 business +4 technical không đổi, không reseed. [Tiến độ hiện hành](BACKEND_PROGRESS_CURRENT.md), [source/API/quyền/presence/locks/tái lập](POSTGRES_DEVICES_IMPLEMENTATION.md). AppModule vẫn RAM tới khi adapters và async consumers hoàn tất đồng bộ; không chỉ đổi HTTP sang DB. Còn2 PG bảng Sensor/Actuator và3 Mongo domains, tiếp Sensor trên branch mới kế thừa Device; sau đó full runtime/restart/frontend/hardware acceptance. .env/private ERD/MQTT/Postman/UI giữ nguyên; không hỏi lại rule/seed/hardware, không tự push/merge. Các checkpoint bên dưới là lịch sử.

**Harvest persistence2026-10-17:** feat/postgres-harvests-persistence từ Tree5aca62a hoàn tất PG TREE_HARVESTS/requests/grants/version/audit, async port dùng cùng RAM service và migration010. **235 backend/151 persistence/37 browser**, API lint/typecheck/build đạt;010 Applied local, hash/count13 business +4 technical giữ nguyên, không reseed. [Tiến độ hiện hành](BACKEND_PROGRESS_CURRENT.md), [source/API/quyền/locks/tái lập](POSTGRES_HARVESTS_IMPLEMENTATION.md). User chốt correction cây Dead/Removed: chặn đổi sang hôm nay; giữ nguyên ngày vẫn sửa được kể cả ngày đó là hôm nay, kiểm tra lại khi gửi/chuẩn bị/duyệt. **AppModule vẫn RAM** tới khi hoàn tất adapters/async consumers; không bật riêng PG HTTP. Còn3 PG bảng Device/Sensor/Actuator và3 Mongo domains, tiếp Device trên nhánh mới từ Harvest. Không hỏi lại rule/seed/hardware đã chốt; private files/.env giữ nguyên, không tự push/merge. Các checkpoint cũ bên dưới là lịch sử.

**Tree persistence2026-10-16:** feat/postgres-trees-persistence from87c069b delivers PostgreSQL Tree records, immutable backend DRN-UUID code, owner writes/Admin proposals and versioned append-only history. **233 backend/131 persistence/37 browser**, API lint/typecheck/build pass;009 Applied locally without data changes/reseed. [Current progress](BACKEND_PROGRESS_CURRENT.md), [API/source/locks/reproduction](POSTGRES_TREES_IMPLEMENTATION.md). Shared async RAM port retains current AppModule behavior; full runtime still RAM. Next Harvest persistence; remaining4 PG tables/3 Mongo domains before database wiring/restart/hardware acceptance. Private sources unchanged, no push/merge. Older dated checkpoints below are historical.

Hiện hành2026-10-16: [progress](BACKEND_PROGRESS_CURRENT.md), [Assignment adapter/source/locks/reproduction](POSTGRES_ASSIGNMENTS_IMPLEMENTATION.md), [Zone adapter](POSTGRES_ZONES_IMPLEMENTATION.md). Lời mời/từng chữ ký/nhận việc/End/history/version/audit đã có; **232 backend/118 DB**, eight persistence suites. Migration008 Pending End index Applied, không đổi dữ liệu; AppModule vẫn RAM, tiếp Tree và các adapters còn lại. Thiết kế và checkpoint cũ phía dưới giữ để truy vết.

Mốc hiện hành **2026-10-11 feat/postgres-farm-workflows** từbcf8715: Farm records/workflows/signatures/history/leave notifications đã chuyển PG adapter và async HTTP seam; one shared memory FarmsService được giữ cho các domain RAM. Atomic final apply/version/is_owner/audit/notification, current-role/context/area rechecks, migration005 Pending uniqueness và HTTP fresh app/pool đã test. **228 backend/85 DB/29 browser**, checks đạt. [Chi tiết/rule/commands/boundaries](POSTGRES_FARMS_IMPLEMENTATION.md). Migration005 Applied local, không đổi001–004 hoặc seed lại. AppModule vẫn RAM; tiếp **Zone persistence**, async Farm/Standards lookup rồi các domain/Mongo/full runtime. Các mô tả “Farm repository chưa triển khai” ở dưới chỉ còn là checkpoint cũ.

Mốc hiện hành2026-10-10 **feat/postgres-catalogs** từ007834f: PostgreSQL MATERIALS/STANDARDS/STANDARD_MATERIALS đã có repository, metadata/audit transaction và async HTTP ports; memory wrappers chia sẻ services hiện có. **227 backend/65 DB**, checks đạt. [Chi tiết/quy trình/tái lập](POSTGRES_CATALOGS_IMPLEMENTATION.md). Không đổi schema/migrations/demo seed. AppModule còn RAM; isolated PG Auth/catalog API fresh app/pool đã test, chưa full runtime/process/hardware. Tiếp **Farm persistence**, chuyển catalog lookup async cùng domain; giữ tất cả quyết định persistence/OTP/seed đã chốt. Các ghi chú “catalog còn thiếu” ở checkpoint cũ bên dưới không còn là trạng thái hiện tại.

Mốc hiện hành2026-10-10 **feat/postgres-cooperative-workflows** từ9c328a4: PG Manager HTX workflow/history/scheduler đã có, Coop service dùng async records; Accepted/data/version/audit cùng transaction. Restart giữ nội dung đề xuất/lịch sử nhưng active OTP request chuyển Expired và cần tạo/xác minh lại. **226 backend/51 DB**, checks đạt; migration004 active Manager slot UNIQUE Applied, 001–003 giữ nguyên. [Phạm vi/source/lệnh/giới hạn](POSTGRES_COOPERATIVE_WORKFLOWS_IMPLEMENTATION.md). AppModule còn RAM, OTP single-process; next catalog và các domain phụ thuộc rồi Mongo/database DI toàn backend. Thiết kế đề xuất/OTP ở dưới giữ nguyên, các ghi chú chưa wiring HTX chỉ đúng checkpoint trước.

Mốc hiện hành2026-10-10 **feat/postgres-users-cooperatives** từcb2a4d6: UserManagement async + email proof lease đã hoàn tất; PG đăng ký và Admin duyệt Manager/HTX atomic được kiểm thử HTTP qua khởi tạo instances mới. PG registry/lifecycle/created_at/version/audit/notifications và migration003 certificate UNIQUE đã có; **226 backend/37 DB/8 web/29 browser** và checks đạt. [Chi tiết](POSTGRES_USERS_COOPERATIVES_IMPLEMENTATION.md). **AppModule vẫn RAM**; Manager email→SMS proposal/history, scheduler và các domain repositories chưa chuyển. Thứ tự tiếp theo và yêu cầu parent-HTX locking được ghi trong guide; không triển khai lại account/approval/registry. Các ghi chú “chưa wiring Users/email” bên dưới là mốc cũ, hiện chỉ đúng với AppModule đầy đủ.

Tiến độ PostgreSQL2026-10-10: **feat/postgres-users-auth** từ2b6db5f đã có UserAccounts async + PostgreSQL account adapter/atomic password revocation/audit, **221 backend/26 DB tests +lint/typecheck/build đạt**, isolated Auth HTTP restart kiểm chứng. [Hướng dẫn và giới hạn](POSTGRES_USERS_AUTH_IMPLEMENTATION.md). Chưa wiring Users/email/HTX và các domain phụ thuộc; AppModule vẫn RAM, không bật mixed database Auth/memory domain. Các mốc “repository chưa triển khai” trong phần foundation dưới đây mô tả đợt trước; đợt2 mới hoàn thành adapter account, còn các repository/transactions nghiệp vụ khác.

Ngày 2026-10-10. Nhánh tài liệu **docs/persistence-design**, từ QR **26d45a5**; kế thừa Cultivation3ee921b/main647e6ad. Người dùng chọn persistence trước, AI_DISEASE_DIAGNOSTICS/CHATBOT_CONVERSATIONS để sau vì chưa triển khai AI. **Foundation đã triển khai** trên feat/persistence-foundation từ622a189: migration/schema/index/seed local,216 backend/16 DB integration tests +lint/typecheck/build đạt. [Hướng dẫn và giới hạn](PERSISTENCE_FOUNDATION_IMPLEMENTATION.md). Runtime API vẫn RAM, repository PostgreSQL/Mongo và HTTP restart acceptance còn tiếp theo. Các quyết định/thiết kế dưới đây là nguồn cho toàn đợt persistence, không phải tuyên bố toàn bộ đã hoàn tất.

## Quyết định đã chốt

1. PostgreSQL lưu13 bảng nghiệp vụ hiện có; MongoDB lưu3 collections đã triển khai: IOT_TELEMETRIES, ACTUATOR_TASKS, CULTIVATION_EVENTS. Hai collection AI chưa tạo module, dữ liệu giả hoặc phụ thuộc AI.
2. Lưu metadata/đề xuất/lịch sử/thông báo bằng **bảng kỹ thuật dùng chung**, tách khỏi13 bảng nghiệp vụ. TREE_HARVESTS vẫn đúng một bảng nghiệp vụ, không thêm bảng batch/harvest approval riêng.
3. Chuẩn bị seed mới, chạy lại không ghi đè dữ liệu đã có. Không chuyển dữ liệu RAM hiện tại trong đợt này; không reset/delete database hoặc Docker volumes.
4. Phiên OTP/email/SMS chưa hoàn tất phải xác minh lại sau restart. Giữ tài khoản đã xác minh, nội dung đã duyệt và các đề xuất nghiệp vụ đã lưu. Không reset gmail_verify đã hoàn tất hoặc đổi mật khẩu đã lưu chỉ vì restart.
5. Giữ mọi quyền/luồng duyệt đã chốt, UUID/tree_code/station_id và MQTT DOCXv1. Không sửa nguồn ERD/MQTT/Postman riêng. QR vẫn không có bảng.

## Dữ liệu cần lưu ngoài bảng chính

Đối chiếu source: Farm/Zone/Tree/Device/Sensor/Actuator có requests/version/snapshots; phân công có accepted_at/zone_snapshot; Harvest có everConfirmed/requests/backdate permissions; HTX có createdAt/version và notifications; Users có token version; Cultivation có context phân công gốc và chain heads. Các dữ liệu này hiện ở Map/array, cần lưu cùng records để nghiệp vụ còn đúng sau restart.

Đề xuất bốn bảng PostgreSQL dùng chung, tên vật lý sẽ xác định trong migration:

| Cấu trúc | Nội dung | Quy tắc |
|---|---|---|
| WORKFLOW_REQUESTS | Đề xuất Create/Update/Join/Leave/Assign/End/Confirm/Correct, approvals, snapshot, expected_version; quyền nhập bù là loại record riêng | Phân biệt module/action; payload có cấu trúc và validation backend. Cấp quyền nhập bù vẫn kiểm tra user/Zone/ngày/expiry/revocation. Không diễn giải mọi Accepted request thành grant |
| ENTITY_METADATA | Version, token version, HTX created_at, Harvest everConfirmed, bằng chứng Accepted/snapshot phân công và metadata kiểm tra batch | Khóa entity_type/entity_key; giá trị riêng theo từng loại. Không trả qua public API, không nhận từ body client |
| AUDIT_EVENTS | Lịch sử thay đổi metadata/snapshot, tác giả và thời điểm backend | Append lịch sử cùng transaction thay đổi record; không thay bằng ghi đè snapshot mới nhất |
| NOTIFICATIONS | Farm rời HTX, cảnh báo HTX thiếu Manager/xóa bị chặn/đã xóa | Khóa chống tạo thông báo trùng; giữ snapshot tên/ID khi entity đã được phép xóa |

Các bảng trên nằm trong schema kỹ thuật riêng để sơ đồ nghiệp vụ13 bảng vẫn rõ. Các liên kết UUID có FK khi có bảng đích cố định; khóa metadata đa loại được quản lý bởi repository và transaction, không tuyên bố FK đa hình đã được database bảo đảm. JSONB chỉ chứa payload kỹ thuật có schema, không đưa cả database/RAM vào một blob. Migrations cần index theo module/status/target/recipient và kiểm thử cleanup liên kết khi có phép xóa.

MongoDB cần metadata kỹ thuật cùng database với3 collections chính. Đề xuất **một collection nội bộ PERSISTENCE_STATE** với các loại document rõ ràng: CultivationContext theo event/root, ZoneChainHead, TelemetryInsertionCounter và bộ cấp mã command/task. Validation/index riêng theo loại; dữ liệu không nằm trên route public và không tham gia payload hashv1. Số collections kỹ thuật không phải số module nghiệp vụ mới.

Context Cultivation giữ zone_id/farm_id/author_id/assignment_id/original_created_at/root_id. Phân công mới không sửa context cũ. Lưu event/context/head cùng transaction MongoDB để tránh event Locked xuất hiện mà head chưa cập nhật. MongoDB hỗ trợ transaction nhiều document/collection trên replica set; Compose hiện đã cấu hình rs0. [MongoDB8 transactions](https://www.mongodb.com/docs/v8.0/core/transactions/).

## Ví dụ thu hoạch chờ sửa

Bản ghi đã Confirmed có fruit_count10. Tác giả/chủ đề xuất99:

1. Transaction PostgreSQL khóa Harvest và metadata, kiểm tra quyền/version, ghi request chứa99, đổi status Pending, giữ fruit_count10 và everConfirmed=true.
2. QR vẫn đọc10 từ bảng chính; không đọc proposed_changes cho public.
3. Reviewer đúng scope (Manager HTX hoặc Admin Farm độc lập) duyệt: kiểm tra lại quyền/version/snapshot, cập nhật99, status Confirmed và updated_by/updated_at theo người sửa/thời điểm được áp dụng đúng rule hiện có; resolved_by lưu reviewer ở request kỹ thuật.
4. Từ chối giữ nội dung10. Draft/Pending xác nhận lần đầu vẫn không public; xác nhận lần đầu giữ updated_by/updated_at null. Chỉ xóa Draft chưa từng Confirmed.

Record, metadata và request phải commit/rollback cùng nhau. node-postgres yêu cầu dùng **cùng client** trong transaction, không chia các câu SQL vào pool.query. [pg transaction guide](https://node-postgres.com/features/transactions).

## Ràng buộc bắt buộc giữ khi chuyển database

- Email chuẩn hóa trim/lowercase, unique khi có giá trị; Farmer có thể null email. Số điện thoại chống trùng0/84/+84 nhưng giữ cách login hiện có. Password lưu hash; không lưu/in plaintext seed password.
- HTX manager_id nullable/unique, một Manager một HTX; Active Manager vẫn cần email đã xác minh và Admin duyệt/gắn HTX trong một transaction. created_at kỹ thuật HTX phải bền để deadline7/30 ngày không khởi động lại khi restart.
- Farm/Zone dùng khóa Farm chung khi ghi diện tích hoặc duyệt shrink, tính tổng Zone trong transaction. CHECK riêng từng dòng không tự bảo đảm tổng nhiều Zone.
- USERS_ZONES giữ Accepted assignment và lịch sử; khoảng [start,end), end có thể null. Ràng buộc loại trừ giao nhau theo Zone trong database, cùng kiểm tra dịch vụ. PostgreSQL có range/exclusion cho trường hợp này. [PostgreSQL17 range constraints](https://www.postgresql.org/docs/17/rangetypes.html).
- tree_code duy nhất/bất biến; Tree/Device không chuyển Zone. Device station_id UNIQUE NOT NULL/bất biến, installed_at/cost NOT NULL. Device UUID khác station_id.
- Sensor UNIQUE(device_id,data_stream_id), Actuator UNIQUE(device_id,capability_id); Inactive không giải phóng định danh. Sensor type và Actuator purpose bất biến, đơn vị Sensor theo varchar16 hiện hành.
- Harvest UNIQUE(tree_id,harvest_date), không UNIQUE(batch_code). Các dòng cùng batch phải cùng Zone/ngày; kiểm tra cả create/update/review dưới khóa batch chung, chống hai request đồng thời vượt qua kiểm tra. Không thêm bảng batch riêng.
- harvest_date dùng DATE; các mốc thời gian dùng TIMESTAMPTZ/UTC và API ISO như hiện có, hạn7 ngày vẫn theo lịch Việt Nam. Mapping decimal sang JSON phải giữ response API, độ chính xác và giới hạn ERD.
- UUID PostgreSQL giữ dạng string trên API; ObjectId MongoDB giữ hex trên API. Bộ mapping MongoDB phải tái tạo chính xác chuỗi thời gian/kiểu số dùng canonicalJson/hashv1, không tự hash BSON Date như object rỗng hoặc đổi snapshot lịch sử.

Unique/FK/CHECK/exclusion và transaction bổ sung cho kiểm tra backend, không thay scope Auth. [PostgreSQL17 constraints](https://www.postgresql.org/docs/17/ddl-constraints.html).

## Restart, retention và giao tiếp hardware

- Startup đọc records/metadata từ database; worker HTX/Cultivation catch-up theo deadline đã lưu. Pending journal quá15 phút vẫn lock theo cơ chế hiện có.
- Token version lưu bền. OTP/proof ngắn hạn không dùng tiếp sau restart; HTX update chưa hoàn tất xác minh chuyển trạng thái cần bắt đầu phiên mới, giữ lịch sử proposal. Farm/Zone/Harvest proposals không liên quan OTP tiếp tục tồn tại.
- Tasks Pending bị gián đoạn cần ghi kết quả lỗi/phục hồi rõ ràng; không tiếp tục Start tự động. Device acknowledged_mode trở Unknown; trước lần Bật tiếp theo vẫn Reset bơm/hai van và chờ đủ ACK10s từng bước như đã chốt. Trạng thái physical_state vẫn Unknown; persisted Confirmed là receipt history, không chứng minh relay đang bật.
- Bộ cấp taskId/commandId cần lưu bền để không nhận nhầm ACK cũ cho command mới sau restart. Không thay topic/payload/firmware.
- Telemetry giữ giới hạn tổng10.000 readings, xóa cũ theo thứ tự ghi xác định; không đổi chu kỳ hardware15 giây hoặc chuyển thành lưu15 phút. Counter/sequence nội bộ giải quyết thời điểm trùng nhau/clock rollback; append/trim cần kiểm thử đồng thời và restart. Cultivation không FIFO xóa Locked. Tasks giữ eviction terminal hiện có, không xóa workflow còn chạy.
- PostgreSQL/MongoDB không có transaction chung. Thiết kế từng thao tác ghi vào một database; tham chiếu chéo kiểm tra scope và lưu context/snapshot cần thiết. Phải kiểm thử race khi kết thúc phân công/thu hồi quyền đúng lúc tạo event/task, không giả định hai database atomic chỉ vì đều có transaction. Không tự tạo Cultivation khi task có receipt ACK.

## Repository, migrations và triển khai từng đợt

Tái dùng pg/MongoClient hiện có, SQL tham số hóa và repository nhỏ theo module. Hợp đồng repository async; services/guards/workers phải await kết quả DB, kể cả khi adapter test dùng RAM. HTTP paths/DTO/status/JSON giữ hợp đồng frontend/Postman. Một instance module/pool/repository cho HTTP và MQTT.

| Đợt | Phạm vi | Điều kiện nghiệm thu |
|---|---|---|
| 1 — Foundation (đã có) | Migration runner/version/checksum/lock; schema/index theo ERD và kỹ thuật đã duyệt; repository contracts/mapping; seed có kiểm tra dữ liệu sẵn có | Đạt216 backend/16 DB tests; local migrations Applied và seed rerun inserted0. APIs vẫn RAM |
| 2 — PostgreSQL nghiệp vụ | Users/Auth/HTX/danh mục, tiếp Farm/Zone/phân công/Tree/Harvest, metadata IoT | Thay records/proposals/metadata thật; rollback/unique/concurrency/restart; quyền và response không đổi |
| 3 — MongoDB nghiệp vụ | Telemetry, Tasks/control, Cultivation/context/head | Restart/retention/ACK cũ/correction context/hash-chain và transaction được kiểm thử |
| 4 — Nghiệm thu xuyên suốt | API/web/Postman/QR với storage database, lịch sử và seed demo | Restart vẫn còn dữ liệu/quyền/history, chạy toàn bộ hồi quy và DB integration |

Từng đợt có nhánh riêng kế thừa nhánh tích hợp mới nhất. Storage memory giữ để test cô lập; mode database chỉ bật khi các adapter cần thiết đã đầy đủ, không âm thầm fallback sang RAM khi DB lỗi. Migration/seed chạy bằng lệnh riêng, không tự apply schema/xóa dữ liệu khi API boot. Migration đã apply không sửa nội dung; thay đổi tiếp theo dùng file mới.

Seed tối thiểu gồm bootstrap Admin và danh mục demo; seed demo mở rộng có thể tạo Farmer/Farm/Zone/Tree/phân công theo fixtures đã duyệt. Không seed Manager giả đã verify email hoặc auto gửi OTP/email/SMS/MQTT. Giá trị thật/secret lấy cấu hình local, không ghi vào code/docs. Dữ liệu tồn tại: kiểm tra identity và nội dung; nếu khác thì báo conflict, không ghi đè. UUID chỉ được seed mới khi identity đó chưa tồn tại.

## Handoff và việc chưa làm

Bổ sung seed theo người dùng2026-10-10: [PERSISTENCE_SEED_SPEC.md](PERSISTENCE_SEED_SPEC.md) yêu cầu dữ liệu metadata IoT đa dạng/mô phỏng kèm1 bộ thật (Device+3 Sensors+3 Actuators theo identifiers hardware), và1 tài khoản demo chính nhận SMS/reset password thật. Không seed readings/ACK/Online giả cho bộ thật hoặc reset mật khẩu khi rerun. Broker/Twilio đã cấu hình, số chính khớp allowlist. Người dùng xác nhận station E08CFE41DCAC và Farmer cấu hình hiện có làm chủ Farm hardware; cho phép chọn metadata lắp đặt minh họa: installed_at2026-09-01T08:30:00+07:00, cost10237500 VNĐ. Đầu vào seed đã đủ, không hỏi lại; các khóa DEMO_DEVICE_* đã điền local/example theo guide, giữ cấu hình khác. CLI seed đã đọc các khóa và tạo bộ demo database local; không tự đăng ký Device lúc API boot hoặc chuyển API sang database.

Đợt foundation không thêm dependency/ORM hoặc sửa .env thật; đã tạo bảng/index/seed local theo lệnh riêng. Trước triển khai repositories: đọc AGENTS nếu có, git status/log/branch, guide foundation, tài liệu này, MODULE_HANDOFF, ERD_DIAGRAM.xml hiện có, source/types của từng module. Không sử dụng các mô tả QR/Cultivation chưa triển khai trong tài liệu cũ.

Hai module AI trì hoãn theo người dùng. Không push/merge khi chưa có yêu cầu cho đợt mới; không stage toàn workspace hoặc sửa nguồn ERD/MQTT/Postman/UI riêng. Mỗi đợt cập nhật README/handoff/guide/Postman nếu API mapping thay đổi, ghi lệnh migrate/seed/test/reset chỉ dành DB test riêng và cách tái lập session khác.
