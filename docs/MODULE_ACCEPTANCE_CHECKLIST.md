# Hướng dẫn kiểm tra từng vai trò và module

**Tìm Farmer26/10:** chủ Farm chọn Zone→Mời phụ trách khu vực, tìm bằng tên có/không dấu hoặc phone0/84/+84, kiểm cả tên+phone rồi Chọn. Thử hai người trùng tên, đổi từ khóa phải bỏ lựa chọn cũ; trước Farmer chấp nhận chưa có quyền. Q trống chỉ gợi ý người từng Accepted cùng Farm, gồm phân công đã kết thúc; không có lịch sử thì trống. Manager/Farmer không phải chủ Zone không tra cứu được. Xem [API, giới hạn, Postman và tái lập](ASSIGNMENT_FARMER_SEARCH.md).

**Bổ sung26/10 — quản trị danh mục:** Admin mở Vật tư→Thêm vật tư, nhập tên/loại/liều số/đơn vị/cơ sở/cách ly; vào chi tiết→Sửa vật tư để đổi liều/status. Mở Tiêu chuẩn→Thêm/Sửa, kiểm mô tả để trống/xóa được; chi tiết tiêu chuẩn→Gắn vật tư→Bỏ liên kết có xác nhận, vật tư vẫn còn trong danh mục. Farmer/Manager đọc được nhưng không có nút ghi; gọi API ghi trực tiếp vẫn403. Liều văn bản cũ không bị tự suy đoán khi chỉ đổi tên. Xem [báo cáo/source/tái lập](PROJECT_REVIEW_20261026.md). Không sửa dữ liệu vận hành chỉ để thử; dùng tên kiểm thử dễ nhận biết và trạng thái Inactive sau nghiệm thu nếu người dùng chủ động tạo.

**Bổ sung24/10:** đọc [backend theo PDF](BACKEND_PDF_REQUIREMENTS.md). Kiểm phiên còn hoạt động sau15 phút kể từ login, để yên15 phút thì logout;0/+84 cùng tài khoản; `/account` sửa tên/email/đổi mật khẩu cũ+SMS OTP; catalog17 vật tư có số/đơn vị/cơ sở; nhật ký Other có tên/ghi chú riêng tư, QR không công khai free text. Bản private cũ giữ nguyên tài khoản và kết quả bạn đã ghi, không bị tự động ghi đè; dùng phần bổ sung này khi nghiệm thu chức năng mới.

Cập nhật 23/10/2026. Dùng với database hiện có, MQTT FINAL và giao diện đã Việt hóa. File này không chứa mật khẩu. **Bản local có thông tin đăng nhập và cùng checklist: `docs/LOCAL_MODULE_ACCEPTANCE.private.md`**, mở trực tiếp trong VS Code; file đó được Git bỏ qua.

Mỗi ô bên dưới là một bước **chưa được bạn nghiệm thu trong lần kiểm tra này**. Đánh dấu sau khi quan sát kết quả, không đánh dấu chỉ vì đã có test tự động. Ghi thêm ngày, tài khoản, mã hồ sơ và kết quả thực tế vào cuối file local. Không gửi bản có mật khẩu cho AI khác hoặc đưa lên GitHub.

## 0. Chuẩn bị và cách ghi kết quả

1. Mở bản local, chọn tài khoản theo vai trò. Chủ vườn, Farmer nhận việc, Manager và Admin là bốn ngữ cảnh khác nhau; chủ vườn vẫn có role Farmer.
2. Khởi động Docker Desktop và database hiện có bằng `docker compose up -d`. Không xóa volume, không chạy lại seed/migration để sửa lỗi đăng nhập.
3. Từ thư mục gốc, terminal thứ nhất chạy `npm run dev:api`, terminal thứ hai chạy `npm run dev:web`. Đọc cổng thực tế trong terminal; web mặc định `http://localhost:5173`, API mặc định `http://localhost:3000/api`.
4. Giữ MQTT tắt khi kiểm phần mềm offline. Lịch sử mô phỏng chỉ nằm ở các station mô phỏng; không thêm telemetry giả cho `E08CFE41DCAC`.
5. Dùng cửa sổ ẩn danh hoặc đăng xuất trước khi đổi tài khoản. Trang `/account` phải đúng người. Web lưu phiên trong sessionStorage của tab, không chia sẻ JWT qua file kiểm tra.
6. Với bài kiểm tra có ghi dữ liệu, ghi lại ID mới và giá trị ban đầu. Chọn tài nguyên được phép thao tác, tránh thay đổi hồ sơ cần trình bày trước khi chụp đối chiếu. Bản Locked/Confirmed có quy trình riêng, không SQL để sửa ngược.
7. Postman: nhập JSON trực tiếp, chọn Bearer Token và dán JWT thủ công; UUID/OTP lấy từ response hoặc UI rồi dán tay. Không cần môi trường/scripts.

