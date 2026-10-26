# Tích hợp model và PDF thật — 26/10/2026

Đã chốt và triển khai tiếp: [AI_RAG_CORPUS_IMPLEMENTATION](AI_RAG_CORPUS_IMPLEMENTATION.md). Corpus15 PDF đã nhập, migration018 giữ nguồn/trang/dự thảo; top3 có nhãn tiếng Việt và thông báo gợi ý. Chat API chưa chọn. Các điểm “chờ chốt/chưa nhập” dưới đây là checkpoint trước quyết định mới.

Nhánh `feat/ai-model-corpus-integration`, nền `41837bb`. Quyền API/lịch sử/CSDL theo [AI_BACKEND_IMPLEMENTATION](AI_BACKEND_IMPLEMENTATION.md). Chỉ làm backend/Python; giữ nguyên frontend/ERD/MQTT và PDF/weights gốc. Không thêm migration, không đổi .env, không tạo dữ liệu chẩn đoán giả trong database.

## Model đã kiểm tra

`ai/models/disease/best.pt`: 11.048.706 bytes; SHA-256 `3ef520d39eb401a65021c3769fbc6778bf16cdef7ab91524af27dbc3440ef825`.

Checkpoint khai báo YOLO11s-cls, Ultralytics8.4.189, ảnh224. Đã cài venv CPU và nạp/suy luận thật thành công: Torch2.14.1+cpu, torchvision0.29.1+cpu, Ultralytics8.4.189. Lock đầy đủ ở `ai/requirements-inference.lock.txt`; không tự tải pretrained model, không thay bằng checkpoint khác. Không có ảnh kiểm định có nhãn nên chưa kết luận accuracy. Ảnh màu đồng nhất dùng smoke test chỉ kiểm tra model chạy, không được lưu thành lịch sử bệnh thật.

Các nhãn nguyên bản theo thứ tự class_id0–9:

```text
anthracnose_disease
canker_disease
fruit_rot
mealybug_infestation
pink_disease
sooty_mold
stem_blight
stem_cracking_ gummosis
thrips_disease
yellow_leaf
```

Giữ nguyên cả khoảng trắng trong nhãn class7 để không đổi định danh đã train. Model không có lớp khỏe mạnh/ngoài phạm vi. Chưa tự thêm ngưỡng kết luận bệnh, tên bệnh diễn giải hoặc khuyến cáo thuốc. Cần người dùng chốt cách thể hiện kết quả và cung cấp ảnh có nhãn để đánh giá.

## API và cài lại

GET `/api/ai/model` bằng JWT Farmer/Admin: thực sự nạp và xác minh task/model trước khi trả model_sha256/classes. Manager bị chặn; thiếu dependency/model, sai task hoặc bận trả503. Endpoint không tạo history và không chứng minh accuracy. `/api/ai/status` vẫn mô tả cấu hình, không thay thế readiness model.

Worker có GET `/v1/model`, chỉ loopback và token nội bộ. Không gửi token đó lên frontend/Postman. Loader buộc YOLO_OFFLINE=true, YOLO_AUTOINSTALL=false, sync=false; cấu hình thư viện chỉ ghi tại `ai/.runtime/` đã ignore, không ghi profile người dùng. Model nạp singleton; thay weights/package cần restart worker.

```powershell
# Windows, Python3.13; trong root dự án
ai/.venv/Scripts/python.exe -m pip install -r ai/requirements-inference.lock.txt
ai/.venv/Scripts/python.exe ai/tools/check_model.py
ai/.venv/Scripts/python.exe ai/tools/check_model.py --smoke
npm run dev:ai
# terminal khác
npm run build
npm run start:api
```

