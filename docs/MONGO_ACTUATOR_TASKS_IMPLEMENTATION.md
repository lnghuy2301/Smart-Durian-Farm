# Actuator Tasks — journal MongoDB, mã lệnh bền vững và phục hồi

Ngày 19/10/2026. Nhánh `feat/mongo-actuator-tasks-persistence`, kế thừa control UI `148c380` và telemetry Mongo `de1e9a3`. Đây là adapter Mongo nghiệp vụ thứ hai sau telemetry; PostgreSQL đã đủ 13/13 adapters. [Tiến độ hiện hành](BACKEND_PROGRESS_CURRENT.md), [API và receipt contract](ACTUATOR_TASKS_IMPLEMENTATION.md), [workflow](ACTUATOR_TASKS_WORKFLOW_DESIGN.md), [giao diện đã có](frontend/modules/ACTUATOR_CONTROL_WEB.md), [thiết kế persistence](PERSISTENCE_DESIGN.md).

**AppModule và các lookup MQTT chính vẫn dùng RAM.** Module này cung cấp adapter database, kiểm thử HTTP riêng với PostgreSQL/MongoDB thật và mở lại app/pool/client. Chưa nối toàn bộ MQTT receiver/guards/QR sang database; không coi tests này là nghiệm thu ESP32 → database → frontend. Phần còn lại là Cultivation Mongo/context/head, rồi chuyển consumers async và wiring chung một lần. Không đổi frontend hoặc gửi lệnh tới broker/hardware thật trong đợt này.

## API và nghiệp vụ giữ nguyên

JWT private dưới `/api`; không thêm API giả ACK, sửa trạng thái, resume hoặc replay lệnh. Server sinh toàn bộ ObjectId/numeric IDs/timestamps/receipt.

| Method và route | Kết quả |
| --- | --- |
| POST `/actuator-tasks/devices/:deviceUuid/commands` | Body chỉ `{ "operation": "Watering" }`, `Spraying` hoặc `Stop`; 202 với task Pending, `status_url`, `state_url` |
| GET `/actuator-tasks/:objectId` | Một task theo quyền hiện tại, gồm steps/links/receipt thực đã lưu |
| GET `/actuator-tasks/devices/:deviceUuid` | NewestInserted trước; `limit` 1–100 mặc định20, `offset` 0–100000, filter `status` tùy chọn |
| GET `/actuator-tasks/devices/:deviceUuid/state` | Busy/current task, acknowledged mode, reset_required, broker_ready; physical_state luôn `Unknown` |

`storage.mode` của list database là `MongoDB`, RAM vẫn `Memory`; capacity5000/eviction `OldestTerminal` giữ nguyên. Không thay request paths hoặc cấu trúc task. Invalid DTO/UUID/query400, JWT401, role không được điều khiển403, ngoài scope/không thấy task404, busy/metadata chưa phù hợp409, journal toàn Pending429, DB/allocator/runtime chưa sẵn sàng503. Lỗi persistence trả thông báo cố định, không chứa URI/SQL/driver payload; không fallback sang RAM.

Admin chỉ đọc toàn hệ thống; Manager chỉ đọc theo Farm thuộc HTX hiện tại. Chủ Farmer được điều khiển Farm của mình; Farmer khác cần assignment Accepted đang hiệu lực `[start,end)`. Assignee chỉ đọc task có `created_at` trong phân công hiện tại. Kết thúc phân công mất quyền đọc IoT hiện tại/lịch sử và quyền gửi lệnh mới; phân công mới không mở lại history cũ. Scope và filter được áp dụng trước total/pagination, kể cả journal rỗng. UUID được chuẩn hóa chữ thường.

Start yêu cầu Device và bơm/van tương ứng Active, đúng recipe capability2/shared,3/watering,4/spraying. Stop vẫn được gửi khi metadata Inactive/Maintenance. Trước **mỗi ON** kiểm tra lại actor/assignment/metadata; internal OFF đã được workflow nhận không phụ thuộc việc actor còn quyền, để việc thu hồi phân công không chặn recovery. Không thay metadata/duyệt Admin, không tự đăng ký Device/Actuator.

## Journal và BSON mapping

`ACTUATOR_TASKS` giữ đúng các field nghiệp vụ cũ: `_id`, `device_id`, `command_id`, `targets`, `tasking_parameters`, `status`, `created_at`, `sent_at`, `confirmed_at`, `error_message`, `response_payload`. Không thêm actor/sequence/runtime lock vào record nghiệp vụ. `_id` và ba link parent/reset/recovery là BSON ObjectId, HTTP hex24; top-level và step timestamps là BSON Date, HTTP UTC ISO; Device ID vẫn UUID. Numeric command/target IDs phải là safe integers dương, không trùng nhau.

