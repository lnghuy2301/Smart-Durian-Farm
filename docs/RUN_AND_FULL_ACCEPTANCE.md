# Chạy dự án và kiểm thử toàn diện — 27/10/2026

Thư mục làm việc của **mọi terminal**: `D:\PROJECT\Smart-Durian-Farm`. Hướng dẫn này dùng dữ liệu/volume hiện có, không cài lại, không seed lại. Tài khoản/mật khẩu xem `docs/LOCAL_MODULE_ACCEPTANCE.private.md`; không chép thông tin đó vào báo cáo chia sẻ.

## 1. Bốn terminal và thứ tự chạy

Mở Docker Desktop, đợi engine sẵn sàng. Máy hiện có dependency Node/Python, best.pt và corpus nên không cần chạy npm install/pip install mỗi lần.

Nếu PowerShell chặn npm.ps1, dùng `npm.cmd` thay `npm` trong cùng lệnh; không cần đổi ExecutionPolicy toàn máy. Ví dụ `npm.cmd run dev:ai`.

### Terminal 1 — chuẩn bị, kiểm tra, thao tác quản trị

```powershell
cd D:\PROJECT\Smart-Durian-Farm
docker compose up -d --pull never
docker compose ps
npm run build
```

Kỳ vọng PostgreSQL/MongoDB Up/healthy. `mongo-init` chạy xong rồi Exited0 là bình thường. Docker chạy nền, terminal1 có thể dùng tiếp. `npm run build` phải thành công trước khi mở API bằng start:api.

### Terminal 2 — worker AI ảnh/PDF, giữ mở

```powershell
cd D:\PROJECT\Smart-Durian-Farm
npm run dev:ai
```

Kỳ vọng Uvicorn chạy `http://127.0.0.1:8001`. Không cần Activate.ps1: ai/run.py tự dùng ai/.venv. **Kích hoạt .venv không đồng nghĩa server đã chạy.** Terminal này cần cho chẩn đoán ảnh/nhập PDF; chatbot đọc corpus Mongo và gọi Gemini từ Nest, không cần Python để chat.

### Terminal 3 — backend API, giữ mở

```powershell
cd D:\PROJECT\Smart-Durian-Farm
npm run start:api
```

API mặc định `http://127.0.0.1:3000`. Dùng bản đã build để nghiệm thu ổn định. Khi sửa code, dừng terminal3, chạy lại build ở terminal1 rồi start lại. Nếu cần code tự reload, dùng `npm run dev:api` **thay** start:api; không mở cả hai vì cùng cổng3000.

Trong phiên kiểm OTP/ACK nên dùng start:api. Khi dùng dev:api, việc build có thể làm watcher restart server; có thể chạy pre-check không build bằng `node apps/api/dist/ai/pre-acceptance-cli.js` sau khi đã build thành công.

### Terminal 4 — giao diện web, giữ mở

```powershell
cd D:\PROJECT\Smart-Durian-Farm
npm run dev:web
```

Mở **http://127.0.0.1:5173/**. Vite proxy `/api` sang API3000. Trong phiên này dùng thống nhất127.0.0.1; đổi qua localhost tạo origin/sessionStorage khác và có thể khiến bạn tưởng bị mất phiên. Frontend không đọc key backend từ .env root.

### Quay lại terminal1 — kiểm tra trước khi đăng nhập

```powershell
npm run check:acceptance --workspace @smart-durian/api
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-RestMethod http://127.0.0.1:3000/api/health/ready
```

Kỳ vọng `can_start_full_manual_acceptance=true`, các check ready, API health/ready trả ok. Pre-check chỉ đọc, không gọi Google/OTP/hardware. Gemini ready/key_present=true là đã có cấu hình, **live_api_tested=false vẫn cần kiểm thử Google thật**. Nếu false/exit1, đọc từng check/field trong JSON trước dòng npm error.

API docs: **http://127.0.0.1:3000/api/docs**. Worker8001 không phải trang web cho người dùng; `/` có thể trả404, tài liệu Swagger Python được tắt chủ động. Không đưa token worker vào Swagger/Postman; private API chỉ dùng JWT.

## 2. Cấu hình hiện hành và khi nào restart

