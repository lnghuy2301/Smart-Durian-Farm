# Dữ liệu trạm thật trước khi nghiệm thu ESP32

Checkpoint dữ liệu20/10/2026; protocol FINAL đối chiếu21/10/2026, [database runtime](DATABASE_RUNTIME_IMPLEMENTATION.md). Không có tin/lệnh được gửi tới broker/hardware thật trong bước chuẩn bị này.

Người dùng đã xác nhận test trực tiếp telemetry301–306, pump/valves ON/OFF và ACK taskId/status/action theo [FINAL v1.0](MQTT_HARDWARE_PROTOCOL_FINAL_v1.0.md). Phần còn nghiệm thu trong guide là luồng xuyên suốt API/web/database/restart/recovery của bản server sau tích hợp, không phải yêu cầu kiểm thử lại protocol từ đầu.

Station đã đăng ký: **E08CFE41DCAC**. UUID Device là ID nội bộ riêng, không thay station hoặc dùng station làm FK. Tài khoản chủ Farmer vẫn dùng cấu hình demo hiện có; không thay phone/password/OTP settings.

Migration001–014 đã Applied local. Trước/sau migration014 đã đối chiếu count và SHA-256 của13 bảng nghiệp vụ,4 bảng technical PostgreSQL và4 Mongo collections: dữ liệu giữ nguyên. Không reseed hoặc tạo lại volumes. Sau migration có một bước độc lập bổ sung **chỉ ba sensor304–306 còn thiếu** vào Device thật bằng repository nghiệp vụ hiện có, có metadata/version/audit bình thường. Tất cả sensor cũ giữ nguyên, chạy lại không thêm trùng. Các Device giả và dữ liệu riêng không bị sửa.

| Stream | sensor_type | Unit theo firmware mới | Metadata demo hiện có |
| --- | --- | --- | --- |
|301|air_temperature|C|C, Active|
|302|air_humidity|%|%, Active|
|303|soil_moisture|%rH|%rH, Active; đã cập nhật owner21/10|
|304|soil_temperature|C|Đã thêm, Active|
|305|soil_ph|H+|Đã thêm, Active|
|306|soil_ec|µS/cm|µS/cm, Active; đã cập nhật owner21/10|

Actuator metadata đã có đủ pump2/shared, valve3/watering, valve4/spraying, đều Active. Không thay status hay purpose. Đăng ký Active không chứng minh hardware đang có điện hoặc relay đang bật.

Checkpoint20/10 giữ303 unit%. Đợt vận hành21/10 đã backup trước, rồi đổi expected unit303=%rH và306=µS/cm qua repository của Farmer chủ Farm, có version/audit; dữ liệu ngoài hai metadata này giữ nguyên. Backup sau điều chỉnh đã restore-check khớp. Đây là sửa metadata, không convert readings/thresholds hoặc thay status/IDs. [Báo cáo](DEMO_READINESS_20261021.md).

FINAL v1.0 xác nhận stream306 gửi micro sign `µ` (U+00B5), khác Greek mu `μ` (U+03BC) trong metadata seed cũ. Khi restore bản backup cũ, dùng hướng dẫn PATCH phía dưới để cập nhật đúng quyền nếu cần. Raw history giữ nguyên cả hai cách viết để phản ánh chính xác packet đã nhận.

## Tái lập bằng Postman nhập tay

1. Đăng nhập chủ Farmer demo: POST `/api/auth/login` dùng phone/password local hiện có, copy JWT vào Bearer Auth. Không dùng Admin để ghi trực tiếp; Admin chỉ đề xuất theo rule cũ.
2. GET `/api/devices/by-station/E08CFE41DCAC`, copy `id` UUID Device. GET `/api/sensors?device_id=UUID_DEVICE&limit=100&offset=0` để xem đủ sáu streams. Thay `UUID_DEVICE` trong URL/body bằng giá trị thật, không nhập nguyên placeholder.
3. Nếu phục hồi một database cũ chưa có304–306: POST `/api/sensors` từng body dưới, thay UUID_DEVICE. **Chỉ tạo stream thiếu**; cùng Device+stream đã có trả409, không đổi type/stream để né unique.

```json
{"device_id":"UUID_DEVICE","name":"Nhiệt độ đất","sensor_type":"soil_temperature","data_stream_id":"304","unit":"C"}
```

```json
{"device_id":"UUID_DEVICE","name":"pH đất","sensor_type":"soil_ph","data_stream_id":"305","unit":"H+"}
```

```json
{"device_id":"UUID_DEVICE","name":"EC đất","sensor_type":"soil_ec","data_stream_id":"306","unit":"µS/cm"}
```

4. Để đồng bộ expected unit303: GET `/api/sensors/by-stream/UUID_DEVICE/303`, copy `id` Sensor rồi PATCH `/api/sensors/UUID_SENSOR` với body `{"unit":"%rH"}`. Owner trực tiếp; Admin muốn sửa phải đi luồng đề xuất. Không sửa sensor_type hoặc data_stream_id.
5. Khi hardware được bật đúng broker cấu hình: GET `/api/mqtt/devices/UUID_DEVICE/status`, `/api/telemetry/devices/UUID_DEVICE/latest`, `/api/telemetry/devices/UUID_DEVICE/history` và xem UI IoT. Chu kỳ firmware15s, backend nhận tất cả packets hợp lệ; không bịa readings trước khi ESP32 gửi.

Không cần Postman scripts/environments; UUID/OTP/JWT vẫn copy tay. Tài liệu này không chứa credential. Các JSON có placeholder UUID chỉ là hướng dẫn, phải thay trước khi gửi.

## Phần chưa được chứng minh bằng phần cứng thật

Loopback đã chứng minh MQTT.js TCP→full database→API→browser, Reset/Start/Stop/ACK/history/restart. ESP32 thật còn cần kiểm tra sensor301–306 và từng relay, timeout/disconnect/recovery. ACK chỉ báo nhận command; đủ ACK không tự chứng minh bơm/van đã hoạt động. Hẹn người phụ trách hardware và cô lập tải trước khi chạy các lệnh Bật/Dừng theo [kế hoạch nghiệm thu](IMPLEMENTATION_PLAN.md).