- [ ] API/database khởi động thành công, không fallback RAM.
- [ ] Web vào được `/login`, không có lỗi tải tài nguyên.
- [ ] Mở `/account` của từng tài khoản và xác nhận đúng vai trò.
- [ ] Ghi phiên bản Git, thời gian và trạng thái hardware đang tắt/bật vào báo cáo.

## 1. Đăng nhập, SMS và tài khoản

**Ai kiểm:** bốn tài khoản chính. **Trang:** `/login`, `/forgot-password`, `/register`, `/account`. **API chính:** `/auth/login`, `/auth/me`, `/auth/forgot-password`, `/auth/reset-password`.

- [ ] Đăng nhập đúng phone/password: vào dashboard tương ứng; refresh vẫn giữ phiên còn hạn.
- [ ] Nhập sai mật khẩu: báo lỗi, không mở trang bên trong.
- [ ] Đăng xuất: quay về đăng nhập; URL bên trong không hiện dữ liệu của phiên trước.
- [ ] Chủ vườn thật nhận SMS quên mật khẩu; dùng OTP để đổi; đăng nhập bằng mật khẩu mới thành công, mật khẩu cũ bị từ chối.
- [ ] Sau đổi mật khẩu, cập nhật ghi chú đăng nhập local bằng tay. Việc sửa `.env` không reset password trong database, không dùng seed để khôi phục password.
- [ ] Farmer mới đăng ký Active ngay, email tùy chọn; chưa có Farm hoặc phân công thì giao diện hướng dẫn nhận việc/tạo vườn, không hiện quyền sở hữu giả.
- [ ] Tài khoản Pending/Reject không đăng nhập được; không có đăng ký Admin công khai.

Các số/email tạo sẵn chỉ dùng kiểm quyền và dữ liệu; không phải địa chỉ nhận OTP thật. Không thêm hàng loạt số này vào SMS allowlist.

## 2. Đăng ký và duyệt Manager thật

**Ai kiểm:** Manager chính sẽ đăng ký và Admin. **Trang:** `/register`, `/pending-managers`, `/cooperatives`.

- [ ] Điền tên/phone/email/password của Manager chính vào nhóm `REFERENCE_MANAGER_*` để ghi nhớ; sau đó vẫn phải tự đăng ký trên web. Các biến này không tự tạo user.
- [ ] Xác minh email thật trong luồng đăng ký; không nhận boolean verified từ client.
- [ ] Đăng ký thành công ở trạng thái Pending; trước khi Admin duyệt chưa đăng nhập được.
- [ ] Admin thấy Manager ở danh sách chờ; chọn HTX chưa có Manager hoặc tạo HTX trong luồng duyệt.
- [ ] Sau duyệt, Manager Active đăng nhập được và chỉ thấy HTX được giao. Một Manager không quản lý đồng thời hai HTX; không ghi đè Manager hiện tại.
- [ ] Dùng Manager Pending tạo sẵn để thử Từ chối nếu cần. Thao tác này thay đổi dữ liệu thật; chưa có luồng tự nộp lại sau Reject.

Manager tạo sẵn Active giúp thử dashboard và quyền đọc; email `example.invalid` không kiểm được SMTP/SMS thật. Dùng Manager chính cho bước xác minh provider.

## 3. Dashboard, menu và tên hiển thị

**Trang:** `/`, `/assigned-work`, `/account`, `/requests`.

