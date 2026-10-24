# Backend theo Yêu cầu chỉnh sửa.pdf — 24/10/2026

Nhánh `feat/backend-pdf-business-adjustments`, base `0056142`, giữ nguyên các thay đổi frontend chưa commit từ `feat/web-pdf-review-adjustments`. Đã đọc PDF đầy đủ hai trang và guide frontend. Không tự commit các file riêng của người dùng. `.env`, tài khoản private, ERD/MQTT/Postman giữ nguyên.

## Các quyết định đã chốt trong session

- Phiên chỉ hết sau15 phút không hoạt động; polling IoT/HTTP và focus/visibility không tính hoạt động. JWT vẫn ngắn hạn15 phút; endpoint refresh chỉ nhận JWT còn hiệu lực, recheck Active/tokenVersion. UI gia hạn theo input thực và có idle deadline riêng; không tự đăng nhập lại hoặc refresh JWT đã hết hạn.
- Phone đăng nhập/quên mật khẩu/OTP dùng identity0/84/+84 hiện đã có cho uniqueness. Phone lưu và số gửi provider không bị thay đổi.
- Tài khoản cho đổi tên; đổi mật khẩu cần mật khẩu hiện tại và SMS OTP riêng, không dùng chéo proof quên mật khẩu. Password đổi xong tăng tokenVersion, thu hồi JWT cũ.
- Email tùy chọn ở tài khoản; email mới chỉ lưu sau OTP email. Giữ email cũ đến lúc commit; uniqueness toàn hệ thống, không nhận verified từ client. Manager vẫn bắt buộc xác minh email khi đăng ký, không cho xóa/unverify email của Manager.
- User chốt liều là số +đơn vị +cơ sở, giữ lịch sử. Thêm `default_dosage_value` và `dosage_basis`, giữ `unit`; `default_dosage` là nhãn tương thích client cũ, sinh từ cấu trúc khi có số. Không tự parse mô tả cũ thành số; nhãn legacy thiếu chuẩn hóa trả numeric/basis null. Client cũ vẫn được nhận trong giai đoạn chuyển tiếp.
- User chốt Other chỉ tên công việc bắt buộc và ghi chú tùy chọn; không vật tư/thông tin tưới; tên/ghi chú không công khai QR. Quyền/15 phút/Locked/correction/Zone chain giữ nguyên.

## API bổ sung

| Endpoint | Body chính | Kết quả |
| --- | --- | --- |
|POST `/api/auth/refresh`|`{}` +Bearer còn hạn|200, access_token/expires_in/user, không gia hạn khi expired/revoked|
|GET `/api/account/profile`|Bearer|PublicUser hiện tại|
|PATCH `/api/account/profile`|`{"user_name":"Nguyễn Văn An"}`|200, PublicUser; không sửa role/phone/ownership|
|POST `/api/account/email/request`|`{"gmail":"email thật"}`|202, verification_id; không đổi hồ sơ|
|POST `/api/account/email/verify`|`{"verification_id":"UUID","otp":"6 chữ số"}`|200, PublicUser sau commit|
|POST `/api/account/password/request`|`{"current_password":"mật khẩu hiện tại"}`|202, gửi SMS tới phone của actor|
|POST `/api/account/password/confirm`|`{"current_password":"...","new_password":"...","otp":"6 chữ số"}`|200, đăng nhập lại|

Hạn email10 phút, SMS5 phút, cooldown60 giây, tối đa5 lần sai; proof dùng một lần, mất sau restart. Không gửi lại tự động. Account/email proof riêng với đăng ký và sửa HTX. SMTP/Twilio dùng cấu hình đang có, không thêm secrets hay gửi provider trong test.

```json
{"name":"Phân hữu cơ","material_type":"Fertilizer","default_dosage_value":2.5,"unit":"kg","dosage_basis":"cây/lần","quarantine_days":0}
```

