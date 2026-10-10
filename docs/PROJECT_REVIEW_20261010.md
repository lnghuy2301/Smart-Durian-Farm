# Rà soát toàn dự án ngày 2026-10-10

Nhánh kiểm tra/triển khai tiếp: **feat/postgres-users-cooperatives**, base **cb2a4d6**. Yêu cầu người dùng: rà soát toàn bộ, sửa lỗi nếu có; nếu ổn tiếp tục phần backend đã đề xuất. Frontend chỉ được kiểm thử trong đợt này, không sửa giao diện. [Phần backend mới và tái lập](POSTGRES_USERS_COOPERATIVES_IMPLEMENTATION.md).

## Kết quả rà soát

Trước khi triển khai tiếp, baseline đạt 221/221 backend, 26/26 persistence, 8/8 web unit, 29/29 browser scenarios; API/web lint, typecheck và build đạt; web Prettier đạt. Local PostgreSQL/Mongo readiness và replica-set đạt 1/1. Cả 23 JSON hiện có trong docs/postman parse được. Những tài liệu/collections người dùng đã xóa và ERD/MQTT/Postman/UI đã sửa được giữ nguyên; không restore/reset hoặc stage cả workspace.

Không phát hiện lỗi nghiệp vụ/runtime trong các phạm vi kiểm thử này. Có một bài test ACK cũ từng nhạy với tải máy: kiểm tra reset timeout từng bước bằng sleep 80ms với timeout 150ms. Đã dùng đồng hồ/timer mô phỏng để kiểm chứng chính xác cùng hành vi, bỏ phụ thuộc scheduler máy thật. Không tăng timeout production 10 giây, sửa ACK semantics hoặc thay đổi firmware.

Sau phần persistence mới, backend đạt **226/226**, database đạt **37/37**. Frontend **8/8 unit tests** ở baseline và **29/29 browser scenarios** khi chạy lại sau thay đổi Users/HTX. API lint/typecheck/build và web lint/typecheck/build/Prettier đạt. Không cần thêm .env key; file local và tài liệu riêng được kiểm tra hash so với đầu đợt. Chưa push/merge.

## Phạm vi nghiệm thu và phần còn lại

| Phần | Đã có | Còn phải làm |
|---|---|---|
| Auth/Users | OTP/email/đăng ký/duyệt Manager; async adapters; PG account/registration/approval HTTP và instance restart test | DI database toàn ứng dụng, SMS thật trong demo cuối |
| HTX | Memory workflow; PG danh mục/Admin approval/lifecycle/version/audit/notifications | PG đề xuất Manager email→SMS, lịch sử, CooperativesService/scheduler wiring |
| Vật tư/tiêu chuẩn | API RAM, liên kết, quyền, tests, schema/seed | PG repositories, transactions/async scopes |
| Farm/Zone/phân công/Tree/Harvest | API RAM, duyệt và lịch sử/quyền, tests, schema/seed | PG repositories/metadata/workflow và race/restart tests |
| Device/Sensor/Actuator | Metadata APIs, firmware IDs/mapping, schema/seed thật+mẫu | PG repositories và async access dùng chung |
| MQTT/Telemetry/Actuator tasks | Protocol DOCX v1, routing, retention/quyền, ACK receipt/10s/fail-safe tests | Mongo persistence, khôi phục restart toàn process và nghiệm thu ESP32 thật |
| Cultivation/QR | Pending/Locked/correction/hash-chain, public whitelist/lịch sử, tests/web trace | Mongo context/head transactions, liên kết PG và restart/hash acceptance |
| Web | UI/API luồng đã có, unit/browser checks | Nối database sau khi backend đủ adapters; nghiệm thu demo end-to-end |
| AI bệnh/chatbot | Đã thống nhất để sau | Chưa triển khai |

**Runtime AppModule hiện vẫn RAM.** Database có schema/seed không đồng nghĩa API đã lưu bền; cô lập Auth/Users HTTP test không đồng nghĩa full backend restart đã nghiệm thu. ACK theo DOCX là nhận lệnh, không phải bằng chứng vật lý bơm/van đã hoạt động. Không tạo ACK/Online/readings giả cho station thật. Readiness xanh chỉ chứng minh database trả lời, không chứng minh mọi nghiệp vụ/hardware đã đúng.

Không test SMS/email/hardware thật trong lần rà soát này; browser dùng MQTT local giả lập, database integration dùng ports test riêng, readiness chỉ đọc database local. API contract/security được kiểm tra theo quyền các test hiện có; kết quả không phải bảo đảm tuyệt đối rằng không thể có lỗi ngoài các trường hợp đã kiểm thử.

## Quy trình tiếp theo

Tiếp workflow HTX/Manager email→SMS và lịch sử PostgreSQL, rồi catalog và các domain phụ thuộc. Sau đó Mongo telemetry/control/cultivation, wiring toàn AppModule trên các instance chung; kiểm tra full-process restart và ESP32 thực trước khi nối frontend vào database demo. Giữ branch riêng mỗi phần, migration mới thay vì sửa migration đã Applied, seed không ghi đè dữ liệu và staging cụ thể. Khi phát sinh quyết định nghiệp vụ chưa chốt, hỏi và chờ người dùng; không cần hỏi lại các dữ liệu seed/hardware đã được chốt.

## Tái lập kiểm tra

Các lệnh API/DB trong [guide Users/HTX](POSTGRES_USERS_COOPERATIVES_IMPLEMENTATION.md). Web từ apps/web:

```powershell
node ../../node_modules/vitest/vitest.mjs run
node ../../node_modules/eslint/bin/eslint.js src test vite.config.ts
node ../../node_modules/typescript/bin/tsc --noEmit
node ../../node_modules/prettier/bin/prettier.cjs --check src test vite.config.ts eslint.config.mjs
node ../../node_modules/vite/bin/vite.js build
node test/e2e.mjs
```

Browser runner tự tạo API/MQTT/Vite fixture local, cần Chromium Playwright đã cài và quyền spawn/network loopback. Không dùng broker hardware/Twilio/SMTP production. Node20.19+ và Docker Desktop cho persistence test. Từ root có thể dùng npm scripts tương ứng; không thay .env nếu npm wrapper/spawn bị chặn. Không commit logs/artifacts trong .integration-dist, .test-dist hoặc test-results.
