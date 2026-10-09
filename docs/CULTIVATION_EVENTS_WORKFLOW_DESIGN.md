# CULTIVATION_EVENTS — chuẩn bị triển khai và các quyết định còn chờ

Ngày2026-10-09. Branch **feat/cultivation-events** từ **origin/main @647e6ad** sau khi người dùng merge PR#6. Tree của main bằng delivery768f3b8; module control đã có, không triển khai lại. Tài liệu này là **bản thiết kế chờ chốt**, không phải mô tả API đang chạy. Chưa có service/controller/store Cultivation, chưa migration/seed/MongoDB persistence. Không sửa ERD của người dùng.

## Quy tắc đã có căn cứ

Nguồn: ERD_DIAGRAM.xml hiện tại, PROJECT_BUILD_SPEC.md phần10, quyết định phân công trong MODULE_HANDOFF.md và helpers AssignmentsService.assertCanWork/assertCanCorrect. ERD mới dùng chữ hoa đầu `Pending`/`Locked`, không dùng PENDING/LOCKED làm wire enum.

- `_id` ObjectId; không tạo thêm event_id.
- farmer_id là tác giả UUID do backend suy từ JWT; target_type Zone/Tree, target_id UUID.
- Ba action_type trong ERD: Watering, Spraying, Fertilizing. Chưa thêm Pruning/Harvest/IoT vào enum.
- created_at backend tạo; lock_at=created_at+15 phút; locked_at/hash/previous_hash null khi Pending. Không nhận thời gian lock hoặc hash do client khai.
- Pending chỉ sửa/xóa khi now<lock_at; không dựa status nếu worker bị trễ. Locked không sửa/xóa hoặc mở lại.
- Correction là event mới có is_correction, reference_event_id trỏ event sửa trực tiếp, root_event_id trỏ gốc đầu, correction_reason; cũng trải qua Pending→Locked.
- Chỉ tác giả được correction. Farmer nhận việc được correction tối đa15 ngày từ end_date của **phân công gốc**; phân công mới không gia hạn quyền với lịch sử cũ. Hết phân công không tạo nhật ký mới hoặc điều khiển; tác giả vẫn đọc lịch sử của mình.
- Admin/Manager chỉ đọc theo phạm vi Farm/HTX. Luồng correction Harvest khác Cultivation, không đưa request approval/mở khóa Harvest vào đây.
- Chỉ Locked tham gia hash chain, canonical serialization + SHA-256; đây là cơ chế phát hiện can thiệp, không gọi là blockchain.
- Không tự tạo nhật ký từ ACTUATOR_TASKS Confirmed: MQTT ACK chỉ xác nhận **nhận command**, không chứng minh công việc đã thực hiện.
- Dữ liệu nghiệp vụ tiếp tục RAM trong đợt module; persistence phải chốt riêng. Không âm thầm tạo bảng/collection/migration.

## Fields theo ERD hiện tại

```text
_id: ObjectId
farmer_id: UUID
target_id: UUID
target_type: Zone | Tree
action_type: Watering | Spraying | Fertilizing
details: Object
status: Pending | Locked
is_correction: boolean
reference_event_id: ObjectId | null
root_event_id: ObjectId | null
correction_reason: text | null
created_at: timestamp
lock_at: timestamp
locked_at: timestamp | null
previous_hash: string64 | null
hash: string64 | null
```

ERD chỉ ghi details:Object, chưa mô tả field con. Nullability của links/hash khi event thường/Pending suy từ lifecycle build spec; không thêm trường top-level client-controlled để giả bằng chứng quyền.

## Ba câu hỏi đã gửi người dùng, chưa coi là được duyệt

1. **Chủ Farm:** đề xuất được tạo trực tiếp như Harvest/control; Farmer khác phải có Accepted assignment đang hiệu lực. Chủ chỉ correction nhật ký mình khi còn chủ; mọi correction của assignee dùng phân công gốc. Phương án khác là chủ cũng cần phân công.
2. **Details và tiêu chuẩn:** đề xuất Watering duration_minutes bắt buộc, water_volume_l tùy chọn, note tùy chọn; Spraying/Fertilizing materials[{material_id,quantity}], đơn vị lấy từ danh mục và note. Chỉ vật tư Active; cần chọn chặn vật tư chưa gắn tiêu chuẩn Zone hay ghi nhận kèm cảnh báo. Phương án tối giản là details dạng ghi chú văn bản. Các tên field này còn là đề xuất.
3. **Hash chain:** đề xuất mỗi Zone một chuỗi gồm nhật ký Zone và các Tree trong Zone, nối khi Locked theo lock_at rồi _id. Phương án khác: riêng từng target, hoặc hoãn hash chain. Correction là event mới, không ghi đè gốc. Chưa viết canonicalizer/chain worker cho tới khi chốt phạm vi.

Kết quả câu hỏi được cập nhật sau khi có trả lời rõ ràng; elapsed time/default option không là phê duyệt.

## Chuẩn bị kỹ thuật từ source đã đọc

