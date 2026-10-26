# Smart Durian Farm — đặc tả hiện hành

AI hiện hành theo [AI_RAG_CORPUS_IMPLEMENTATION](AI_RAG_CORPUS_IMPLEMENTATION.md): model thật chạyCPU, top3 nhãn Việt giữ điểm/nhãn gốc, corpus15 PDF nguồn/trang/dự thảo018. Chat API chưa chọn, không có câu trả lời sinh thật; accuracy chưa đánh giá, UI AI chưa làm. Phần chờ weights trong checkpoint trước dưới đây đã hoàn tất.

Cập nhật AI26/10/2026: [AI backend](AI_BACKEND_IMPLEMENTATION.md) có chẩn đoán YOLO11s-cls/lịch sử riêng, Zone tùy chọn có kiểm tra quyền, RAG PDF do Admin quản lý và hội thoại Farmer. Chờ best.pt và chọn API chatbot; chưa khẳng định accuracy hoặc trả lời thật. Phần nghiệp vụ bên dưới đối chiếu nền `1f6c1fd` và workflow đã duyệt; [tiến độ](BACKEND_PROGRESS_CURRENT.md) phân biệt kiểm thử tự động với nghiệm thu thực. Android chưa triển khai.

## Kiến trúc và dữ liệu

Web React/TypeScript/Vite gọi REST NestJS. PostgreSQL lưu13 bảng nghiệp vụ: USERS, COOPERATIVES, AGRICULTURAL_MATERIALS, FARMING_STANDARDS, STANDARD_MATERIALS, FARMS, ZONES, USERS_ZONES, TREES, TREE_HARVESTS, DEVICES, SENSORS, ACTUATORS. MongoDB lưu IOT_TELEMETRIES, ACTUATOR_TASKS, CULTIVATION_EVENTS và state kỹ thuật. QR không có bảng riêng.

Workflow requests/version/audit/notifications dùng bảng kỹ thuật chung đã duyệt. HTTP/Auth/MQTT/workers/QR dùng chung runtime database; memory vẫn có cho test cô lập. Một PG pool/MongoClient/repository authority. Không giả có transaction chéo PG/Mongo. [Persistence](PERSISTENCE_DESIGN.md), [runtime](DATABASE_RUNTIME_IMPLEMENTATION.md).

Đọc ERD_DIAGRAM.xml và migration001–014 cùng các file schema được manifest import để hiểu schema vật lý cuối. Không sửa migration đã Applied. Định danh đối ngoại của hardware khác UUID nội bộ; không dùng station/stream/capability thay PK/FK.

## Tài khoản và HTX

Cập nhật24/10 theo [PDF/backend](BACKEND_PDF_REQUIREMENTS.md): đăng nhập và OTP dùng chung phone identity0/84/+84, không sửa số lưu/provider target. Phiên web theo15 phút không hoạt động; refresh riêng chỉ nhận JWT còn hạn, polling không gia hạn. Tài khoản sửa tên, email mới xác minh trước ghi, đổi mật khẩu cần mật khẩu cũ+SMS OTP riêng và thu hồi JWT cũ. Manager vẫn bắt buộc email verified; profile không sửa role/phone/ownership hoặc gỡ verified.

Ngoại lệ dữ liệu khởi tạo22/10 theo yêu cầu người dùng: [profile lịch sử1 tháng](RICH_OPERATIONAL_DATASET.md) được tạo Manager Active/Pending, HTX/membership/phân công sẵn với provenance GeneratedInitialization, không phải OTP/chữ ký thật. Ngoại lệ chỉ ở CLI development/test; đăng ký/duyệt/xác minh qua HTTP vẫn giữ các rule dưới đây. Trường REFERENCE_MANAGER_* trong .env dành cho tài khoản Manager chính tự đăng ký thật.

- Farmer đăng ký Active ngay; email tùy chọn. Email thuộc tối đa một tài khoản.
- Manager phải xác minh email thật, đăng ký Pending; Admin duyệt và tạo/gắn HTX mới Active. Một Manager quản lý một HTX. Admin không đăng ký công khai.
- Admin được tạo HTX chưa có Manager. Sau7 ngày cảnh báo,30 ngày xóa nếu vẫn chưa có Manager và không có tham chiếu nghiệp vụ; có tham chiếu thì giữ và cảnh báo.
- Manager sửa các thông tin cho phép của HTX mình qua xác minh email tài khoản rồi phone tài khoản theo thứ tự; chứng nhận do Admin quản lý. OTP/proof dở xác minh lại sau restart, nội dung đã duyệt lưu bền.
- Auth development/test, Twilio Verify cho SMS demo, SMTP cho email. Production Auth chưa hoàn tất. [Users](USERS_IMPLEMENTATION.md), [HTX](COOPERATIVES_IMPLEMENTATION.md).

## Farm, Zone và phân công

