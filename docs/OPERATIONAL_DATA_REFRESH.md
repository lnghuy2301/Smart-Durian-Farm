# Chuẩn hóa dữ liệu khởi tạo — 22/10/2026

Branch `feat/realistic-operational-data` kế thừa giao diện theo vai trò `d649de1`. Người dùng yêu cầu bỏ nội dung hiển thị như demo/mẫu, dùng tên, mã hồ sơ và mô tả tự tạo sát bối cảnh sản xuất. Người dùng cũng cho phép đổi riêng hai station mô phỏng sang định dạng12 ký tự hex; chỉ ESP32 đã cấu hình là hardware thật.

## Phạm vi và nguồn gốc

Profile `operational-content-v1` dùng nội dung từ [operational-data-profile.ts](../apps/api/src/persistence/operational-data-profile.ts): tên tài khoản, HTX, vật tư, quy trình, hồ sơ Farm, tên Zone và Sensor. Đây là nội dung khởi tạo tự tạo, không phải xác minh danh tính, chứng nhận, liều dùng hay khảo sát thực địa. Mã HS-... không chứng minh cơ quan nào đã cấp giấy chứng nhận; trước vận hành thực tế chủ dữ liệu cần thay bằng hồ sơ chính xác. Giữ provenance trong metadata/audit nội bộ, không gắn chữ demo vào tên nghiệp vụ hiện tại.

Tên khởi tạo: Admin Trần Quốc Huy, chủ Farm Nguyễn Minh Quân, Farmer phụ Lê Văn Phúc; HTX Sầu Riêng Phước An. Tài khoản có tên do người dùng tự sửa được giữ nguyên. Số điện thoại đăng nhập, mật khẩu/hash, email, xác minh, role/status/token_version, ownership và các phê duyệt đã thực hiện không được đổi để tạo cảm giác dữ liệu thật.

Hai station khởi tạo chuyển như sau:

| Trước | Sau | Hardware thật |
| --- | --- | --- |
| SIM_DEMO_001 | B48A0A6C912E | Không |
| SIM_DEMO_002 | C8F09E7D2B14 | Không |

Giữ nguyên UUID/Zone, Sensor stream/type/UUID, Actuator capability/purpose/UUID và toàn bộ readings. FK nội bộ dùng Device UUID nên không cần viết lại Mongo. Không đổi station ESP32 thật hoặc `.env`, không giả last_seen_at/Online/ACK và không gửi MQTT/OTP/email/SMS. Mã giống MAC không chứng minh có hardware tương ứng.

## Quy tắc bảo trì

- Công cụ chỉ chạy development/test, không có HTTP endpoint. Dừng API trước. Tự tạo archive đầy đủ PG/Mongo trong backups/ rồi mới sửa.
- Giữ migration/controller lease và khóa17 bảng dữ liệu +ledger. So sánh toàn bộ PG với archive vừa tạo trước bất kỳ thay đổi nào; snapshot cũ hoặc khác database bị từ chối.
- Chỉ sửa các field thuộc profile khởi tạo có seed_key đúng và giá trị cũ khớp từng field. Không thay chuỗi toàn database, không ghi đè nội dung người dùng đã sửa. Chạy lại không tạo audit/version cho dòng không đổi.
- Đây là đợt bảo trì nội dung khởi tạo được người dùng yêu cầu, không phải luồng sửa Farm/Zone/HTX qua API. Không tạo phê duyệt hoặc chứng minh email/SMS giả. API vận hành vẫn giữ đầy đủ các phê duyệt cũ.
- Riêng hai station mô phỏng: yêu cầu provenance Simulated và đúng mã cũ. Công cụ tạm tắt duy nhất trigger device_identity trong transaction có khóa, đổi hai mã rồi bật lại trước commit. Không tắt ALL triggers hoặc sửa migration đã Applied. Nếu bất kỳ bước nào lỗi, PostgreSQL rollback cả dữ liệu lẫn trạng thái trigger. Sau commit, quy tắc station_id bất biến tiếp tục có hiệu lực.
- Chỉ đổi nhãn Zone trong snapshot của hai phân công khởi tạo; giữ ID, dates, accepted_at, ownership/scope và quyền correction. Không sửa snapshot workflow của người dùng, journal Locked, hash-chain hoặc audit lịch sử. Vì lịch sử bất biến được giữ, nhãn demo cũ có thể còn xuất hiện trong audit/bản lịch sử trước chuyển đổi.
- Xóa duy nhất Manager khởi tạo có tên/email/phone cố định cũ, Pending, chưa verify và không có bất kỳ tham chiếu nào trong archive PG/Mongo. Manager thật hoặc tài khoản đã được sử dụng không bị xóa. Không tự tạo Manager Active: người dùng vẫn cần đăng ký email thật và Admin duyệt/gắn HTX.
- Một transaction PG cho toàn bộ lần apply. Mongo chỉ đọc để backup/kiểm tham chiếu; không tuyên bố transaction chung hai DB. Backup không bị xóa khi apply thất bại.

## Tái lập

Từ root, sau khi dừng API và giữ database chạy:

```powershell
npm run db:data:preview
npm run db:data:refresh
```

Preview chỉ tạo backup và báo số bản ghi/field tùy chỉnh được giữ, không sửa database. Apply cũng tự backup mới, không dùng archive của máy khác để ghi. Backup chứa dữ liệu cá nhân/hash: không commit/gửi AI, backups/ đã ignore. Không cần thay hoặc thêm key .env.

