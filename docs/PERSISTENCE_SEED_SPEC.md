# Seed demo — dữ liệu mô phỏng và một bộ hardware thật

Ngày 2026-10-10, bổ sung theo yêu cầu người dùng vào [thiết kế persistence](PERSISTENCE_DESIGN.md). Nhánh **docs/persistence-design**; tài liệu này là specification, chưa có seed runtime hoặc ghi database.

## Yêu cầu đã chốt

- DEVICES/SENSORS/ACTUATORS có dữ liệu mô phỏng đa dạng và **một bộ hardware thật** kết nối bằng station_id/dataStreamId/taskingCapabilityId thực tế.
- USERS có **một tài khoản demo chính dùng số điện thoại thật**, sử dụng luồng SMS/quên mật khẩu thật khi người trình diễn yêu cầu.
- Dữ liệu phải phù hợp bối cảnh vườn sầu riêng, quan hệ/diện tích/ngày/status hợp lệ. Seed chạy lại không ghi đè dữ liệu hiện có.
- Không đưa số điện thoại/mật khẩu/credentials thực vào source, collection Postman hoặc tài liệu. Không tự gửi OTP/email/SMS hay lệnh MQTT trong seed.

## Thông tin đã chốt

Người dùng xác nhận ngày 2026-10-10:

1. station_id ESP32 thật là `E08CFE41DCAC`. Đã điền vào khóa DEMO_DEVICE_STATION_ID trước đó trống trong .env local, giữ nguyên mọi byte ngoài giá trị này. Mã station là định danh, không phải secret/token. .env.example giữ giá trị trống để từng installation cấu hình riêng.
2. Farmer chính dùng AUTH_TEST_PHONE/AUTH_TEST_PASSWORD hiện có, làm chủ Farm chứa hardware thật. Không cần gửi lại thông tin đăng nhập trong chat.
3. Người dùng cho phép chọn ngày/giờ lắp hợp lý và chi phí khoảng10 triệu với số lẻ. Profile demo dùng `installed_at=2026-09-01T08:30:00+07:00` (01/09/2026 lúc08:30 giờ Việt Nam; UTC `2026-09-01T01:30:00.000Z`) và `cost=10237500` (10.237.500 VNĐ). Đây là metadata minh họa cho hồ sơ Device nối hardware thật, không tuyên bố là ngày lắp/hóa đơn thực tế. Ngày cố định trước ngày chốt10/10/2026, không lấy thời điểm chạy seed; chi phí là số VNĐ nguyên trong giới hạn decimal(10,2).

Theo yêu cầu dời ngày sớm hơn, profile đã đổi từ01/10 sang01/09/2026; giờ08:30 và cost10237500 giữ nguyên. Đây là cập nhật cấu hình trước khi có seed, không sửa dữ liệu database đã tồn tại; seed chạy lại sau này vẫn không được ghi đè Device đã có.

Các thông tin đầu vào của bộ thật đã đủ; không hỏi lại station/tài khoản/ngày lắp/chi phí. Đã thêm DEMO_DEVICE_INSTALLED_AT và DEMO_DEVICE_COST với các giá trị trên vào .env local/.env.example, giữ nguyên nội dung local trước đó. Ba khóa DEMO_DEVICE_* hiện chỉ là cấu hình tham khảo cho demo; runtime chưa đọc hai khóa mới, không tự đăng ký Device hoặc tạo quan hệ database. Foundation tiếp theo phải triển khai parser/preflight cho seed riêng; seed runtime chưa triển khai và chưa ghi database.

Kết quả đối chiếu cấu hình local chỉ ghi trạng thái, không ghi giá trị: broker host/port đã điền; SMS_PROVIDER=twilio; AUTH_TEST_PHONE khớp SMS_ALLOWED_PHONE sau chuẩn hóa. Đây không phải bằng chứng SMS đã gửi hoặc hardware đã kết nối trong lượt này. Khi triển khai seed mới, phải hướng dẫn và điền đầy đủ các khóa còn cần trong .env/.env.example, giữ nguyên giá trị cũ.

## Hardware thật

Một Device thật có đúng station_id ESP32 do người dùng cung cấp, UUID nội bộ backend/database cấp, Zone cố định thuộc Farm của tài khoản chính. **Một bộ thật không có nghĩa chỉ một dòng Sensor hoặc Actuator**: bộ hiện có cần ba luồng cảm biến và bơm/hai van.