Mapper kiểm tra exact keys, operation/action/recipe, target↔step mapping, thứ tự Acknowledged→WaitingAck→Queued, timestamp/ACK shape, trạng thái terminal và confirmation_kind. `Confirmed` cần mọi step Acknowledged và confirmed_at bằng receipt cuối. ACK đến nhanh có thể được lưu trong step WaitingAck trong lúc callback publish chưa báo thành công; chưa được coi Confirmed. Không lưu provider payload hoặc diagnostic tùy ý trong task.

State kỹ thuật dùng **collection `PERSISTENCE_STATE` đã được duyệt**, kind `TaskIdAllocator`, key `global`, `_id=task-journal:global`:

```text
payload.next_id       safe integer sẽ cấp tiếp theo, ban đầu 1
payload.revision      safe integer tăng mỗi journal mutation
payload.owner         UUID tiến trình đang giữ quyền điều phối, hoặc null
payload.retained_ids  ObjectId[] theo thứ tự insert đã commit, cũ → mới
```

Schema/index foundation002 đã cho phép payload mở rộng bên cạnh next_id, nên không cần migration mới, không sửa checksum001–013. Không tạo bảng/collection hoặc biến môi trường mới. API không lộ state kỹ thuật. Numeric IDs không reset khi evict, shutdown hoặc đổi process; hết khoảng số an toàn thì503, không wrap/reuse. Xóa allocator bằng tay có thể làm mất bằng chứng uniqueness; adapter từ chối bootstrap khi có records mà không có state.

## Transactions, retention và giới hạn

Mỗi read/change dùng Mongo snapshot transaction và majority write concern; mutation ghi record mới/step receipts/failure/links, evict terminal và allocator/order/revision **trong cùng transaction**. Callback mutation đồng bộ, chỉ sửa journal snapshot; không publish MQTT hoặc thay runtime cache bên trong callback có thể bị driver retry. Các writers tranh cùng revision document, nên allocator và insertion order không mất cập nhật khi concurrency. Driver xử lý transient transaction/uncertain commit theo cơ chế hiện có; ứng dụng không tự chạy lại một publication khi kết quả commit chưa rõ.

Cap5000 áp dụng toàn hệ thống, không theo Device. Khi cần chỗ, bỏ terminal cũ nhất theo retained_ids; không suy thứ tự từ ObjectId/created_at/sent_at. Không evict Pending. Command không đủ chỗ bị từ chối trước cancellation task cũ. Tạo Start+Reset, preempt+Stop và Failed Start+RecoveryStop đều atomic. Recovery bảo vệ record Start vừa thất bại khỏi eviction trong transaction tạo link. Các terminal khác, kể cả Reset/parent đã kết thúc, vẫn theo retention; link history có thể trỏ record đã evict và GET trả404 theo contract hiện hành.

Snapshot kiểm tra count, IDs bị thiếu/thừa/trùng, mapping, unique numeric IDs và upper bound allocator. Không sửa chữa bằng sort timestamp hoặc xóa record. Dữ liệu không nhất quán trả503. Dùng một cursor batch có giới hạn5000 để tránh lỗi CSOT/getMore đã gặp ở telemetry; task shape có giới hạn nên batch nằm dưới giới hạn response Mongo. Mỗi transition đọc/validate journal có giới hạn; đây là thiết kế cho capacity hiện tại, cần đo lại latency trước khi tăng cap. Deadline không bị tắt để bù latency.

PostgreSQL chỉ đọc/khóa quyền và metadata: users→metadata→HTX→Farm→Zone→Device→Actuators UUID sorted; assignment hiện hành được recheck sau locks. Internal OFF khóa Device→Actuators, không quay lại lấy user/Farm lock muộn. Giữ các locks qua Mongo commit và lời gọi synchronous vào transport.publish trước khi thả PG transaction. Không ghi PG business rows từ task engine, không có distributed transaction PG–Mongo–MQTT. Mongo có thể đã commit dù caller sau đó nhận lỗi PG/network; không tự gửi lại POST để giả exactly-once, hãy GET history/state và kiểm tra trước.

## Một runtime điều phối và restart

`PostgresTaskAccess.claim` giữ PostgreSQL **session advisory lock** `smart-durian:actuator-runtime` trên connection riêng. Engine thứ hai không có quyền điều phối và initialize503. Đây là chế độ một controller đang hoạt động, không phải triển khai control ngang nhiều workers. Cần pool còn connection cho nghiệp vụ ngoài connection giữ lease.

