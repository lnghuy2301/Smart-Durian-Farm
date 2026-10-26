# Kế hoạch triển khai tiếp theo

Ưu tiên hiện hành26/10: [nền tảng AI](AI_BACKEND_IMPLEMENTATION.md) đã triển khai theo yêu cầu mới: YOLO11s-cls, Zone tùy chọn, Farmer có lịch sử riêng, Admin quản lý PDF RAG. Tiếp theo nhận best.pt/versions Colab, chọn API chatbot và corpus để đánh giá thật; tiếp tục nghiệm thu bốn vai trò/hardware, môi trường triển khai và review Git. Không seed lại dữ liệu hiện có. Các checkpoint offline bên dưới giữ làm lịch sử.

Checkpoint offline21/10: [dữ liệu IoT mẫu](OFFLINE_DEMO_TELEMETRY.md) đã nạp cho hai Device mô phỏng; không cần bật hardware/MQTT để xem lịch sử. Bước tiếp theo là người dùng smoke API/web với DB đã có mẫu, hoàn tất Manager thật/Join HTX, sau đó nghiệm thu hardware. AI chỉ bắt đầu sau khi chốt model/provider/corpus và phạm vi; chưa tự chọn dịch vụ trả phí hoặc giả kết quả AI.

Cập nhật21/10/2026. API nghiệp vụ,13 PG adapters,3 Mongo adapters, shared database runtime, giao diện web và QR đã có. [Tiến độ/evidence](BACKEND_PROGRESS_CURRENT.md); không lập lại backlog persistence/UI đã hoàn tất.

## Thứ tự ưu tiên

| Bước | Công việc | Điều kiện đạt |
| --- | --- | --- |
|1|Tích hợp MQTT FINAL v1.0 đã nhận|Parser/wire/units và metadata-based control đã tích hợp; purpose bất biến, Active mọi ON/OFF; hoàn tất regression trước chuyển vận hành|
|2|Nghiệm thu ESP32 thật|Sáu streams đúng metadata/raw units; receipt correlation và thứ tự van/bơm; lỗi ACK/mất mạng/restart ghi evidence rõ|
|3|Chốt dữ liệu và ba tài khoản demo chính|Farmer chủ Farm thật, Manager xác minh thật +Admin duyệt HTX, Admin riêng; giữ Farmer phụ để demo phân công/duyệt|
|4|Smoke nghiệp vụ trên database+web|SMS/email, HTX/Farm approvals, assignment expiry, Harvest/Cultivation/correction, QR whitelist và restart|
|5|Backup/restore đã có; diễn thử với tài khoản thật|CLI và8 tests backup đạt; actual snapshot/restore-check demo khớp, không restore đè. Xem DATABASE_BACKUP_RESTORE/DEMO_READINESS_20261021|
|6|Review release và triển khai đích|Tests, docs, config, Auth/deploy/TLS/broker; chỉ push/merge theo yêu cầu rõ ràng|

AI có nền tảng backend theo guide mới, còn weights/provider/corpus và nghiệm thu thật. Android chưa có, là phạm vi riêng. Không tự chọn nhà cung cấp hoặc thêm nghiệp vụ mới để tăng phần trăm hoàn thành.

## Checklist hardware

Dùng [nguồn MQTT hiện có](MQTT_HARDWARE_PROTOCOL_FINAL_v1.0.md), [implementation](MQTT_COMMUNICATION_IMPLEMENTATION.md) đã được người dùng xác nhận kiểm thử hardware; vẫn cần nghiệm thu full API/web/database với bản server đã tích hợp. Không tự phát command thật trong test tự động.

1. Ghi revision, storage=database, readiness, broker connected/subscribed; không ghi credentials/JWT/OTP.
2. Dùng Device station `E08CFE41DCAC` đã đăng ký, UUID nội bộ riêng. Không tạo station trùng. Đối chiếu [readiness](REAL_HARDWARE_DATABASE_READINESS.md).
3. Streams301 air_temperature/C,302 air_humidity/%,303 soil_moisture/%rH,304 soil_temperature/C,305 soil_ph/H+,306 soil_ec/µS/cm. Legacy303 expected% được sửa qua quyền metadata khi cần; readings raw không sửa.
4. Quan sát packet khoảng15s; latest/history/last_seen_at cập nhật; measured_at backend arrival, received_at bước ghi. Packet lỗi/retained/stream lạ không làm receiver chết hoặc tự đăng ký Sensor.
5. Bơm2/shared, van3/watering, van4/spraying. Start từ Unknown: OFF2→ACK→OFF3→ACK→OFF4→ACK, rồi van chức năng ON→ACK→bơm ON→ACK. Chờ10s mỗi bước.
6. Stop bơm trước rồi các van theo workflow. Không tưới/phun đồng thời trên cùng Device. ACK đủ chỉ xác nhận nhận command; quan sát hardware riêng để xác nhận bơm/van thực sự hoạt động.
7. Kiểm ACK thiếu/trễ/trùng/sai action/Device, disconnect, Stop preemption và recovery. Không báo “đã tắt” khi thiếu ACK; Start tiếp phải Reset đủ ACK.
8. Restart backend: dữ liệu còn, task dở Failed/mode Unknown, không tự ON; Start sau Reset. OTP dở phải xác minh lại.

Report nghiệm thu: case, expected, actual, Pass/Fail/NotRun, thời gian và packet shape đã bỏ dữ liệu nhạy cảm. Tách kết quả receipt với quan sát vật lý. Loopback tests không thay bằng chứng hardware thật.

## Chuẩn bị demo

Seed hiện có là điểm xuất phát, không xóa tạo lại. Bổ sung qua API/seed non-overwriting; không SQL trực tiếp để bỏ qua approvals/metadata/audit. Dữ liệu thu hoạch/canh tác đi đúng workflow. Không tạo telemetry/ACK giả cho station thật. Giữ UUID/tree_code/station/stream/capability đã liên kết.

[Seed profile](PERSISTENCE_SEED_SPEC.md), [runtime và commands test](DATABASE_RUNTIME_IMPLEMENTATION.md), [sơ đồ hiện hành](CURRENT_SYSTEM_DIAGRAMS.md). Không đánh dấu backup/restore, production Auth hay hardware đã đạt trước khi thực hiện.
