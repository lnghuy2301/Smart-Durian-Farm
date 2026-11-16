# Smart-Farm-Durian — MQTT Hardware Communication Contract

**Version:** 1.0 Final
**Status:** FINAL / HARDWARE-TESTED
**Scope:** Quy ước giao tiếp MQTT giữa Server và Hardware cho Smart-Farm-Durian.
**Audience:** Codex trong VS Code, Backend developers, Hardware team.

> Đây là **source of truth cuối cùng cho giao tiếp MQTT** của dự án.
> Nếu code cũ, tài liệu cũ hoặc implementation cũ mâu thuẫn với file này, ưu tiên file này.
> Các giá trị deployment thật như broker host, port, credential và station ID phải lấy từ ENV/config, không hard-code vào source code hay tài liệu.

---

## 1. Mục tiêu

Hệ thống MQTT phục vụ 2 nhóm chức năng:

1. Hardware gửi dữ liệu cảm biến lên Server.
2. Server gửi lệnh điều khiển actuator xuống Hardware và Hardware phản hồi ACK.

```text
Hardware / ESP32
      │
      │ MQTT
      ▼
MQTT Broker
      │
      │ MQTT
      ▼
NestJS Backend
      │
      ├── PostgreSQL
      └── MongoDB
```

---

## 2. Cấu hình kết nối

Mọi giá trị kết nối phải lấy từ ENV.

```env
MQTT_BROKER_HOST=<mqtt-broker-host>
MQTT_BROKER_PORT=<mqtt-broker-port>
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_USE_TLS=false
MQTT_TEST_STATION_ID=<test-station-id>
```

Quy tắc:

- Hiện tại có thể tiếp tục dùng broker MQTT miễn phí đã kiểm thử.
- Khi chuyển sang broker riêng, chỉ thay thông tin kết nối.
- Không đổi topic hoặc payload nếu không có version protocol mới.
- `.env` không commit lên Git.
- `.env.example` chỉ chứa placeholder.
- Không hard-code broker host, port, station ID, username hoặc password trong code.
- Production không phụ thuộc vào một `MQTT_TEST_STATION_ID` toàn cục.

---

## 3. Topic chính thức

### 3.1 Hardware → Server

```text
publish/station/{stationId}
```

Dùng cho:

- Sensor telemetry.
- ACK của actuator command.

### 3.2 Server → Hardware

```text
subscribe/station/{stationId}
```

Dùng cho:

- Command điều khiển actuator.

---

## 4. Station ID

`stationId` là ID hardware của một station/device.

```text
MQTT topic stationId
        ↓
DEVICES.station_id
        ↓
DEVICES.id
```

Quy tắc:

- `DEVICES.station_id` phải `UNIQUE NOT NULL`.
- `stationId` không dùng làm PK nội bộ.
- Các quan hệ trong hệ thống dùng UUID nội bộ `DEVICES.id`.
- Nếu payload có `stationId`, phải đối chiếu với station ID lấy từ topic.
- Nếu topic và payload không khớp, reject message và log lỗi.

---

## 5. Sensor telemetry

### 5.1 Topic

```text
publish/station/{stationId}
```

### 5.2 Payload đã kiểm thử với hardware

```json
{
  "stationId": "<STATION_ID>",
  "sensorRecords": [
    {
      "dataStreamId": 302,
      "result": "81.22 %"
    },
    {
      "dataStreamId": 301,
      "result": "28.86 C"
    },
    {
      "dataStreamId": 303,
      "result": "4.40 %rH"
    },
    {
      "dataStreamId": 304,
      "result": "28.00 C"
    },
    {
      "dataStreamId": 305,
      "result": "8.50 H+"
    },
    {
      "dataStreamId": 306,
      "result": "0.00 µS/cm"
    }
  ]
}
```

---

## 6. Mapping sensor đã xác nhận

| dataStreamId | Chỉ số | sensor_type đề xuất | Unit hardware |
|---:|---|---|---|
| `301` | Nhiệt độ không khí | `air_temperature` | `C` |
| `302` | Độ ẩm không khí | `air_humidity` | `%` |
| `303` | Độ ẩm đất | `soil_moisture` | `%rH` |
| `304` | Nhiệt độ đất | `soil_temperature` | `C` |
| `305` | pH đất | `soil_ph` | `H+` |
| `306` | EC đất | `soil_ec` | `µS/cm` |