| Bảng | Định danh giao tiếp | Nội dung |
|---|---|---|
| DEVICES | station_id E08CFE41DCAC từ cấu hình local | Active về quản trị lắp đặt; installed_at/cost minh họa được người dùng cho phép chọn như trên |
| SENSORS | data_stream_id="301" | air_temperature, unit C |
| SENSORS | data_stream_id="302" | air_humidity, unit % |
| SENSORS | data_stream_id="303" | soil_moisture, unit % |
| ACTUATORS | capability_id=2 | shared — bơm chung |
| ACTUATORS | capability_id=3 | watering — van tưới |
| ACTUATORS | capability_id=4 | spraying — van phun |

Sensors/Actuators tham chiếu Device UUID bằng device_id; không FK bằng station_id. Gateway đổi numeric dataStreamId MQTT thành mã string metadata, command đổi capability_id thành taskingCapabilityId như protocolv1 hiện có. UUID record không phải stream/capability/taskId. Seed không sửa topic, không thêm token firmware, không tái gán Zone hoặc thay station_id đã đăng ký.

Device và ba Sensors/Actuators của bộ thật được đặt metadata khả dụng theo profile demo đã chốt. last_seen_at bắt đầu null nếu chưa nhận message thật, connectivity Unknown; không seed Online hoặc timestamp mới chỉ vì đã tạo row. Sensor ngưỡng chưa có cấu hình thực giữ cả min/max null, có thể cấu hình qua API sau; không tự đặt ngưỡng canh tác chưa được chốt.

Luồng nghiệm thu sau khi repositories hoạt động: seed metadata → đăng nhập tài khoản chính → bật MQTT bằng cấu hình broker đã có → nhận packet station thật → tìm đúng Device UUID và ba Sensors → đọc Telemetry trên API/web. Control vẫn theo quyền chủ/Accepted assignment, bơm2/van3/4, receipt ACK đúng Device/taskId/action, timeout10s và Reset trước Start khi Unknown. Seed không tạo ACK/Confirmed task/Telemetry giả cho Device thật hoặc tự bật bơm/van.

## Hardware mô phỏng

Station mô phỏng dùng namespace riêng như `SIM_DEMO_001`, `SIM_DEMO_002`; phải kiểm tra không trùng station thật hoặc Device sẵn có. Có thể cùng sử dụng301/302/303 và2/3/4 trên Device khác vì unique là cặp Device+stream/capability. Các Sensors/Actuators cùng bộ luôn trỏ đúng Device của bộ đó.

Dữ liệu nguồn có nhãn/profile mô phỏng; danh sách tài nguyên demo và guide chỉ rõ Zone nào là hardware thật, Zone nào mô phỏng. Có thể lưu seed_origin/seed_key trong metadata kỹ thuật, không thêm enum Real/Fake vào status nghiệp vụ. Device mô phỏng có installed_at/cost mẫu hợp lệ cùng Active/Inactive/Maintenance phù hợp câu chuyện trình diễn, không tự gắn kết nối Online.

Mặc định metadata seed không phát sinh MQTT publish; các bài test MQTT giả dùng broker loopback và data cô lập như bộ tests hiện có. Không route message/lệnh của station mô phỏng sang station thật, không dùng fallback Device thật khi không tìm thấy station. Dữ liệu minh họa telemetry/task nếu bổ sung sau phải có profile riêng cho station mô phỏng và được ghi rõ; không gắn dữ liệu tạo sẵn thành kết quả đo/ACK của ESP32 thật.

## Tài khoản demo chính và tài khoản mẫu

Đã chốt Farmer chính dùng cấu hình điện thoại/password hiện có, role Farmer/Active; khi tạo Farm Accepted làm chủ, cập nhật is_owner đúng nghiệp vụ. ID/account name giữ nguyên khi đã tồn tại. Không hỏi lại lựa chọn tài khoản; không đưa số điện thoại/password thật vào tài liệu.

Lần tạo đầu hash password, chuẩn hóa identity chống trùng số0/84/+84, giữ quy ước login hiện tại. Chạy seed lại không reset password đã đổi, không sửa role/status/email_verify, không tạo user khác chỉ vì khác dạng viết số điện thoại. Nếu identity đã có nhưng role/liên kết không phù hợp profile, báo conflict để xử lý rõ ràng, không ghi đè.

SMS thật chỉ được gửi khi người trình diễn bấm yêu cầu OTP/quên mật khẩu cho tài khoản phù hợp allowlist và qua rate limit/provider hiện có. OTP nhập bằng tay như các module trước. Test tự động dùng mock, không đọc .env thật hoặc gửi tin mất phí. Backend restart vẫn giữ user/password/token version trong database; OTP chưa hoàn tất phải yêu cầu lại.