- Chủ Farmer tạo/sửa Farm cần Admin duyệt; Admin tạo/sửa cần chủ duyệt. Farm được độc lập. is_owner do backend cập nhật theo nghiệp vụ.
- Gia nhập HTX cần duyệt đối ứng và Manager chấp thuận. Rời HTX cần duyệt đối ứng, thông báo Manager; không cần Manager duyệt.
- Chủ tạo/sửa Zone trực tiếp; Admin chỉ đề xuất cần chủ chấp thuận; Manager chỉ đọc trong HTX. Tổng diện tích Zone không vượt Farm, kể cả lúc giảm Farm. Tiêu chuẩn gắn mới phải Active.
- Chủ phân công; Admin đề xuất cần chủ chấp thuận; Farmer nhận phải chấp nhận trước khi có quyền. Khoảng [start_date,end_date), end null là không định hạn; các phân công không giao nhau trên cùng Zone. Một Farmer được nhiều Zone.
- Hết phân công không tạo nhật ký/điều khiển hoặc đọc IoT; được đọc lịch sử canh tác của mình. Correction chỉ tác giả trong15 ngày từ end_date phân công gốc; phân công mới không gia hạn lịch sử cũ.

[Farm](FARMS_WORKFLOW_DESIGN.md), [Zone](ZONES_IMPLEMENTATION.md), [phân công](ASSIGNMENTS_IMPLEMENTATION.md).

## Cây và metadata IoT

- Chủ tạo/sửa cây và Device/Sensor/Actuator trực tiếp; Admin đề xuất cần chủ duyệt. Manager HTX và Farmer Accepted còn hiệu lực chỉ đọc đúng scope. Version/snapshot chặn duyệt đề xuất lỗi thời.
- tree_code backend sinh DRN-UUID/bất biến. Không chuyển Zone/hard-delete cây. Metadata cây có Active/Dead/Removed theo API.
- Device zone/station cố định; station UNIQUE NOT NULL, UUID nội bộ riêng; installed_at/cost NOT NULL. Active/Inactive/Maintenance là trạng thái quản trị, khác Online/Offline và trạng thái relay. last_seen_at do receiver cập nhật.
- Sensor UNIQUE(device_id,data_stream_id), giữ mã cả khi Inactive. Device/stream/type bất biến; sáu types air_temperature, air_humidity, soil_moisture, soil_temperature, soil_ph, soil_ec. Unit metadata varchar16 sửa được; min/max cùng null hoặc đủ cặp min<max. Không áp enum hai unit cũ hay tự đổi giá trị đo.
- Actuator UNIQUE(device_id,capability_id); device/capability/purpose bất biến, purpose watering/spraying/shared. Bơm có capability riêng, cần command riêng.

[Cây](TREES_IMPLEMENTATION.md), [IoT metadata](IOT_CORE_TABLES_SPEC.md), [adapter Device](POSTGRES_DEVICES_IMPLEMENTATION.md), [Sensor](POSTGRES_SENSORS_IMPLEMENTATION.md), [Actuator](POSTGRES_ACTUATORS_IMPLEMENTATION.md). Nguồn thiết kế IoT có thể còn enum cũ; đối chiếu quyết định sáu types và migrations hiện hành trước khi chỉnh ERD.

## Thu hoạch

- Một cây chỉ một bản ghi trên một harvest_date; có thể xuất hiện batch khác vào ngày khác. batch_code không UNIQUE; nhiều cây chung batch phải cùng Zone/ngày. Cộng dồn bằng sửa bản Draft, không tự cộng khi POST trùng.
- harvest_date là ngày thu hoạch thực; created_at là lúc nhập. Nhập bù tối đa7 ngày lịch Việt Nam; cũ hơn cần Admin cấp quyền phù hợp. Farmer chỉ nhập cây thuộc Zone có quyền hiện tại; chủ Farm nhập trực tiếp. Manager/Admin chỉ đọc dữ liệu và thực hiện quyền duyệt được quy định.
- Draft: tác giả/chủ sửa theo quyền; chỉ xóa Draft chưa từng Confirmed. Người tạo gửi lên; chủ xác nhận; nếu người tạo chính là chủ thì auto xác nhận. Lần xác nhận đầu updated_by/updated_at giữ null.
- Confirmed không sửa trực tiếp. Gửi correction thành Pending, dữ liệu đã duyệt giữ nguyên; nội dung sửa được Manager HTX hoặc Admin với Farm độc lập duyệt thì áp ngay, về Confirmed, ghi updated_by của editor và updated_at lúc duyệt.
- Khóa từng bản ghi, vẫn thêm cây khác cùng batch đúng Zone/ngày. Cây Dead/Removed chỉ nhập bù ngày cũ; correction không được đổi ngày sang hôm nay, nhưng giữ nguyên ngày đã lưu vẫn sửa được, kể cả ngày đó là hôm nay.

[Workflow](TREE_HARVESTS_WORKFLOW_DESIGN.md), [API](TREE_HARVESTS_IMPLEMENTATION.md), [PG](POSTGRES_HARVESTS_IMPLEMENTATION.md). Giữ một bảng nghiệp vụ TREE_HARVESTS; đề xuất chờ duyệt trong bảng kỹ thuật chung.

## Canh tác và QR

