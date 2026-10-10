# CULTIVATION_EVENTS — API và hướng dẫn tái lập

Tích hợp QR2026-10-10: [public traceability](QR_TRACEABILITY_IMPLEMENTATION.md) dùng shared lockedForTrace, lazy lock catch-up và toàn lineage Locked; công khai snapshot whitelist cùng nhãn target/latest/applicability. Correction A→B: cả QR A/B hiện toàn chuỗi, A ghi rõ hiện tại áp dụng B. Pending/note/reason/context/UUID/hash private không công khai. Không thay quyền nhập/sửa/correction, không thêm thời điểm performed_at hoặc auto log từ ACK. Full-chain verify vẫn cần JWT/quyền Zone.

Ngày 2026-10-09; branch **feat/cultivation-events** từ main647e6ad đã merge PR#6. Module đã có source/API RAM, không MongoDB persistence. [Quy trình và quyết định nghiệp vụ](CULTIVATION_EVENTS_WORKFLOW_DESIGN.md); [Postman25 requests nhập JSON](postman/Cultivation-Events-Local-Test.postman_collection.json).

## Cấu hình và chạy

Không có biến môi trường mới cho Cultivation. Giữ .env hiện có; không chép đè .env.example. Dùng AUTH_MODE=mock và local Farmer/Admin đã cấu hình như các module trước; API mock chỉ chạy local, không production. MQTT có thể disabled, nhật ký nhập thủ công hoạt động độc lập hardware. Không cần bật broker, SMTP/SMS hoặc DB để test module; readiness503 khi DB không chạy không có nghĩa Cultivation RAM lỗi.

Từ root:
```powershell
npm ci
npm run dev:api
```

Swagger http://localhost:3000/api/docs; schemas http://localhost:3000/api/docs-json. Chỉ dùng npm ci khi cần cài theo lockfile; không sửa dependency mới trong delivery này. Startup main có thể yêu cầu DATABASE_URL/MONGODB_URI cấu hình sẵn, nhưng API nhật ký không ghi DB.

Có Farmer là chủ Farm, Farm đã qua Admin duyệt, Zone gắn tiêu chuẩn, Tree trong Zone, vật tư Active nếu phun/bón. Dùng collections [Farms](postman/Farms-Local-Test.postman_collection.json), [Zones](postman/Zones-Local-Test.postman_collection.json), [Trees](postman/Trees-Local-Test.postman_collection.json), [Materials](postman/Materials-Local-Test.postman_collection.json) và [Standard Materials](postman/Standard-Materials-Local-Test.postman_collection.json) để tạo theo thứ tự. Farmer khác cần đăng ký Active rồi chủ mời/nhận phân công theo [Assignments](ASSIGNMENTS_IMPLEMENTATION.md). Không có seed/demo dữ liệu tự tạo; restart API mất toàn bộ business RAM và phải nhập lại.

## Hợp đồng API

Mọi endpoint cần Bearer JWT tài khoản Active. Event ID là **ObjectId hex24**, target/zone/material/author là **UUIDv4**, không dùng tree_code hoặc station_id thay UUID.

| Method | Path sau /api | Request/response |
|---|---|---|
| POST | /cultivation-events | Create →201 event Pending |
| GET | /cultivation-events | Danh sách được phép →200 page |
| GET | /cultivation-events/mine | Lịch sử tác giả từ JWT →200 page |
| GET | /cultivation-events/:id | Event →200 |
| PATCH | /cultivation-events/:id | Partial target/action/details, chỉ tác giả Pending →200 |
| DELETE | /cultivation-events/:id | Chỉ tác giả Pending trước deadline →204 không body |
| POST | /cultivation-events/:id/corrections | Full Create + correction_reason →201 event Pending mới |
| GET | /cultivation-events/:id/corrections | Page bản gốc và correction, thứ tự cũ→mới |
| GET | /cultivation-events/zones/:zoneId/chain/verify | Quyền Zone hiện tại →200 valid/count/tail/failure |

