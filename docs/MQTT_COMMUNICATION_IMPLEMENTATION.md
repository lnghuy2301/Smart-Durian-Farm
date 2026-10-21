# MQTT — implementation đang dùng và tiếp nhận Configuration cuối

Cập nhật21/10/2026. Hợp nhất guide communication/contract v1/review sáu Sensor; source nền `1f6c1fd`. [Protocol người dùng hiện có](MQTT_HARDWARE_PROTOCOL_VERIFIED.md), [DOCX hiện có](MQTT_Configuration_Smart_Farm_Durian_v1.0.docx). Người dùng sẽ gửi Configuration chốt tiếp theo; đợt dọn này không đổi firmware, payload, topic hoặc credentials.

## Giao tiếp source đang triển khai

| Hướng | Topic | Payload |
| --- | --- | --- |
| Telemetry lên | publish/station/{stationId} | stationId + sensorRecords[{dataStreamId,result}] |
| ACK lên | publish/station/{stationId} | taskId:number, status:ACK, action:0 hoặc1; stationId nếu có phải khớp topic |
| Command xuống | subscribe/station/{stationId} | targets[{taskId,taskingCapabilityId}], taskingParameters{actionType:control,action:0 hoặc1} |

ACK không có taskId/action là legacy và bị reject; không dùng short ACK cũ để xác nhận task. ACK chỉ nhận command, không xác nhận relay/lưu lượng/áp lực vật lý.

Topic station→DEVICES.station_id→DEVICES.id UUID; Sensor lookup device_id+data_stream_id, Actuator device_id+capability_id. station bất biến/không secret/không FK. Không hardcode một station global cho mọi Device. Stream/capability có thể dùng lại ở Device khác; numeric IDs dương, safe integer.

| Stream demo | Type | Raw unit |
| --- | --- | --- |
|301|air_temperature|C|
|302|air_humidity|%|
|303|soil_moisture|%RH|
|304|soil_temperature|C|
|305|soil_ph|H+|
|306|soil_ec|μS/cm|

Đây là mapping bộ demo đã chốt, router vẫn resolve bằng metadata, không ép mọi station tương lai dùng cùng IDs. Sensor type/stream/Device bất biến; unit varchar16 sửa được. Metadata303 cũ% giữ nguyên tới khi chủ sửa; readings vẫn giữ raw%RH và diagnostic mismatch. Không tự convert, tự tạo Sensor hay tự đặt thresholds.

## Runtime, quyền và lỗi

Database runtime dùng `database-mqtt.service.ts` với cùng DeviceRecords/SensorRecords/TelemetryRecords/ActuatorTaskRecords như HTTP. Chế độ memory dùng mqtt.service.ts; giữ để test. MQTT.js quản lý connect/reconnect/SUBACK/shutdown. Presence last_seen_at monotonic trong PG, không version/audit metadata mỗi packet; Active khác Online và khác relaystate.

Parser phân biệt telemetry/ACK bằng shape. Retained, malformed UTF-8/JSON/result, duplicate stream, station mismatch hoặc station chưa đăng ký bị từ chối; telemetry lỗi không rơi xuống ACK. Stream chưa map có diagnostic, không tự đăng ký. Packet tối đa64KiB/100 readings, diagnostics FIFO200 và tối đa200 handlers đồng thời theo source.

measured_at là backend packet arrival, received_at bước ghi Mongo, không thêm timestamp firmware. Telemetry nhận mọi packet hợp lệ theo nhịp hardware khoảng15s, FIFO10.000 readings. [Mongo telemetry](MONGO_TELEMETRY_IMPLEMENTATION.md).

Farmer Accepted còn hiệu lực được đọc đúng scope/reading interval; hết phân công mất latest/history IoT. Diagnostic chứa readings cũng lọc theo assignment trước pagination. Không endpoint HTTP inject telemetry hoặc publish arbitrary MQTT.