Nếu npm wrapper bị EPERM:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.build.json
node apps/api/dist/persistence/operational-data-cli.js preview
node apps/api/dist/persistence/operational-data-cli.js apply
```

Seed CLI cho database mới dùng cùng tên/nội dung và hai station hex, không tạo lại Manager giả. Seed không ghi đè nội dung hiện có. Các fixture test vẫn được phép khởi tạo Pending Manager/namespace legacy để kiểm backward compatibility; không dùng chúng làm dữ liệu xác minh thật. Công cụ telemetry offline và chuẩn bị Sensor nhận cả namespace cũ/mới với cùng seed provenance, không cho tùy ý chỉ định station thật.

## Kiểm tra giao diện theo vai trò

Sau cập nhật, khởi động API/web rồi đăng xuất/đăng nhập lại để nạp tên tài khoản mới. Không seed lại hoặc reset mật khẩu.

| Vai trò/ngữ cảnh | Kiểm tra |
| --- | --- |
| Admin | Tổng quan; tên Users/HTX; danh mục vật tư/quy trình; Farm/Zone/cây; xem IoT; duyệt yêu cầu. Dùng thông tin AUTH_TEST_ADMIN_* hiện có, mật khẩu trong database không đổi. |
| Farmer chủ Farm | Vườn của tôi: hồ sơ Krông Pắc/Cái Bè và các Zone thuộc quyền; cây; cấu hình trạm; phân công; nhập canh tác/thu hoạch. Thay đổi Farm vẫn cần Admin duyệt. |
| Farmer phụ | Công việc được giao: Zone ven mương và lịch sử; chỉ xem metadata của Farm được giao, không sửa cây/Device của chủ. Tài khoản này cũng sở hữu Farm riêng ở Đạ Huoai, nên có cả ngữ cảnh chủ và nhận việc. |
| Manager | Không dùng tài khoản giả đã xóa. Đăng ký email thật/phone riêng → OTP email → Admin duyệt/gắn HTX → Farm gia nhập đủ các bước → xem dữ liệu HTX đúng scope. Sửa HTX vẫn email rồi SMS. |
| IoT | Trạm B48A0A6C912E/C8F09E7D2B14 giữ lịch sử khởi tạo; trạm thật chỉ có readings hardware thực. Metadata Inactive/Maintenance và Offline là đúng, không tự bật để làm đẹp giao diện. |
| QR | Mã cây/URL giữ nguyên, tên Zone/quy trình hiện tại mới; journal/thu hoạch chỉ xuất hiện theo trạng thái công khai đã chốt. |

Nếu mục đích cần Farmer hoàn toàn không sở hữu Farm, đăng ký Farmer mới và phân công qua workflow; không sửa is_owner trực tiếp. Manager chưa vào HTX hoặc Farm chưa gia nhập sẽ có màn hình trống đúng scope.

## Source và kiểm thử

[Refresh transaction](../apps/api/src/persistence/operational-data-refresh.ts), [CLI](../apps/api/src/persistence/operational-data-cli.ts), [profile](../apps/api/src/persistence/operational-data-profile.ts), [integration](../apps/api/integration/operational-data.integration.ts).

Suite mới kiểm preview, tên tùy chỉnh, lease, stale backup, collision rollback, trigger sau thành công/thất bại, giữ credentials/roles/ownership/history/Mongo, làm mới nhãn snapshot khởi tạo và idempotency. Bộ test persistence đã bao gồm suite mới. Nghiệm thu hardware/SMS/email thật không được thay thế bằng kết quả fixture.

## Kết quả thực hiện local

Ngày22/10/2026: preview khớp source backup; apply thành công29 bản ghi nghiệp vụ và2 nhãn snapshot phân công; xóa1 Manager placeholder cùng metadata của tài khoản đó. Giữ UUID, password/hash/token_version, phone/email, roles/status, ownership, dữ liệu cây/thu hoạch, requests và mọi audit cũ. Hai mã station mới được kiểm tra, trigger device_identity vẫn Enabled sau chuyển đổi.

Đối chiếu13 bảng public không còn chuỗi demo/mẫu/minh họa. Các audit lịch sử/provenance kỹ thuật vẫn giữ nguyên có chủ đích. `.env`/MQTT=false giữ nguyên. Không phát command hoặc gửi OTP/email/SMS.

Backup trước:242 PG rows/1.443 Mongo documents. Backup sau:272 PG rows/1.443 Mongo documents; tăng audit mới, không thêm/sửa Mongo. Snapshot Mongo so sánh chính xác trước/sau khớp. Restore-check vào database fixture mới/rỗng thành công; data_sha256 `5ddbe746249eaf28ec16d2265ee7f1efeb7aeed511b1e4007565e0aff8f27c03`. Preview sau apply:0 thay đổi/0 xóa. Archives chỉ nằm trong backups/ đã ignore.

QA:248/248 backend unit đạt. Đã chạy toàn bộ20 suite persistence: lần đầu285/287 đạt, một subtest và suite cha thất bại do fixture chọn Zone theo UUID ngẫu nhiên trúng phân công đang mở. Đã sửa fixture chỉ chọn Zone chưa có phân công, không sửa constraint nghiệp vụ; chạy lại foundation và suite chuyển đổi đạt23/23. Suite telemetry offline sau thay đổi đạt7/7. Đây là kiểm chứng kết hợp full run và rerun các suite bị ảnh hưởng, không tuyên bố một full run mới288/288. API lint/typecheck/build đạt.

Database sau chuyển đổi có1 Admin Active và2 Farmer Active, chưa có Manager thật Active. Manager giả bị xóa không được thay bằng tài khoản xác minh giả; cần người dùng hoàn tất luồng đăng ký/xác minh thật để kiểm giao diện Manager.
