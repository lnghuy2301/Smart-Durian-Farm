# AI ảnh và corpus RAG đã nhập — 26/10/2026

Nhánh `feat/ai-rag-corpus`, nền `b36b1f1`. Người dùng chốt: chatbot chưa chọn API; chấp nhận dự thảo nếu ghi rõ nguồn; chuẩn bị riêng phần sầu riêng, giữ bản gốc; ảnh chỉ trả top3 gợi ý, không tự kết luận hoặc khuyến cáo thuốc. Đây là checkpoint mới nhất, thay phần “chờ chốt nguồn/chưa nhập” trong [guide tích hợp model](AI_MODEL_AND_CORPUS_INTEGRATION.md). Auth/quyền theo [AI backend](AI_BACKEND_IMPLEMENTATION.md).

## Đã hoàn thành

- best.pt chạyCPU; `/api/ai/model`, chẩn đoán và lịch sử thêm `label_vi` cùng `interpretation.kind=classification_suggestions`, giữ nguyên label/class_id/confidence/model_sha256. Metadata hiển thị không sửa prediction lưu trong Mongo. Không suy luận “khỏe mạnh” từ model10 lớp bệnh; không tự gửi lệnh thiết bị hay tạo nhật ký.
- Corpus thực:15 PDF,9 nguồn gốc,396 trang,394 trang có text,1.220 chunks. Hai trang không có text không được bịa nội dung/OCR. Nguồn TCVN11892 có lỗi mã hóa bị loại; chưa kích hoạt. Không nhập hướng dẫn của cây trồng khác từ hai quy trình tổng hợp.
- 5 bản tách được đánh dấu dự thảo/tham khảo chưa xác nhận ban hành. Hai file có tên Draft/DuThao; ba bản quy trình/phụ lục có thông tin ban hành để trống cũng được đánh dấu tham khảo, không tự khẳng định hiệu lực pháp lý. Tài liệu hội thảo giữ đúng tên hội thảo, không gọi là quy định pháp luật.
- Tài liệu snapshot và nguồn gốc có SHA-256; trích dẫn trả cả trang trong bản tách và trang PDF gốc. Nguồn gốc được giữ nguyên ở inbox. Chạy lại prepare/import không tạo trùng hoặc ghi đè.

## Chuẩn bị tài liệu

`ai/corpus.sources.json` là kế hoạch đã kiểm tra: basename, checksum nguồn, title, is_draft và khoảng trang PDF1-based. Dùng số trang thực của file PDF, không suy đoán từ số in trong nội dung.

| Nguồn | Trang chọn |
| --- | --- |
| Quy trình QLSB revised3 | 1–10 |
| Draft Protocol of Durian | 1–7 |
| Dự thảo TCVN sầu riêng quả tươi | 1–13 |
| Hướng dẫn kỹ thuật canh tác sầu riêng | 1–88 |
| Hội thảo CTU về sầu riêng | 1–198 |
| Phụ lục QĐ29/2025 | **265–272**, trước phần cây sơ ri |
| Quy trình kèm QĐ34/2025 | **2–9**, trước phần xoài |
| Quyết định QĐ29/2025 Cần Thơ | 1–2, văn bản kèm theo/phạm vi |
| Sổ tay kỹ thuật nông dân | 1–62 |

