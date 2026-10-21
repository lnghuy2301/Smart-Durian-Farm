# Dữ liệu IoT mẫu khi chưa bật hardware

Cập nhật 21/10/2026, branch `feat/offline-demo-telemetry`, kế thừa `71fb723`. Không cần bật MQTT hoặc thay `.env`. Không có endpoint HTTP nhập telemetry giả.

## Phạm vi

Profile `offline-telemetry-v1` tạo **1.440 readings**: hai Device `SIM_DEMO_001` và `SIM_DEMO_002`, mỗi Device sáu streams301–306, mỗi stream120 mẫu cách15 giây, khoảng30 phút trước lúc chạy. Giá trị có biến thiên liên tục, hai vườn khác nhau; nhiệt độ/độ ẩm không khí, độ ẩm/nhiệt độ đất, pH/EC nằm trong khoảng minh họa. Không coi đây là dữ liệu thực nghiệm, kết quả AI hoặc khuyến cáo canh tác.

Chỉ nhận Device có cả station mẫu và provenance `durian-demo-v1:device-sim-N` / `Simulated` trong metadata kỹ thuật. Không nhận station tùy ý từ CLI, không chèn readings cho trạm thật. Units theo FINAL: C,%,%rH,C,H+,µS/cm. UUID Device vẫn là khóa liên kết Mongo, không dùng station làm FK.

Đây là import lịch sử offline rõ nguồn gốc, nên giữ nguyên Device Inactive/Maintenance, Sensor status, last_seen_at và trạng thái điều khiển. Không giả Online, ACK, tác vụ Confirmed hoặc kết quả vật lý. Receiver thật vẫn kiểm tra Active và lấy measured_at từ thời điểm backend nhận packet; import mẫu không thay quy tắc đó. Chỉ mẫu offline được tạo cặp timestamp lịch sử với độ trễ ghi20–25ms minh họa.

## Chạy từ máy mới / session mới

1. Đọc [handoff](MODULE_HANDOFF.md), kiểm tra branch/status; giữ `.env` và các thay đổi riêng. Cần DB đã migrate và profile metadata `durian-demo-v1`; không reset volume hoặc chạy seed để đổi mật khẩu.
2. Dừng API trước; CLI giữ cùng controller/migration lease để ngăn chạy đồng thời. Web có thể đóng trong lúc chuẩn bị. Không bật hardware/MQTT.
3. Từ root, tạo backup trước khi bổ sung:

```powershell
npm run db:backup
npm run db:demo:prepare
npm run db:seed:telemetry
npm run db:backup
```

`db:demo:prepare` chỉ bổ sung Sensor304–306 còn thiếu của hai Device mẫu, đổi unit303 legacy%→%rH và306 Greek mu→micro sign nếu gặp. Mọi tạo/sửa đi qua repository bình thường với actor là chủ Farm, có version/audit và recheck quyền; không SQL bypass. Chạy lại không thay các dòng đã đúng. Giữ các field khác của Sensor cũ, toàn bộ metadata trạm thật và trạng thái Device. Nếu stream/type/unit tùy chỉnh khác dự kiến, dừng `DEMO_CUSTOM_SENSOR_CONFIGURATION` để trao đổi; không tự ghi đè.

Các thay đổi chuẩn bị Sensor là từng transaction nghiệp vụ riêng. Nếu lỗi giữa chừng, các thao tác đã thành công vẫn còn; sửa nguyên nhân rồi chạy lại sẽ tiếp tục phần thiếu. Không tuyên bố atomic cho cả bước chuẩn bị hoặc giữa PostgreSQL/MongoDB.

`db:seed:telemetry` chỉ thành công khi journal telemetry **chưa từng có lần append**, kể cả khi số documents bằng0 nhưng sequence đã tăng. Kiểm tra và insert/counter cùng transaction Mongo. Chạy lại báo `DEMO_JOURNAL_ALREADY_USED_NO_DATA_CHANGED`; không tạo trùng hoặc eviction. Nếu đã có dữ liệu thật, bỏ qua seed mẫu, không xóa counter/collection để ép chạy lại. Công cụ bị chặn với `NODE_ENV=production`.