Liều dương0.001–1.000.000, tối đa3 số lẻ; cơ sở1–60 ký tự. PATCH cơ sở/số/đơn vị recompute nhãn dưới row lock; không ghi lại snapshot cũ. Dữ liệu catalog khởi tạo chỉ phục vụ hệ thống mẫu, không thay hướng dẫn sử dụng của sản phẩm và không tạo lệnh phần cứng.

```json
{"target_type":"Zone","target_id":"UUID_ZONE","action_type":"Other","details":{"activity_name":"Tỉa cành","note":"Nội dung riêng tư"}}
```

Tên1–200 ký tự, ghi chú tối đa2000. Thay action khi Pending/correction phải gửi details phù hợp. QR chỉ trả action_type Other với snapshot tiêu chuẩn công khai; không thêm tên công việc tự do.

## Migrations và dữ liệu

-015 Mongo mở enum Other bằng clone validator, không sửa source/checksum002 hoặc tài liệu lịch sử.
-016 PG thêm cặp numeric/basis nullable và CHECK. Không thay kiểu/xóa cột nhãn cũ.
- Runtime yêu cầu đủ migrations mới. Backup v1 hỗ trợ prefix đã biết014–016; restore đúng schema của archive để giữ checksum, sau đó chạy migrate riêng trước runtime mới. Không chấp nhận checksum lạ/gap/newer schemas.
- `npm run db:materials:expand`: backup trước/sau, transaction +migration/controller advisory locks, thêm12 vật tư theo profile `material-dosage-v1`. Chỉ chuẩn hóa5 dòng khởi tạo cũ còn đúng nhãn/unit/tên; lưu nhãn cũ vào metadata và audit/version, không đổi status/ID hoặc vật tư người dùng đã chỉnh. Không tự liên kết vào tiêu chuẩn, không ghi nhật ký hay đổi hash. Chạy lại không tạo trùng/ghi đè.

## Source

Auth: `auth.service.ts`, ports/adapters UserAccounts, AccountService/Controller trong UsersModule cùng pool/store. Không tạo authority mới. Frontend chỉ nối các chức năng cần API mới ở session/AccountTools và lựa chọn Other, giữ bố cục/nguồn private đã chỉnh.

## Tái lập và kiểm tra

Development/test dùng cấu hình đang có; không thêm biến môi trường hoặc reset password. Sau chuyển source, khởi động lại API/web. Trên database khác cần dừng API trước các lệnh bảo trì:

```powershell
npm run build
npm run db:backup
npm run db:migrate
npm run db:materials:expand
npm run dev:api
# Terminal khác
npm run dev:web
```

Database local đã apply/nạp ở bước dưới, **không cần chạy lại để đăng nhập**. CLI mở rộng idempotent; nếu báo controller lease đang bận, dừng API đúng cách rồi thử lại, không xóa lock/volume. Công cụ chỉ chạy development/test; không khởi tạo Nest/Auth/MQTT/provider. Không chạy seed cũ để “sửa” dữ liệu.

[Postman JSON riêng](postman/Backend-PDF-Changes.postman_collection.json) nhập trực tiếp; thay phone/password/JWT/UUID/OTP bằng tay, không scripts/environment. Không chạy cả collection hàng loạt vì có request gửi OTP/ghi dữ liệu. Phone nhận SMS vẫn phải được provider/allowlist hiện có cho phép, không tự thêm số khởi tạo vào allowlist.

Kiểm tra web: `/account` sửa tên/xác minh email/đổi mật khẩu, `/cultivation-events` chọn Công việc khác, `/materials` xem liều số/cơ sở. Thử thao tác sau14 phút và để yên15 phút; chỉ input thực ở trang hiện được tính hoạt động, polling/focus không giữ phiên. SessionStorage chỉ JWT và deadline số, không password/email/OTP. Refresh có throttle15 giây và một lần gửi cuối cho input đang chờ; deadline idle tại client giữ đúng lần thao tác cuối. Khi mất mạng đến lúc JWT hết hạn thì cần đăng nhập lại, không phục hồi bằng JWT expired.

