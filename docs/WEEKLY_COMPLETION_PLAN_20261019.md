# Kế hoạch hoàn thiện và test hardware — tuần19–25/10/2026

Ngày rà soát19/10/2026 là thứ Hai,20/10 là thứ Ba. Người dùng nói “ngày mai thứ3(19/10)”; kế hoạch tạm lấy buổi nhận/test hardware là **thứ Ba20/10**, không coi ngày hardware tới là dữ kiện đã xác minh. Không cần dừng các công việc độc lập để chờ ngày chính xác.

Mục tiêu tuần: hoàn thiện80–90% **phạm vi đồ án không AI đã thống nhất**, ưu tiên demo dữ liệu thật, không mất nghiệp vụ sau restart và frontend đọc/ghi cùng backend. Đây là mục tiêu, không phải phần trăm hoàn thành đã được đo hoặc cam kết chắc chắn. Chẩn đoán bệnh/chatbot để sau theo người dùng; nếu tính cả AI vào tổng dự án thì chưa đủ cơ sở tuyên bố đạt80–90%.

## Hiện trạng có bằng chứng

Tiến triển ngay trong lượt19/10: Sensor hoàn tất commit **9571247**; Actuator adapter hoàn tất trên branch kế thừa, PostgreSQL đủ13/13 business-table adapters; **238 backend/200 persistence/37 browser** và API quality checks đạt. Migration001–013 Applied, dữ liệu cũ giữ nguyên. Xem [progress cập nhật](BACKEND_PROGRESS_CURRENT.md)/[Actuator guide](POSTGRES_ACTUATORS_IMPLEMENTATION.md) cho source/branch. Thứ tự tiếp **Mongo telemetry→tasks→Cultivation→runtime/wiring→restart/frontend/hardware**. Đoạn base rà soát bên dưới giữ để biết điểm bắt đầu, không còn nghĩa Sensor/Actuator chưa code.

Base rà soát **9ec5f29**, nhánh đang làm feat/postgres-sensors-persistence. API Auth/Users/HTX/catalogs/Farm/Zone/phân công/Tree/Harvest/Device/Sensor/Actuator/telemetry/tasks/Cultivation/QR đã có. Frontend các luồng quản lý, duyệt, nhật ký, thu hoạch và QR đã có; không dựng lại chúng. Checkpoint base **236 backend/167 persistence/37 browser** và API quality checks đạt. Sensor adapter source đang hoàn thiện cùng integration/tests, chưa tính là delivery mới trước khi hồi quy/bàn giao.

Schema13 bảng PostgreSQL/4 bảng technical/ledger và3 collections Mongo/private state đã có. **11/13 PG business-table adapters hoàn tất** ở base; còn Sensor/Actuator. Chưa có3 Mongo domain adapters. **AppModule vẫn RAM**: không nhầm adapter HTTP riêng đã test restart với toàn runtime đang chạy database. MQTT parser/transport/router/chuỗi control đã có loopback tests, chưa nghiệm thu ESP32 trực tiếp. Không tự suy tỷ lệ tổng thể từ số tests, số bảng hoặc lượng source.

## Công việc còn lại theo đường phụ thuộc

| Thứ tự | Việc cần xong | Điều kiện coi là đạt |
| --- | --- | --- |
| 1 | Sensor PG, rồi Actuator PG, mỗi module một branch | Async shared RAM seam +PG adapter; immutable identifiers/composite unique/scopes/proposals/history/version/audit; race/rollback/fresh app-pool tests; migration/docs/local commit |
| 2 | IOT_TELEMETRIES Mongo | Packet hợp lệ→Device UUID+stream→raw value/unit, measured/received times theo quyết định cũ; latest/history/current assignment scope; append/trim tổng10000 readings atomic/deterministic qua restart |
| 3 | ACTUATOR_TASKS Mongo/private recovery state | Numeric wire task IDs bền vững/không trùng sau restart; step/task/mode/links durable; không replay ON; lần Start tiếp Reset đủ ACK; lock1 workflow/Device, Stop/recovery/timeout race được kiểm thử |
| 4 | CULTIVATION_EVENTS Mongo/private context | Pending15 phút→Locked đúng deadline; Zone hash-chain/head/event/context atomic; immutable gốc+corrections; quyền theo phân công gốc/hạn15 ngày giữ nguyên; QR full lineage/applicability |
| 5 | Database runtime toàn backend | Chuyển consumers/guards/workers/MQTT/QR async, cùng instances/pool/ports; Auth/User/HTX/Farm/Zone/catalog/Tree/Harvest/IoT/Mongo cùng authority; không mixed PG HTTP/RAM domain hoặc fallback dữ liệu khi DB lỗi |
| 6 | Nghiệm thu xuyên suốt | Cùng process/backend DB nhận hardware; frontend thao tác đúng API; restart giữ users/tài nguyên/quyền/proposals/readings/logs/task journal; OTP dở xác minh lại, không tự gửi command ON |
| 7 | Hoàn thiện demo/UI/tài liệu/release review | Seed bổ sung không overwrite khi cần, backup/restore thử trên fixture; Postman JSON thủ công; guide vận hành và log kết quả thực; màn hình control theo brief; review branch trước quyết định push/merge |