- [ ] Admin ưu tiên việc chờ duyệt và danh mục; Manager ưu tiên đúng HTX; chủ vườn có Vườn của tôi; Farmer thường có Công việc được giao.
- [ ] Farmer thường không thấy nút sửa cây/thiết bị hoặc thao tác dành cho chủ vườn.
- [ ] Danh sách, lọc, phân trang, chi tiết và nút quay lại hoạt động.
- [ ] Tên người/HTX/Zone thay UUID khi được phép xem; mã cây/lô/trạm/ID hồ sơ giữ nguyên. Trỏ chuột lên tên đã tra cứu để xem ID.
- [ ] Hồ sơ đề xuất hiện Người tạo/Người cập nhật/Thời điểm tạo bằng tiếng Việt; giờ theo Việt Nam, ngày thu hoạch `dd/MM/yyyy`, số thập phân dùng dấu phẩy.
- [ ] Snapshot đơn không có cột Trước thay đổi trống; đề xuất sửa có trước/sau rõ ràng. Tên liên quan là tên hiện tại; nội dung snapshot giữ nguyên.
- [ ] Mobile không tràn ngang toàn trang, menu đóng/mở đúng. Lỗi mạng có thông báo và thử lại, không hiện dữ liệu cũ như dữ liệu mới.

## 4. Hợp tác xã và xác minh thay đổi

**Ai kiểm:** Admin, Manager thật, Farmer đọc. **Trang:** `/cooperatives`, `/cooperative-updates`.

- [ ] Admin tạo HTX chưa có Manager và sửa thông tin được phép; không gắn Manager tùy ý trong body tạo/sửa HTX.
- [ ] Manager chỉ sửa tên HTX, giám đốc, địa chỉ, số liên hệ của HTX mình; không sửa số giấy chứng nhận hoặc chuyển Manager.
- [ ] Gửi yêu cầu sửa: thông tin chính thức chưa đổi; xác minh **email tài khoản trước, SMS phone tài khoản sau**; chỉ sau đủ hai bước mới áp dụng.
- [ ] Hủy yêu cầu/chờ hết hạn/OTP sai không làm thay đổi thông tin HTX.
- [ ] Admin sửa hồ sơ trong lúc Manager đang xác minh: đề xuất cũ không ghi đè dữ liệu mới; thông báo xung đột rõ.
- [ ] Farmer không sửa HTX; Manager không sửa/xem dữ liệu ngoài phạm vi được cấp.

Worker cảnh báo HTX chưa có Manager sau 7 ngày, xét xóa sau 30 ngày; có tham chiếu nghiệp vụ thì giữ và cảnh báo. Không đổi giờ máy hoặc dữ liệu DB vận hành để ép kiểm bước này; các ca thời gian có bộ test tự động riêng.

## 5. Danh mục vật tư, tiêu chuẩn và liên kết

**Ai kiểm:** Admin ghi; Farmer/Manager đọc. **Trang:** `/materials`, `/standards`.

- [ ] Admin tạo/sửa vật tư với loại, đơn vị, liều tham khảo, ngày cách ly và trạng thái hợp lệ.
- [ ] Admin tạo/sửa tiêu chuẩn, thêm/bỏ liên kết vật tư; liên kết không trùng.
- [ ] Farmer/Manager đọc danh mục nhưng không có quyền sửa.
- [ ] Tiêu chuẩn mới gắn vào Zone phải Active; lịch sử đã dùng danh mục cũ không bị viết lại sau thay đổi danh mục.
- [ ] Ngưỡng/đơn vị trên UI khớp dữ liệu đã nhập, thông báo lỗi trường bắt buộc rõ ràng.

## 6. Vườn và gia nhập/rời HTX

**Ai kiểm:** chủ vườn, Admin, Manager HTX. **Trang:** `/farms`, `/farms/{id}/membership`, `/requests`, `/farm-notifications`.

- [ ] Chủ gửi tạo/sửa Farm: đợi Admin duyệt; Admin đề xuất thì đợi chủ Farmer duyệt. Chưa duyệt chưa thay nội dung chính thức.
- [ ] Farm độc lập vẫn vận hành được, không bắt buộc gia nhập HTX.
- [ ] Gia nhập HTX: đủ duyệt đối ứng Admin–chủ và Manager HTX cần tham gia; thiếu một bên chưa gia nhập.
- [ ] Rời HTX: duyệt đối ứng Admin–chủ; Manager nhận thông báo, không phải người duyệt rời.
- [ ] Manager chỉ đọc Farm thuộc HTX mình; chủ Farm không đọc hồ sơ riêng của Farm khác.
- [ ] Giảm diện tích Farm dưới tổng diện tích Zone bị từ chối; hồ sơ cũ vẫn nguyên vẹn.

## 7. Khu vực canh tác