| Phần | Giá trị/ý nghĩa đã đối chiếu | Thao tác |
| --- | --- | --- |
| Storage | Database (mặc định ngoài NODE_ENV=test),18 migrations | Không ép memory, không seed lại |
| Gemini | provider=gemini, model=gemini-3.1-flash-lite, key hiện đã có | Sửa .env → restart API; không gửi key vào chat/Postman |
| AI ảnh | AI_SERVICE_ENABLED=true, worker127.0.0.1:8001, best.pt đã có | Thay weights/dependency → restart worker; thay config API → restart API |
| MQTT | **MQTT_ENABLED=false** ở lần đối chiếu này | Chưa bật hardware vẫn kiểm nghiệp vụ/AI được; phần telemetry live/control thật chưa nghiệm thu |
| MQTT broker | Host đã cấu hình, port1883, TLS=false | Dùng đúng broker firmware đang kết nối; compose hiện chỉ chạy database, không tự tạo MQTT broker |
| Device Offline | MQTT_OFFLINE_AFTER_MS=1800000, tức30 phút | Online dựa thời điểm last_seen; khác trạng thái broker hoặc Device Active |
| ACK | Chờ tối đa10 giây mỗi bước | ACK báo nhận command, không chứng minh bơm/van đã đổi vật lý |

Nếu cần test Offline nhanh, bạn có thể chủ động đặt tạm MQTT_OFFLINE_AFTER_MS=45000 rồi restart API; ghi giá trị cũ để phục hồi sau test. Không thay tốc độ gửi firmware chỉ để thử UI. Không đổi .env để reset password: password nằm trong database.

Không cần chạy `db:migrate`, `db:seed`, `db:data:refresh`, import corpus hoặc tạo lại tài khoản trong mỗi lần mở dự án. Chỉ bảo trì migration khi có Pending được xác định rõ. Hiện corpus có mốc15 PDF/1.220 chunks; số này có thể tăng khi Admin nhập thêm hợp lệ.

Đổi AI_INTERNAL_TOKEN cần restart cả worker và API để hai bên cùng token; đổi AI_DEVICE hoặc weights cần restart worker. Đổi Gemini key/model chỉ cần restart API, rồi tải lại web.

## 3. Phân biệt các phiên tài khoản

Chuẩn bị chủ Farm, Farmer nhận việc, Manager thật và Admin từ file private. Có thể dùng bốn tab/profile trình duyệt; kiểm tên và vai trò trên từng tab trước khi thao tác. Session dùng sessionStorage theo tab, reload giữ phiên; tab được nhân bản có thể khởi đầu bằng phiên sao chép, vì vậy không suy ra vai trò chỉ từ vị trí tab.

Farmer nhận việc cần phân công Accepted còn hiệu lực trên đúng Zone. Manager cần Active và được gắn đúng HTX; Farm độc lập không tự xuất hiện trong HTX Manager. Không tự gắn lại Farm/đổi phân công bằng SQL để làm bài test qua. Nếu không có dữ liệu phù hợp thì tạo qua workflow và ghi rõ ID hồ sơ mới.

## 4. Danh sách kiểm thử nghiệp vụ

Chưa có kết quả quan sát của bạn thì đánh dấu **Chưa chạy**. Checklist chi tiết từng nút/form đã có ở [MODULE_ACCEPTANCE_CHECKLIST](MODULE_ACCEPTANCE_CHECKLIST.md); bảng này là lộ trình độc lập để không bỏ nhóm chức năng.

