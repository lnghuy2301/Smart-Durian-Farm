# Bộ dữ liệu vận hành một tháng

Ngày22/10/2026, branch `feat/rich-operational-dataset` kế thừa `d39e841`. Người dùng chốt lịch sử khoảng một tháng, ưu tiên ĐBSCL và giữ Tây Nguyên/Đắk Lắk; cho phép khởi tạo Manager đã duyệt/chờ duyệt, HTX có/chưa có Manager và Farm đã/chưa tham gia HTX.

## Tài khoản và hướng dẫn kiểm tra — cập nhật23/10

[Checklist từng module](MODULE_ACCEPTANCE_CHECKLIST.md) là bản chia sẻ không có mật khẩu. Bản đầy đủ có thông tin đăng nhập/tài nguyên theo tài khoản là `docs/LOCAL_MODULE_ACCEPTANCE.private.md`, được Git bỏ qua; mở trực tiếp tại máy, không gửi AI khác hoặc commit.

`.env` chỉ giữ bốn nhóm tài khoản:

- `AUTH_TEST_PHONE/PASSWORD`: chủ vườn chính, giữ nguyên.
- `AUTH_TEST_ADMIN_PHONE/PASSWORD`: Admin chính, giữ nguyên.
- `REFERENCE_FARMER_NAME/PHONE/PASSWORD`: Nguyễn Văn An, Farmer chỉ nhận việc, không sở hữu vườn. Đây là nhóm chính thay cho `REFERENCE_ASSIGNED_FARMER_*` cũ; Lê Văn Phúc đã chuyển sang hướng dẫn local vì còn sở hữu Farm.
- `REFERENCE_MANAGER_NAME/PHONE/EMAIL/PASSWORD`: dành cho Manager thật sẽ tự đăng ký/xác minh và được Admin duyệt. Chưa điền thì để trống, không tự tạo user.

Đã chuyển thông tin Farmer/Manager bổ sung ra khỏi `.env`, không xóa tài khoản khỏi database. Bản local có14 tài khoản hiện có (đối chiếu14 mật khẩu khớp hash ở thời điểm lập file) và một vị trí cho Manager thật sẽ đăng ký. Có tên, phone/password tham khảo, trạng thái, mã tài khoản, HTX/vườn/Zone và phân công liên quan. Nếu đổi mật khẩu sau đó, cập nhật ghi chú bằng tay; không reset DB để khớp cấu hình.

CLI tạo dữ liệu không bổ sung các nhóm tài khoản vào `.env` nữa. Sau khi kiểm hash, ghi thông tin còn thiếu vào file `.private.md` nói trên, có marker chống trùng; giữ nguyên kết quả kiểm tra thủ công/mật khẩu đã ghi, không ghi đè. Mật khẩu chưa xác nhận là null. Các tên marker `REFERENCE_EXTRA_*`/`REFERENCE_SEEDED_*` chỉ là mã nội bộ trong bản local, không phải biến môi trường cần thêm lại.

Máy mới clone không có bản private và mật khẩu thật. Người vận hành giữ/chuyển bản private bằng phương thức riêng phù hợp, hoặc sao chép checklist công khai rồi tự điền tài khoản đã có; không chạy seed chỉ để lấy lại mật khẩu. Khi CLI cần tạo bản private lần đầu, nó chép các bước từ checklist công khai trong cùng thư mục; lần sau không ghi đè kết quả kiểm tra đã nhập.

Kiểm tra thay đổi23/10:2/2 unit tests của `local-login-guide.test.ts` đạt (không ghi `.env`, không lộ mật khẩu chưa xác nhận, chống trùng/giữ ghi chú, kèm checklist); API lint, typecheck/build và kiểm tra cấu hình `.env` đạt. Đợt này không đổi nghiệp vụ/domain/HTTP/web hoặc chạy lại toàn bộ regression. Database chỉ SELECT/hash, không gửi OTP, đăng nhập hay lệnh MQTT.

Các Manager tạo sẵn dùng email miền example.invalid không gửi thư được và phone khởi tạo không được đưa vào SMS allowlist. User đã cho phép trạng thái verified/Active khởi tạo trong profile này; metadata giữ verification_origin=AuthorizedGeneratedInitializationNotProviderProof. Đây không phải bằng chứng OTP thật. Muốn test email/SMS thực tế, dùng Manager chính đăng ký bằng địa chỉ/số thật, không gửi OTP/password trong chat.

## Nội dung thêm