Cập nhật24/10: Other yêu cầu details.activity_name1–200 và note tùy chọn, không vật tư/thông tin tưới; khóa/correction/quyền gốc giữ nguyên. QR chỉ nhãn Other, không tên công việc/ghi chú tự do. Catalog thêm default_dosage_value số và dosage_basis cùng unit; nhãn default_dosage cũ giữ tương thích, lịch sử/hash không viết lại. Migration015 Mongo/016 PG là bổ sung, không sửa checksum cũ; ERD nguồn riêng cần đối chiếu các field mới.

- Chủ nhập trực tiếp; Farmer khác cần Accepted còn hiệu lực. Đang phân công được đọc toàn bộ nhật ký Zone; hết phân công chỉ lịch sử tự tạo.
- Target Zone hoặc cây cùng Zone; Watering thời lượng phút/lượng nước tùy chọn; Spraying/Fertilizing vật tư và lượng dùng, đơn vị snapshot. Chỉ vật tư Active; ngoài tiêu chuẩn được ghi kèm cảnh báo.
- Pending15 phút cho tác giả sửa/xóa. Locked không sửa/xóa; correction là bản mới giữ phân công/context gốc. Target/action đổi được trong cùng Zone, recheck quyền gốc. Chủ correction nhật ký mình khi còn là chủ.
- SHA-256 chain mỗi Zone gồm nhật ký Zone và cây, chỉ Locked nối theo lock_at rồi _id; genesis previous_hash=null. Không gọi là blockchain. Không tự sinh nhật ký từ ACK.
- QR public không đăng nhập: metadata cây/Zone/HTX/tiêu chuẩn, hoạt động và vật tư/lượng dùng, thu hoạch đã xác nhận. Cả gốc và mọi correction Locked được hiển thị, có nhãn target/latest/applies; chuyển A→B thì A vẫn thấy chuỗi và nhãn nội dung hiện tại không còn áp dụng cho A. Pending chưa công khai.
- Thu hoạch Pending sửa giữ nội dung đã xác nhận trên QR. Ẩn PII Farmer, địa chỉ/GPS Farm, số chứng nhận, field UUID nội bộ, ghi chú/lý do tự do và IoT. tree_code công khai vẫn theo định dạng DRN-UUID đã chốt.

[Canh tác](CULTIVATION_EVENTS_WORKFLOW_DESIGN.md), [QR](QR_TRACEABILITY_WORKFLOW_DESIGN.md).

## MQTT, telemetry và điều khiển

Nguồn đang dùng: [MQTT_HARDWARE_PROTOCOL_FINAL_v1.0](MQTT_HARDWARE_PROTOCOL_FINAL_v1.0.md); [implementation hiện hành](MQTT_COMMUNICATION_IMPLEMENTATION.md). Đã nhận FINAL v1.0 hardware-tested; topic/payload/IDs/action semantics được đóng băng. Recipe đã chuyển theo purpose metadata; purpose bất biến, mỗi vai trò đúng một actuator. Mọi command kể cả OFF cần Device/actuator Active theo chốt21/10.

- Hardware lên publish/station/{stationId}, server xuống subscribe/station/{stationId}. station từ topic resolve Device UUID; payload có station phải khớp. Không auth_token firmware, không coi station là secret. Không tự đổi protocol.
- Sáu stream demo301–306 theo metadata. Nhận packets hợp lệ khoảng15s từ hardware; không đổi thành15 phút. measured_at backend arrival, received_at bước ghi; giữ raw unit. FIFO tổng10.000 readings.
- Farmer chỉ latest/history khi assignment còn hiệu lực và readings trong khoảng được phép hiện tại; Farmer cũ không xem lịch sử IoT. Chủ/Admin/Manager theo scope hiện có.
- ACK taskId/status ACK/action0|1 là receipt ngay khi nhận command; confirmed_at backend ghi, không cho nhập tay, không chứng minh vật lý. Numeric hardware IDs phải positive safe integer.
- Recipe theo purpose shared/watering/spraying (seed demo mặc định2/3/4, hai van được gán ngược lúc đăng ký); không tưới/phun cùng Device đồng thời. Start van trước rồi bơm; Stop bơm trước rồi van. Chờ ACK10s mỗi bước.
- Restart/disconnect mode Unknown; trước Start tự Reset OFF2/OFF3/OFF4 đủ ACK. Partial Start có recovery Stop riêng. Không false Off, không replay ON; journal và allocator lưu bền, một controller lease.

## Quy ước phát triển và giới hạn

Comment logic khó; mỗi module/đợt một branch; cập nhật API/workflow/tests/giới hạn/cách tái lập. Postman JSON trực tiếp, JWT/UUID/OTP nhập tay. Không ghi đè .env, in/commit secrets, reset/clean/stage-all hoặc tự push/merge. Giữ nguồn riêng ERD/MQTT/Postman/UI/assets. Khi còn mơ hồ nghiệp vụ thì hỏi và chờ.

Kiểm thử mô phỏng không chứng minh hardware, SMS/email hay production đã nghiệm thu. [Kế hoạch](IMPLEMENTATION_PLAN.md) ghi rõ phần còn lại. Backup/restore, triển khai đích, production Auth và hardware thật phải có evidence riêng.