**Ai kiểm:** chủ vườn, Admin, Manager, Farmer nhận việc. **Trang:** `/zones`, `/requests?kind=zone`.

- [ ] Chủ tạo/sửa Zone trực tiếp trong vườn mình; tổng diện tích không vượt Farm.
- [ ] Admin đề xuất thay đổi: chủ duyệt mới có hiệu lực; không tự ghi trực tiếp.
- [ ] Không gắn tiêu chuẩn Inactive mới; tiêu chuẩn cũ chuyển Inactive không xóa lịch sử liên quan.
- [ ] Manager trong HTX và Farmer được phân công chỉ đọc; không sửa metadata Zone.

## 8. Phân công và hết hiệu lực

**Ai kiểm:** chủ vườn và Farmer thường chính. **Trang:** `/assignments`, `/assigned-work`, `/requests?kind=assignment`. **API danh sách:** `/zone-assignments`.

- [ ] Lấy mã Farmer tại `/account`, chủ mời đúng tài khoản vào Zone; chưa chấp nhận thì chưa có quyền làm việc.
- [ ] Farmer chấp nhận: được xem toàn bộ nhật ký Zone, nhập công việc/thu hoạch và dùng quyền IoT hiện hành.
- [ ] Không tạo khoảng phân công giao nhau trên cùng Zone; một Farmer được phụ trách nhiều Zone.
- [ ] Tạo khoảng ngắn hoặc dùng Kết thúc phân công đúng workflow; sau kết thúc, Farmer không tạo nhật ký/thu hoạch mới hoặc điều khiển, không xem latest/lịch sử IoT.
- [ ] Sau kết thúc vẫn đọc lịch sử canh tác do mình tạo và lịch sử phân công; không tiếp tục xem toàn bộ nhật ký người khác.
- [ ] Quyền correction canh tác của Farmer nhận việc tối đa 15 ngày từ end_date phân công gốc; phân công mới không kéo dài quyền sửa lịch sử cũ.

Chủ vườn nhập cho Zone/cây của mình không cần tự phân công. Thử hết hạn trên một phân công riêng, không kết thúc phân công đang cần cho các bước kế tiếp khi chưa ghi rõ.

## 9. Cây trồng

**Trang:** `/trees`, `/requests?kind=tree`.

- [ ] Chủ tạo cây trong Zone mình; backend sinh tree_code; xem giống, ngày trồng, tọa độ và trạng thái.
- [ ] Chủ sửa trực tiếp; Admin đề xuất chờ chủ duyệt; Farmer nhận việc và Manager chỉ đọc.
- [ ] Không cho đổi tree_code hoặc chuyển Zone ở giai đoạn này.
- [ ] Kiểm lịch sử cập nhật và trang QR từ cây; không nhầm UUID nội bộ với mã cây.
- [ ] Không đổi cây đang dùng demo thành Dead/Removed chỉ để thử rồi SQL khôi phục; dùng cây riêng cho ca trạng thái.

## 10. Thu hoạch và cấp quyền nhập bù

**Ai kiểm:** tác giả Farmer, chủ vườn, Manager HTX hoặc Admin. **Trang:** `/tree-harvests`, `/requests?kind=harvest`, `/harvest-backdates`.

- [ ] Farmer đang phụ trách hoặc chủ tạo Draft: chọn cây/ngày thật/số quả/kg/mùa vụ/mã lô; created_at do hệ thống đặt.
- [ ] Nhiều cây cùng Zone/ngày dùng chung batch_code được; cùng cây/ngày không thêm dòng trùng, thu thêm thì sửa cộng dồn Draft hiện có. Cùng cây khác ngày được xuất hiện ở batch khác.
- [ ] Tác giả hoặc chủ sửa Draft; chỉ xóa Draft chưa từng Confirmed. Không có xóa hồ sơ từng Confirmed.
- [ ] Tác giả gửi, chủ xác nhận từng bản ghi; người tạo đồng thời là chủ thì tự duyệt. Việc xác nhận một dòng không khóa cả batch.
- [ ] Xác nhận lần đầu: updated_by/updated_at vẫn null; không coi đây là thiếu dữ liệu.
- [ ] Nhập trong 7 ngày lịch Việt Nam được theo quyền; xa hơn cần Admin cấp đúng người/Zone/ngày và còn hạn, vẫn phải đủ quyền làm việc.
- [ ] Cây Dead/Removed: không tạo thu hoạch ngày hiện tại, cho nhập bù ngày cũ theo quyền/hạn. Correction không đổi sang hôm nay nhưng giữ ngày đã lưu thì vẫn được sửa nội dung.
- [ ] Confirmed không sửa trực tiếp: gửi lý do, chuẩn bị nội dung đề xuất; khi Pending vẫn giữ nội dung chính thức cũ.
- [ ] Manager đúng HTX duyệt correction; Farm độc lập do Admin duyệt. Khi chấp nhận, áp dụng ngay và trở lại Confirmed, ghi updated_by/updated_at; từ chối giữ nội dung cũ.