Hardware có thể bổ sung thêm chỉ số sau này theo cùng cấu trúc:

```text
dataStreamId mới
+ tên chỉ số
+ unit
```

Không cần đổi topic hoặc payload tổng thể.

---

## 7. Quy tắc parse telemetry

Ví dụ:

```json
{
  "dataStreamId": 301,
  "result": "28.86 C"
}
```

Backend parse thành:

```text
data_stream_id = "301"
value          = 28.86
unit           = "C"
```

Quy tắc:

- `dataStreamId` là external identifier.
- Có thể lưu `data_stream_id` dạng string trong metadata.
- `result` phải tách numeric value và unit.
- Giữ nguyên unit hardware gửi lên.
- Không tự convert unit.
- Nếu unit nhận được khác `SENSORS.unit`, vẫn giữ telemetry gốc và log mismatch.
- Không giả định `sensorRecords` chỉ có 3 hoặc 6 phần tử.
- Backend phải hỗ trợ sensor mới mà không cần sửa MQTT router.

---

## 8. Sensor lookup

Lookup theo:

```text
device_id + data_stream_id
```

Flow:

```text
stationId
   ↓
DEVICES.station_id
   ↓
DEVICES.id
   ↓
SENSORS
WHERE device_id = ...
AND data_stream_id = ...
```

Constraint đề xuất:

```text
UNIQUE(device_id, data_stream_id)
```

---

## 9. Actuator command

### 9.1 Topic

```text
subscribe/station/{stationId}
```

### 9.2 Payload đã kiểm thử với hardware

```json
{
  "targets": [
    {
      "taskId": 9001,
      "taskingCapabilityId": 2
    }
  ],
  "taskingParameters": {
    "actionType": "control",
    "action": 1
  }
}
```

---

## 10. Command fields

### `taskId`

- Do Server tạo.
- Dùng để correlation command ↔ ACK.
- Hardware nhận `taskId` nào thì phản hồi đúng `taskId` đó.
- Không được thay bằng relay ID hoặc capability ID.
- Backend phải đảm bảo `taskId` đủ unique trong phạm vi quản lý task.

### `taskingCapabilityId`

ID capability/relay hardware cần điều khiển.

Map từ:

```text
ACTUATORS.capability_id
```

Hardware hiện expose capability IDs:

```text
1
2
3
4
```

Kết quả test thực tế:

```text
capability_id = 2
→ Pump
```

Hai van đều đã test điều khiển ON/OFF thành công và có thể linh động đổi vai trò nghiệp vụ.

Không hard-code business purpose theo capability number.

Đúng:

```text
ACTUATORS.capability_id
ACTUATORS.purpose
```

Sai:

```text
if capability_id == 3 => watering
if capability_id == 4 => spraying
```

Capability `1` hiện có trên firmware nhưng không gán business meaning cố định trong protocol này.

### `taskingParameters.actionType`

Giá trị hiện tại:

```text
control
```

### `taskingParameters.action`

Đã test hardware thành công:

```text
1 = ON
0 = OFF
```

Phải gửi dạng Number.

---

## 11. ACK từ Hardware

### 11.1 Topic

```text
publish/station/{stationId}
```

### 11.2 Payload cuối cùng

```json
{
  "taskId": 9001,
  "status": "ACK",
  "action": 1
}
```

ACK có 3 trường protocol chính:

```text
taskId
status
action
```

---

## 12. Ý nghĩa ACK

### `taskId`

- Echo nguyên giá trị Server đã gửi.
- Dùng để tìm chính xác task cần cập nhật.

```text
ACK.taskId
   ↓
ACTUATOR_TASKS.task_id
```

ACK không cần gửi lại `taskingCapabilityId`.

### `status`

Giá trị hiện tại:

```text
ACK
```

Nghĩa:

```text
Hardware đã nhận command và gửi xác nhận về Server.
```

`ACK` không đồng nghĩa với việc hệ thống đã đo độc lập trạng thái vật lý cuối cùng.

### `action`

```text
1 = ON
0 = OFF
```

Hardware trả lại action tương ứng với command.

---

## 13. ACK validation

Backend xử lý ACK theo thứ tự:

```text
1. Validate JSON
2. Validate taskId
3. Find task by taskId
4. Validate status == ACK
5. Compare ACK.action với task.action
6. Nếu khớp → confirm task
7. Nếu không khớp → log mismatch / xử lý failure theo ACTUATOR_TASKS spec
```

---

## 14. Routing trên upstream topic

Cả telemetry và ACK đều đi qua:

```text
publish/station/{stationId}
```

### Telemetry

Nếu có:

```text
sensorRecords: array
```

→ `TelemetryHandler`

### ACK

Nếu có:

```text
taskId
status = "ACK"
action
```

→ `ActuatorAckHandler`

### Unknown payload

```text
log unsupported MQTT payload
không crash MQTT consumer
không persist như telemetry/ACK hợp lệ
```

---

## 15. NestJS responsibility

Đề xuất tách:

```text
MqttService
→ connect / subscribe / publish

MqttTopicRouter
→ route payload theo shape

DeviceResolver
→ stationId → DEVICES.id

TelemetryHandler
→ sensorRecords parsing + persistence

ActuatorCommandService
→ build + publish actuator command

ActuatorAckHandler
→ validate taskId/status/action
```

---

## 16. MQTT subscription của Backend

Backend có thể subscribe:

```text
publish/station/+
```

Không dùng:

```text
#
```

làm application subscription mặc định.

---

## 17. MQTT publish của Backend

Flow chuẩn:

```text
1. Resolve DEVICES.station_id
2. Resolve ACTUATORS.capability_id
3. Server sinh taskId
4. Persist actuator task theo ACTUATOR_TASKS spec
5. Build payload MQTT
6. Publish subscribe/station/{stationId}
7. Hardware thực thi command
8. Hardware publish ACK
9. Backend lookup bằng taskId
10. Validate ACK
```

---

## 18. Business operation: Watering / Spraying

MQTT protocol chỉ biết:

```text
taskingCapabilityId
action
```

Business metadata nằm ở PostgreSQL:

```text
watering
spraying
shared
```

Thiết kế:

```text
Pump
→ purpose = shared

Valve A
→ purpose = watering hoặc spraying

Valve B
→ purpose = spraying hoặc watering
```

Hai van có thể đổi vai trò mà không thay MQTT protocol.

---

## 19. Status rules

### Telemetry

Chỉ persist khi:

```text
Device.status == Active
AND
Sensor.status == Active
```

### Actuator command

Chỉ gửi khi:

```text
Device.status == Active
AND
Actuator.status == Active
```

---

## 20. `last_seen_at`

Khi nhận message hợp lệ từ station đã biết:

```text
DEVICES.last_seen_at = now()
```

Có thể update khi nhận:

- Telemetry hợp lệ.
- ACK hợp lệ.

Online/offline là runtime state suy ra từ `last_seen_at`.

---

## 21. Những điều đã test thực tế

```text
✓ Hardware publish sensorRecords lên publish/station/{stationId}

✓ dataStreamId 301–306 hoạt động

✓ Server publish actuator command xuống subscribe/station/{stationId}

✓ capability_id = 2 điều khiển Pump

✓ Hai van đều điều khiển ON/OFF được

✓ taskId Server gửi xuống được Hardware giữ và phản hồi đúng

✓ action = 1 bật thiết bị

✓ action = 0 tắt thiết bị

✓ ACK trả về theo format:
  taskId + status + action
```

---

## 22. Mosquitto test

### Nghe telemetry và ACK

```cmd
cd "C:\Program Files\mosquitto"

mosquitto_sub.exe -h <MQTT_HOST> -p <MQTT_PORT> -t "publish/station/<STATION_ID>" -v
```

### Nghe command

```cmd
cd "C:\Program Files\mosquitto"

mosquitto_sub.exe -h <MQTT_HOST> -p <MQTT_PORT> -t "subscribe/station/<STATION_ID>" -v
```

### Gửi ON

```cmd
mosquitto_pub.exe -h <MQTT_HOST> -p <MQTT_PORT> -t "subscribe/station/<STATION_ID>" -m "{\"targets\":[{\"taskId\":9001,\"taskingCapabilityId\":2}],\"taskingParameters\":{\"actionType\":\"control\",\"action\":1}}"
```

### Gửi OFF

