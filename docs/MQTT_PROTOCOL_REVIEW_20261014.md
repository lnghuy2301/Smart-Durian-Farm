# Rà soát giao thức MQTT và mở rộng sáu Sensor — 2026-10-14

Base **024214b feat/web-reference-integration**, kế thừa Farm persistence5782323. Nhánh riêng **feat/sensors-six-streams**. Đã đọc toàn bộ MQTT_HARDWARE_PROTOCOL_VERIFIED.md hiện có và đối chiếu source/tests. Người dùng chốt mở rộng đủ sáu semantic Sensor thay cho quyết định giữ ba loại trước đây. IOT_CORE_TABLES_SPEC/ERD riêng vẫn mô tả ba loại; không tự sửa nguồn riêng, phần enum của chúng cần được người dùng cập nhật theo quyết định này. Luồng Device installed_at/cost bắt buộc, station_id bất biến và identity UUID đã chốt vẫn giữ, không lấy nullable khuyến nghị cũ làm thay đổi nghiệp vụ.

## Giao tiếp cuối cùng

| Hướng | Topic | JSON |
|---|---|---|
| Hardware→server telemetry | publish/station/{stationId} | stationId +sensorRecords[{dataStreamId,result}] |
| Hardware→server ACK | publish/station/{stationId} | taskId +status="ACK" +action0/1; stationId optional, nếu có phải khớp topic |
| Server→hardware | subscribe/station/{stationId} | targets[{taskId,taskingCapabilityId}], taskingParameters{actionType:"control",action:0/1} |

Không topic observation/sensor hoặc root wildcard #. Broker đọc MQTT_BROKER_HOST/PORT/USERNAME/PASSWORD/USE_TLS; .env không được in/commit/sửa. DEMO_DEVICE_STATION_ID dùng setup demo, không thay resolver production bằng một global station. `.env.example` hiện đã có host placeholder và station trống; các timeout/port mặc định là configuration, không định danh hardware hard-code.

Topic station→DEVICES.station_id→DEVICES.id UUID, rồi sensor theo device_id+data_stream_id; station không phải FK/token. JSON station mismatch, malformed UTF-8/JSON/result, duplicate stream, retained message bị từ chối; parser/routing không chết vì một packet lỗi. Telemetry được phân biệt với ACK bằng shape; packet sensorRecords lỗi không rơi xuống đường ACK. Incoming units giữ nguyên, không đổi %RH thành% hoặc μ thành ký tự khác; mismatch metadata được ghi diagnostics và readings hợp lệ vẫn lưu raw unit. Chỉ Device/Sensor được phép theo status và đã map mới ghi telemetry; stream chưa đăng ký ghi UNMAPPED_STREAM, không tự tạo Sensor từ MQTT.

ACK đối chiếu taskId, Device và requested action; unknown/wrong device/wrong action/ACK cũ không xác nhận task. Confirmed/confirmed_at là receipt ACK tại backend, **không chứng minh relay/bơm vật lý đã hoạt động**. ACK chờ10s mỗi bước, Start van trước/bơm sau; Stop/Reset bơm trước/hai van sau, thiếu ACK giữ kết quả lỗi/Unknown và trước Start sau phải Reset đủ ACK. Firmware/topic/protocol không đổi. Recipe demo2/shared,3/watering,4/spraying là quyết định đã chốt và được kiểm tra với metadata từng Device; không tự diễn giải capability1 thành chức năng mới, không tuyên bố recipe đó áp cho mọi station tương lai.

Nguồn implementation: mqtt.protocol.ts (parse/build), mqtt.transport.ts (connection), mqtt.service.ts (station resolution/routing/diagnostics), telemetry.service.ts (readings), actuator-tasks.service.ts (receipt correlation/sequence/timeout/recovery). Transport nhận packet tối đa64KiB/100 readings, không giả định chỉ3 hoặc6 streams. measured_at dùng thời điểm packet tới backend theo quyết định không đổi firmware; received_at dùng thời điểm bước ghi. Chu kỳ gửi15s thuộc hardware, không đặt timer làm mất packet hoặc đổi thành15 phút.

## Sáu loại và đơn vị

| Stream demo | sensor_type | Unit mới |
|---|---|---|
| 301 | air_temperature | C |
| 302 | air_humidity | % |
| 303 | soil_moisture | %RH |
| 304 | soil_temperature | C |
| 305 | soil_ph | H+ |
| 306 | soil_ec | μS/cm |

API cho tạo/filter sáu enum values; type/device/stream tiếp tục bất biến. Unit metadata varchar16 vẫn sửa được, không áp dropdown hai unit cũ hoặc chuyển đổi dữ liệu đo. Mapping trên là bộ hardware đã xác nhận/demo seed; không UNIQUE stream toàn hệ thống hoặc ép mọi Device tương lai phải dùng cùng mã cho cùng ý nghĩa. Metadata chủ động đăng ký quyết định lookup.