Sau Sensor/Actuator không triển khai lại nghiệp vụ mới cho các modules đã có. Tập trung persistence/wiring, xử lý lỗi có chứng cứ; nghiệp vụ mới mơ hồ phải hỏi và chờ. Không cắt tests hoặc mở rộng quyền để kịp tiến độ.

## Thứ tự thực hiện trong tuần

| Mốc dự kiến | Ưu tiên | Đầu ra kiểm chứng |
| --- | --- | --- |
| Thứ Hai19/10 | Hoàn tất Sensor/Actuator PG; chuẩn bị test hardware và brief UI | Baseline tests/docs/branch rõ ràng; recipe/six mappings/ACK contract đã kiểm tra; chưa tuyên bố full persistence |
| Thứ Ba20/10 — khi hardware có mặt | Smoke MQTT và kiểm tra vật lý theo bảng bên dưới; tiếp telemetry persistence | Evidence packet/ACK/thứ tự van-bơm và ghi chú trạng thái storage đang dùng; lỗi protocol fix theo packet thật, không sửa firmware tự ý |
| Thứ Tư–Năm21–22/10 | Tasks/Cultivation durable, async consumers và database runtime | Restart/failure/concurrency/correction/QR tests; không chia nguồn dữ liệu HTTP/MQTT |
| Thứ Sáu23/10 | Frontend+DB+ESP32 end-to-end, sửa lỗi và màn hình control nếu có mẫu | Test nghiệp vụ role/scopes, hai luồng tưới/phun không giao nhau, ACK thiếu/late/mismatch/restart |
| Cuối tuần24–25/10 | Hồi quy, dữ liệu demo, tài liệu/sơ đồ và buổi diễn thử | Checklist đạt/chưa đạt cụ thể, backup thử, demo tái lập từ tài liệu; mới đánh giá mức80–90% |

Các mốc trên là thứ tự ưu tiên dự kiến, không hứa ngày hoàn tất các khối chưa kiểm thử. Hardware chưa có vẫn tiếp fixture tests/persistence; không thay hardware acceptance bằng log mô phỏng. Nếu một khối chậm, ưu tiên luồng demo đã kiểm chứng và ghi rõ giới hạn; không đánh dấu hoàn thành hoặc ẩn trạng thái RAM.

## Buổi test ESP32 trực tiếp

Nguồn giao tiếp: [MQTT protocol review](MQTT_PROTOCOL_REVIEW_20261014.md), MQTT_HARDWARE_PROTOCOL_VERIFIED.md của người dùng; [tasks API và semantics](ACTUATOR_TASKS_IMPLEMENTATION.md), [workflow](ACTUATOR_TASKS_WORKFLOW_DESIGN.md). Topic/firmware không đổi. Tests tự động dùng fake/localhost, không tự gửi lệnh broker thật trong đợt code. Live commands thuộc buổi người dùng chủ động kiểm tra.

