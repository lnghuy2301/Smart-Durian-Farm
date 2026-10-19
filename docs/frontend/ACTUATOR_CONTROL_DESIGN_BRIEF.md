# Brief thiết kế — điều khiển tưới/phun và tiến trình ACK

Ngày19/10/2026. Dành cho bên thiết kế mẫu; chưa phải UI đã tích hợp. Giữ phong cách Farmer dashboard hiện có. Không thay giao diện metadata/giám sát. Mẫu desktop+mobile cho màn hình chọn Farm→Zone→Device, bảng điều khiển và lịch sử gần đây. Một Device có1 bơm chung,1 van tưới và1 van phun; không có slider tốc độ/định lượng hoặc đặt lịch chưa có API.

## Thành phần cần thiết

- Thẻ nhận diện Farm/Zone/tên hoặc station của Device, trạng thái quản trị riêng Active/Inactive/Maintenance, kết nối broker và lần nhận dữ liệu cuối nếu API giám sát cung cấp. Không dùng status quản trị làm nút relay ON/OFF.
- Ba thao tác rõ ràng **Tưới nước**, **Phun thuốc**, **Dừng**. Không tưới/phun đồng thời cùng Device. Khi đang gửi/chờ thì không gửi Start trùng. Stop có thể ngắt Start theo backend; Stop/RecoveryStop đang chạy thì không gửi thêm Stop. Luôn đọc state/task mới sau lỗi/busy, không suy ra relay từ click.
- Tiến trình theo từng bước: bước đang chờ ACK, bước đã nhận ACK, chưa gửi, lỗi/hủy. Hiển thị thời gian chờ ACK tối đa10s **mỗi bước**, không10s cho cả thao tác. Reset ba bước và Start hai bước có thể dài hơn10s.
- Nhãn kết quả “Đã nhận đủ ACK”/“Chưa xác định”/“Lệnh lỗi”; ghi rõ ACK xác nhận thiết bị nhận lệnh, trạng thái vật lý chưa đo được. Không vẽ bơm chạy, dòng nước hoặc số lít thực nếu chỉ có ACK.
- Lỗi Start có thể chuyển sang chuỗi Dừng phục hồi; lúc task Start Failed nhưng recovery vẫn chạy phải giữ tiến trình, chưa báo “đã tắt”. Có link/khối Reset/RecoveryStop do backend tạo, không có nút người dùng tự Confirm/Reset hoặc nhập taskId.
- Lịch sử: operation/status/created_at/sent_at/confirmed_at/error_message, mở chi tiết steps+liên kết reset/recovery. Thời gian do server ghi, không có form nhập. Hiển thị Empty/loading/mất mạng/hết phiên/không quyền/broker chưa sẵn sàng.

Chủ Farmer và Farmer Accepted đang hiệu lực mới có quyền gửi lệnh. Admin/Manager chỉ xem trong scope, không có nút gửi. Farmer hết phân công mất cả lịch sử IoT; khi403/404 phải xóa dữ liệu private trên màn hình theo API. Không thêm roles/quyền mới từ UI.

## Trạng thái mẫu cần bàn giao

| Mẫu | Nội dung |
| --- | --- |
| Bình thường | Device chọn, readings hiện có, trạng thái receipt Off, nút Start hợp lệ |
| Lần Bật sau restart | Reset OFF bơm→van tưới→van phun; sau đó Start van→bơm; mỗi bước chờ ACK riêng |
| Đang tưới/phun | acknowledge mode tương ứng, vật lý Unknown, thao tác Dừng |
| Thiếu ACK/lỗi | Start Failed, RecoveryStop đang chạy hoặc Failed, mode Unknown; không tự gạt thành Off |
| Broker offline/không quyền | Giải thích ngắn theo API, không gửi lệnh giả hoặc cho nhập ACK |
| Lịch sử/chi tiết | Task và từng step có trạng thái, thời điểm và link Reset/Recovery; desktop/mobile |

## API đã có — không tự thay hợp đồng

Base `/api`, Bearer JWT từ phiên hiện có; Device UUID nội bộ khác station. API task `_id`24hex khác numeric wire taskId. Người dùng không phải nhập ID thủ công trên UI.

| Method/path | Contract |
| --- | --- |
| POST `/actuator-tasks/devices/:deviceId/commands` | Body đúng `{"operation":"Watering"}` hoặc Spraying/Stop;202 task+status_url+state_url |
| GET `/actuator-tasks/devices/:deviceId/state` | acknowledged_mode Unknown/Off/Watering/Spraying,physical_state Unknown,busy,active_task_id,reset_required,broker_ready,ack_timeout_ms |
| GET `/actuator-tasks/devices/:deviceId` | Paged tasks,status optionalPending/Confirmed/Failed |
| GET `/actuator-tasks/:id` | response_payload.operation/steps/reset_task_id/recovery_task_id và thời gian/error |

Frontend tích hợp sau: poll status_url khoảng1s khi Pending; đọc state khi terminal, tiếp theo recovery link nếu có. Không đợi HTTP POST đến lúc ACK xong, không retry Start tự động hoặc replay khi reconnect. Backend là nguồn xác nhận quyền/busy/trạng thái; brief không bổ sung response fields như can_start/can_stop hoặc cảm biến áp suất chưa có.

Nguồn gửi cho bên thiết kế: [tasks API](../ACTUATOR_TASKS_IMPLEMENTATION.md), [workflow](../ACTUATOR_TASKS_WORKFLOW_DESIGN.md), [MQTT review](../MQTT_PROTOCOL_REVIEW_20261014.md), `apps/api/src/actuator-tasks/actuator-tasks.controller.ts`, `actuator-tasks.types.ts`, `actuator-tasks.schema.ts`, ảnh `apps/web` IoT hiện có. Những checkpoint cũ về3 Sensors hoặc chưa có collections không thay quyết định sáu streams/persistence ở progress hiện hành.

Giao `code.html`, ảnh desktop.png/mobile.png và states/*.png vào `docs/frontend/references/actuator_control/`; assets/logo/ảnh rời trong assets/. Không cần gọi API thật trong mẫu, không `.env`/credentials/JWT/phone người dùng, không CDN/asset có bản quyền chưa được phép. Phiên coding sau ánh xạ thiết kế vào React/types/api hiện có, không nhúng script mẫu thành nguồn xác thực hoặc dữ liệu thật.