Frontend cập nhật type union, dropdown/filter/labels ở types/api.ts, workflows/iotConfig.ts, pages/IotResources.tsx và pages/Iot.tsx. Nhiệt độ đất dùng cùng biểu tượng nhiệt độ; không sửa layout/auth/brand hoặc AuthIntroPanel riêng. Không tự đổi ngưỡng pH/EC: thresholds vẫn nullable cùng cặp/min<max theo nghiệp vụ hiện có, không áp giới hạn vật lý chưa được chốt.

Migration **006_sensor_types** chỉ thay CHECK sensor_type bằng sáu giá trị, giữ identity trigger/FK/unique/status và migrations001–005 immutable. Không DML sửa dữ liệu cũ. Fresh seed có18 Sensors (6 mỗi Device), vẫn9 Actuators và54 Trees; **108 business records +4 bridges**, tăng9 so với profile99 cũ. Sensor/actuator loops độc lập, chỉ capabilities2/3/4 được seed. Rerun không overwrite units/type/threshold/status/IDs/password/tokens/requests cũ; legacy303 unit% được giữ nếu đã tồn tại, raw packet %RH được lưu kèm mismatch. Khi runtime DB hoàn tất, owner/Admin xử lý metadata theo đúng luồng sửa nếu cần đổi unit; không âm thầm rewrite lịch sử.

Đợt này không chạy seed lại demo. Dữ liệu mới được thêm bằng db:seed theo lệnh riêng khi người dùng thực sự muốn mở rộng profile; API startup không auto-seed/auto-register. Khi mã304–306 chưa có trong một Device, nhận MQTT chỉ báo UNMAPPED_STREAM; đây là metadata chưa đăng ký, không phải parser bỏ hỗ trợ.

## Tái lập

Từ root: npm run build → db:status → db:migrate → db:status. Không chạy seed để chữa migration; .env giữ nguyên. Test fixture riêng: docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d → npm run test:persistence → npm test → npm run lint/typecheck/build → npm run test:web/test:web:e2e/lint:web/typecheck:web/build:web → down đúng fixture, không -v. Windows fallback dùng Node local bins như POSTGRES_FARMS_IMPLEMENTATION.md.

Kết quả: **230/230 backend, 85/85 persistence, 8/8 web unit, 37/37 browser**, backend/web lint/typecheck/build và web format đạt. Kiểm thử mới ở mqtt.test.ts nhận7 readings (301–306 và307) qua đúng Device/Sensor metadata, preserve units; sensors.test.ts tạo ba type mới qua HTTP, không cho PATCH đổi type. persistence.integration.ts kiểm tra18 sensors/9 actuators, sáu mappings, idempotent seed và giữ unit legacy. Test cũ từng coi soil_temperature invalid đã được đổi sang type không hỗ trợ; không sửa validation để chiều test cũ.

Browser review phát hiện test mở rộng37 flows làm login thứ21 trong một phút nhận429 đúng chính sách20/min. Helper trước chỉ chờ sidebar hoặc alert và không assert status, nên cảnh báo phiên cũ/429 bị hiểu nhầm là login đã thành công. Helper hiện chờ response tương ứng và session/error thật; case relogin assert200. Hai case session cuối dùng một cửa sổ quota fixture riêng (dịch startedAt của bucket test, không đổi giới hạn/code production hoặc clock toàn backend); không dùng sleep dài/tăng timeout/bỏ security assertions. Chẩn đoán chỉ dùng dữ liệu fixture/status/cờ storage, không ghi JWT/password; hooks chẩn đoán tạm đã bỏ khỏi source.

Local migration006 Applied; đối chiếu SHA-256/counts13 bảng nghiệp vụ và4 bảng technical trước/sau đều giữ nguyên; ledger thêm006, không seed lại. Sources001–005 immutable. Các kiểm thử không dùng hardware/Twilio/SMTP thật; metadata snapshot không được in ra logs.

Đây là đối chiếu tài liệu hardware đã xác nhận +kiểm thử server/loopback, chưa test trực tiếp ESP32 trong đợt rà soát. Tasks/telemetry/Cultivation vẫn RAM; allocator/task recovery/retention/hash-chain durable và full-runtime database/hardware acceptance còn phải hoàn tất. Hai module AI vẫn để sau theo người dùng. Tiếp Zone→assignments→Tree/Harvest/IoT metadata PG→Mongo→AppModule database wiring. Không publish/push/merge hoặc chỉnh nguồn riêng trong đợt này.