| Nhóm | Bổ sung |
| --- | --- |
| Farmer |8 tài khoản:5 chủ Farm,3 chỉ nhận phân công, đều Active|
| Manager |3 tài khoản:2 Active quản lý hai HTX riêng,1 Pending chưa gắn HTX|
| HTX |Ngũ Hiệp, Quới Sơn có Manager; Thanh Bình chưa có Manager; giữ HTX Phước An hiện có|
| Farm |5 Farm:Ngũ Hiệp,Long Tiên,Quới Sơn,Thanh Bình ở ĐBSCL và Đạ M’ri ở Lâm Đồng;3 thuộc HTX,2 độc lập|
| Zone/cây |10 Zone,360 cây Ri6/Monthong, có Active/Dead/Removed; tổng diện tích Zone không vượt Farm|
| Phân công |5 phân công Accepted, cho3 Farmer làm việc ở nhiều Zone, lịch sử cùng khung thời gian|
| Canh tác |130 nhật ký trong28 ngày:tưới theo Zone,bón theo Zone,phun riêng cây; Locked qua deadline15 phút và chuỗi SHA-256 của10 Zone|
| Thu hoạch |160 dòng trong20 batch;130 Confirmed,10 Pending chờ chủ,20 Draft; cùng batch nhiều cây đúng Zone/ngày|

Giữ nguyên3 Device hiện có, sensors/actuators, station thật và hai mã hex đã chuẩn hóa; không thêm telemetry/ACK giả cho hardware. Không đổi trạm/cây/nhật ký/thu hoạch do người dùng đã nhập. Những Pending cũ đến hạn có thể được worker/store khóa đúng nghiệp vụ; Locked cũ không viết lại hash.

## Cách sinh dữ liệu và các ngoại lệ đã chốt

Profile `operational-month-v1` tạo graph khởi tạo PG trong một transaction với seed provenance rõ ràng. Farmer/Manager/HTX/Farm/membership/phân công ban đầu là dữ liệu bootstrap được người dùng cho phép; không giả rằng các OTP/chữ ký đã được thực hiện bởi người thật. Các Manager và HTX có quản lý được đặt trước lịch sử; HTX chưa có Manager được tạo hiện tại để không dựng hồ sơ vô chủ quá30 ngày.

Nhật ký/thu hoạch tạo qua DatabaseCultivationRecords/PostgresHarvestsRepository với clock lịch sử chỉ được inject trong bundle CLI. Không sửa Date.now toàn cục, firmware, .env thời gian, DTO hoặc backend đang chạy. Không chèn thẳng Locked/hash hay Confirmed thu hoạch. Deadline, assignment, vật tư Active, batch/Tree/date, author submit và owner confirm đều dùng nghiệp vụ đang có. Lần xác nhận đầu updated_by/updated_at vẫn null.

Những số liệu vật tư/nước/sản lượng là giá trị khởi tạo tự tạo, không phải khuyến cáo liều dùng hoặc kết quả khảo sát. Chi tiết vật tư giữ snapshot của danh mục và cảnh báo ngoài tiêu chuẩn theo logic hiện hành. Mã hồ sơ là mã khởi tạo, không chứng minh chứng nhận cơ quan nhà nước.

## Chạy và phục hồi khi gián đoạn

Dừng API, giữ PostgreSQL/MongoDB chạy, từ root:

```powershell
npm run db:data:expand
```