| Mã | Ai thử và thao tác | Kỳ vọng cần kiểm | Kết quả |
| --- | --- | --- | --- |
| A01 | Bốn vai trò đăng nhập đúng/sai, reload, logout | Đúng dashboard/quyền; lỗi mật khẩu không đăng nhập; logout không còn dữ liệu riêng | Chưa chạy |
| A02 | Quên mật khẩu bằng phone thật; đổi mật khẩu trong tài khoản | Nhận OTP đúng số, sai/hết hạn bị chặn, password mới dùng được; phiên cũ bị thu hồi theo workflow | Chưa chạy |
| A03 | Farmer mới đăng ký; Manager mới đăng ký/xác minh email | Farmer Active ngay/email tùy chọn; Manager Pending, email thật bắt buộc; trùng phone/email bị chặn | Chưa chạy |
| A04 | Admin duyệt Manager và gắn HTX trống/tạo HTX | Manager Active đúng HTX, tên hiển thị cập nhật; không thay Manager HTX đã có; không quản lý hai HTX | Chưa chạy |
| A05 | Admin/Manager mở cùng hồ sơ, thử duyệt lần hai | Xử lý một lần; stale/race409 yêu cầu đối chiếu, không tạo HTX hoặc bản ghi trùng | Chưa chạy |
| A06 | Manager sửa thông tin HTX được phép | Email rồi SMS lần lượt; OTP sai/hết hạn/cancel không áp dụng; đúng hai bước mới cập nhật | Chưa chạy |
| A07 | Chủ Farm/Admin tạo/sửa Farm, Farmer khác thử sửa | Đúng duyệt đối ứng; người ngoài không có quyền; không giảm diện tích dưới tổng Zone | Chưa chạy |
| A08 | Farm xin gia nhập/rời HTX | Gia nhập thêm Manager chấp thuận; rời duyệt đối ứng và thông báo Manager, không thêm quyền duyệt rời cho Manager | Chưa chạy |
| A09 | Chủ sửa Zone, Admin đề xuất, Manager đọc | Chủ trực tiếp, Admin cần chủ duyệt; tổng diện tích không vượt Farm, tiêu chuẩn gắn mới Active | Chưa chạy |
| A10 | Chủ tìm Farmer tên có/không dấu hoặc phone, gửi mời | Thấy đúng tên/phone, đổi query bỏ chọn cũ; người nhận chưa Accepted chưa có quyền; người không có quyền không tra cứu directory | Chưa chạy |
| A11 | Farmer nhận/từ chối; thử phân công giao nhau và hết hạn | Khoảng[start,end), không giao nhau trên cùng Zone; nhiều Zone được phép; hết hạn mất quyền làm mới | Chưa chạy |
| A12 | Chủ tạo/sửa Tree, Admin đề xuất, Farmer/Manager đọc | tree_code backend sinh; Farmer phụ trách không sửa cây; không chuyển Zone đợt này | Chưa chạy |
| A13 | Admin tạo/sửa vật tư, tiêu chuẩn, liên kết | Liều số+đơn vị+cơ sở; validation số/enum; Farmer/Manager chỉ đọc; lịch sử cũ giữ snapshot | Chưa chạy |
| A14 | Farmer nhập Harvest Draft rồi gửi chủ duyệt | Đúng Tree/Zone/quyền; chủ tự tạo rồi gửi auto-confirm; lần xác nhận đầu updated_by/at vẫn null | Chưa chạy |
| A15 | Harvest cùng cây/ngày, nhiều cây chung batch; khác ngày/batch | Không trùng tree/date; nhiều cây cùng Zone/ngày dùng chung batch; thêm cây sau khi một dòng confirmed vẫn được | Chưa chạy |
| A16 | Nhập bù Harvest trong7 ngày, quá7 ngày, ngày tương lai | Trong hạn có quyền thì được; quá hạn cần grant Admin đúng người/Zone/ngày; tương lai bị chặn | Chưa chạy |
| A17 | Sửa/xóa Harvest, correction Confirmed, cây Dead/Removed | Chỉ xóa Draft chưa từng confirmed; Confirmed đi qua đề xuất và Manager đúng HTX/Admin cho Farm độc lập; không đổi ngày sang hôm nay cho cây Dead/Removed | Chưa chạy |
| A18 | Nhật ký tưới/phun/bón/Khác, toàn Zone hoặc riêng cây | Nội dung theo loại; vật tư Active; ngoài tiêu chuẩn có cảnh báo; Other nội dung riêng tư | Chưa chạy |
| A19 | Tác giả sửa/xóa Pending rồi thử sau15 phút | Chỉ tác giả sửa khi Pending; Locked bất biến; correction là bản mới, gốc không đổi | Chưa chạy |
| A20 | Correction nhật ký, đổi cây/loại trong cùng Zone; người khác thử sửa | Quyền theo tác giả/phân công gốc; hết phân công correction tối đa15 ngày từ end gốc; phân công mới không gia hạn lịch sử cũ | Chưa chạy |
| A21 | Kiểm tra chuỗi và xem nhật ký bằng Farmer đang/cũ phụ trách | Chuỗi hợp lệ; đang phụ trách xem cả Zone, hết hạn chỉ lịch sử mình; snapshot vật tư cũ không thay theo danh mục | Chưa chạy |
| A22 | Device/Sensor/Actuator tạo/sửa/đề xuất/ngoài quyền | station_id/stream/type/purpose bất biến theo rule; composite(Device,stream) duy nhất; unit/threshold đúng enum/range; không chuyển Zone | Chưa chạy |
| A23 | Manager/Farmer xem IoT và lịch sử theo phạm vi | Chỉ quyền hiện hành; Farmer cũ không xem lịch sử IoT; không rò dữ liệu khi đổi Device hoặc hết phân công | Chưa chạy |
| A24 | QR chưa đăng nhập, tải PNG, quét, correction đổi cây | Đúng cây; gốc+mọi correction Locked và nhãn áp dụng; không hiện Pending/private notes/PII/GPS/IoT hoặc đề xuất Harvest chưa duyệt | Chưa chạy |
| A25 | Thử thay UUID của tài nguyên/hội thoại/ảnh bằng tài khoản khác |403/404/điều hướng đúng, không trả dữ liệu; biết UUID không cấp quyền | Chưa chạy |
| A26 | Refresh phiên trong lúc form duyệt mở, submit hai lần, mạng lỗi | Form không tự thoát khi refresh token; không gửi/lưu trùng; phải đối chiếu sau409 hoặc response không chắc chắn | Chưa chạy |
| A27 | Mobile390×844/320×740, màn thấp1366×640 | Form/dialog/menu/bảng/AI dùng được, không tràn ngang toàn trang, tên/giờ Việt đọc được | Chưa chạy |
| A28 | Tạo hồ sơ mới, restart API rồi đọc lại | Cùng ID/nội dung/trạng thái/lịch sử; OTP đang dở cần xác minh lại; không mất dữ liệu hoặc auto phát ON | Chưa chạy |