1. Ghi commit/branch, storage mode thật, API readiness, backend/broker connected+subscribed. Xem cấu hình local trong máy, không paste/ghi credentials vào report. Host/port là cùng broker hardware; station **E08CFE41DCAC** là định danh, không secret/token.
2. Kiểm tra metadata đúng trong **nguồn dữ liệu runtime đang dùng**. Seed PG không tự xuất hiện trong API RAM. Nếu DB runtime chưa sẵn, dùng Postman API để tạo cùng Farmer owner/Farm/Zone/Device và ghi rõ chỉ smoke RAM; không override riêng vài providers để giả DB runtime. Nếu đã database mode, dùng UUID tài nguyên database và không đăng ký station trùng.
3. Đúng sáu Sensors:301 air_temperature/C,302 air_humidity/%,303 soil_moisture/%RH,304 soil_temperature/C,305 soil_ph/H+,306 soil_ec/μS/cm. API dùng stream string; hardware dataStreamId có thể JSON number theo parser đã có. Mapping dựa metadata, không global UNIQUE stream. Legacy unit303% khác packet%RH phải giữ raw unit và báo mismatch; sửa metadata theo quyền, không đổi giá trị lịch sử. Nếu thiếu304–306 thì thêm đúng API hoặc seed non-overwriting có preflight, không tự suy from packet.
4. Quan sát packet hardware→`publish/station/E08CFE41DCAC`: stationId+sensorRecords, chu kỳ thực tế khoảng15s. Giá trị/unit hợp lý theo cảm biến, measured_at theo lúc backend nhận packet (firmware không phát timestamp), received_at theo lúc bước ghi. latest/last_seen thay đổi; malformed/unknown stream không làm receiver chết. Không tạo readings giả cho trạm thật để tô dashboard.
5. Đúng ba Actuators: capability2/shared(bơm),3/watering(van tưới),4/spraying(van phun), FK Device UUID. Không suy purpose từ thứ tự insert hoặc dùng station làm FK.
6. Gửi Watering bằng API: lần đầu backend Reset OFF2→ACK→OFF3→ACK→OFF4→ACK, rồi ON3→ACK→ON2→ACK. Mỗi wire taskId khác nhau do server sinh; ACK trả đúng taskId/status ACK/action numeric, chờ10s mỗi bước. Backend Confirmed là receipt; người test quan sát bơm/van riêng và ghi kết quả.
7. Gửi Stop: OFF bơm trước rồi van theo workflow. Test Spraying sau Stop đủ ACK: ON4 trước ON2; Watering/Spraying không chạy cùng Device cùng lúc. Không gọi Stop nhiều lần khi đã có Stop/RecoveryStop đang chạy.
8. Chạy case mất một ACK/disconnect/ACK trễ theo khả năng fixture/hardware thực, quan sát Failed/recovery/Unknown và không tự replay ON. Chỉ thiếu một ACK không được hiển thị “đã tắt”; lần Start tiếp phải Reset đủ ACK. Test tự động đã có cho mismatch/wrong Device/unknown task; không cần thao tác phá firmware.
9. Khi DB runtime hoàn tất, restartbackend sau tạo các dữ liệu mẫu/đề xuất/nhật ký/tasks. Xác nhận dữ liệu còn, OTP dở bắt đầu lại; tasks không tự bật thiết bị và lần Start kế tiếp chạy Reset. Nếu storage RAM ở bước2 thì ghi “restart durability chưa test”, không ghi pass.

Ghi evidence riêng trong report mới ngày thực test: commit/storage mode, case, expected, actual, Pass/Fail/NotRun, packet shape và thời điểm không credentials/JWT/OTP; log hardware quan sát được tách khỏi receipt ACK. Source/schema private của người dùng không sửa để khớp một kết quả test lỗi.

## Frontend cần mẫu bổ sung nào?

**Một màn hình cần thiết:** điều khiển IoT+tiến trình lệnh/lịch sử. Hiện `Iot.tsx` giám sát readings và `IotResources.tsx` quản lý metadata; chưa gọi actuator-tasks API. [Brief cho bên thiết kế](frontend/ACTUATOR_CONTROL_DESIGN_BRIEF.md) ghi rõ states/permission/API và những gì không được biểu diễn sai. Không cần dựng lại Login/Farm/Zone/Tree/Harvest/Cultivation/QR/HTX đã có.

Gửi kèm brief, ACTUATOR_TASKS_IMPLEMENTATION.md/WORKFLOW_DESIGN.md, MQTT_PROTOCOL_REVIEW_20261014.md, source controller/types/schema nhiệm vụ và ảnh giao diện IoT hiện tại. Bên thứ3 chỉ cần HTML/CSS+ảnh desktop/mobile và các trạng thái, không `.env`, JWT, OTP, user phone thật hoặc protocol credentials. Giao mẫu vào `docs/frontend/references/actuator_control/`, ảnh trong assets/. Backend không triển khai UI trước khi có mẫu/đợt tích hợp đã rõ.

Không đặt tiến độ frontend làm điều kiện để test hardware: Postman các endpoint tasks hiện có đã dùng được. Session sau đọc [progress hiện hành](BACKEND_PROGRESS_CURRENT.md)/MODULE_HANDOFF trước những checkpoint lịch sử và tiếp nhánh mới nhất, không quay về main cũ. Không push/merge khi chưa có yêu cầu mới.
