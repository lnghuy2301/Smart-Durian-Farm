# ACTUATOR_TASKS — workflow đã chốt và đã code

Cập nhật21/10/2026 theo MQTT FINAL v1.0 và quyết định trực tiếp: purpose bất biến, recipe theo metadata, mọi ON/OFF cần Active. API/dữ liệu/cấu hình/tái lập ở [implementation](ACTUATOR_TASKS_IMPLEMENTATION.md). Các thiết kế task cũ “Confirmed = relay executed” và short ACK không taskId đã được thay thế.

```mermaid
flowchart TD
  Request[Farmer POST Watering hoặc Spraying] --> Check[JWT, quyền hiện tại, metadata Active, lock Device]
  Check --> Pending[202 Pending + status_url]
  Pending --> Unknown{Mode Unknown?}
  Unknown -->|Có| Reset[Reset riêng: OFF bơm chung → ACK → OFF van tưới → ACK → OFF van phun → ACK]
  Unknown -->|Off| Valve[ON van theo purpose tưới hoặc phun]
  Reset -->|Đủ ACK| Valve
  Reset -->|Lỗi| FailedReset[Reset Failed và Start Failed, mode Unknown, không ON]
  Valve --> ValveAck[Chờ ACK đúng Device, taskId, action; tối đa10s]
  ValveAck -->|Đủ| Recheck[Kiểm tra lại quyền và metadata Active]
  Recheck --> Pump[ON bơm chung]
  Pump --> PumpAck[Chờ ACK đúng Device, taskId, action; tối đa10s]
  PumpAck -->|Đủ| Confirmed[Start Confirmed: CommandReceipt, physical state Unknown]
  ValveAck -->|Lỗi| Failed[Start Failed, giữ confirmed_at null]
  Recheck -->|Lỗi| Failed
  PumpAck -->|Lỗi| Failed
  Failed --> Recovery[RecoveryStop riêng: OFF bơm → ACK → OFF van tưới → ACK → OFF van phun → ACK]
  Recovery -->|Đủ| Off[Mode Off: đủ ACK nhận lệnh OFF]
  Recovery -->|Lỗi| U[Mode Unknown, lần Bật kế tiếp chạy Reset lại]
```

Trước Bật, mode Watering/Spraying thì409, phải Dừng trước; không tưới/phun trên cùng Device đồng thời. Devices khác có workflow/lock độc lập. Reset đủ ACK chuyển nội bộ sang bước Start, không mở khóa để lệnh Bật khác chen vào.

```mermaid
sequenceDiagram
  actor Farmer
  participant API
  participant Domain as ActuatorTasks
  participant MQTT as Shared MQTT transport
  participant ESP as Hardware
  Farmer->>API: POST Stop
  API->>Domain: kiểm tra quyền, preempt Pending Start nếu có
  Domain-->>API: task Pending + status_url
  API-->>Farmer: 202
  Domain->>MQTT: OFF bơm chung (ID A)
  MQTT->>ESP: subscribe/station/{stationId}
  ESP-->>MQTT: ACK {taskId:A,status:ACK,action:0}
  MQTT->>Domain: receipt đúng Device + ID + action
  Domain->>MQTT: OFF van đang dùng (ID B)
  MQTT->>ESP: command riêng
  ESP-->>MQTT: ACK {taskId:B,status:ACK,action:0}
  MQTT->>Domain: receipt
  Domain->>Domain: Confirmed, confirmed_at = ACK cuối
  Farmer->>API: GET status_url
  API-->>Farmer: Confirmed / CommandReceipt
```

Nếu mode Unknown hoặc Stop preempt thao tác chưa hoàn tất, Dừng **cả** van theo purpose watering rồi spraying sau pumpOFF. PumpOFF thiếu ACK thì dừng chuỗi, không gửi đóng van tiếp. Đây là quy tắc điều phối dựa trên receipt đã chốt; không bảo đảm trạng thái vật lý từ ACK.

Stop được chen để hủy bước ON chưa gửi. Start cũ Failed/CANCELLED_BY_STOP, ACK/callback cũ bị bỏ qua. Lệnh ON đã ra wire không thể thu hồi; Stop gửi OFF mới và giữ Unknown đến đủ ACK. Một Stop/RecoveryStop đang chạy thì409, không tạo chuỗi Stop trùng. Không auto-ON retry; Reset/Stop/RecoveryStop lỗi không lặp vô hạn.

Broker disconnect làm mọi workflow đang chạy Failed và modes Unknown. Start lỗi có RecoveryStop riêng nhưng broker offline khiến recovery Failed, không queue offline; reconnect không tự phát lệnh. Lần Bật tiếp theo bắt buộc Reset. Backend shutdown hủy các waits/unsent steps, không giả định biết trạng thái hardware sau shutdown.

ACTUATOR_TASKS top-level theo shape ERD; response_payload giữ steps/status/ACK/links. Không created_by/confirmed_by, không HTTP manual confirm. Không log Cultivation tự động từ receipt. Persistence và frontend control đã có; đọc runtime và Mongo/UI guides hiện hành.

Trước mỗi publication ON/OFF recheck Device và actuator Active, kể cả OFF nội bộ. Inactive/Maintenance không có ngoại lệ Stop: task không tiếp tục gửi, mode Unknown, không giả Off. Recipe cần đúng một mỗi purpose; seed2/3/4 chỉ là mặc định, hai van có thể gán ngược lúc đăng ký. Missing/duplicate purpose409, không tự chọn actuator đầu tiên hoặc bỏ qua duplicate Inactive.