Nếu npm wrapper EPERM:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.build.json
node apps/api/dist/persistence/rich-data-cli.js
```

Không thêm key bắt buộc: mật khẩu khởi tạo lấy REFERENCE_FARMER_PASSWORD hoặc AUTH_TEST_PASSWORD local. CLI tự backup trước và sau; archive trong backups/ đã ignore, không gửi AI hoặc commit. Giữ controller/migration lease suốt quá trình ghi, không Nest/App/Auth/MQTT/SMTP providers, không gửi lệnh hoặc OTP. NODE_ENV chỉ development/test; từ chối nếu số tạo sẵn trùng số operator/allowlist. File mật khẩu local không phải nguồn để thay đổi password DB. Không chạy công cụ tạo dữ liệu chỉ để lập checklist.

Không có transaction chung PG/Mongo. Graph PG atomic; các bước nhật ký/thu hoạch commit riêng và được checkpoint trong entity_metadata. Khi Mongo commit xong mà checkpoint PG thất bại, chạy lại sẽ tìm bản gốc bằng actor/time hoặc Tree/date, kiểm xung đột và tiếp tục. Profile Complete chạy lại không ghi đè nội dung, password hay lịch sử. Nếu lỗi, giữ backup và tiến độ, không xóa collection/counter/seed_key để ép chạy. Không auto migration/restore/reset.

## Kiểm tra giao diện

Khởi động API/web, đăng xuất và đăng nhập lại. Mở .env để lấy tài khoản, không cần gửi mật khẩu qua chat.

1. Admin: tổng quan số lượng, HTX, Manager Pending; duyệt Manager thứ3 và gắn HTX chưa có Manager nếu muốn. Kiểm Farm/Zone/cây và yêu cầu xác nhận thu hoạch.
2. Manager tạo sẵn thứ1: HTX Ngũ Hiệp và hai Farm Ngũ Hiệp/Long Tiên. Manager thứ2: HTX Quới Sơn và Farm Quới Sơn. Không thấy dữ liệu HTX khác hoặc Farm độc lập; không có quyền ghi nhật ký/sửa cây. Email/SMS thật dùng Manager chính riêng.
3. Farmer thêm thứ1–5: Vườn của tôi, Zone/cây, lịch sử một tháng, duyệt thu hoạch Pending ở Zone được giao. Farm thứ1–3 đã gia nhập HTX, thứ4–5 độc lập.
4. Farmer thêm thứ6–8: chỉ có công việc được giao, không sở hữu Farm; xem nhật ký Zone, tự nhập nhật ký/thu hoạch theo assignment; không sửa cây/Device của chủ. Không dùng tài khoản Lê Văn Phúc để đại diện Farmer hoàn toàn không sở hữu Farm.
5. Canh tác: lịch sử một tháng, đủ Watering/Fertilizing/Spraying, target Zone/cây, chi tiết vật tư và xác minh chain. Các bản Locked chỉ correction theo quyền.
6. Thu hoạch: lọc Draft/Pending/Confirmed, xem batch nhiều cây và cùng cây khác ngày. Chủ duyệt Pending; Draft tác giả sửa/submit; Confirmed không sửa trực tiếp. Draft cũ hơn7 ngày có thể cần Admin cấp quyền nhập bù theo policy hiện có; dùng các Draft đợt gần nhất để kiểm nhanh.
7. QR: chọn cây thuộc các Farm thêm, xem hoạt động cây/Zone và thu hoạch Confirmed; không công khai Draft/Pending lần đầu hoặc PII/free text/IoT.

Lịch sử giữ anchor của lần chạy đầu, không trượt theo ngày mỗi lần seed. Không tự đổi trạng thái Device thành Online/Active hoặc đổi phạm vi truy cập để lấp dashboard.

## Source và kiểm thử

[Generator/bootstrap/workflows](../apps/api/src/persistence/rich-operational-data.ts), [CLI và ghi chú tài khoản](../apps/api/src/persistence/rich-data-cli.ts), [integration](../apps/api/integration/rich-data.integration.ts). SeedWriter hỗ trợ namespace riêng, default profile cũ giữ nguyên.

29/29 integration liên quan đạt:fixture dữ liệu một tháng, foundation và backup. Test gián đoạn giữa Mongo commit/checkpoint PG, resume không trùng,130 hash-chain records/160 harvests, status/null updates, membership và credentials/history/idempotency. API lint/typecheck/build đạt. Đây không phải nghiệm thu hardware/OTP/email thật.

## Kết quả đã nạp local

Ngày22/10: thêm đủ graph và130 nhật ký/160 thu hoạch. Tổng hiện tại14 Users (10 Farmer Active,2 Manager Active,1 Manager Pending,1 Admin Active),4 HTX,8 Farm (3 thuộc HTX,5 độc lập),16 Zone,414 cây. Thu hoạch130 Confirmed/10 Pending/20 Draft;130 nhật ký Locked với10 chuỗi Zone kiểm tra valid. Đã xác nhận mật khẩu khởi tạo khớp DB cho cả11 tài khoản thêm trước khi ghi tham khảo local.

Backup trước272 PG rows/1.443 Mongo documents; sau2.302 PG rows/1.713 Mongo documents. Đối chiếu giữ nguyên mọi row PG trước đó và mọi document domain Mongo trước đó; telemetry/tasks không thay đổi. Restore-check database mới/rỗng thành công, data_sha256 `8957bd701428b750713487df8f6fba2526fc6f0a402ef67156fa0f9399116658`. `.env` cũ được giữ, MQTT=false; các key Manager chính vẫn trống theo yêu cầu. Không gửi SMTP/SMS/MQTT hoặc đổi password tài khoản cũ.
