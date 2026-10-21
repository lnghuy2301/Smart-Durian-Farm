# Ghi chú kỹ thuật hiện hành

Cập nhật21/10/2026. [Quy tắc nghiệp vụ](PROJECT_BUILD_SPEC.md), [runtime và tái lập](DATABASE_RUNTIME_IMPLEMENTATION.md), [tiến độ](BACKEND_PROGRESS_CURRENT.md).

## Authority và cấu hình

- `AppModule` chọn trọn vẹn database hoặc memory. Mặc định database ngoài NODE_ENV=test; test mặc định memory. Không trộn HTTP PG với MQTT/store RAM trong database mode.
- Một DatabaseService sở hữu pool PostgreSQL/MongoClient. DatabaseRuntimeModule/PersistenceRuntimeModule chia sẻ bundle; ports dùng useExisting aliases khi provider có lifecycle hooks, tránh init/destroy hai lần.
- AUTH_MODE=mock chỉ bật Auth development/test; không đồng nghĩa account/business data lưu RAM. Production Auth còn cần thiết kế/cấu hình riêng.
- `.env` giữ local, không in/commit/ghi đè. Frontend chỉ đọc public config riêng, không sao chép root secrets. MQTT host/port/TLS/credentials từ config; station lấy Device metadata.
- Compose database bind loopback; Mongo local replica set phục vụ transaction. Chạy đúng project `smart-durian-farm`, không xóa volumes.

## Persistence và lỗi

- PG:13 bảng nghiệp vụ; technical entity_metadata/workflow_requests/audit_events/notifications và migration ledger. Mongo:telemetry/tasks/cultivation cùng technical state.
- Migration CLI kiểm checksum/store/order;001–014 là baseline đã apply. Không sửa migration cũ. Startup kiểm ledger, writable replica set, collections/validators/indexes trước receiver/worker; thiếu schema thì fail, không tự seed/fallback.
- SQL tham số hóa; khóa parent/users/requests/batch theo thứ tự của adapter; version và snapshot chống duyệt nội dung lỗi thời. Business record+request+version+audit trong transaction cùng store.
- Không có transaction chung PG/Mongo. Giữ context/snapshot, recheck quyền và cơ chế khóa theo adapter; không gọi hai DB rồi tuyên bố atomic toàn hệ thống.
- Seed nhận cấu hình local, không ghi đè UUID/identity/password/status/verified/context đã tồn tại, không gửi OTP/MQTT. Xung đột profile cần xử lý rõ, không reset dữ liệu.

## Thời gian, lịch sử và retention

- Timestamp ISO/UTC; harvest_date là ngày thực tế theo lịch Việt Nam, kiểm hạn nhập bù7 ngày theo policy. Không nhận confirmed_at hay email verified do client tự đặt.
- Telemetry measured_at là backend arrival do firmware hiện chưa gửi timestamp; received_at là bước ghi. Raw unit giữ nguyên, metadata mismatch không tự convert.
- Telemetry FIFO10.000 readings; task journal5.000 theo rules terminal; Cultivation cap10.000 không FIFO xóa Locked. Hash v1/canonical mapping phải giữ nguyên qua BSON/restart.
- Cultivation lock15 phút; catch-up tối đa512 earliest events/transaction; quyền correction theo phân công gốc. Snapshot read chia batch100 tránh lỗi cursor/CSOT. Không giả catch-up10.000 events là realtime.
- OTP/email/SMS proof chưa xong là state ngắn hạn, restart phải xác minh lại; account verification, proposals, token version và history lưu bền.

## MQTT/control

Xem [communication guide](MQTT_COMMUNICATION_IMPLEMENTATION.md). Chưa nhận bản Configuration cuối người dùng sắp gửi nên không tự đổi firmware/topic/payload. ACK là receipt;10s mỗi bước; Unknown trước Start phải Reset; restart không phát lệnh ON. Metadata Active khác connectivity và khác trạng thái vật lý.

## Kiểm tra và tiếp tục

Tự động dùng providers giả/broker loopback/DB fixture; không dùng credentials thật hoặc phát lệnh ra hardware để chạy regression. Giữ memory adapters và tests vì vẫn là chế độ được hỗ trợ. Giữ SpeedSMS vì còn provider/config/tests dùng; Twilio là lựa chọn demo hiện hành.

Xem [kế hoạch](IMPLEMENTATION_PLAN.md) cho hardware/demo/backup/deploy; [mục lục](README.md) cho guide từng module. Báo cáo cũ đã hợp nhất, không hỏi lại các rule đã chốt. Phát hiện mâu thuẫn nghiệp vụ mới thì trao đổi trước khi triển khai.