`ai/tools/prepare_corpus.py` tạo file ở `ai/data/rag/prepared/` và manifest. Tách tối đa80 trang/lượt rồi chia nhỏ nếu còn vượt10MiB. Dùng PyMuPDF để loại resource không dùng/deflate, không giảm độ phân giải ảnh, không sửa/nén bản gốc. [PyMuPDF](https://pymupdf.readthedocs.io/en/latest/faq/index.html) giải thích tài nguyên chung có thể làm bản tách vẫn lớn như file gốc. Bản chuẩn bị có thể khác cách biểu diễn số tọa độ sau khi làm sạch stream;44 mẫu render đã đối chiếu, sai khác trung bình kênh tối đa0,216/255. Đây không phải chứng minh từng pixel trùng nhau; checksum mọi bản gốc được kiểm tra giữ nguyên.

PDF chuẩn bị vẫn qua parser thực/kiểm tra text. Các giới hạn10MiB/100 trang/400k ký tự/700 chunks mỗi file,100 tài liệu/5.000 chunks active được giữ nguyên. Toàn bộ15 snapshot khoảng45MB. File sinh ra và manifest ignored; chỉ plan/source code/tài liệu được commit. Thay nguồn phải review checksum/khoảng trang rồi cập nhật plan; công cụ từ chối sửa âm thầm file đã có khác nội dung.

## API và metadata

JWT Admin:

| API | Ý nghĩa |
| --- | --- |
| GET `/api/ai/rag/prepared` | Danh sách bản tách đã chuẩn bị, title và source metadata |
| POST `/api/ai/rag/documents/import-prepared` | JSON `{ "filename": "tên lấy từ prepared" }`; title/source lấy từ manifest, client không tự gửi source |
| GET `/api/ai/rag/documents` | Danh sách đã nhập, source.page_map/is_draft, số chunks/trạng thái |
| POST `/api/ai/rag/search` | JSON `{ "message": "thán thư" }`; top5 context để nghiệm thu trước khi có API chat |

Collection [Postman nhập tay](postman/AI-Backend.postman_collection.json) có các request mới; copy JWT/filename/UUID/ObjectId thủ công. Farmer/Manager không có quyền quản trị nguồn. Farmer vẫn chỉ chẩn đoán và xem lịch sử của mình.

AI_RAG_DOCUMENTS thêm source tùy chọn: `{filename, sha256, page_map[], is_draft}`. Citation thêm source tùy chọn: `{filename, sha256, page, is_draft}`. `citation.page` là trang bản tách; **`citation.source.page` là trang gốc cần hiển thị**, filename gốc và nhãn “Dự thảo/Tham khảo” lấy từ source. Không có source ở bản cũ/người quản trị import thông thường có nghĩa chưa có metadata phân loại nguồn; không mặc định đó là văn bản đã ban hành. Snapshot citation được giữ cùng hội thoại sau này.

Import prepared kiểm tra checksum cả PDF gốc lẫn bản tách, đường dẫn nằm trong thư mục cố định, manifest/page_map đúng và số trang trùng kết quả parser. Client không được tự thay metadata nguồn. Thay file gốc/bản tách báo409; tên/manifest không hợp lệ400; file không có404. Không tự nới giới hạn để nhập cho qua.

## Migration, nhập offline và tái lập

**018_ai_source_provenance** mở rộng validator Mongo bằng metadata nguồn tùy chọn. Không đổi checksum001–017, không thêm bảng PG. Archive014–017 vẫn restore đúng schema gốc rồi migrate tiếp018. Runtime và CLI kiểm tra validator/index; không tự tạo collection nếu MONGODB_URI sai.

Máy khác cần nhận weights/PDF gốc riêng (không nằm trong Git), giữ đúng checksum plan. Cài dependency bằng venv; requirements.lock.txt chứa bộ PDF/test, requirements-inference.lock.txt có bộ inference CPU; PyMuPDF chuẩn bị corpus được pin ở requirements-corpus.txt.

```powershell
ai/.venv/Scripts/python.exe -m pip install -r ai/requirements-inference.lock.txt -r ai/requirements-corpus.txt
npm run ai:corpus:prepare
# Dừng API trước các bước bảo trì; worker Python vẫn cần chạy
npm run db:backup
npm run db:migrate
# terminal riêng
npm run dev:ai
# terminal bảo trì
npm run ai:corpus:check
npm run ai:corpus:import
npm run db:backup
# restart API sau bảo trì
npm run start:api
```

CLI dùng Admin Active đã có theo AUTH_TEST_ADMIN_PHONE, không yêu cầu/in mật khẩu/JWT/OTP. Một DatabaseService/pool/MongoClient và các repository dùng chung; gọi cùng AiService như API. Không khởi tạo Nest lifecycle/SMTP/SMS/MQTT/controller. Giữ lock runtime/migration suốt batch, từ chối API đang chạy và production. Không có transaction chéo PG/Mongo: nếu import dở, file đã nhập được giữ; chạy lại tiếp tục bằng checksum, không rollback/xóa lịch sử.

Local đã check15/15 PDF và nhập15; rerun imported0/skipped15. Kiểm tra5 câu hỏi về thán thư/rệp sáp/nứt thân/bón phân/thu hoạch đều có5 context với trang nguồn. Đây là nghiệm thu truy hồi, không phải chất lượng câu trả lời AI. Chưa có adapter chat, AI_CHAT_PROVIDER vẫn disabled; không gửi dữ liệu ra ngoài. Chưa có UI AI mới trong nhánh backend này.

## Kiểm thử và phục hồi

Backend266/266, persistence310/310, Python10/10 đạt; lint/typecheck/build đạt. Nhóm AI6 unit kiểm tra phân quyền, nhãn tiếng Việt/điểm gốc, manifest, thay nguồn409, source client400; integration7 kiểm tra schema018, lưu citation dự thảo, nguồn/trang gốc, backup017 rồi upgrade018 và binary sidecar. Log ignored apps/api/.integration-dist/ai-source-*.txt; báo cáo thực nằm trong backups/ai-corpus-acceptance.json.

Backup sau nhập có2.352 dòng PG,1.728 documents Mongo và15 PDF sidecar. So trước nhập:17 bảng dữ liệu PG và toàn bộ Mongo cũ giữ nguyên, thêm15 AI_RAG_DOCUMENTS; không tạo chẩn đoán/hội thoại giả. Restore-check vào database tạm đạt cùng checksum `0bad2654b2a998cad2db2a0082a3dbf045eedc8b4a4ae7087505d11f87cc3912`.

Giữ JSON cùng `<file>.json.assets/`, không đưa lên Git. Sidecar chứa snapshot PDF đã nhập/ảnh được tham chiếu, **không bao gồm weights hoặc PDF gốc trong inbox**; sao lưu riêng các đầu vào đó để còn đối chiếu nguồn và chuẩn bị lại corpus. Backup đã lưu source metadata và snapshot đầy đủ nên lịch sử/trích dẫn đã nhập vẫn phục hồi được. Không tự OCR tài liệu lỗi font hoặc khẳng định đạt accuracy khi chưa có tập ảnh kiểm định.