HTX chưa có Manager có lifecycle cảnh báo/xóa theo quy tắc đã có: xem ngày hiển thị/thông báo thật. Không đổi đồng hồ máy hoặc timestamps database để giả lập7/30 ngày trong phiên nghiệm thu; các mốc dài ngày có kiểm thử tự động riêng. Không cố sửa hash trong database vận hành để thử phát hiện can thiệp; dùng fixture nếu cần thử phá dữ liệu.

## 5. AI — phần còn cần kiểm chứng thực tế

| Mã | Trường hợp | Kỳ vọng và điểm chưa chắc chắn | Kết quả |
| --- | --- | --- | --- |
| AI01 | Farmer gửi ảnh thật có nhãn đã biết, không chọn Zone | Nạp model thật, top3/điểm/nhãn Việt đúng format, có ảnh/lịch sử riêng; đối chiếu nhãn thật để đánh giá, không lấy smoke test làm accuracy | Chưa chạy |
| AI02 | Chọn Zone được/không được phân công; Admin/Manager vào AI | Chỉ Farmer dùng; chọn Zone phải có quyền; Farmer khác không xem ảnh/hội thoại dù có URL/ID | Chưa chạy |
| AI03 | File rỗng, quá5MiB, GIF/SVG/giả MIME, ảnh quá lớn | Từ chối rõ ràng, không tạo lịch sử thành công giả | Chưa chạy |
| AI04 | Ảnh cây khỏe/ảnh không liên quan, ảnh mờ, ảnh nhiều đối tượng | Model10 lớp bệnh chưa có healthy/out-of-domain; vẫn chỉ gợi ý, không được diễn giải chắc chắn bệnh/khỏe hoặc tự khuyến cáo thuốc | Chưa chạy |
| AI05 | Dừng worker ảnh rồi gửi, khởi động lại, feedback/reload | Lỗi503 không lưu prediction mới giả; history/feedback cũ giữ, chạy lại không có ảnh sai quyền | Chưa chạy |
| AI06 | Chat với key thật: chăm sóc sau thu hoạch/thán thư/rệp sáp | Google chấp nhận key/model/quota, trả tiếng Việt và nguồn PDF/trang gốc; đây mới xác nhận live_api, pre-check không xác thực điều này | Chưa chạy |
| AI07 | Câu không có trong nguồn, câu hỏi nối tiếp/mơ hồ | Không bịa nguồn/liều; nêu thiếu dữ liệu hoặc từ chối; retriever chủ yếu theo câu hiện tại nên nên viết rõ bệnh/công việc trong câu hỏi nối tiếp | Chưa chạy |
| AI08 | Kiểm nguồn dự thảo và hai quy trình đã tách | Giữ nhãn dự thảo/tham khảo; trích dẫn dùng source.page gốc, phần Cần Thơ265–272/Tiền Giang2–9; không gọi dự thảo là pháp luật đã ban hành | Chưa chạy |
| AI09 | Yêu cầu bot bỏ quy tắc hoặc bật bơm/xóa dữ liệu | Không có công cụ thực thi; đối chiếu thiết bị/dữ liệu không bị thay; chỉ trả lời trong phạm vi nguồn | Chưa chạy |
| AI10 | Key/quota/model lỗi hoặc mất mạng, bấm gửi liên tục | Không retry tự động/tin nhắn dở; giữ draft, không duplicate; khi lỗi không chắc chắn phải đọc lịch sử trước khi gửi lại | Chưa chạy |
| AI11 | Đổi Farm/Zone hoặc hết phân công rồi xem AI history | Tác giả vẫn giữ AI history riêng; không có quyền tạo chẩn đoán gắn Zone đã mất quyền; người khác không đọc được | Chưa chạy |
| AI12 | Restart API, mở lại hội thoại/ảnh/citation | History/source/feedback giữ; Gemini không cần Python để chat; Python không giữ key Gemini hoặc lịch sử nghiệp vụ | Chưa chạy |

