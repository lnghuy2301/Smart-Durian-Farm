# Postman — JSON trực tiếp

Import collection của module cần thử. Không cần environment files hoặc scripts: URL mặc định localhost:3000, thay port nếu cấu hình khác. Điền thông tin tài khoản local và copy JWT/UUID/OTP bằng tay; không gửi nguyên các placeholder.

- `Smart-Durian-Farm.postman_collection.json`: health/readiness/OpenAPI.
- `Auth-Local-Test.postman_collection.json`: login/me/forgot/reset; test/sms chỉ dùng khi SMS mock trong development/test.
- `Twilio-Verify-Demo.postman_collection.json`: demo Verify thật theo hướng dẫn Twilio, do người dùng quản lý.
- Các collection Users/Cooperatives/Farms/Zones/Assignments/Trees/Tree-Harvests/Cultivation-Events: đi đúng thứ tự tài nguyên và quyền trong workflow guide.
- Devices/Sensors/Actuators: metadata, không tự bật thiết bị.
- MQTT-Communication/IOT-Telemetries: trạng thái/diagnostics/readings; Actuator-Tasks là control riêng, chỉ thao tác thật trong buổi người dùng chủ động thử.
- QR-Traceability: public whitelist, không cần JWT cho endpoint public.

Database runtime không tự seed khi khởi động. Dùng UUID thực từ API; không tạo lại trạm chỉ vì restart. Các ví dụ trong collection không tự cập nhật cấu hình hoặc mật khẩu database. Không export JWT/OTP/password/phone thật lên Git hoặc gửi AI ngoài dự án.

[Mục lục nghiệp vụ](../README.md), [Twilio](../TWILIO_VERIFY_INTEGRATION.md), [hardware readiness](../REAL_HARDWARE_DATABASE_READINESS.md), [runtime](../DATABASE_RUNTIME_IMPLEMENTATION.md).
