# Backend — trạng thái và việc tiếp theo

Cập nhật 2026-10-16. Đây là bảng hiện hành; các checkpoint theo ngày trong README/handoff/notes vẫn giữ để truy vết lịch sử.

| Phần | Đã có | Còn phải hoàn tất |
| --- | --- | --- |
| API nghiệp vụ | Auth/Users/duyệt Manager/HTX/catalogs/Farm/Zone/phân công/Tree/Harvest/IoT metadata/Cultivation/QR; frontend tương ứng đã có | Persistence toàn runtime và nghiệm thu kết hợp |
| PostgreSQL foundation |13 bảng nghiệp vụ,4 bảng technical/ledger, migration/constraints, seed demo không ghi đè | Không cần tạo lại schema/seed từ đầu |
| PostgreSQL adapters | Users/Auth; HTX registry/workflows; vật tư/tiêu chuẩn/bridge; Farm; Zone |6 bảng: USERS_ZONES,TREES,TREE_HARVESTS,DEVICES,SENSORS,ACTUATORS |
| Mongo | Schema/validators/indexes/transaction helpers/hash mapping |3 adapters nghiệp vụ: telemetry,actuator tasks,cultivation cùng private context/state |
| MQTT | Hợp đồng đã đối chiếu, parser/router/ACK/control an toàn và loopback tests;6 Sensor types đã được user duyệt | Durable task ID/recovery và nghiệm thu ESP32 trực tiếp với database runtime |
| Frontend |37 browser checks,8 unit; form/workflow/dashboard/QR hiện có | Nối và nghiệm thu với backend dùng database toàn bộ |
| AI | User đồng ý để sau | Chẩn đoán bệnh/chatbot chưa triển khai |

**Ứng dụng chính vẫn dùng RAM cho dữ liệu nghiệp vụ.** Các adapter PostgreSQL được kiểm thử với HTTP app/pool mới, không mất trạng thái DB; chưa bật cho AppModule vì các consumers còn gọi sync RAM services. Không đổi riêng HTTP sang PG làm nguồn dữ liệu lệch với assignments/Tree/MQTT/QR. Đã có schema/migration không đồng nghĩa toàn bộ API đang lưu database.

Đợt Sensor: commit **46a03b7**, nhánh feat/sensors-six-streams từ frontend024214b. Six mappings301/C,302/%,303/%RH,304/C,305/H+,306/μS/cm; type tương ứng air_temperature,air_humidity,soil_moisture,soil_temperature,soil_ph,soil_ec. Topic/protocol/firmware không đổi. [Chi tiết MQTT](MQTT_PROTOCOL_REVIEW_20261014.md). Private ERD/IOT_CORE còn enum cũ, cần chủ tài liệu cập nhật; không tự sửa nguồn riêng.

Đợt Zone: **feat/postgres-zone-persistence**, kế thừa46a03b7. Official Zone/proposals/version/audit transactional; owner trực tiếp, Admin đề xuất, Manager scope HTX hiện tại, Accepted assignment trong khoảng hiệu lực. Có khóa parent Farm/chống vượt diện tích, standard share lock và kiểm tra quyền sau khi đợi lock. [Source/API/locks/tests/tái lập](POSTGRES_ZONES_IMPLEMENTATION.md).

Kiểm thử hiện hành **231/231 backend +103/103 persistence +8/8 web unit +37/37 browser**; API/web lint/typecheck/build và web format đạt. Không SMS/email/MQTT command thật trong các tests. DB integration chạy random database fixture, không dùng database demo.

Local demo migration001–007 đã **Applied**; Docker Desktop/container cũ được khởi động lại ngày16/10, không tạo lại volume.007 chỉ tạo index; hash/count13 bảng nghiệp vụ +4 bảng technical trước/sau giữ nguyên, không seed/ghi đè business data. Migration006 trước đó cũng giữ nguyên toàn bộ dữ liệu.

Thứ tự thực hiện tiếp: USERS_ZONES → Tree/Harvest → Device/Sensor/Actuator PostgreSQL → telemetry/actuator-tasks/Cultivation Mongo → chuyển các lookup/guards/QR async và wiring database AppModule một lần đồng bộ → restart/API/frontend/hardware acceptance. Mỗi module một branch kế thừa nhánh mới nhất; comment logic khóa/quyền/recovery, guide API/giới hạn/tái lập và cập nhật bảng này. Nghiệp vụ đã chốt giữ nguyên, điểm mới chưa rõ phải hỏi và chờ. .env/ERD/MQTT/Postman/UI riêng giữ nguyên; không reset/clean/stage-all, không tự push/merge.