Đánh giá Gemini: ghi câu hỏi, nguồn/trang đúng, nội dung model diễn giải và kết quả bạn chấm. JSON/source hợp lệ không chứng minh nội dung đúng. Một TCVN lỗi font vẫn bị loại; cần PDF tốt hơn hoặc OCR có kiểm tra nếu muốn bổ sung. Không nhập lại corpus chỉ vì gửi chat lỗi.

## 6. Chuyển sang hardware thật

Chỉ bắt đầu khi bạn trực tiếp quan sát phần cứng và chủ động sẵn sàng vận hành. Terminal1/2/4 giữ như trên; dừng API ở terminal3 trước khi sửa .env:

```dotenv
MQTT_ENABLED=true
```

Giữ host/port/protocol đúng firmware đang chạy, rồi `npm run start:api` lại. Không cần build chỉ vì sửa .env; API đọc lại khi khởi động. Nếu port/TLS/username/password cần đổi, dùng cấu hình broker thật; không tự thêm auth_token hoặc sửa firmware/topic. Nếu broker của bạn là dịch vụ ngoài thì máy chạy API phải truy cập được dịch vụ đó.

Admin xem `/api/mqtt/status` bằng JWT hoặc màn chẩn đoán hiện có: connected/subscribed chỉ chứng minh backend nối broker. Device chỉ Online khi có gói hợp lệ của trạm đăng ký, không phải cứ backend connected là ESP32 đã gửi.

| Mã | Trường hợp | Quan sát và kết quả mong đợi | Kết quả |
| --- | --- | --- | --- |
| HW01 | ESP32 thật gửi khoảng15s/lần | Đúng station_id E08CFE41DCAC, dữ liệu mới cập nhật đúng Device UUID, không tạo trùng Device/stream | Chưa chạy |
| HW02 | Sáu streams301–306 | 301/C,302/%,303/%rH,304/C,305/H+,306/µS/cm; raw số/đơn vị đúng firmware, không tự quy đổi lịch sử | Chưa chạy |
| HW03 | Measured/received time, latest/history, restart | measured_at backend arrival, received_at thời điểm ghi; dữ liệu tăng theo gói thật, lưu qua restart | Chưa chạy |
| HW04 | Rút điện/mất broker/kết nối lại | Broker state khác Device Online theo last_seen; hết ngưỡng mới Offline; reconnect không phát lại lệnh ON | Chưa chạy |
| HW05 | Từ Unknown bấm tưới một lần | Reset OFF bơm→hai van, chờ ACK từng bước; mở van watering rồi bật bơm; dùng capability2/shared,3/watering,4/spraying theo metadata hiện tại | Chưa chạy |
| HW06 | Tưới đang chạy rồi yêu cầu phun; nút Dừng | Không đồng thời; Stop tắt bơm trước rồi van; quan sát vật lý, không chỉ nhìn ACK/UI | Chưa chạy |
| HW07 | Thiếu1 ACK/trễ/trùng/sai taskId hoặc mất mạng giữa chuỗi | Không Confirmed giả; timeout10s/bước, fail/recovery theo dõi; không tự coi mọi tải đã OFF khi thiếu bằng chứng; ACK cũ không khôi phục tác vụ bị hủy | Chưa chạy |
| HW08 | Bấm Dừng lúc Start chờ; bấm hai lần; reload sau response mất | Chặn phần ON chưa gửi, không phát command trùng; đối chiếu task đã nhận, không bấm lại mù | Chưa chạy |
| HW09 | Restart API khi đang điều khiển | Không auto-ON; task/history giữ; trước lần Bật tiếp Reset và đủ ACK; kiểm trạng thái vật lý riêng | Chưa chạy |
| HW10 | Metadata Device/Actuator Inactive, thiếu/trùng purpose | Bảo đảm tải đã dừng trước khi thử; mọi command kể cả OFF bị chặn nếu Inactive; thiếu/trùng vai trò chặn Bật | Chưa chạy |
| HW11 | Farmer hết phân công/Admin/Manager thử điều khiển | Chỉ chủ hoặc Farmer đang có quyền mới gửi; Admin/Manager xem trong phạm vi; không có nút không đồng nghĩa API được bỏ kiểm quyền | Chưa chạy |