List query: limit(default20,max100), offset(default0,max100000), zone_id, target_id, target_type, action_type, status. Lọc quyền và filters trước total/pagination; newest theo lock_at/_id ở trước. target filter chỉ document khớp, không áp nhật ký Zone cho các Tree. mine thêm điều kiện farmer_id=JWT actor; Admin/Manager thường nhận rỗng.

Create Watering:
```json
{
  "target_type": "Zone",
  "target_id": "PASTE_ZONE_UUID",
  "action_type": "Watering",
  "details": { "duration_minutes": 5, "water_volume_l": 20, "note": "Tưới thực tế" }
}
```

Create Spraying/Fertilizing:
```json
{
  "target_type": "Tree",
  "target_id": "PASTE_TREE_UUID",
  "action_type": "Spraying",
  "details": { "materials": [{ "material_id": "PASTE_ACTIVE_MATERIAL_UUID", "quantity": 2 }], "note": "Phun riêng cây" }
}
```

Thay PASTE_* bằng UUID thật trước gửi. Không gửi unit/name/status/hash/timestamps/farmer_id/assignment_id/warnings. DTO từ chối field lạ cả trong materials/details. Không gửi null thay field tùy chọn: bỏ field khỏi JSON; note="" hợp lệ để bỏ ghi chú.

Giới hạn input:
- duration_minutes: number, 0.001–10080, tối đa3 số lẻ. Watering bắt buộc duration; cấm materials.
- water_volume_l và quantity: number, 0.001–1000000, tối đa3 số lẻ. Watering volume tùy chọn; thiếu trả null.
- Spraying/Fertilizing:1–20 vật tư không trùng material_id; không nhận duration/water volume. Mọi vật tư chọn lại phải Active; không áp hạn chế type theo activity.
- note tối đa2000 ký tự, trim; correction_reason bắt buộc trim1–2000 ký tự.
- details khi PATCH là **replacement toàn bộ**, không merge từng field/nested material. Omit details giữ snapshot cũ; thay action phải gửi details tương ứng. Đổi target/action chỉ cùng Zone; created_at/lock_at không đổi.

Response details giữ standard_snapshot{standard_id,code,name}; Spraying/Fertilizing thêm mỗi vật tư quantity/name/type/unit/default_dosage/quarantine_days/standard_linked. warnings là mảng MATERIAL_OUTSIDE_STANDARD+material_id nếu chưa linked. Các snapshot lấy lúc backend chấp nhận input, cảnh báo phản ánh cấu hình lúc nhập, không khẳng định chứng nhận tuân thủ.

Trả409 nếu Locked khi sửa/xóa, reference correction lỗi thời, có correction Pending, hoặc clock rollback làm phá thứ tự chain. 400 input/action-details/khác Zone/vật tư Inactive;401 thiếu/saiJWT;403 sai vai trò/tác giả/quyền ghi/grace;404 bản ghi ngoài quyền/không tồn tại;429 hết dung lượng. Quyền tác giả được kiểm tra trước trạng thái khi mutation, nên sai tác giả403 dù bản ghi Locked. Không có API bulk/confirm/unlock/admin override hoặc nhập ngày thực hiện.

## Tái lập bằng Postman

1. Import JSON mới trực tiếp. Không environment, collection variables hoặc scripts; sửa từng PASTE_* bằng tay. Không lưu credentials/JWT thật vào Git.
2. Requests01–07: login Owner/Admin, tìm Farm/Zone/Tree/Active material và link tiêu chuẩn. Nếu list rỗng tạo bằng các collections setup ở trên.
3.08–12: tạo Zone tưới, Tree phun/bón, một bản Pending riêng để xóa, rồi PATCH target/action trong cùng Zone. Copy BASE_OBJECTID, DELETE_OBJECTID và lock_at từ responses. Dùng đúng tác giả.
4.13–17: đọc/filter/mine, xóa bản riêng →204. Dùng JWT Farmer Accepted để kiểm tra đọc nhật ký của Owner; mời mà chưa nhận việc vẫn chưa có quyền.
5. Đợi đến lock_at của BASE, rồi18–20: GET trả Locked/hash, PATCH/DELETE đúng tác giả trả409. Worker chạy30s nhưng GET tự catch-up; không đổi đồng hồ/.env hoặc thêm API force-lock cho demo.
6.21–24: POST correction →Pending mới, copy CORRECTION_OBJECTID, PATCH khi còn hạn, GET lineage và verify chain. verify chưa tính Pending; đợi lock_at correction rồi GET/verify thấy count tăng. Gửi correction tiếp phải dùng ID của Locked mới nhất.
7.25: Admin đọc; Manager JWT chỉ đọc Farm hiện trong HTX mình. Farmer hết phân công vẫn đọc own/mine, không đọc Owner hay verify cả Zone; không tạo mới, chỉ correction theo original grace.

