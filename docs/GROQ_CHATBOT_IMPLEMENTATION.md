# Chatbot RAG với Groq — 28/10/2026

Nhánh: `feat/ai-groq-chatbot`. Groq thay Gemini làm provider được chọn trong `.env` local và `.env.example`. Adapter Gemini vẫn có thể chọn lại; không tự chuyển provider khi lỗi. Không thay database, corpus PDF, API hội thoại hoặc giao diện. Chẩn đoán ảnh vẫn dùng YOLO11s-cls/Python.

## Cấu hình và chạy

Điền key **riêng của Groq** trong `.env` root (không dùng key Gemini):

```dotenv
AI_CHAT_PROVIDER=groq
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=30000
GROQ_MAX_OUTPUT_TOKENS=4096
```

Các dòng đã được thêm sẵn; key để trống cho người dùng nhập. Không đưa key vào frontend, biến VITE_, Postman, chat hoặc Git. Các cấu hình Gemini cũ được giữ nguyên nhưng không dùng khi chọn Groq. Không thay các cấu hình MQTT/OTP/ảnh.

1. Dừng terminal API bằng Ctrl+C (trong phiên phần cứng, Dừng bơm/van và xác nhận tải đã tắt trước).
2. Chạy `npm run build` tại root sau lần cập nhật code này.
3. Chạy lại `npm run start:api`. Các lần sau chỉ sửa key/model thì restart API, không cần build lại.
4. Farmer vào Hỗ trợ canh tác → chatbot, tải lại hội thoại và gửi một câu hỏi cụ thể như “Chăm sóc sầu riêng sau thu hoạch cần lưu ý những gì?”. Đối chiếu nguồn/trang PDF trong câu trả lời.
5. `npm run check:acceptance --workspace @smart-durian/api` sẽ hiển thị `groq_configuration`. Ready chỉ kiểm tra cấu hình, **không xác thực key/quota hoặc gọi Groq thật**. Key trống thì needs_setup, API vẫn khởi động và các chức năng khác vẫn hoạt động.

## Hợp đồng provider

- POST cố định `https://api.groq.com/openai/v1/chat/completions`; header `Authorization: Bearer ...`, không gửi key trong URL/body. Native fetch, không thêm SDK/dependency.
- Model mặc định `openai/gpt-oss-20b`; có thể chọn model hỗ trợ JSON Object Mode trong GROQ_MODEL nếu project có quyền. Hạn mức/quyền model phụ thuộc tài khoản Groq; không giả định có quota miễn phí.
- JSON Object Mode (`response_format.type=json_object`), không stream, không tools. Mặc định tối đa 4096 completion tokens. JSON mode không bảo đảm schema: backend vẫn xác thực đúng hai trường `text`, `used_chunk_ids`, nội dung tối đa 8000 ký tự và 1–5 nguồn khác nhau trong danh sách đã truy xuất; không sửa JSON hoặc nguồn sai để ép thành công.
- Chỉ gửi câu hỏi, tối đa 6 tin nhắn trước và 5 đoạn RAG cùng filename/trang nguồn/nhãn dự thảo. Không gửi account/Zone UUID, JWT, ảnh hoặc toàn bộ PDF. Nhãn dự thảo và quy tắc không công khai thông tin riêng giữ nguyên.
- Request/response giới hạn 128 KiB, timeout 1–40 giây (mặc định 30). Không redirect, không tự retry/fallback. Lịch sử chỉ lưu sau phản hồi hợp lệ, bằng cùng store/CAS hiện có.
- 401/403 báo kiểm tra key/quyền; 400/404 báo model/cấu hình; 429 báo quota; timeout/upstream/phản hồi sai báo chưa hoàn tất. Không trả body thô của provider hoặc key ra lỗi/log.
- Quyền Farmer dùng và xem hội thoại riêng, Admin quản lý RAG, kiểm tra Zone và thu hồi phiên không đổi. Không nối chatbot với công cụ điều khiển phần cứng.

## Kiểm thử và giới hạn

`apps/api/test/groq.test.ts` kiểm tra chọn provider qua Nest, cô lập key Gemini/Groq, model/config an toàn, readiness không gọi mạng, endpoint/header và whitelist, giới hạn context/history, response hợp lệ, thiếu key/nguồn, 400/401/403/404/429/5xx, mất mạng, không retry, JSON sai/quá lớn/truncated/tool call và nguồn giả/trùng. Test dùng fetch giả, không tiêu quota hoặc ghi dữ liệu vận hành.

Tái lập tại root:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.test-dist
node --test apps/api/.test-dist/test/groq.test.js apps/api/.test-dist/test/gemini.test.js
npm run lint --workspace @smart-durian/api
npm run typecheck --workspace @smart-durian/api
npm run build
```

Chưa xác nhận Groq live khi người dùng chưa điền key. Cần test câu trả lời tiếng Việt, nguồn/trang, câu ngoài nguồn, quota và chất lượng diễn giải thực tế. Không tuyên bố nội dung đúng chỉ dựa vào JSON và citation hợp lệ. Không cần migrate/seed/import lại corpus.

Kết quả28/10: toàn backend unit/workflow **276/276**, Groq+Gemini tập trung **9/9**, backend lint, TypeScript compile cả test/integration và build đạt. Các lượt này dùng provider giả, không gửi Groq/Gemini/OTP/command phần cứng thật. Không chạy lại toàn persistence vì không sửa schema/store hoặc dữ liệu vận hành.

Nguồn chính thức đã đối chiếu: [Groq API reference](https://console.groq.com/docs/api-reference), [JSON mode và Structured Outputs](https://console.groq.com/docs/structured-outputs), [danh sách model](https://console.groq.com/docs/models). Nếu thay model hoặc Groq đổi contract, kiểm tra lại các nguồn này trước khi điều chỉnh adapter.
