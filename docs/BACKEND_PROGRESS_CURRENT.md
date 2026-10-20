# Backend — trạng thái và việc tiếp theo

Cập nhật20/10/2026, nhánh `feat/database-runtime-integration`, kế thừa `1a8a8bb`/`b6d3ed1`. Đây là tiến độ hiện hành; các mốc RAM/persistence chưa wiring trong tài liệu cũ là lịch sử. [Cách chạy/source/limits/tests](DATABASE_RUNTIME_IMPLEMENTATION.md).

| Phần | Trạng thái thực tế | Còn lại |
| --- | --- | --- |
| API nghiệp vụ | Auth, Users, Manager approval/HTX, catalog/standard/bridge, Farm/Zone, assignments, Tree/Harvest, Device/Sensor/Actuator, telemetry/tasks, cultivation, QR đã có | Nghiệm thu demo kết hợp bằng tài khoản/thiết bị thật |
| PostgreSQL |13/13 business tables cùng proposals/history/audit/notifications, adapters/constraints/seed không ghi đè | Backup/restore và vận hành môi trường deploy |
| MongoDB |3/3 domain adapters: FIFO telemetry10.000, task journal5000/counter/receipts/restart, cultivation/context/Zone head/ledger | Đo tải trước khi tăng cap; không eviction Locked cultivation |
| Main AppModule | Database runtime dùng chung pool/client/repositories cho HTTP, Auth, guards, workers, MQTT và QR | Không còn backlog wiring database; legacy memory chỉ dành thử nghiệm |
| MQTT/control |6 streams, immutable station→Device UUID, receipt ACK,10s/step, Reset/Start/Stop/preempt/recovery; đã qua TCP loopback với full database và UI | ESP32/relay/pump/valves thật, mất mạng/ACK thiếu/trễ trong môi trường demo |
| Web | Giao diện/workflows/control đã có, dùng được với database; wording storage cập nhật | Người dùng duyệt giao diện, smoke bằng SMS/email thật và phần cứng |
| AI | Hai module chẩn đoán bệnh/chatbot chưa triển khai, đã thống nhất hoãn | Chỉ bắt đầu khi có model/provider/corpus và business specs |

`readEnvironment`: development mặc định database; test mặc định memory; explicit `BUSINESS_STORAGE=database|memory`. `.env.example` có key, `.env` thật giữ nguyên. **Chạy database không cần thêm key vì development đã mặc định database.** AUTH_MODE=mock vẫn là Auth development/test, không có nghĩa business data dùng RAM.

Startup kiểm tra migration ledger, writable Mongo replica set và validators/indexes trước khi receiver/task engine chạy. Không auto-migrate/seed/fallback RAM hoặc tự publication lúc boot. Task controller một process bằng PG session lease; restart giữ journal/counter, mode Unknown, Start tiếp theo Reset trước ON. OTP chưa hoàn tất cần verify lại; nội dung đã duyệt/tài khoản/proposals lưu bền.

Cultivation `1a8a8bb`: deadline15 phút, context assignment gốc/grace15 ngày, author-only, same-Zone target/action và full QR lineage giữ nguyên. Đợt runtime sửa burst10.000 overdue bằng catch-up tối đa512 event/transaction cùng head/ledger, giữ timeout10s và SHA-256 v1. [Guide](MONGO_CULTIVATION_IMPLEMENTATION.md).

Kiểm chứng cuối: **240/240 backend,263/263 persistence (17 suites),8/8 web unit,46/46 browser RAM +4/4 browser full database/MQTT TCP**; API/web lint/typecheck/build và formatting đạt. Full database target9/9 được chạy lại sau kiểm tra thứ tự compound index. Suite kiểm tra HTTP/MQTT/QR, shared instances/no RAM store, fresh app/pool/client, thiếu migration, sai Mongo DB và crash/restart Node riêng. Test TCP/ACK vẫn là giả lập, không chứng minh tác động relay thật.

Migration001–014 đã Applied local. Migration014 chỉ mở rộng validator technical-state cho CultivationLedger; đối chiếu count/hash13 business+4 technical PG và4 Mongo collections trước/sau giữ nguyên. Sau migration bổ sung riêng304–306 cho trạm thật, sensor cũ giữ nguyên; chạy lại không tạo trùng. Sensor303 vẫn có expected unit cũ `%`, Owner có thể chỉnh `%RH` theo [hướng dẫn](REAL_HARDWARE_DATABASE_READINESS.md). Không reseed hoặc tái tạo volume.

Ba nhánh local kế tiếp nhau: `feat/mongo-actuator-tasks-persistence` (`b6d3ed1`) → `feat/mongo-cultivation-persistence` (`1a8a8bb`) → `feat/database-runtime-integration`. Không tự push/merge. Các feature cũ vẫn được giữ; không cần triển khai lại hoặc merge ngược main cũ để bắt đầu code.

Việc làm tiếp theo theo thứ tự:

1. Nghiệm thu trạm thật theo [MQTT/hardware plan](WEEKLY_COMPLETION_PLAN_20261019.md):6 readings/cadence/raw units/presence, từng ACK, Reset/Start/Stop/recovery, mất broker, backend restart, đối chiếu Mongo và UI. Người phụ trách phần cứng phải xác nhận quan sát bơm/van; ACK chỉ là receipt, physical_state vẫn Unknown.
2. Smoke tài khoản Farmer demo thật/SMS quên mật khẩu, Manager email→SMS/approval/HTX, harvest/cultivation/QR trên database runtime.
3. Backup/restore và chuẩn bị deploy/Auth/TLS/broker khi có đích triển khai. AI tiếp tục hoãn; không tự chọn provider/model hoặc ghi nghiệp vụ giả để nâng phần trăm hoàn thành.

Nguồn riêng ERD/MQTT/DOCX/Postman và giao diện/assets của người dùng giữ nguyên, kể cả các file đang xóa/chưa track. Không reset/clean/stage-all hoặc in/commit secrets. Postman vẫn JWT/UUID/OTP nhập tay, không scripts/environments phức tạp. Khi có quyết định nghiệp vụ mới chưa rõ, hỏi và chờ; không hỏi lại các rule đã chốt trong guides.