- AppModule đang tái dùng các dynamic modules Auth/Farms/Zones/Trees/Assignments/Materials/Standards/StandardMaterials. Module Cultivation phải nhận các **instance đó**, không gọi forMock lần nữa để tạo store trùng.
- Helpers assertCanWork đòi assignment, không bypass owner; nếu duyệt owner nhập trực tiếp, Cultivation phải resolve ownership trước khi gọi helper cho assignee.
- assertCanCorrect nhận assignment_id, zone_id, author_id, created_at từ **event gốc đã lưu**. Dự kiến metadata nội bộ RAM giữ context gốc này, không nhận từ request và không tự thêm field ERD. Lưu bền context khi làm persistence là quyết định riêng cần ghi rõ.
- TREES.zone_id bất biến, không chuyển cây; có thể resolve Tree target về Zone qua TreesService.getRecord. Target existence/quyền phải validate từ server.
- MaterialsService.get trả snapshot metadata; material_type gồm Fertilizer/Pesticide/Biological, unit/default_dosage/quarantine_days là cấu hình hiện có. Nếu details cấu trúc được chốt, cần giữ snapshot vật tư/đơn vị trong details để sửa danh mục không đổi nhật ký cũ.
- StandardMaterialsService hiện có add/list/remove, chưa có membership lookup trực tiếp. Nếu cần kiểm tra vật tư tiêu chuẩn, bổ sung internal query trên **store hiện có**, không tạo Map links mới trong Cultivation.
- Timer lock phải dừng khi shutdown; đường read/edit/delete/correction cũng cần xử lý deadline để worker trễ không làm lọt sửa. Không xóa Locked theo FIFO để mất lịch sử/hash chain; dung lượng RAM phải từ chối ghi trước khi có partial state.
- Hash canonical không dùng raw JSON.stringify Mongo document. Chỉ hash những trường đã định nghĩa, có thứ tự xác định; chain lock là thao tác đồng bộ/atomic trong process hiện tại. Không coi hash chain RAM là audit bền vững hoặc hỗ trợ nhiều backend workers.

## API dự kiến — chưa có routes runtime

```text
POST   /api/cultivation-events
GET    /api/cultivation-events
GET    /api/cultivation-events/mine
GET    /api/cultivation-events/:id
PATCH  /api/cultivation-events/:id             (Pending trước deadline)
DELETE /api/cultivation-events/:id             (Pending trước deadline)
POST   /api/cultivation-events/:id/corrections (Locked, tác giả có quyền)
```

Sau chốt chain mới quyết định API verify-chain và payload kết quả. Không tạo route public QR hoặc mutation Admin/Manager từ bản dự kiến này. Đặc tả đọc lịch sử, target correction và trường details phải được đối chiếu trước khi viết DTO, không suy privacy policy từ endpoint dự kiến.

## Kiểm thử cần thực hiện khi code

JWT/role/scope và DTO nested; shared store metadata; Pending đúng15 phút ở biên now=lock_at kể cả worker trễ; Locked immutable; correction gắn đúng root/reference/assignment cũ; không gia hạn bởi phân công mới; authored history sau end; snapshot vật tư không đổi khi sửa danh mục; queue correction/locking không ghi partial; canonical serialization ổn định; chain độc lập theo phạm vi được duyệt, phát hiện sửa nội dung Locked; shutdown/limits/defensive copies; HTTP/schema OpenAPI/manual Postman.

Baseline đã kiểm thử ở delivery trước: backend168 tests + lint/typecheck/build, web8 unit/22 browser. Lượt chuẩn bị này chưa đổi code và không chạy lại các tests đó. Khi code xong, chạy focus tests mới và toàn bộ API regression trước commit module. Hướng dẫn Postman nhập JSON trực tiếp/copy JWT/UUID/ObjectId bằng tay sẽ viết cùng implementation; không tạo collection giả cho API chưa tồn tại.

## Thứ tự các phần còn lại

1. CULTIVATION_EVENTS: chốt ba câu hỏi chính và các chi tiết phát sinh, code/API/tests/docs trên nhánh này.
2. QR traceability: không bảng; chốt whitelist công khai và dữ liệu Locked/Confirmed trước triển khai.
3. AI_DISEASE_DIAGNOSTICS: chờ model/nhãn/output thật và quyết định upload/feedback/scope; chưa có asset/model inference trong source được rà soát, không giả kết quả AI.
4. CHATBOT_CONVERSATIONS: chốt provider/RAG/corpus PDF và quyền/session/messages; không tự tạo knowledge base hoặc trả lời giả.
5. Persistence/repositories/migration/seed và nghiệm thu ESP32 v1 là các đợt riêng, không được tính là hoàn tất vì module dùng RAM đã có.

Session sau: đọc AGENTS nếu có, git status/branch/log, handoff/build spec/ERD/guide này. Base647e6ad là main đã merge PR#6, local main có thể còn c71820d vì lượt này chỉ fetch origin/main. Giữ .env/file riêng; không reset/clean hoặc stage toàn workspace. Đợt push trước đã hoàn tất; không tự push module chưa nghiệm thu hoặc merge main.
