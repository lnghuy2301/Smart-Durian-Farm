# Điều khiển tưới / phun trên web

Ngày triển khai: 19/10/2026. Nhánh `feat/web-actuator-control`, kế thừa `feat/mongo-telemetry-persistence`. Người dùng yêu cầu đọc mẫu actuator control và tối ưu cho người nông dân. Không thay backend, hợp đồng MQTT, firmware, dữ liệu DB, `.env`, dependency hoặc giao diện xác thực.

## Nguồn và điều chỉnh thiết kế

Đã đọc `code.html`, `DESIGN.md` và xem `screen.png` trong `docs/frontend/references/stitch_smart_durian_farmer_dashboard/actuator control/`. Giữ file nguồn tại chỗ; không nhúng script đổi kịch bản, role switcher, CDN Tailwind/font, thông tin demo hoặc dữ liệu giả vào app. Font local, logo và màu dùng bộ nhận diện Smart Durian đã duyệt.

| File tham khảo | SHA-256 |
| --- | --- |
| `code.html` | `151149310cbd1059e8e3a5c7f5d9dfbfcdee5d7691d2ea78006bcb48909395a9` |
| `screen.png` | `a5a8b1505d5181dcb0b2d0b527c566e9268ff02796d02eb28efb9cba012cf5e5` |
| `DESIGN.md` | `e683768f916179f9771f9c5dc9dc3fd3c65e2bd731d9c969d7bd9c447523d03c` |

Màn hình dùng cùng shell hiện có. Đầu trang chọn Vườn → Khu vực → Trạm; kế tiếp là trạng thái và các nút thao tác, tiến trình thật, số đo tham khảo và lịch sử dạng hàng/thẻ. Không có trạm mặc định tự chọn để gửi lệnh: người dùng chọn rõ hoặc mở liên kết trạm cụ thể từ chi tiết Device. Đổi vườn xóa khu vực/trạm, đổi khu vực xóa trạm; Device mới có workspace và requests mới.

Farmer được phân công có quyền đọc Zone/Device nhưng API Farm chỉ cho Farmer đọc vườn của chính mình. Bộ chọn bổ sung phạm vi từ các Zone được phép đọc, nhóm theo `farm_id` và dùng nhãn “Khu vực được phân công · tên khu vực”. Đây là context chọn phạm vi, không giả Farm record/tên/địa chỉ; không gọi API đọc hồ sơ chủ vườn ngoài quyền. Nhờ đó không bắt Farmer được phân công phải có quyền Farm mới được điều khiển.

Nút Tưới/Phun có icon, chữ lớn, phần mô tả thứ tự van–bơm và xác nhận lại tên trạm/khu vực. Nút Dừng màu đỏ, gửi trực tiếp theo click, không thêm dialog. Các nút có nhãn/chữ, trạng thái không chỉ phân biệt bằng màu. Dialog dùng component native hiện có, đóng bằng nút/ESC và cuộn dọc. CSS `.control-*`/`.actuator-control` riêng, không đổi theme/font/breakpoint của các trang khác; dưới900px xếp một cột, lịch sử chuyển thành thẻ, không yêu cầu cuộn bảng rộng.

Các khác biệt so với mẫu là để khớp API:

- Bỏ khẳng định “ngắt ngay tức thì”, “bơm đang tắt an toàn”, “đã áp dụng lệnh”, “khóa cứng phần cứng” và “tự đóng toàn bộ relay”. API xác nhận nhận command, chưa đo vật lý. Nút Dừng được mô tả là gửi lệnh, không hứa kết quả vật lý.
- Trạng thái phản hồi nhận lệnh (Unknown/Off/Watering/Spraying), trạng thái quản trị Device và trạng thái đo thực tế được tách riêng. Physical luôn ghi **Chưa xác định**. `broker_ready` chỉ là kênh gửi lệnh, không dùng nó để suy trạm Online.
- Chỉ vẽ các bước từ `response_payload.steps`, không có bước “đồng bộ phiên/ghi sổ cái” thứ ba tự tạo. Reset/RecoveryStop là bản ghi do backend tạo, hiển thị riêng theo liên kết.
- Không đưa MAC, firmware, công suất bơm, thể tích nước, topic demo hoặc export kiểm toán vào UI khi chưa có hợp đồng tương ứng. Số đo thật giữ raw unit và thời điểm, có thể cũ; không suy lượng nước/relay từ telemetry.
- Không có lịch hẹn, slider, ON/OFF từng relay, tự reset, tự confirm ACK, nhập taskId hoặc nút mô phỏng kịch bản.

## Route, cấu trúc và hợp đồng

Web `/actuator-control`; deep link `/actuator-control?device_id=<Device UUID>`. Có mục “Điều khiển tưới / phun” trên sidebar, link từ Giám sát IoT và chi tiết Device. Admin/Manager cũng mở được màn hình nhưng chỉ xem.