## 11. Nhật ký canh tác và hash-chain

**Trang:** `/cultivation-events` và chi tiết nhật ký.

- [ ] Chủ nhập trực tiếp; Farmer khác cần phân công Accepted đang hiệu lực. Chọn toàn Zone hoặc cây cụ thể trong Zone.
- [ ] Tưới nhập thời lượng phút, lượng nước tùy chọn; phun/bón nhập vật tư Active và lượng dùng. Ngoài tiêu chuẩn được ghi nhưng phải có cảnh báo.
- [ ] Trong 15 phút Pending/chờ khóa: chỉ tác giả được sửa/xóa; cho sửa hoạt động và đối tượng trong cùng Zone.
- [ ] Sau hạn, nhật ký Locked bất biến. Chỉ tác giả tạo correction theo quyền; không đổi bản gốc hoặc chuyển sang Zone khác.
- [ ] Dùng Kiểm tra chuỗi: mỗi Zone có một chuỗi gồm hoạt động Zone/cây, SHA-256 phát hiện can thiệp. Không gọi đây là blockchain.
- [ ] Farmer đang phụ trách xem toàn bộ Zone; hết phân công chỉ giữ lịch sử của chính mình và hạn correction gốc như mục 8.
- [ ] Sửa thông tin vật tư sau khi đã ghi không thay snapshot vật tư trong nhật ký cũ.

Không chỉnh timestamps để bỏ qua 15 phút. Có thể kiểm phần đọc trước, quay lại kiểm Locked sau khi hết hạn thực tế.

## 12. Device, Sensor và Actuator

**Trang:** `/devices`, `/sensors`, `/actuators`, `/requests`.

- [ ] Device có UUID nội bộ riêng, station_id duy nhất/bất biến; cần Zone, installed_at và cost ngay lúc lắp. Không đăng ký lại station thật.
- [ ] Chủ ghi trực tiếp, Admin đề xuất cần chủ duyệt; Manager/Farmer nhận việc chỉ đọc metadata. Không chuyển Zone.
- [ ] Device Active/Inactive/Maintenance là trạng thái quản trị; Online/Offline là kết nối. Active không chứng minh thiết bị đang có điện.
- [ ] Sensor: cùng Device không trùng data_stream_id; Device khác có thể dùng cùng stream. Type/stream cố định; đơn vị chỉ chọn enum đang hỗ trợ, không tự convert dữ liệu lịch sử.
- [ ] Có đủ sáu loại: 301 nhiệt độ không khí/C; 302 độ ẩm không khí/%; 303 độ ẩm đất/%rH; 304 nhiệt độ đất/C; 305 pH/H+; 306 EC/µS/cm.
- [ ] Actuator: purpose và capability bất biến sau đăng ký; mỗi Device đúng một shared, một watering, một spraying. Thiếu/trùng vai trò phải chặn Bật.
- [ ] Cây chịu tác động theo Zone của Device, không thêm device_id riêng vào cây.

## 13. IoT offline và nhận hardware thật

**Trang:** `/iot`. **API:** `/mqtt/devices/{device_id}/status`, `/telemetry/devices/{device_id}/latest`, `/telemetry/devices/{device_id}/history`.