```cmd
mosquitto_pub.exe -h <MQTT_HOST> -p <MQTT_PORT> -t "subscribe/station/<STATION_ID>" -m "{\"targets\":[{\"taskId\":9002,\"taskingCapabilityId\":2}],\"taskingParameters\":{\"actionType\":\"control\",\"action\":0}}"
```

---

## 23. Error handling bắt buộc

Phải handle/log:

```text
invalid JSON
unknown stationId
topic/payload station mismatch
missing sensorRecords fields
unknown dataStreamId
invalid result format
unknown taskId
invalid ACK status
action mismatch
unsupported payload shape
publish failure
broker disconnected
```

---

## 24. Security / broker migration

Hiện tại có thể dùng broker miễn phí đã kiểm thử.

Khi chuyển broker riêng:

```text
- giữ nguyên topics
- giữ nguyên payloads
- đổi host/port/credentials/TLS qua ENV
```

Khuyến nghị:

```text
per-device MQTT credential
backend service account riêng
topic ACL
TLS nếu firmware hỗ trợ
```

---

## 25. Các điều chỉnh cần áp dụng cho project

### 25.1 DEVICES

```text
station_id varchar(50) UNIQUE NOT NULL
status = Active | Inactive | Maintenance
last_seen_at timestamp NULL
```

### 25.2 SENSORS

Cần hỗ trợ:

```text
air_temperature
air_humidity
soil_moisture
soil_temperature
soil_ph
soil_ec
```

Khuyến nghị:

```text
unit varchar(16)
UNIQUE(device_id, data_stream_id)
```

### 25.3 ACTUATORS

```text
purpose = watering | spraying | shared
capability_id
status = Active | Inactive
UNIQUE(device_id, capability_id)
```

Không hard-code `watering/spraying` theo capability ID.

### 25.4 IOT_TELEMETRIES

Collection tiếp tục dùng:

```text
device_id
data_stream_id
value
unit
measured_at
received_at
```

### 25.5 ACTUATOR_TASKS

Protocol hiện đủ để correlation bằng:

```text
task_id
```

Task phải lưu đủ thông tin để từ `task_id` truy lại:

```text
device
actuator/capability
requested action
status
timestamps
```

Schema chi tiết, timeout, retry và multi-actuator operation được chốt trong spec riêng.

---

## 26. Tài liệu/implementation cũ cần cập nhật nếu còn assumption sau

```text
observation/sensor/{dataStreamId} là telemetry path hiện tại
ACK không có taskId
chỉ có sensor 301–303
unit chỉ có % và oC
capability ID hard-code trực tiếp thành watering/spraying
DEVICES.status có Offline
```

---

## 27. FINAL PROTOCOL SUMMARY

### Hardware → Server

Topic:

```text
publish/station/{stationId}
```

Telemetry:

```json
{
  "stationId": "<STATION_ID>",
  "sensorRecords": [
    {
      "dataStreamId": 301,
      "result": "28.86 C"
    }
  ]
}
```

ACK:

```json
{
  "taskId": 9001,
  "status": "ACK",
  "action": 1
}
```

### Server → Hardware

Topic:

```text
subscribe/station/{stationId}
```

Command:

```json
{
  "targets": [
    {
      "taskId": 9001,
      "taskingCapabilityId": 2
    }
  ],
  "taskingParameters": {
    "actionType": "control",
    "action": 1
  }
}
```

---

## 28. FINAL DECISIONS

```text
Sensor:
301 = air_temperature
302 = air_humidity
303 = soil_moisture
304 = soil_temperature
305 = soil_ph
306 = soil_ec

Actuator:
capability 2 = Pump (hardware-tested)
remaining valve capabilities are mapped by database metadata
business purpose of valves is configurable

Action:
1 = ON
0 = OFF

taskId:
generated by Server
sent to Hardware
echoed back unchanged in ACK

ACK:
taskId
status = ACK
action
```

---

## 29. Protocol freeze

**MQTT protocol version 1.0 is frozen for the current thesis implementation.**

Codex must not modify topic names, payload structures, field meanings, sensor IDs, task correlation behavior, or action semantics unless:

1. Hardware team explicitly changes the protocol; and
2. this document is versioned and updated first.

Từ thời điểm này, implementation phải **adapt theo contract này**, không âm thầm redesign protocol trong code.