| API | Cách dùng |
| --- | --- |
| GET `/farms`, `/zones`, `/devices` | Bộ chọn lấy đủ các trang100 mục trong scope, không chỉ trang đầu; không sửa quyền từ UI. |
| GET `/actuator-tasks/devices/:deviceId/state` | `acknowledged_mode`, `physical_state`, `busy`, `active_task_id`, `reset_required`, `broker_ready`, `ack_timeout_ms`. |
| GET `/devices/:id`, `/actuators?device_id=…` | Kiểm tra metadata hiện tại và recipe bơm2/shared, van3/watering, van4/spraying. |
| POST `/actuator-tasks/devices/:deviceId/commands` | Body đúng một field `operation: Watering|Spraying|Stop`;202 task, status_url, state_url. |
| GET `/actuator-tasks/:id` | Đọc root/active/reset/recovery/parent theo ID trả từ server, đối chiếu device_id. Không theo URL tùy ý ngoài API client của phiên. |
| GET `/actuator-tasks/devices/:deviceId` | Phân trang20, offset0–100000, filter trạng thái Pending/Confirmed/Failed; mở tiến trình chi tiết từ lịch sử. |
| GET `/mqtt/devices/:id/status`, `/sensors?device_id=…`, `/telemetry/devices/:id/latest` | Tín hiệu và số đo tham khảo; đọc riêng, lỗi số đo không khóa thao tác Dừng khi core vẫn đọc được. |

`src/pages/ActuatorControl.tsx` chọn scope và thao tác; `src/control/types.ts` khai báo response; `data.ts` đọc/đối chiếu dữ liệu và gate metadata; `useControlPolling.ts` quản lý GET/abort/version; `TaskProgress.tsx` nhãn bước/thời gian/ACK; `ControlReadings.tsx` đọc telemetry riêng; `control.css` giới hạn style. `ApiClient`, `AuthProvider`, `useTask`, `Modal`, `Field`, `DataState`, brand/font và collection pagination dùng lại thành phần hiện có.

## Trạng thái, quyền và lỗi

Frontend chỉ đưa nút gửi cho role Farmer có Device trong read scope hiện tại; backend vẫn quyết định chủ vườn/Accepted assignment còn hiệu lực trước mỗi ON. Admin/Manager không có nút gửi, không gọi POST để thử quyền. Nhận403/404 ở các dữ liệu private sẽ bỏ workspace, xóa trạm đang chọn và đọc lại bộ chọn; lịch sử/snapshot cũ không giữ trên màn hình.401 theo AuthProvider hiện có, phiên bị đóng và abort các requests.

Start cần state mới, broker sẵn sàng, không busy, mode Unknown hoặc Off, đúng recipe và Device/bơm/van tương ứng Active. Stop dùng recipe nhưng không bị khóa bởi status Inactive/Maintenance; khi API trả active task là Stop/RecoveryStop thì khóa nút Dừng. Backend đang chạy Reset/Start thì vẫn cho Dừng sau khi POST trước đó đã trả202 và đã đọc lại state. Farmer mới nhận việc có thể đọc state busy nhưng `active_task_id:null` vì lệnh cũ nằm ngoài thời gian phân công; không mở lịch sử cũ, vẫn cho gửi Dừng có chủ ý để backend kiểm tra. Backend409 ngăn Stop trùng trong tình huống không đọc được loại task đó. Phải nhận đủ Dừng trước khi đổi tưới/phun; UI không tự chuyển409/busy thành Off.

POST chỉ từ click/xác nhận; `useTask` chặn gửi kép. Sau POST phải có lần đọc core mới trước khi mở nút; không dùng snapshot trước POST để giả thành công. Lỗi mutation, kể cả mất phản hồi sau khi server có thể đã nhận, giữ cảnh báo **Chưa rõ kết quả** và yêu cầu “Kiểm tra lại trạng thái”; không retry Start ngầm hoặc replay khi reconnect. Mỗi lần đọc mới abort snapshot cũ, có epoch guard chống response cũ ghi đè Device/phiên mới.

Core state/active task được poll1s khi busy,5s khi rảnh. Task/root/reset/recovery được poll1s khi còn Pending,5s khi terminal; số đo15s. Các vòng poll không chồng lấn, dù GET độc lập trong một vòng đọc song song; rời trang/đổi trạm/phiên thì abort, tab ẩn dừng lịch poll, trở lại thì đọc mới. Lỗi đọc xóa snapshot tương ứng và dừng vòng đó tới khi người dùng thử lại. Lịch sử/số đo tách khỏi core nên lỗi503 của lịch sử không chặn Dừng. Thời gian hiển thị múi giờ Việt Nam, gồm giây ở lịch sử và từng bước.

Đếm chờ ACK dùng `sent_at + ack_timeout_ms`, chỉ là hướng dẫn theo giờ trình duyệt. Hết bộ đếm hiển thị “Đang kiểm tra phản hồi từ máy chủ”; client không tự gán Failed. Mỗi bước có hạn riêng, không áp10s cho toàn chuỗi5 bước Reset+Start. Start Failed có thể còn busy do RecoveryStop: vẫn giữ lỗi Start và xem riêng RecoveryStop, không báo “đã tắt”.

## Chạy và tái lập

Từ root, dependencies đã có thì không chạy lại `npm ci`. Hai terminal:

```powershell
npm run dev:api
# Terminal khác
npm run dev:web
```

Mở http://127.0.0.1:5173/actuator-control. Tài khoản, broker và metadata lấy từ môi trường dev hiện có; không đưa secrets vào frontend. AppModule hiện vẫn RAM dù PG/Telemetry Mongo adapters đã có; seed DB không tự xuất hiện trong API RAM. Không bật database wiring hoặc reseed chỉ để làm màn hình điều khiển.

Kiểm tra thủ công trong môi trường được người vận hành chuẩn bị:

1. Farmer chủ vườn chọn đúng trạm; nếu chưa có metadata, tạo Device và đủ ba Actuators theo [tasks API](../../ACTUATOR_TASKS_IMPLEMENTATION.md). Mở từ Device detail phải chọn đúng UUID, không dùng station làm FK.
2. Trước khi xác nhận Tưới/Phun không có POST. Hủy dialog cũng không có POST. Bấm gửi một lần,202 phải hiện tiến trình; lần đầu Unknown có3 bước Reset rồi2 bước Start. Không dùng ACK làm bằng chứng dòng nước thực tế.
3. Dừng trước khi chuyển chế độ. Trong lúc Start đang đợi phản hồi, Dừng phải preempt theo backend; khi Stop/RecoveryStop đang chạy không gửi Stop trùng. Late ACK không đổi kết quả đã Dừng.
4. Thiếu ACK: Start Failed và RecoveryStop phải hiển thị riêng. Thiếu ACK Dừng vẫn Unknown. Không thử tạo thiếu ACK trên vườn thật ngoài buổi vận hành được chuẩn bị.
5. Farmer được phân công Accepted hiện tại có nút; kết thúc phân công phải mất state/task/history. Admin/Manager chỉ xem. Thử lỗi409,503, mất mạng và kết quả POST chưa rõ: không có lệnh lặp tự động, đọc lại trước khi gửi tiếp.
6. Device/Actuator Inactive chặn Start, vẫn có thể Stop nếu đủ recipe/kênh gửi. Lỗi lịch sử/số đo không tự biến trạm Off hoặc che tiến trình core. Đổi trạm không giữ steps/mode của trạm trước.
7. Kiểm tra1440×1000,1366×640,390×844 và320×720: không tràn body/dialog, nút và nhãn dễ đọc, lịch sử dạng thẻ trên mobile.

## Kiểm thử tự động và giới hạn

```powershell
npm run lint:web
npm run build:web
npm run test:web
npm run format:check -w apps/web
npm run test:web:e2e
```

`test/actuator-control-browser.mjs` chạy trong fixture Nest/Vite/MQTT.js TCP loopback của `test/e2e.mjs`. `loopback-broker.mjs` nhận commands và trả ACK giả lập đúng taskId/action cho station fixture riêng. Kiểm tra thiếu ACK dùng timeout10s thật, không thay production ACK config. Email capture/mock SMS/RAM stores, không đọc root `.env`, không ghi DB hoặc gửi tới ESP32/broker thật. Artifacts ignored tại `apps/web/test-results/`: `control-1440.png`, `control-1366.png`, `control-390.png`, `control-320.png`, `control-recovery-desktop.png` và `report.json`.

Kết quả19/10/2026: **46/46 browser checks (37 hồi quy +9 điều khiển), 8/8 unit**, web lint/build (gồm TypeScript)/format đạt. Chín kiểm tra điều khiển được chạy lại sau bổ sung case Farmer mới nhận việc Dừng lệnh cũ ngoài read-history scope. Không có uncaught browser error. Toàn bộ screenshot đã được sinh từ API fixture, đối chiếu với mẫu; không dùng dữ liệu sản xuất để làm ảnh. Production JS khoảng465kB/gzip134kB, CSS38kB/gzip8kB, không thêm dependency hoặc ảnh mới. Backend239/persistence216 là checkpoint trước đợt này, không chạy lại DB và không coi nó là nghiệm thu database/hardware của control UI.

Các kiểm tra mới: chọn scope/xác nhận/không tự gửi/nhấn kép; Reset→Start đúng thứ tự wire và physical Unknown; Stop preempt/late ACK; Start timeout10s→RecoveryStop; POST đã được server nhận nhưng mất response không lặp; Admin/Manager chỉ xem; metadata Inactive vẫn Stop; lịch sử503 không chặn Stop; broker/state-read unavailable khóa gửi; assignee không cần Farm profile và không đọc task cũ nhưng vẫn Dừng được; kết thúc phân công xóa dữ liệu; responsive và đổi trạm không giữ mode/steps cũ. Đây là chín scenario kiểm thử nhóm, không phải mọi biến thể hardware.

Đợt này chỉ giao frontend; durable tasks/Cultivation, shared database runtime và nghiệm thu ESP32 vẫn theo [progress backend hiện hành](../../BACKEND_PROGRESS_CURRENT.md) và [kế hoạch tuần](../../WEEKLY_COMPLETION_PLAN_20261019.md). Không thay rule/timeout/topic/firmware, không tự gửi lệnh thật, không push/merge.