ACK xác nhận hardware **nhận lệnh**, không phải cảm biến phản hồi bơm/van đã hoạt động. Không giả ACK/telemetry cho station thật hoặc sửa taskId/timestamps trong DB để làm test qua. Ca fault hardware chưa đủ điều kiện thì ghi Chưa chạy; không tự coi là Pass vì loopback đạt.

## 7. Backup và kết thúc phiên

Khi xong, Dừng tưới/phun trên UI và quan sát tải đã tắt. Dừng API bằng Ctrl+C ở terminal3 trước khi backup; Python/web có thể giữ hoặc dừng theo nhu cầu.

```powershell
# Terminal1, API đã dừng
npm run db:backup
npm run db:backup:verify -- backups/TEN_FILE_THUC_TE.json
```

Giữ JSON cùng thư mục `.json.assets/` nếu có, sao lưu riêng best.pt/PDF gốc. Muốn thử phục hồi, dùng fixture riêng:

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d --pull never
npm run db:restore:check -- backups/TEN_FILE_THUC_TE.json
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml stop
```

Thay TEN_FILE_THUC_TE bằng file backup CLI vừa in ra. Restore-check chỉ tạo/xóa database tạm, không phục hồi đè database vận hành. Không dùng down-v/reset/clean để kết thúc phiên. Nếu muốn dừng database vận hành sau mọi việc: `docker compose stop`; dữ liệu vẫn ở volume. Nhớ đưa MQTT_ENABLED vềfalse và restart API khi quay lại phiên không kiểm hardware nếu đó là chế độ bạn muốn dùng.

## 8. Lỗi thường gặp và cách ghi evidence

| Hiện tượng | Kiểm tra trước |
| --- | --- |
| Pre-check exit1/npm error | Đọc check state/field; `not_running` worker thì mở terminal2, key config ready vẫn chưa chứng minh Google chấp nhận |
| Vite ECONNRESET/ECONNREFUSED | Terminal3 có API3000 không, lỗi startup/DB/config; terminal4 chạy không thay API |
| Port3000/5173/8001 đang dùng | Có instance đã chạy; không mở thêm instance trên cùng port, không kill process không xác định |
| Kết nối DB thất bại | Docker Desktop/compose Up/healthy, health/ready; không seed để sửa lỗi kết nối |
| Gemini503/429 | Terminal3 và thông báo đã được làm gọn; key/quyền/model/quota/network; không gửi key cho người khác hoặc đổi corpus để thử may rủi |
| AI ảnh503 | Terminal2, model/dependency/task, không nhầm key Gemini với token worker |
| MQTT chưa nhận dữ liệu | Enabled, broker host/port/TLS, connected/subscribed, station/topic đúng, Device/Sensor Active; ESP32 có điện/mạng |
| Manager không thấy Farm/hardware | Farm có ở đúng HTX không; Farm độc lập không tự gắn vào Manager; đây có thể là dữ liệu đúng |
| UI ghi Unknown sau ACK | Đúng giới hạn hiện tại: ACK không phải đo trạng thái vật lý |
| Quét QR bằng điện thoại không vào |127.0.0.1 trên điện thoại là chính điện thoại; cấu hình hiện tại bind local, chưa chứng minh dùng LAN/production. Thử cửa sổ chưa đăng nhập trên cùng máy trước |

Ghi mỗi case: mã, thời gian Việt Nam, commit, vai trò, ID hồ sơ/Device/tree_code/batch, bước tái lập, expected/actual, Pass/Fail/Chưa chạy và ảnh/log đã che dữ liệu nhạy cảm. Không chụp .env/OTP/JWT/API key. File kết quả có tài khoản giữ local/private, không commit.

Mức chắc chắn: tự động đã kiểm quyền/validation/workflow/persistence/loopback và lỗi provider giả lập; chưa thay thế Google key/quota/câu trả lời thật, accuracy ảnh, SMTP/SMS từng tài khoản hoặc quan sát hardware. Production host/domain/TLS/Auth/release Git cần chốt riêng sau phiên này. Hướng dẫn này chỉ bổ sung tài liệu, không chạy provider/hardware hoặc thay cấu hình.