- [ ] Hardware tắt: Device mô phỏng có lịch sử phong phú; trạm thật không được bịa readings hoặc hiển thị Online chỉ vì có metadata.
- [ ] Lọc lịch sử/stream/thời gian, phân trang và đơn vị raw; metadata đổi không sửa readings cũ. Retention tối đa 10.000 readings theo store hiện hành.
- [ ] Chủ, Admin và Manager đúng HTX đọc được theo phạm vi; Farmer nhận việc chỉ đọc khi còn hiệu lực, Farmer cũ không đọc lịch sử IoT.
- [ ] Khi sẵn sàng hardware mới bật MQTT theo cấu hình đang có; không sửa firmware/topic. Topic lấy station_id để tìm UUID Device; collections dùng device_id nội bộ.
- [ ] Trạm thật gửi khoảng 15 giây/lần; sáu streams hiển thị đúng. measured_at là thời điểm backend nhận vì firmware không có timestamp; received_at là bước ghi dữ liệu, không giả là giờ đo do hardware gửi.
- [ ] Mất broker/thiết bị ngừng gửi: UI thể hiện đúng trạng thái và thời gian tín hiệu cuối; kết nối lại không tạo metadata trùng.

## 14. Điều khiển tưới/phun — chỉ kiểm khi có người quan sát hardware

**Trang:** `/actuator-control`. Đối chiếu [MQTT FINAL integration](MQTT_FINAL_INTEGRATION.md) trước khi gửi lệnh. Không dùng Postman gửi lệnh thủ công song song với lượt kiểm trên UI.

- [ ] Admin/Manager chỉ xem; chủ hoặc Farmer đang được giao mới có nút điều khiển. Chọn thao tác chưa xác nhận thì chưa gửi command.
- [ ] Mọi command kể cả OFF/Recovery đều yêu cầu Device và Actuator liên quan Active. Khi Inactive, giao diện báo chặn đúng, không báo đã tắt.
- [ ] Khi trạng thái chưa xác định, Start tự Reset tắt bơm rồi hai van, chờ từng ACK, sau đó mở van chức năng rồi bật bơm. Mỗi bước chờ tối đa 10 giây.
- [ ] Hiện tại pump capability 2/shared, van 3/watering, van 4/spraying; server chọn theo metadata purpose đã đăng ký, không đổi vai trò tùy ý.
- [ ] Không tưới và phun đồng thời trên cùng Device. Stop tắt bơm trước rồi đóng van theo chuỗi có ACK.
- [ ] ACK chỉ xác nhận đã nhận lệnh; ghi riêng quan sát bơm/van có thực sự chạy/tắt. Không coi Confirmed là chứng minh trạng thái vật lý.
- [ ] Chỉ nhận một ACK/thiếu ACK: không Confirmed giả; tác vụ thất bại và recovery riêng, UI theo dõi kết quả. ACK đến trễ/trùng không làm bật lại thao tác cũ.
- [ ] Stop trong lúc Start đang chờ phải hủy phần ON chưa gửi; không gửi lặp khi bấm hai lần.
- [ ] Ngắt kết nối hoặc restart: không replay ON, giữ lịch sử task; trước lần Bật tiếp chạy Reset và chờ đủ ACK.

Ca mất mạng/ACK là nghiệm thu có chủ đích với người vận hành; nếu chưa đủ điều kiện ghi **Chưa chạy**, không tự sửa firmware hoặc giả ACK cho trạm thật.

## 15. QR truy xuất công khai

**Trang:** `/trace/{tree_code}` từ chi tiết cây; thử cửa sổ chưa đăng nhập và điện thoại nếu web truy cập được từ điện thoại.

- [ ] QR tải được và trỏ đúng web origin, mở được cây theo tree_code, không cần JWT.
- [ ] Hiện mã cây, giống/ngày trồng/trạng thái, Zone/HTX, tiêu chuẩn, hoạt động/vật tư và thu hoạch đã xác nhận.
- [ ] Không hiện tên/phone/email Farmer, GPS/địa chỉ Farm, số chứng nhận, UUID dưới dạng trường nội bộ, ghi chú tự do hoặc dữ liệu IoT. tree_code vốn chứa UUID vẫn là mã truy xuất được phép công khai.
- [ ] Hiện bản gốc và mọi correction Locked; correction Pending chưa công khai. Nếu đổi cây A sang B, cả hai QR có chuỗi với nhãn phiên bản/áp dụng hiện tại đúng.
- [ ] Harvest đang Pending correction tiếp tục hiện nội dung Confirmed cũ; Draft/Pending chưa từng Confirmed không hiện.

## 16. Restart, dữ liệu và backup

