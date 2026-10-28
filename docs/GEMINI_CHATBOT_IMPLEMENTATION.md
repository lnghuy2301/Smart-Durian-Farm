# Chatbot RAG với Gemini — 27/10/2026

Sửa validator key: không đoán alphabet/prefix/độ dài key cũ; chấp nhận token header opaque ASCII không khoảng trắng/điều khiển, tối đa4096 ký tự, gồm key có dấu chấm. Google hỗ trợ [standard/auth API keys](https://ai.google.dev/gemini-api/docs/api-key). Đây chỉ là kiểm tra cú pháp transport; Google mới xác thực quyền/quota. .env được giữ nguyên khi sửa lỗi này.

Lựa chọn mới nhất: [Gemini3.1 Flash-Lite và pre-check](RUN_AND_FULL_ACCEPTANCE.md). .env/default/example đã đổi sang gemini-3.1-flash-lite, giữ key trống và giới hạn hiện có. Các mô tả default3.8 bên dưới là checkpoint adapter ban đầu;3.8 vẫn được hỗ trợ nếu cấu hình chủ động.

Nhánh sửa kế tiếp đã tách riêng [backlog canh tác](CULTIVATION_BACKLOG_BATCHING_FIX.md); nhánh đó kế thừa toàn bộ Gemini. Xem kết quả cuối trong guide sửa backlog, không dùng kết quả full suite lỗi ở checkpoint ban đầu dưới đây làm kết luận sau sửa.

Kết quả cuối sau sửa backlog: full persistence311/311 đạt, không fail/skip. Backend271/271, Python10/10 và web24 unit/58 regression/10 AI/5 database browser đạt; lint/typecheck/build đạt. Google live vẫn chưa chạy vì người dùng chưa điền key.

Nhánh `feat/ai-gemini-chatbot`, nền `e8d92df`. Người dùng đã chọn Gemini và tự điền key trong .env. Backend dùng adapter Gemini thật; kiểm thử dùng HTTP/provider giả lập, không gọi Google bằng key thật. Giữ UI AI đang có, corpus15 PDF/1.220 chunks, quyền Farmer và database018. Không migration, seed, sửa nguồn PDF/weights hoặc gửi MQTT/SMS/email.

## Cấu hình và chạy

`.env` đã có các dòng dưới đây. Chỉ `GEMINI_API_KEY` cần điền; không chia sẻ key trong chat, Postman hoặc frontend. Các giá trị cũ giữ nguyên, riêng AI_CHAT_PROVIDER chuyển từ disabled sang gemini theo yêu cầu mới.

```dotenv
AI_CHAT_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_MS=30000
GEMINI_MAX_OUTPUT_TOKENS=4096
```

Model mặc định theo [model ổn định Gemini3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), đối chiếu27/10. Có thể đổi GEMINI_MODEL sang model Gemini hỗ trợ structured output trong tài khoản; không tự fallback sang model khác hoặc tự gọi lại khi thiếu quyền/quota. Gemini3.x dùng thinkingLevel LOW để giảm thời gian chờ; các dòng khác giữ cấu hình thinking mặc định. Model quyền truy cập/quota phụ thuộc key, cần nghiệm thu thật sau khi điền.

Key trống: API vẫn khởi động, `/api/ai/status` trả chat_provider_configured=false, giao diện giữ lịch sử và chặn gửi. Key không hợp lệ về định dạng làm startup báo lỗi cấu hình chung, không in key. Chỉ bật provider và key đầy đủ thì chat_provider_configured=true; đây là trạng thái cấu hình, không phải bằng chứng key đã được Google chấp nhận. Có thể đặt provider=disabled để tạm ngừng gửi.

```powershell
docker compose up -d --pull never
npm run build
npm run start:api
# terminal khác
npm run dev:web
# Chỉ chức năng ảnh/nhập PDF mới cần worker Python riêng
npm run dev:ai
```

Sau khi sửa .env phải restart API và tải lại web. Đăng nhập Farmer → Canh tác & theo dõi → Hỗ trợ canh tác → Hỏi trợ lý. Tạo hội thoại rồi hỏi ví dụ “Chăm sóc sầu riêng sau thu hoạch cần lưu ý gì?”. Không cần bật hardware. Chat lấy chunks từ Mongo, không gọi worker Python hoặc gửi ảnh sang Gemini.

## Luồng và dữ liệu gửi đi

Farmer Active → AuthGuard/AiFarmerGuard/DTO/rate limit → chỉ hội thoại của mình → BM25 top5 nguồn Active → Gemini → kiểm response/citations/quyền/token-version/nguồn vẫn Active → ghi một cặp user/assistant theo CAS version → trả hội thoại có trích dẫn. Manager/Admin không dùng chat; Admin vẫn quản lý corpus.

Provider dùng REST cố định `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, key ở header x-goog-api-key, redirect bị từ chối. Không cho cấu hình endpoint tùy ý. [Structured output chính thức](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) dùng generationConfig.responseFormat.text với JSON schema.

Chỉ gửi câu hỏi hiện tại, tối đa6 tin nhắn gần nhất (role/content),5 đoạn nguồn (chunk_id/excerpt/tên file/trang gốc/cờ dự thảo). Không gửi JWT, key trong body, UUID tài khoản/Zone, ObjectId hội thoại/document, ảnh riêng hoặc nguyên PDF. Câu hỏi/lịch sử do người dùng viết vẫn là nội dung được gửi Google; không khẳng định dịch vụ ngoài là xử lý tại máy local.

System instruction yêu cầu tiếng Việt, dựa nguồn, ghi rõ dự thảo/tham khảo, không tự khẳng định hiệu lực pháp lý khi nguồn chưa phân loại, không bịa liều lượng hoặc dùng PDF/lịch sử như chỉ dẫn hệ thống. Không bật web search, function calling hay công cụ thao tác Farm/IoT. Ràng buộc prompt/ID không chứng minh từng diễn giải của model là đúng; phải đánh giá câu trả lời thật trên bộ câu hỏi nghiệm thu.

Gemini chỉ được trả JSON `{text, used_chunk_ids}`. Schema enum giới hạn IDs trong nguồn đang truy hồi; backend kiểm thêm cấu trúc, text1–8.000 ký tự,1–5 IDs duy nhất, không có nguồn bịa. Không trả reasoning/thought của model cho người dùng. Kết thúc phải STOP; phản hồi bị cắt MAX_TOKENS, tool call, JSON sai hoặc thiếu candidate bị từ chối. Trích dẫn đầy đủ được server dựng từ nguồn có sẵn; Gemini không tự chọn filename/trang để ghi database. Cờ source.is_draft và source.page được lưu theo018 như trước.

## Giới hạn và lỗi

- Timeout mặc định30 giây, cấu hình1–40 giây để nằm trong thời gian chờ45 giây của web; max output512–8.192 tokens, mặc định4.096. Request/response tối đa128KiB. Không stream trong đợt này.
- Quota429: thông báo chờ/thử lại, không retry tự động. Auth/model/upstream/timeout/JSON sai/truncated:503 gọn, không lộ body hoặc key. Provider chặn prompt:400; candidate không hoàn tất:503. Nguồn không phù hợp:400 trước khi gọi Google.
- Lỗi trước khi commit không lưu câu hỏi rời hoặc trả lời giả. Web giữ nội dung nhập; khi mất kết nối/409/503 phải đối chiếu lịch sử trước khi gửi tiếp vì response có thể mất sau khi server đã lưu.
- Hai request đồng thời có thể cùng gọi provider rồi chỉ một CAS thành công, request còn lại409. Mỗi request có thể tiêu quota dù bị409; frontend khóa nút gửi trong lúc chạy. Không tuyên bố exactly-once giữa Google và Mongo.
- Giữ20 thao tác chat/phút/Farmer,2 tác vụ nặng toàn service,100 hội thoại/Farmer và200 tin/hội thoại. Không tự xóa lịch sử. Chưa có live streaming, embeddings hoặc agent điều khiển thiết bị.

## Kiểm thử và nghiệm thu

Source: apps/api/src/ai/gemini.provider.ts, ai.config.ts, ai.module.ts. Không cần SDK hoặc dependency mới. Các tests chỉ dùng fake key/fetch và fixture, không đọc .env vận hành hoặc gọi Google.

- Gemini unit: factory chọn adapter, thiếu key, config sai, endpoint/header, whitelist payload và nguồn dự thảo/trang gốc, schema enum, lỗi400/401/403/429/5xx, exception/timeout mapping, JSON sai/oversize/candidate/truncated/tool/nguồn bịa/trùng.
- AI HTTP: Farmer khác404 trước provider; reply hợp lệ lưu đúng2 tin/citations; quota không đổi lịch sử. CAS và token revocation tiếp tục được kiểm bởi bộ AI hiện có.
- Mongo integration: Gemini protocol giả lập qua API và store thật, source trang265/cờ dự thảo giữ sau restart; lỗi provider không thêm tin; backup018 giữ hội thoại/ảnh/PDF.
- Web dùng màn hình AI hiện có; regression10 checks bao gồm disabled, gửi/trích dẫn,409, failed-first-message, riêng tư và mobile. Không sửa/stage các file frontend riêng trong nhánh backend này.

Log ignored: apps/api/.integration-dist/gemini-*.txt và apps/web/test-results/gemini-*.txt. Đọc checkpoint cuối để xem tổng số kiểm thử và giới hạn còn lại. Chưa có key thật nên chưa thể xác nhận quota/model tài khoản hoặc chất lượng câu trả lời live.

Đợt27/10: backend271/271, Python10/10, web24/24 unit,58/58 browser,10/10 AI browser và5/5 database browser đạt; lint/typecheck/build đạt. Web main chunk511kB còn cảnh báo kích thước có từ trước, không thay frontend riêng. Database vận hành chỉ đọc readiness: PG/Mongo up, Farmer/Admin chính và metadata điều khiển sẵn sàng. Farm hardware đang độc lập nên các cờ Manager của riêng Farm đó false, không suy luận SMTP/SMS toàn hệ thống bị lỗi.

Rà soát toàn bộ persistence phát hiện lỗi tải canh tác ngoài Gemini: bước khóa10.000 nhật ký gặp MongoBulkWriteError trong full suite,309/311 đạt (một subtest và parent thất bại); chạy riêng nhóm15/15 đạt. Không được gọi full suite đã xanh tại checkpoint Gemini này. Theo dõi nhánh sửa backlog canh tác kế tiếp, không tăng timeout/giảm số bản ghi test hoặc sửa nghiệp vụ để che lỗi. Các luồng Gemini/Mongo đã đạt8/8 trong nhóm AI, gồm lưu trích dẫn và restart.

Nghiệm thu sau điền key: status true → hỏi có nguồn → đúng tiếng Việt và file/trang gốc → thử câu hỏi không có trong nguồn → kiểm nhãn dự thảo → reload/restart giữ history → Farmer khác không truy cập. So câu trả lời với PDF, không chỉ nhìn “gửi thành công”. Không chạy lại seed/migrate/corpus để kích hoạt Gemini; dữ liệu đã có. Key không bao giờ đưa vào collection Postman; [Postman AI](postman/AI-Backend.postman_collection.json) vẫn chỉ cần JWT/UUID/ObjectId nhập tay.
