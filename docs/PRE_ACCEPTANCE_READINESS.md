# Chuẩn bị nghiệm thu toàn diện — 27/10/2026

Nhánh `chore/gemini-flash-lite-acceptance`, nền `b6bd07b`. Đây là chỉ dẫn hiện hành trước khi người dùng kiểm thử, thay các mô tả cũ “AI chưa có/chưa chọn API”. Không tự coi test tự động là nghiệm thu Google/hardware thật.

## Gemini 3.1 Flash-Lite

`.env` đã được sửa riêng dòng model; key và mọi cấu hình khác giữ nguyên:

```dotenv
AI_CHAT_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_TIMEOUT_MS=30000
GEMINI_MAX_OUTPUT_TOKENS=4096
```

Điền key vào dòng GEMINI_API_KEY đang trống, không đặt trong VITE_ hoặc Postman. Không cần key khác cho model này. Mã stable theo [Google](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite.md) là `gemini-3.1-flash-lite`; không dùng suffix preview. Adapter giữ thinking LOW theo [Gemini3](https://ai.google.dev/gemini-api/docs/gemini-3/), structured output và giới hạn nguồn. Key/quyền truy cập/quota tài khoản vẫn phải kiểm tra bằng yêu cầu live sau khi điền.

Sau khi sửa .env, restart API và tải lại trang. Không cần migrate/seed lại để đổi model. Chat dùng corpus trong Mongo, không cần Python; chức năng ảnh/nhập PDF cần worker Python.

## Chạy và kiểm tra trước nghiệm thu

```powershell
# Từ root, giữ nguyên volume/dữ liệu hiện có
docker compose up -d --pull never
npm run build
# Terminal1: worker ảnh
npm run dev:ai
# Terminal2: API
npm run start:api
# Terminal3: web
npm run dev:web
# Một terminal bất kỳ, từ root
npm run check:acceptance --workspace @smart-durian/api
```

Lệnh cuối chỉ đọc: kết nối DB, kiểm ledger migrations và validator/index AI/replica set, checksum snapshot PDF và số trang nguồn, tìm kiếm thử corpus, tài khoản chính/metadata Device và model worker local. Không ghi dữ liệu, migrate/seed, gửi OTP, bật MQTT/hardware hoặc gọi Google. Không in key/token/UUID hay nội dung hội thoại. Nó không yêu cầu dừng API.

`can_start_full_manual_acceptance=true` nghĩa cấu hình/tài nguyên local đủ để bắt đầu nghiệm thu, không phải key đã được Google xác nhận hoặc phần cứng đã đạt. Exit1 cùng needs_setup/not_running chỉ rõ thứ cần điền/chạy. Thiếu key vẫn cho các module khác hoạt động, nhưng chưa thể nghiệm thu chat. Cờ Manager cho Farm hardware độc lập là not_applicable, không phải lỗi SMTP/HTX.

Model worker được nạp để kiểm dependency/task/classes/checksum; không tạo ảnh chẩn đoán hoặc lịch sử giả. Nếu không dùng ảnh lúc đó, có thể chat mà chưa chạy Python, nhưng kiểm tra toàn diện sẽ còn worker not_running. Snapshot PDF kiểm SHA-256 từ file đã nhập; weights/PDF gốc tiếp tục cần backup riêng theo [hướng dẫn corpus](AI_RAG_CORPUS_IMPLEMENTATION.md).

## Phần đã có để bạn nghiệm thu

- Auth/OTP/email, Users và duyệt Manager/HTX; vật tư/tiêu chuẩn/liên kết/liều; Farm/Zone/phân công/mời Farmer theo tên/phone; Tree/Harvest; Cultivation/correction/hash-chain; IoT metadata/MQTT/telemetry/control; QR; AI ảnh và chatbot RAG Gemini.
- Persistence nghiệp vụ PostgreSQL/Mongo, nguồn/trang/dự thảo RAG, dữ liệu local và backup/restore đã có. Không còn module đã chốt nào cần viết mới trước khi kiểm thử local. Không seed lại để làm test đẹp.
- UI AI local đã nối status/model/ảnh/lịch sử/feedback/hội thoại/trích dẫn và xử lý lỗi. Các thay đổi giao diện riêng vẫn được giữ trong working tree, chưa tự stage/merge/push trong nhánh backend.
- Backlog Cultivation đã tách128/lô; full persistence311/311 của checkpoint trước đạt. Đợt đổi model/doctor này không đổi transaction/schema/nghiệp vụ canh tác, nên không chạy lại bài tải10.000 kéo dài chỉ để đổi GEMINI_MODEL.

## Những việc không thể đánh dấu xong thay người dùng

| Việc | Vì sao còn cần làm | Cách kiểm |
| --- | --- | --- |
| Điền key và nghiệm thu Gemini live | Key đang trống ở lần rà soát; mock không xác nhận tài khoản/quota/chất lượng | Gửi câu hỏi có nguồn, kiểm tiếng Việt/trang gốc/dự thảo và reload giữ history |
| Bốn vai trò trên dữ liệu hiện có | Cần đối chiếu đúng tài khoản/phân công/HTX của phiên người dùng | [Checklist module](MODULE_ACCEPTANCE_CHECKLIST.md), tài khoản trong LOCAL_MODULE_ACCEPTANCE.private.md, không chia sẻ file private |
| ESP32 xuyên suốt và quan sát bơm/van | Loopback/ACK không chứng minh trạng thái vật lý | [MQTT FINAL](MQTT_HARDWARE_PROTOCOL_FINAL_v1.0.md), thiếu/trễ ACK, mất mạng, Stop/restart; người dùng chủ động bật phần cứng |
| Accuracy ảnh và câu trả lời | Chưa có tập ảnh kiểm định có nhãn hoặc kết quả chấm chất lượng live | Ảnh đúng/sai/ngoài phạm vi, top3; so câu trả lời với PDF, không suy ra “khỏe” từ10 lớp bệnh |
| Một PDF TCVN lỗi font | Có ký tự mất mã, không được đoán chữ để nhập | Cung cấp bản tốt hơn hoặc OCR có kiểm tra; hiện bị loại,9 nguồn còn lại dùng được |
| Production và release | Chưa chốt host/domain/TLS/Auth/broker vận hành, chưa cho push/merge đợt này | Thảo luận riêng sau nghiệm thu local; không tự triển khai bằng cấu hình test |

Các mục trên là dữ liệu đầu vào, nghiệm thu thực hoặc quyết định triển khai, không phải lý do viết thêm module nghiệp vụ chưa được chốt. Không thay station_id/protocol, bật phần cứng hoặc gắn Farm vào HTX tự động để làm readiness xanh.

## Trình tự nghiệm thu đề xuất

1. Chạy pre-check, điền key, mở đủ dịch vụ. Kiểm địa chỉ API/web và đăng nhập bốn vai trò hiện có; giữ kết quả OTP/email đã được kiểm chứng, chỉ test lại khi cần xác nhận luồng mới.
2. Kiểm quyền và quy trình Admin/Manager/chủ Farm/Farmer nhận việc theo checklist. Dùng bản ghi mới qua API; không xóa dữ liệu cũ hoặc reset seed.
3. AI ảnh: upload đúng/sai file, Zone có/không quyền, top3 gợi ý, feedback/lịch sử riêng; ảnh ngoài miền không được diễn giải chắc chắn khỏe/bệnh.
4. Chat: câu có nguồn, không đủ nguồn, nguồn dự thảo, quota/key lỗi, reload/restart, Farmer khác không đọc hội thoại; đối chiếu trang gốc. Không tự bật lại request sau lỗi không rõ đã lưu.
5. Hardware: người dùng bật thiết bị, kiểm6 streams, Reset/van/bơm/Stop, ACK10s và quan sát thực tế; không chuyển metadata Inactive rồi kỳ vọng command OFF được phép.
6. Backup JSON + sidecar sau dữ liệu nghiệm thu, restore-check ở fixture. Ghi Pass/Fail/NotRun và ID hồ sơ trong file private, che key/JWT/OTP trước khi chia sẻ lỗi.

Source mới: apps/api/src/ai/pre-acceptance-cli.ts. Integration so checksum toàn database trước/sau để xác nhận chỉ đọc; Gemini tests kiểm cả model3.1 và3.8, thinking LOW và payload/source whitelist. Kết quả cuối trong handoff; không công bố số test cũ như vừa chạy lại trong đợt này.

Kết quả đợt này: backend271/271, nhóm Gemini/AI11/11, AI persistence9/9, UI AI10/10 và lint/typecheck/build đạt. Full persistence311/311 và web58 regression/24 unit/5 database browser thuộc checkpoint b6bd07b/33a6923, không chạy lại toàn bộ trong lần đổi model này. Không sửa transaction hoặc nghiệp vụ/IoT. Pre-check thật:6 mục ready (DB, ledger, schema/replica, corpus/files, tài khoản/metadata, worker ảnh),1 mục needs_setup là Gemini key còn trống; không gọi Google. Toàn bộ snapshot PDF khớp checksum,4/4 câu thử truy hồi có nguồn, model ảnh10 lớp nạp được.