Kiểm thử cô lập (không đọc `.env` thật hoặc gửi SMS/email/command thật):

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.integration-dist
node --test --test-concurrency=2 apps/api/.integration-dist/test
# Docker Desktop mở, fixture dùng port15432/27028, không dùng DB vận hành
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d --pull never
npm run test:persistence
cd apps/web
node ../../node_modules/vitest/vitest.mjs run
node test/e2e.mjs
node test/database-runtime-browser.mjs
node test/pdf-backend-browser.mjs
```

Test riêng: `pdf-account.test.ts` kiểm phone/OTP purpose/refresh, tên/email và stale proof; `material-dosage.test.ts`; `cultivation-events.test.ts` Other; `pdf-business.integration.ts` PG email CAS/unique, legacy backup014 restore rồi upgrade, chuẩn hóa snapshot bất biến và chạy lại không trùng. Browser dùng JWT clock riêng, không đổi global Date.now của Playwright để tránh cộng thời gian hai lần khi reload. Ảnh tại `apps/web/test-results/pdf-backend/` đã ignore.

## Kết quả hoàn tất24/10

-258/258 backend,302/302 persistence trong22 suites;20/20 web unit;56/56 browser memory/API,5/5 browser database/MQTT TCP,5/5 browser chức năng PDF. Lỗi assert cũ về field catalog/migration cuối/SessionStorage đã cập nhật đúng contract mới; các lượt đầy đủ cuối đạt. Xem log local `.integration-dist/pdf-*-report.txt` và `test-results/pdf-*-report.txt`.
-Local đã apply015/016. Backup trước `2026-10-24T15-24-51-705Z-57c7011b-ea1a-4b89-91cd-2ff981c40cb0.json`:2.302 PG/1.713 Mongo. Sau mở rộng:2.343 PG/1.713 Mongo, tổng17 vật tư (12 mới,5 chuẩn hóa), không có dòng tùy chỉnh bị ghi đè.
-Backup sau `2026-10-24T15-25-58-179Z-3e58f414-1fc7-40f3-ad02-0abd9572b8c7.json`, SHA dữ liệu `8aa118ec74ff1b3ab169468b676c834bdb547834917351fb0d932aba6224fad6`. Restore-check vào DB fixture mới đã khớp và xóa DB kiểm tra. Chạy lại CLI0 insert/0 normalize, hash trước/sau bằng nhau.
-Đối chiếu từng dòng: toàn bộ Users/Farm/Zone/Tree/Device/Sensor/Actuator/assignment/harvest/standard/bridge/notification cũ giữ nguyên; mọi Mongo document byte-identical, gồm lịch sử/hash canh tác. Chỉ catalog/metadata liên quan và17 audit mới thay đổi như dự kiến. Nhãn liều cũ lưu metadata; không sửa snapshot đã ghi.
-Không gửi provider thật hoặc bật/tắt hardware. Nghiệm thu SMS/email thực tế và hardware xuyên API/web vẫn do người vận hành thực hiện theo checklist.

## ERD và giới hạn còn giữ

AGRICULTURAL_MATERIALS thêm `default_dosage_value` (double precision, nullable với legacy, dương tối đa3 số lẻ) và `dosage_basis` (varchar60, cùng null/non-null với số). `default_dosage` varchar100 giữ tương thích và nhãn lịch sử; `unit` giữ nguyên. USERS không thêm cột; proof sống ngắn trong service, metadata/version/audit dùng cơ chế hiện có. Mongo action_type thêm Other, details.activity_name chỉ có khi Other. **Không tự sửa ERD/XML riêng của người dùng**; đối chiếu các thay đổi này khi vẽ lại.

AUTH_MODE vẫn development/test, không tuyên bố đã triển khai production Auth. Thống kê “công việc” vẫn là Zone đang phụ trách như frontend đã chốt, không thêm bảng nhiệm vụ. Không đổi duyệt Farm/HTX, assignment interval, quyền correction, tree_code thật, MQTT protocol hoặc QR whitelist ngoài thêm nhãn Other. Hai module AI tiếp tục hoãn.