Khi npm wrapper gặp EPERM trên Windows, từ root dùng local Node tools tương đương:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.build.json
node apps/api/dist/persistence/demo-telemetry-cli.js prepare
node apps/api/dist/persistence/demo-telemetry-cli.js seed
```

Không có tham số broker, station hoặc password cần nhập thêm. CLI đọc `.env` hiện có, chỉ khởi tạo pool/client, không Nest App/Auth/SMS/email/MQTT providers. Lỗi driver được che để tránh lộ URI/credentials.

## Xem dữ liệu trên web/API

Khởi động API và web bằng `npm run dev:api`, `npm run dev:web`. Đăng nhập Farmer chính → vườn mẫu/Khu3 → Device `SIM_DEMO_001`; Admin có thể xem cả hai Device mẫu. `SIM_DEMO_002` thuộc Farmer mẫu khác; Farmer chính không tự được mở rộng quyền đọc. Manager chỉ có scope khi Active, đã xác minh và Farm thực sự vào HTX mình.

Tìm Device UUID từ danh sách Device rồi thay thủ công trong Postman/Swagger:

```text
GET http://localhost:3000/api/telemetry/devices/DEVICE_UUID/latest
GET http://localhost:3000/api/telemetry/devices/DEVICE_UUID/history?data_stream_id=301&limit=100&offset=0
```

Gắn Bearer JWT bằng tay. Latest mỗi Device có6 streams; history mỗi Device720 readings, một stream120 readings. Phân trang nếu cần mẫu thứ101–120. Không đặt bộ lọc ngày loại bỏ cửa sổ30 phút lúc seed; sau nhiều giờ/ngày dữ liệu vẫn là lịch sử cũ, không tự sinh mới. Inactive/Offline trên giao diện là đúng vì chưa có kết nối thực. Trạm thật vẫn trống cho đến packet hardware đầu tiên.

FIFO vẫn dùng chung **10.000 readings toàn hệ thống**, không dành quota riêng cho dữ liệu giả. Mẫu chiếm1.440 vị trí; hardware vào sau sẽ append bình thường và cuối cùng đẩy mẫu cũ ra. Một trạm sáu streams/15 giây tạo1.440 readings/giờ, nên10.000 readings tương đương khoảng6 giờ56 phút nếu chỉ có trạm đó. Đây là giới hạn retention, không giảm cadence thành15 phút.

## Kết quả local đã thực hiện

Đã backup trước:220 PG rows,0 Mongo documents. Chuẩn bị tạo6 Sensor mẫu, sửa2 unit303 mẫu; không đụng trạm thật. Import thành công1.440 readings. Sau bước này:240 PG rows,1.441 Mongo documents gồm1.440 readings và1 FIFO counter.

Đối chiếu archive trước/sau: chỉ public.sensors, technical.entity_metadata và technical.audit_events thay đổi trong PG;6 Sensor thêm và2 Sensor chỉ đổi unit đều thuộc hai Device mô phỏng. Các bảng khác và ACTUATOR_TASKS/CULTIVATION_EVENTS giữ nguyên. `.env` và MQTT_ENABLED=false giữ nguyên. Không gửi command/OTP/email/SMS.

Backup sau import đã restore-check vào database mới/rỗng trong fixture, checksum data khớp `293347b6c0f2b7ba17ac520ebef8f4ac4fa253667510204ae0ff9ce998ddaf05`; target kiểm thử đã xóa, database demo giữ nguyên. Archives trong `backups/` đã ignore; không đưa lên Git hoặc gửi model AI vì có dữ liệu tài khoản.

## Source, kiểm thử và giới hạn còn lại

- [Generator/import](../apps/api/src/persistence/demo-telemetry.ts), [chuẩn bị Sensor](../apps/api/src/persistence/demo-sensor-preparation.ts), [CLI](../apps/api/src/persistence/demo-telemetry-cli.ts).
- [Store](../apps/api/src/persistence/mongo-telemetry.store.ts): import dùng cùng schema/FIFO/counter/transaction của runtime, kiểm journal trống ngay trong transaction. Không thêm migration, collection hoặc store authority lúc API chạy.
- Unit generator2/2; toàn backend248/248. Integration mới7/7 gồm suite cha; regression telemetry16/16 và backup8/8: tổng31/31 trên ba suite. API lint/typecheck/build đạt. `npm run test:persistence` đã thêm suite mới; không tuyên bố đã chạy lại toàn bộ19 suite trong đợt này.
- Tái lập riêng: từ `apps/api`, `npm run test:demo-telemetry`; cần Compose fixture theo [runtime guide](DATABASE_RUNTIME_IMPLEMENTATION.md), không dùng DB demo làm fixture.
- Kiểm thử khóa controller/provenance, cập nhật legacy qua owner/audit, giữ custom metadata, SQL unchanged khi import, không đọc chéo scope, không trộn Device thật, live append sau seed, refuse rerun/no eviction và FIFO/restart/backup.

Các bước chưa thể đánh dấu hoàn thành: Manager thật/email/SMS/HTX Join, nghiệm thu ESP32 qua runtime API/web, môi trường production. Nhật ký/thu hoạch demo đi qua workflow bình thường; không seed giả Locked/Confirmed để lấp giao diện. Hai module AI chưa có model/provider/corpus đã thống nhất nên vẫn chờ thảo luận.