ACK đối chiếu taskId+Device+requested action+arrival time; sai/trùng/trễ/unknown không revive workflow. Confirmed/confirmed_at là receipt backend; physical_state vẫn Unknown. Chờ10s/step. Bơm2 shared, van3 watering, van4 spraying; Unknown trước Start phải OFF2→ACK→OFF3→ACK→OFF4→ACK rồi valveON→ACK→pumpON→ACK. Stop/recovery bơm trước van; không đồng thời tưới/phun. Restart không tự gửi command, pending cũ Failed và Start sau Reset. [Workflow](ACTUATOR_TASKS_WORKFLOW_DESIGN.md), [durable journal](MONGO_ACTUATOR_TASKS_IMPLEMENTATION.md).

## Cấu hình và kiểm tra thủ công

- Root `.env`: MQTT_ENABLED, MQTT_BROKER_HOST, MQTT_BROKER_PORT, MQTT_USERNAME, MQTT_PASSWORD, MQTT_USE_TLS cùng các timeouts/presence keys theo `.env.example`/mqtt.config.ts. Không in credentials.
- DEMO_DEVICE_STATION_ID chỉ phục vụ chuẩn bị demo; HTTP/MQTT tìm Device đã đăng ký. Không thay bằng global station hay thêm auth_token firmware.
- Không cần Postman environment. Import [collection MQTT](postman/MQTT-Communication-Local-Test.postman_collection.json), copy JWT/UUID bằng tay. Control dùng collection riêng, chỉ gửi lệnh thật trong buổi test được người dùng chủ động thực hiện.
- Database mode restart giữ metadata/history, không tạo lại Farm/Device/Sensor và không mặc định JWT đã mất. OTP/proof dở mới cần xác minh lại. Khi test legacy memory, restart mất dữ liệu RAM là expected.
- Xem [readiness của trạm thật](REAL_HARDWARE_DATABASE_READINESS.md), [demo config/UUID](MQTT_DEMO_AND_API_IDENTIFIERS.md), [kế hoạch nghiệm thu](IMPLEMENTATION_PLAN.md).

API diagnostic: GET `/api/mqtt/status`, `/api/mqtt/devices/:deviceId/status`, `/api/mqtt/devices/:deviceId/messages`. Quyền global và resource theo controller/scopes; không mở global cho Farmer.

## Source và kiểm thử

`apps/api/src/mqtt/mqtt.protocol.ts` parse/build; mqtt.transport.ts connection; persistence/database-mqtt.service.ts async routing; persistence/database-actuator-task-records.ts orchestration; mqtt/mqtt-diagnostics.ts diagnostics. Runtime guide và MONGO guides ghi đầy đủ providers/locks/tests/restart.

Unit/fake/TCP loopback kiểm packet reject, raw units, command shape, ACK correlation, timeout/reset/Stop/recovery. Full database/browser tests kiểm HTTP/MQTT/QR/restart. Đây chưa phải nghiệm thu ESP32/relay thật. Lệnh kiểm tra/fixture: [runtime guide](DATABASE_RUNTIME_IMPLEMENTATION.md).

## Khi nhận Configuration cuối

1. Đọc toàn bộ bản người dùng gửi; ghi rõ version và nguồn chốt trong mục lục này.
2. Đối chiếu host/port/TLS/credentials keys, topics, telemetry shape/units/timestamps, command targets/action, ACK correlation và ý nghĩa receipt, mapping IDs và timeouts.
3. Nêu sai khác cùng tác động DEVICES/SENSORS/ACTUATORS/telemetry/tasks/UI. Không tự đổi nghiệp vụ hoặc migrations đã Applied; hỏi phần chưa rõ.
4. Sửa parser/transport/adapters/tests/Postman/docs theo quyết định, giữ shared instances. Chỉ thêm migration khi schema thật sự cần thay đổi được duyệt.
5. Chạy hồi quy cô lập, sau đó người dùng nghiệm thu hardware; ghi case/evidence thực, không đánh dấu pass từ fixture.

Nguồn protocol/ERD/DOCX người dùng đang chỉnh được giữ nguyên trong lần dọn. Bản Configuration chưa gửi không được suy diễn thành contract mới.