- [ ] Tạo xong một hồ sơ đã duyệt, ghi mã; restart API rồi mở lại vẫn còn cùng ID/nội dung/trạng thái.
- [ ] OTP/email/SMS đang dở phải xác minh lại sau restart; tài khoản đã duyệt và đề xuất nghiệp vụ đã lưu không bị mất.
- [ ] Lịch sử task/telemetry/Locked cultivation giữ nguyên; Start không tự phát khi khởi động.
- [ ] Theo [backup/restore guide](DATABASE_BACKUP_RESTORE.md), tạo backup và verify; restore-check vào database kiểm tra mới, không restore đè database đang dùng.
- [ ] Sau kiểm tra, ghi rõ những dữ liệu nghiệp vụ đã tạo/thay đổi. Không reset/clean/xóa volume để “làm sạch”.

## 17. Tổng kết nghiệm thu

| Mục | Người kiểm/tài khoản | Mã hồ sơ | Kết quả thực tế | Đạt/Lỗi/Chưa chạy | Ngày giờ |
| --- | --- | --- | --- | --- | --- |
| Đăng nhập/SMS | | | | Chưa chạy | |
| Manager thật/email/SMS/HTX | | | | Chưa chạy | |
| Dashboard/menu/hiển thị | | | | Chưa chạy | |
| HTX/danh mục/tiêu chuẩn | | | | Chưa chạy | |
| Farm/Zone/phân công | | | | Chưa chạy | |
| Cây/thu hoạch/nhập bù | | | | Chưa chạy | |
| Canh tác/correction/hash-chain | | | | Chưa chạy | |
| Metadata/telemetry | | | | Chưa chạy | |
| Hardware/control/ACK | | | | Chưa chạy | |
| QR/restart/backup | | | | Chưa chạy | |

Nếu gặp lỗi: ghi bước tái lập, vai trò, ID hồ sơ, thông báo và ảnh đã che thông tin nhạy cảm. Không ghi JWT/OTP/mật khẩu vào báo cáo chia sẻ.

## AI — nền tảng mới26/10

27/10 thêm [nghiệm thu Gemini](GEMINI_CHATBOT_IMPLEMENTATION.md): điền key/restart API, kiểm status→gửi→nguồn/trang/dự thảo→reload giữ lịch sử; thử key sai/quota không tạo tin nhắn dở. Không đánh dấu đã nghiệm thu live chỉ dựa trên test giả lập.

Checkpoint mới: [AI_RAG_CORPUS_IMPLEMENTATION](AI_RAG_CORPUS_IMPLEMENTATION.md), model thật và15 PDF đã nhập.

- [ ] Admin xem prepared/documents và tìm “thán thư”, kiểm tra filename gốc/trang gốc và nhãn dự thảo trong source.
- [ ] Hai quy trình tổng hợp chỉ dùng trang265–272 và2–9 của phần sầu riêng; TCVN lỗi font không nằm trong danh sách Active.
- [ ] Kết quả ảnh có label_vi, giữ nhãn/điểm gốc, hiển thị top3 gợi ý; không khẳng định khỏe mạnh hoặc tự đưa thuốc.

Đọc [AI_BACKEND_IMPLEMENTATION](AI_BACKEND_IMPLEMENTATION.md), dùng Postman AI-Backend nhập tay. Chưa có UI AI.

- [ ] Farmer gửi ảnh không Zone; có Zone thì chỉ nhận Zone có quyền, Manager/Admin không chẩn đoán.
- [ ] Chưa có best.pt: nhận lỗi chưa sẵn sàng, không tạo lịch sử giả. Có model thì đánh giá ảnh đã biết nhãn và top3.
- [ ] Farmer khác không đọc được chẩn đoán, ảnh hoặc hội thoại; lịch sử riêng vẫn xem được sau hết phân công.
- [ ] Admin nhập PDF văn bản, kiểm tra tìm kiếm đúng trang/đoạn; Farmer không quản lý corpus.
- [ ] Provider disabled: gửi chat báo chưa cấu hình, không ghi cặp tin nhắn. Chỉ nghiệm thu chat thật sau chốt API/corpus.
- [ ] Backup/restore cả JSON và thư mục .assets đi kèm; restart vẫn giữ lịch sử và ảnh/PDF.

Tài liệu chi tiết: [quy tắc hiện hành](PROJECT_BUILD_SPEC.md), [bàn giao](MODULE_HANDOFF.md), [runtime](DATABASE_RUNTIME_IMPLEMENTATION.md), [hiển thị tiếng Việt](frontend/modules/READABLE_BUSINESS_INFORMATION.md), [dữ liệu một tháng](RICH_OPERATIONAL_DATASET.md).