Sau claim, engine ghi owner token vào allocator và đổi mọi task Pending cũ sang Failed/`BACKEND_SHUTDOWN` trong một Mongo transaction. Confirmed/Failed cũ giữ nguyên, numeric counter và insertion order giữ nguyên. Mọi mutation tiếp theo so owner; tiến trình cũ không ghi qua được sau takeover. Mất session/error/end lập tức đánh dấu engine faulted, xóa live waits/modes, không cho gửi lệnh mới. Listener được gắn trước lúc lấy lock; connection hỏng được loại khỏi pool. Lease release có thể gọi lại an toàn.

Runtime maps chỉ chứa queue/timeout/live run và **acknowledged mode trong phiên hiện tại**. Không dùng Maps làm nguồn history/counter/order. Mode cố ý không khôi phục thành Off/Watering/Spraying sau restart: state bắt đầu Unknown dù lịch sử cuối Confirmed. Không publication lúc boot, không resume Pending, không OFF tự động ở boot; Start mới do người dùng yêu cầu phải Reset đủ ACK trước ON. Shutdown chủ động ngừng scheduling, hủy timer, chờ queue, đánh dấu Pending failed rồi nhả lease. Hard crash để lại Pending sẽ được xử lý tại lần initialize tiếp.

Owner token và lease không thu hồi được packet đã rời backend hoặc chứng minh tác động vật lý. Nếu PG/Mongo lỗi, fail closed: không có RAM fallback, không tự gửi lại ON, không tuyên bố đã tắt. Pending chưa ghi được terminal giữ trong database đến lần initialize hợp lệ tiếp theo. Recovery cũng cần ghi journal thành công và transport sẵn sàng; mất DB/broker không bảo đảm gửi OFF được.

## Trình tự lệnh và races

- Mode Unknown: Start+Reset được tạo atomic; OFF2→ACK→OFF3→ACK→OFF4→ACK rồi ON3→ACK→ON2→ACK cho Watering, hoặc ON4→ACK→ON2→ACK cho Spraying. Reset lỗi thì Start `RESET_FAILED`, không ON.
- Mode Off đã nhận đủ receipt trong process hiện tại: Start đi thẳng valve ON trước pump ON. Đang Watering/Spraying phải Stop trước khi đổi mode. Stop khi busy Start/Reset preempt, hủy phần chưa gửi, bỏ qua callbacks cũ; Stop/RecoveryStop đang chạy thì409.
- Stop mode biết chỉ đóng pump rồi valve tương ứng; Unknown/preempt/recovery dùng OFF2/OFF3/OFF4. Thiếu ACK pump OFF thì dừng chain, không tiếp tục đóng valve và không khẳng định physical state.
- Mỗi step có deadline10s theo cấu hình đã có, tính từ persisted sent_at; quá deadline trước publish thì không gửi. ACK đúng tại deadline cũng hết hạn. Timer cho từng step, không gộp cả Reset thành10s.
- Durable intent WaitingAck phải commit **trước** publication. Không chờ publish callback trong per-Device queue, nên Stop vẫn preempt được callback chậm. Independent Devices có queues riêng, dùng chung durable allocator.
- Receipt chỉ advance khi Device/taskId/action khớp, chưa hết hạn và callback publish thành công. Duplicate/wrong Device/action/ID/late ACK không advance. Callback và ACK sau preempt/fault không hồi sinh task.
- Start đã thất bại tạo riêng RecoveryStop, giữ Start Failed và link hai record; recovery không sửa lại Start thành Confirmed. Recovery lỗi giữ Unknown. ACK chỉ xác nhận đã nhận lệnh, `physical_state` luôn Unknown.
- Disconnect tăng epoch và xóa mode ngay cả khi Mongo/PG đang await. Reconnect không cho workflow epoch cũ phát ON, kể cả command commit vừa trả về sau reconnect. Không offline queue hoặc tự replay ON. DB503 đặt engine faulted; cần initialize bằng instance mới sau khi xử lý nguyên nhân, không tự fallback/retry publication.

## Source và cách wiring đúng

| Source | Vai trò |
| --- | --- |
| `actuator-tasks/actuator-task-records.ts` | Async HTTP port và Memory wrapper dùng đúng legacy service; callbacks RAM vẫn sync |
| `actuator-tasks/task-rules.ts` | Recipe/task factory/markFailed/stop capabilities chung cho hai engines |
| `actuator-tasks/task-access.ts` | Trusted PG authority, internal OFF và singleton claim contract |
| `persistence/task-mappers.ts` | Strict task/BSON mapping, không normalize tùy ý payload |
| `persistence/mongo-actuator-task.store.ts` | Snapshot/durable allocator/owner/revision/order/retention/atomic writes |
| `persistence/postgres-task-access.ts` | Shared domain scope/current assignment/metadata locks và session lease |
| `persistence/database-actuator-task-records.ts` | Async command/ACK/timers/preempt/recovery/restart/fault lifecycle |
| `mqtt/mqtt.service.ts` | Nhận TaskRecords port; Promise ACK/state failures được sanitize; RAM behavior giữ nguyên |
| `integration/helpers/task-persistence-fixture.ts` | Random database fixture, trusted fake transport và isolated HTTP app |
| `integration/actuator-task-persistence.integration.ts` | Database, HTTP fresh instances, concurrency/restart/failure/retention evidence |