Admin bootstrap vẫn có tài khoản riêng từ cấu hình, không đăng ký Admin công khai. Tài khoản Farmer/Manager mẫu để trình diễn phải được ghi rõ trong profile; không thêm các số mẫu vào allowlist gửi SMS thật. Không seed Manager Active giả đã xác minh email hoặc giả HTX approval. Manager muốn demo Active phải hoàn tất email thật và Admin duyệt/gắn HTX theo luồng hiện có.

## Bộ dữ liệu minh họa đề xuất

Số lượng dưới đây là profile gọn cho demo, không ràng buộc mới của API và chưa seed thực tế:

| Nhóm | Quy mô minh họa | Đa dạng và tính hợp lệ |
|---|---|---|
| Farm/Zone | 3 Farm, 6 Zone | Chủ và assignee đúng scope; có Farm độc lập. Mỗi Zone có tiêu chuẩn; tổng diện tích không vượt Farm |
| Trees | Khoảng54 cây mẫu | Giống Ri6/Monthong, ngày trồng khác nhau; phần lớn Active, một số Dead/Removed; tree_code sinh backend, không chuyển Zone |
| Devices | 1 bộ thật +2 bộ mô phỏng | Bối cảnh đang dùng/ngắt sử dụng/bảo trì; installed_at/cost hợp lệ, station duy nhất |
| Sensors | 3 mỗi bộ, tổng9 | Đúng loại/đơn vị/stream; status đa dạng theo tình trạng bộ, ngưỡng chưa chốt để null |
| Actuators | 3 mỗi bộ, tổng9 | Bơm chung/van tưới/van phun rõ ràng, purpose/capability bất biến |
| Danh mục | Vật tư/tiêu chuẩn và liên kết mẫu | Có Active/Inactive; gắn mới chỉ Active; tên/đơn vị phù hợp nội dung minh họa, không tuyên bố chứng nhận thật |
| Phân công | Accepted hiện tại và lịch sử kết thúc | [start,end), không giao nhau cùng Zone; dữ liệu phụ bảo đảm snapshot/accepted_at và correction context |
| Harvest/Cultivation | Nội dung mẫu có profile riêng khi seed mở rộng | Draft/Pending/Confirmed hoặc Pending/Locked theo luồng hợp lệ; không dùng ACK để tự sinh nhật ký |

Ví dụ diện tích Farm1.2ha có Zone0.5+0.6ha; Farm1.8ha có Zone0.8+0.9ha; Farm2.4ha có Zone1.0+1.2ha. Các cây là mẫu đại diện trong demo, không gọi số lượng seed là kiểm kê toàn vườn. Địa chỉ/GPS/chứng nhận của Farm mô phỏng ghi rõ tính minh họa trong hướng dẫn và metadata, không lấy thông tin cá nhân thật làm dữ liệu mẫu.

Người trình diễn phải phân biệt telemetry hiện tại của trạm thật với hồ sơ canh tác/thu hoạch mẫu. QR vẫn chỉ whitelist dữ liệu được công khai, không làm lộ thông tin Farmer/GPS/chứng nhận/reason hoặc metadata seed private.

## Điều kiện kiểm thử seed

- Fresh seed tạo đúng quan hệ13 bảng chính/metadata kỹ thuật và bộ hardware; seed rerun giữ UUID, station, password mới, role/status và records đã có.
- Thiếu station/ngày lắp/cost/identity cần thiết: preflight báo tên trường thiếu; không chèn một phần bộ thật bằng placeholders. Seed không tự kết nối/sửa credential broker hoặc xác minh account.
- station thật va chạm mô phỏng hoặc bộ sẵn có sai Zone: báo conflict, không đổi định danh bất biến. Sensor/Actuator composite unique không chặn dùng cùng stream/capability trên Device khác.
- MQTT station thật chỉ ghi vào Device thật; station khác không ghi nhầm; metadata Inactive/Maintenance xử lý theo rule hiện có. Seed không giả last_seen_at/ACK.
- Real phone/password không xuất hiện trong log, file JSON/Postman export, reports hoặc Git diff. Kiểm thử provider giả chứng minh seed không tự gửi OTP/SMS/MQTT.
- Sau chuyển repository database: restart vẫn giữ bộ thật/account và các quan hệ; password reset qua SMS do thao tác người dùng được nghiệm thu riêng, không tự gửi trong test suite.

Foundation và các đợt repositories đọc specification này cùng PERSISTENCE_DESIGN.md. Tạo nhánh code riêng khi triển khai; cập nhật lệnh seed, cấu hình đầy đủ, profile/manifest phân biệt dữ liệu thật/mẫu và hướng dẫn demo trước hội đồng trong guide implementation.
