# Quản lý cấu hình IoT

Nhánh `feat/web-iot-metadata`, mẫu `manage_IoT/code.html`, `screen.png`. Thiết bị `/devices`, detail `/devices/:id`; cảm biến `/sensors/:id`, bơm/van `/actuators/:id`; phê duyệt `/requests?kind=device\|sensor\|actuator`. Trang `/iot` tiếp tục giám sát presence/telemetry hiện có, có liên kết sang cấu hình.

Chủ Farmer ghi metadata trực tiếp POST/PATCH vào Devices/Sensors/Actuators. Admin POST `/requests` hoặc `/:id/update-requests`, chủ vườn tương ứng PATCH `/…-requests/:id/approve\|reject`. Manager/assignee chỉ đọc. Quyền chủ đi theo Device → Zone → Farm.owner_id, không dùng role Farmer để cấp quyền sửa mọi trạm.

Detail Device có tab Cảm biến, Bơm/van, Lịch sử cấu hình, Cây trong khu vực. Hai tab đầu GET `sensors?device_id=…`, `actuators?device_id=…`, phân trang20 và có tạo/proposal trong trạm đang mở. GET `devices/:id/history` lưu phiên bản; GET `devices/:id/trees` chỉ có limit/offset, không gửi bộ lọc q/status từ tab khác. Sensor/Actuator detail có lịch sử riêng. Mã trạm/luồng/khả năng theo cấu hình thực tế, không tự đăng ký mapping MQTT.

Immutable: Device zone_id/station_id; Sensor device_id/data_stream_id/sensor_type; Actuator device_id/capability_id/purpose. PATCH chỉ gửi field thay đổi. station/stream phân biệt hoa thường và một topic segment `[A-Za-z0-9_-]+`, max50; capability JSON number nguyên1..MAX_SAFE_INTEGER; purpose watering/spraying/shared. Sensor unit tự do max16, threshold cả hai null hoặc đủ cặp min<max tối đa2 số lẻ. Để trống cặp ngưỡng gửi null để xóa; không gửi string số.

Device Active/Inactive/Maintenance là quản trị, không dùng thay Online/Offline. Sensor unit là cấu hình, không sửa đơn vị dữ liệu lịch sử. last_seen_at chỉ đọc từ receiver, không nhận từ form. Mẫu metadata không điều khiển relay; không thêm toggle bật/tắt. ACK actuator-tasks không nằm trong màn hình này.

Tái lập: chủ chọn Zone tạo trạm, thêm Sensor và Actuator vào tab tương ứng; kiểm tra API list chỉ trả các bản ghi của trạm đang mở. Chỉnh tên Sensor và để trống cả hai ngưỡng, GET phải trả null; không kích hoạt lại Inactive. Admin đề xuất cập nhật cost/name; chủ mở Phiếu đề xuất đối chiếu snapshot và duyệt. Thử trùng mã phần cứng trong Device, proposal lỗi thời và assignee đọc nhưng không có nút sửa. Chuyển tab sau khi tìm kiếm để kiểm tra Trees không nhận query ngoài DTO. Kiểm tra desktop thấp/mobile, history cuộn riêng.

Không thay cấu hình broker/env, không gửi lệnh tới phần cứng, không thêm thư viện. Runtime RAM và kiểm thử cô lập theo tài liệu triển khai mẫu mới.
