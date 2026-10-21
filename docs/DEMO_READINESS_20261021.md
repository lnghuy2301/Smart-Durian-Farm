# Chuẩn bị demo — checkpoint21/10/2026

Source MQTT final `fd7a4fb`; công cụ vận hành trên `feat/database-backup-restore`. [Protocol/source/tests](MQTT_FINAL_INTEGRATION.md), [backup/restore CLI](DATABASE_BACKUP_RESTORE.md).

## Đã thực hiện trên database local

- Khởi động đúng hai container PG/Mongo đã có, giữ volumes. Không chạy migrate/reseed hoặc bật API/MQTT để thử lệnh thật.
- Tạo backup trước điều chỉnh:218 PG data rows,0 Mongo documents. Phục hồi thử vào fixture ngẫu nhiên, đối chiếu checksum khớp và xóa chỉ target kiểm chứng.
- Chỉ cập nhật Sensor303 expected unit từ% sang%rH và306 từ Greek mu U+03BC sang micro sign U+00B5 qua repository của Farmer chủ Farm. Tăng version/audit đúng quy trình, không đổi readings/thresholds/status/IDs/purpose.
- Đối chiếu before/after: chỉ hai rows Sensor, metadata của chúng và thêm2 audit rows thay đổi; mọi PG data còn lại và Mongo giữ nguyên. Không sửa SQL trực tiếp để bỏ qua quyền.
- Tạo backup sau điều chỉnh:220 PG data rows,0 Mongo documents; restore-check khớp toàn bộ data. Hai file backup nằm trong `backups/` local đã ignore, không commit.
- Audit chỉ đọc xác nhận Farmer chính/owner và Admin chính đã Active, hardware thuộc đúng Farmer, đủ sáu stream units final và recipe metadata Active. Có2 Farmer Active (giữ Farmer phụ để demo phân công),1 Admin Active,0 Manager Active đã verify.

Mongo0 documents là tình trạng thật lúc backup, không có telemetry/task/cultivation giả được chèn để tô giao diện. Fixture tests có dữ liệu Mongo và Locked chain để chứng minh backup/restore nonempty. User đã test packet/relay/ACK hardware theo FINAL; chưa tự suy rằng telemetry đang được runtime server thu nhận.

## Việc cần người trình diễn hoàn tất

1. **Manager thật:** seed Manager mẫu vẫn Pending/email giả. Dùng giao diện đăng ký Manager với phone riêng/email thật → nhập OTP email → Admin duyệt/tạo hoặc gắn HTX. Không seed Active/verified giả, không gửi password/OTP trong chat.
2. **Farm hardware vào HTX:** hiện Farm còn độc lập. Nếu cần Manager thấy hardware/Farm, tạo Join request và đủ duyệt đối ứng +Manager theo workflow. Sau đó audit hardware_manager_ready mới có thể true; chỉ tạo Manager chưa đủ mở scope.
3. **SMS/email thật:** Farmer đã có cấu hình Twilio/allowlist. Chủ động thử quên mật khẩu, nhập OTP tay. Manager sửa HTX đi email rồi phone, cần HTX Verify Service/allowlist của phone Manager. Account chưa tồn tại thì audit không khẳng định cấu hình Manager đã dùng được.
4. **Kết nối MQTT:** .env tại checkpoint đang MQTT_ENABLED=false, host/port đã có. Agent đã hỏi cách bật vì quy tắc giữ cấu hình riêng; chưa tự đổi cờ hoặc publish command thật. Khi bật, khởi động API và xem health/MQTT/latest/history từ UI; chờ packet thật khoảng15s.
5. **Diễn thử control:** metadata Active cho mọi ON/OFF, đúng một mỗi purpose; nhận đủ Reset ACK trước Start từ Unknown, van trước bơm, Stop bơm trước van. ACK chỉ receipt; người trình diễn quan sát bơm/van vật lý. Không thử bằng scripts tự gửi lệnh thật.

## Chạy phần mềm và kiểm chứng

Từ root: `npm run dev:api`, terminal khác `npm run dev:web`. API localhost:3000/api, Swagger /api/docs; web127.0.0.1:5173. Nếu npm wrapper EPERM, dùng local Node tools theo runtime guide. .env giữ local, password đã reset không bị seed/restart khôi phục.

Role rehearsal: Farmer owner tạo/sửa Zone/cây; Farmer phụ nhận phân công và nhập thu hoạch gửi chủ duyệt; Manager đúng HTX đọc/duyệt nghiệp vụ cho phép; Admin đề xuất thay metadata cần chủ duyệt. Tạo nhật ký Pending rồi chờ15 phút/correction; QR công khai chỉ Locked lineage/approved harvest, không PII/IoT.

Database startup không tự ON; restart giữ data/history/proposals, OTP dở bắt đầu lại. Trước buổi diễn thử nên tạo snapshot mới và restore-check; không xóa dữ liệu nền/volume để làm lại demo.

## Giới hạn còn lại

Không tự deploy hoặc push/merge. Production Auth/TLS/domain/private broker cần đích triển khai và cấu hình riêng; Auth hiện chỉ development/test. Hai module AI và Android vẫn ngoài phạm vi đã chốt. Không đánh dấu ba tài khoản thật/SMS/email/server↔hardware end-to-end hoàn tất khi chưa có kết quả thao tác thật tương ứng.