Script check_model chỉ đọc weights, trả classes/checksum/versions, không đọc .env hoặc gọi DB. `--smoke` chạy ảnh RGB tổng hợp, không đo accuracy. GET model và chẩn đoán có trong [Postman AI](postman/AI-Backend.postman_collection.json); JWT/UUID/ObjectId nhập tay như cũ. [Ultralytics classification](https://docs.ultralytics.com/tasks/classify/) dùng probs; [PyTorch CPU](https://pytorch.org/get-started/locally/) là nguồn cài đặt.

## PDF đã rà soát, chưa kích hoạt corpus

Tất cả nằm ở `ai/data/rag/pdfs/`, giữ nguyên bytes và tên gốc. Giới hạn runtime hiện vẫn10MiB/100 trang/400.000 ký tự mỗi PDF,700 chunks; chưa tăng khi chưa thống nhất phương án nguồn. PDF trong inbox chưa đồng nghĩa đã nhập/kích hoạt.

| File | Trang | Kết quả/điểm cần xử lý |
| --- | ---: | --- |
| 21.12.25_ Quy trình QLSB sau rieng-revised 3.pdf | 10 | Trích xuất được; dòng số/ngày quyết định để trống, chưa tự khẳng định là bản đã ban hành |
| 22.06.21- Draft Protocol of Durian (VN Ver)_clean.pdf | 7 | Trích xuất được; tên file ghi Draft, chờ chốt nguồn |
| DuThaoTCVN sauriengquatuoi.pdf | 13 | Văn bản ghi DỰ THẢO3, chờ chốt nguồn |
| Hướng dẫn kỹ thuật canh tác sầu riêng.pdf | 88 | 25MB, vượt giới hạn; có glyph Unicode cần chuẩn hóa |
| Hội thảo khoa học CTU về Sầu riêng-30_4_2024.pdf | 198 | 12,9MB, vượt dung lượng/trang |
| Phu luc dinh kem QĐ 29_2025.pdf | 320 | Quy trình nhiều cây trồng, vượt số trang |
| QUY TRINH KEM QĐ 34_2025_QĐ-UBND.pdf | 180 | Quy trình nhiều cây trồng, vượt số trang |
| QĐ 29_2025_QĐ-UBND Can Tho.pdf | 2 | Trích xuất được; đây là quyết định, không thay phần hướng dẫn canh tác trong phụ lục |
| STHDKT Canh tác sầu riêng.pdf | 62 | 18,6MB, vượt giới hạn; có glyph Unicode cần chuẩn hóa |
| TCVN11892-1_2017_916963.pdf | 12 | Mã hóa font trả ký tự điều khiển/làm sai chữ, bị chặn; cần bản text tốt hơn hoặc OCR có kiểm tra |

Parser đã giải mã chính xác mẫu `/uniXXXX` thành Unicode/NFC và có fonttools; không đoán lại chữ đã mất. Ký tự điều khiển lỗi/surrogate bị từ chối trước khi nhập. API vẫn trả lỗi PDF được làm gọn; không ghi nội dung hỏng. Bản gốc không bị viết lại.

Cần người dùng chốt: API chatbot; có dùng dự thảo hay không; chuẩn bị riêng phần sầu riêng với trang nguồn hay nhập toàn bộ PDF và tăng giới hạn/schema. Chưa chọn API thì AI_CHAT_PROVIDER giữ disabled, không gọi API ngoài hoặc bịa câu trả lời. Chưa nhập/kích hoạt tài liệu cho đến khi chốt phạm vi. [pypdf](https://pypdf.readthedocs.io/en/stable/user/extract-text.html) không tự OCR chữ trong ảnh.

## Kiểm thử và session tiếp theo

Python9/9: model readiness nạp singleton/sai task/auth, top3, ảnh, PDF, Unicode glyph và chặn lỗi font. Backend265/265 đạt, gồm5 nhóm AI có GET model, Manager403, classes/hash và HTTP adapter GET/POST thật trên loopback; lint/typecheck/build đạt. Không đổi persistence/schema, không cần chạy lại toàn bộ fixture308 của checkpoint trước. Smoke model thật đã chạy ởCPU; không thay ảnh đó thành bằng chứng accuracy. Báo cáo kiểm tra cục bộ ở backups/ai-model-smoke.json, ai-corpus-inventory.json, ai-corpus-text-quality.json và ai-corpus-extraction-check.json (ignored); backend log apps/api/.integration-dist/ai-model-full-backend.txt.

Session sau đọc guide này trước checkpoint cũ “chưa có weights”. Không tự nhập hết inbox hoặc tăng giới hạn cho qua; không sửa migrations017 đã Applied. Chốt nguồn/cách biểu diễn trước, sau đó chuẩn bị corpus, import bằng workflow Admin và kiểm tra trang/trích dẫn. Chat provider cần key/model/quota và quy tắc gửi dữ liệu ra ngoài trước khi viết adapter. UI AI chưa triển khai trong nhánh backend này.