AppModule vẫn đăng ký Memory wrapper bằng useExisting cùng ActuatorTasksService cũ, không tạo source dữ liệu thứ hai. MQTT ACK nhận thời điểm arrival từ receiver; callback database được await qua Promise trước diagnostic. Device/Sensor lookup và telemetry của receiver chính vẫn sync/RAM, phải chuyển chung trong đợt runtime sau.

**Khi wiring database**, cung cấp một concrete DatabaseActuatorTaskRecords provider có lifecycle init/destroy rồi alias port tới nó, hoặc đăng ký concrete useFactory/useValue ở token port. Không override một useExisting alias bằng useValue rồi giả định Nest gọi lifecycle: alias wrappers có thể bỏ qua hooks. HTTP fixture đăng ký controller/Auth + concrete TaskRecords provider riêng, không kéo RAM IoT modules vào làm authority. Dùng cùng MongoClient/Db, PG pool/repositories và transport instance cho receiver và HTTP; khởi tạo task engine trước khi transport chuyển ready. Không thêm env flag để bật riêng HTTP database trong khi MQTT/guards còn RAM.

## Kiểm thử và tái lập

Từ root repository, Node20.19+ và dependencies hiện có; không thêm library hoặc đọc `.env` trong tests:

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d
npm run test:persistence
npm test
npm run lint
npm run typecheck
npm run build
npm run test:web:e2e
```

Test project dùng PG15432/Mongo27028 replica set rs-test, khác demo5432/27017. Fixtures tạo/migrate/seed **chỉ random database** `sdf_persistence_test_{32hex}` bằng test credentials trong helpers, rồi tự drop đúng tên đã kiểm tra. Case session-loss chỉ terminate PID giữ lease của random DB fixture. Không chạy db:migrate/db:seed vào demo, không đổi/clear volume hoặc reset user data. Chưa cần dữ liệu hay secrets từ `.env` thật; không SMS/email/live MQTT/hardware.

Chạy riêng suite mới bằng local tools khi npm wrapper trên Windows bị EPERM:

```powershell
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --outDir apps/api/.integration-dist
node --test --test-concurrency=1 apps/api/.integration-dist/integration/actuator-task-persistence.integration.js
```

Compile phải exit0 trước test. Suite mới **23/23 tests** kể cả wrapper: Unknown Reset/start/step BSON, Stop preemption, fast ACK/callback, wrong/duplicate/late ACK, partial ON timeout/recovery, actual timer, failed publication, disconnect/reconnect, metadata/assignment revoke, Manager/Admin scopes, fresh engine và HTTP app/pool/client, independent Devices, disconnect trong lúc commit đang trả, lease loss/takeover, Mongo loss lúc ACK/trước command, concurrent allocator/rollback, cap5000 với ObjectId/timestamps đảo thứ tự, all-Pending429, counter overflow/corrupt state và Mongo unavailable. Timer test dùng timeout1s riêng trong fixture; production default10s giữ nguyên. ACK synthetic là trusted test transport, không phải REST backdoor hay bằng chứng physical relay state.

Kết quả cuối: **239/239 backend,239/239 persistence (15 suites),46/46 browser; API lint/typecheck/build đạt**. Không đổi web source; checkpoint8/8 web unit/quality checks từ đợt UI giữ nguyên, đợt này chạy lại browser regression. Browser suite tiếp tục dùng runtime RAM/loopback hiện có, chỉ chứng minh không làm hỏng UI/API contract; chưa thay cho nghiệm thu browser với toàn database runtime. Không cần thay Postman collection: routes/body/JWT hiện có giữ nguyên, chỉ storage.mode MongoDB khi dùng adapter database trong app được wiring đúng.

## Việc tiếp theo

Cultivation Mongo/private context/head với deadline15 phút, chain/correction/assignment gốc và QR lineage như đã chốt; sau đó async lookup/guards/workers/MQTT/QR và shared database AppModule. Cuối cùng nghiệm thu restart/API/frontend cùng nguồn database và ESP32 thật theo [kế hoạch tuần](WEEKLY_COMPLETION_PLAN_20261019.md). Không xây lại giao diện actuator control đã được duyệt; không đổi protocol, firmware, ACK semantics hoặc tự gửi lệnh thật.