Correction body là Create đầy đủ + correction_reason. root/reference do server sinh; correction về Tree khác trong cùng Zone được phép, khác Zone400. Hai request correction cùng root chỉ một201, request còn lại409. Xóa Pending correction thì được tạo proposal mới trên Locked hiện tại. Không xóa bản Locked gốc.

## Kiểm thử và tái lập session sau

24 kiểm thử mới trong apps/api/test/cultivation-events.test.ts: HTTP DTO/lifecycle forgery, structured details, Owner/Accepted/future/end permissions, Manager/HTX, total/filter privacy, shared bridge snapshots/Inactive/warnings, target/action editing, exact deadline/worker delay, deletion, correction root/reference/concurrency, original assignment grace15 days, independent Zone chains, canonical tamper/head removal, defensive copies, RAM capacity và clock rollback. Fixtures dùng tài khoản test cô lập, không đọc .env thật, không gửi mail/SMS hoặc ghi DB. Deadline tests dùng clock tạm trong process test, không chờ15 phút.

Lệnh thường từ root:
```powershell
npm run lint
npm run typecheck
npm run build
npm test
npm run test:web
npm run test:web:e2e
```

Nếu npm shim bị EPERM do đường dẫn hồ sơ Windows, từ apps/api dùng cùng entrypoint:
```powershell
node ../../node_modules/typescript/bin/tsc --outDir .test-dist
node --test .test-dist/test/cultivation-events.test.js
node --test --test-concurrency=2 .test-dist/test
node ../../node_modules/eslint/bin/eslint.js src test integration
node ../../node_modules/typescript/bin/tsc --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
```

Kết quả cuối2026-10-09: **192/192 API tests (24 mới), lint/typecheck/build**; web regression **8/8 unit +22/22 browser**, typecheck/build. Postman25 requests JSON hợp lệ/không scripts hoặc variables, tất cả routes khớp OpenAPI runtime và links hai guide tồn tại. Không đánh đồng test local với nghiệm thu ESP32 thật. API task/MQTT không tự sinh nhật ký; frontend nhật ký, QR public/effective projection chưa có trong đợt này.

## Điểm cần giữ khi phát triển tiếp

Source mới ở apps/api/src/cultivation-events: DTO/types, service/controller/module/schema, store và cultivation-chain.ts. AppModule tái dùng đúng các instance dependency; StandardMaterialsService.has kiểm tra bridge hiện có. Context gốc (zone/farm/author/assignment/original_created_at/root) nằm ngoài document ERD, trong Map RAM, không client controlled. Author-assignee dùng AssignmentsService.assertCanWork/assertCanCorrect; original owner dùng ownership thật, không cờ is_owner.

10000 events tổng (Pending+Locked), không FIFO xóa lịch sử; đầy trả429 trước mutation. Worker30s unref/shutdown; catch-up trên API, Pending deadline không kéo dài bởi PATCH. Hash-chain per Zone v1 genesis null, head RAM kiểm tra count/tail. Đây chỉ là một process; restart mất document/context/head, không có chain bền vững. Persistence cần bàn nơi lưu authorization evidence, transaction/index/worker locking và anchors; không tự thêm field vào ERD hoặc collection.

Giữ private ERD/MQTT/Postman/UI và .env; không restore file người dùng xóa, không stage-all/reset/clean. Chỉ commit module trên branch riêng, không tự push/merge. QR công khai cần chốt whitelist và cách xử lý target thay đổi trong correction. AI/chatbot cần model/corpus/provider trước implementation.
