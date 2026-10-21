# Seed demo — profile hiện hành

Cập nhật21/10/2026. Profile `durian-demo-v1` trong [seed.ts](../apps/api/src/persistence/seed.ts), cấu hình qua [seed-config.ts](../apps/api/src/persistence/seed-config.ts). Database runtime đã dùng dữ liệu PG/Mongo chung; mô tả API RAM ở checkpoint foundation không còn hiện hành.

## Tài khoản và dữ liệu mẫu

Farmer chính dùng AUTH_TEST_PHONE/AUTH_TEST_PASSWORD hiện có, Active và là chủ Farm chứa hardware thật. Admin dùng cấu hình riêng AUTH_TEST_ADMIN_PHONE/PASSWORD, không đăng ký công khai. Seed hash mật khẩu khi tạo mới; không xuất credentials hoặc reset mật khẩu đang có khi chạy lại.

Farmer mẫu và Manager mẫu dùng identity giả riêng; Manager Pending/email mẫu chưa verified, không thay thế Manager thật. Muốn demo Manager Active cần đăng ký/xác minh email thật và Admin duyệt/gắn HTX. Không giả email verified, không cho số mẫu vào SMS allowlist.

Fresh profile có3 Farm,6 Zone,54 Trees,3 Devices,18 Sensors,9 Actuators,3 tiêu chuẩn,5 vật tư,4 standard-material links cùng accounts/assignments theo source. Tổng108 business records có UUID +4 bridges. Có tiêu chuẩn/vật tư Inactive, cây trạng thái khác nhau và metadata thiết bị mô phỏng để minh họa hợp lý. Đây là cây đại diện demo, không khẳng định kiểm kê toàn vườn.

Database đã seed từ profile cũ có thể chưa đủ sáu Sensors trên mọi Device; rerun bổ sung phần thiếu khi identity hợp lệ và không ghi đè unit/status/thresholds đã có. Trạm thật đã được bổ sung304–306 riêng theo [readiness](REAL_HARDWARE_DATABASE_READINESS.md), không cần tạo lại.

## Bộ hardware thật

| Trường | Giá trị đã được người dùng chốt |
| --- | --- |
| station_id | E08CFE41DCAC |
| installed_at minh họa | 2026-09-01T08:30:00+07:00 |
| cost minh họa | 10237500 VNĐ |
| Sensors |301 air_temperature/C,302 air_humidity/%,303 soil_moisture/%rH,304 soil_temperature/C,305 soil_ph/H+,306 soil_ec/µS/cm|
| Actuators |2 shared/bơm,3 watering/van tưới,4 spraying/van phun|

Ngày lắp/chi phí là metadata demo được người dùng cho phép chọn, không tuyên bố là hóa đơn/thời điểm lắp thực tế. DEMO_DEVICE_STATION_ID/INSTALLED_AT/COST từ cấu hình local; station là identifier, không secret/token. Seed không cấu hình broker cho firmware.

Device UUID khác station; Sensors/Actuators FK bằng Device UUID. Các station mô phỏng SIM_DEMO_001/SIM_DEMO_002 có namespace riêng, không route fallback vào trạm thật. Raw units giữ nguyên;303 expected unit legacy% không được rerun tự đổi sang%rH. Chủ sửa metadata qua API khi muốn đồng bộ.

## Không ghi đè và không giả kết quả hardware

- Một transaction PG, khóa migration/seed; chỉ chạy NODE_ENV development/test, kiểm manifest migration trước khi ghi.
- seed_key/natural identity tìm lại UUID; immutable/profile conflict hoặc manifest hỏng thì báo lỗi và rollback. Existing metadata thắng defaults, không reset version/token/status/ever_confirmed/history.
- Không đổi phone/station để “thay tài khoản/thiết bị” rồi mong seed overwrite. Dùng API phù hợp, giữ FK/lịch sử; mật khẩu thay bằng đổi/quên mật khẩu.
- Không tự gửi OTP/email/SMS/MQTT, không seed Online/ACK/Confirmed task/telemetry cho trạm thật. Không tự đặt ngưỡng canh tác chưa chốt.
- Không tạo Locked hash-chain hay Confirmed Harvest bằng chèn SQL tắt. Dữ liệu demo nghiệp vụ tiếp theo tạo qua workflow hiện có.

## Cách dùng

1. Backup và kiểm kê dữ liệu hiện có; xác nhận đúng project/database.
2. `npm run db:status`; nếu Pending mới chạy `npm run db:migrate`, kiểm tra lại.
3. Chỉ khi cần bổ sung profile: `npm run db:seed`. Không chạy để chữa password/unit hoặc để thay cho audit trạng thái.
4. Kiểm tài khoản/quyền/Farm/Zone/Device qua API database runtime; restart không mất dữ liệu. OTP dở cần xác minh lại.
5. Test SMS/email/hardware thật riêng, do người trình diễn chủ động. Fake providers/loopback được dùng trong automated tests.

[CLI và seed implementation](PERSISTENCE_FOUNDATION_IMPLEMENTATION.md), [runtime](DATABASE_RUNTIME_IMPLEMENTATION.md), [kế hoạch demo](IMPLEMENTATION_PLAN.md). Không in/commit `.env`, phone/password thật, token/OTP hoặc snapshot PII.
