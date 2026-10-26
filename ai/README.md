# AI — YOLO11s-cls và chatbot RAG

Cập nhật26/10: đã có best.pt và10 PDF; model thật đã nạp/suy luận CPU. [Checkpoint tích hợp](../docs/AI_MODEL_AND_CORPUS_INTEGRATION.md) ghi versions, nhãn, API readiness và các PDF cần chốt trước nhập. Không dùng mô tả “chưa có model” bên dưới để kết luận trạng thái mới. Lock CPU đầy đủ: requirements-inference.lock.txt; kiểm tra bằng `.venv/Scripts/python.exe tools/check_model.py` từ thư mục ai.

Ngày26/10/2026, `feat/ai-foundation` từ `0965c05`. [API/CSDL/kiểm thử](../docs/AI_BACKEND_IMPLEMENTATION.md). NestJS giữ auth/quyền và dữ liệu; Python xử lý ảnh/PDF ở loopback bằng token nội bộ. Chat API chưa chọn vendor nên chưa sinh câu trả lời thật.

## Đặt file ở đâu

| Đường dẫn từ root | Nội dung |
| --- | --- |
| `ai/models/disease/best.pt` | Checkpoint YOLO11s-cls đã train trên Colab |
| `ai/data/rag/pdfs/` | PDF hướng dẫn nông nghiệp để Admin chọn nhập |
| `ai/data/rag/index/` | Chỗ dành cho cache/chỉ mục bổ sung; hiện BM25 lấy chunks từ MongoDB |
| `ai/storage/diagnostics/` | Ảnh riêng, backend tạo tên ObjectId và checksum |
| `ai/storage/rag-documents/` | Snapshot PDF đã nhập, tên ObjectId |
| `ai/src/diagnosis/`, `ai/src/rag/` | Loader model, parser PDF subprocess |
| `ai/src/chatbot/` | Boundary provider; orchestration/RAG/chat ở NestJS |

Model/PDF/index/storage/venv đã ignore. Không tạo best.pt/kết quả giả để lấp chỗ trống. Thả PDF vào folder chưa đồng nghĩa đã import; Admin nhập qua API. Không tự dùng PDF ERD/yêu cầu phần mềm làm corpus canh tác.

## Cài và chạy

Đã tạo venv nhẹ cho API/PDF/test. Session khác tái lập trên Windows:

```powershell
python -m venv ai/.venv
ai/.venv/Scripts/python.exe -m pip install -r ai/requirements.lock.txt
```

Lock không có Torch/Ultralytics. Khi có best.pt, ưu tiên pin phiên bản Ultralytics/Torch/torchvision giống Colab; giữ pip freeze, args.yaml/imgsz và tên lớp cùng model. Bộ cài ban đầu:

```powershell
ai/.venv/Scripts/python.exe -m pip install -r ai/requirements-inference.txt
```

Torch là dependency lớn, phụ thuộc CPU/GPU; chưa tải trong đợt viết source này. Không dùng checkpoint pretrained ImageNet thay model bệnh đã train. Classifier đọc model.names và top3 score qua probs, không tạo bounding box; [tài liệu Ultralytics](https://docs.ultralytics.com/tasks/classify/). Score chưa phải độ chính xác đã kiểm định.

`.env` local chỉ append key AI chưa có, giữ cấu hình/tài khoản cũ: AI_SERVICE_ENABLED, AI_SERVICE_URL, AI_INTERNAL_TOKEN, AI_CHAT_PROVIDER, AI_DEVICE. Token nội bộ sinh ngẫu nhiên, không in/Git/Postman. `.env.example` là placeholder. Worker mặc định127.0.0.1:8001/CPU. AI_CHAT_PROVIDER hiện chỉ hỗ trợ disabled vì chưa chọn API.

Sau migration017, chạy hai terminal từ root:

```powershell
# Terminal1: worker vẫn xử lý PDF khi chưa có model
npm run dev:ai
# Terminal2: backend
npm run build
npm run start:api
```

Frontend/Postman gọi `/api/ai/*` bằng JWT. Token worker chỉ NestJS dùng, không đưa lên web. Chưa có màn hình AI mới trong đợt backend này.

Thiếu weights/dependencies hoặc sai task/model busy:503, không lưu ảnh/prediction mới. Không tự tải model. Worker lazy-load một lần; sau khi thay best.pt/package/device phải restart. Model checksum được lưu theo từng bản ghi; giữ weights cũ nếu cần tái hiện.

PDF cần text; scan-only phải OCR trước. File mã hóa/lỗi/quá giới hạn bị từ chối, không có OCR tự động. [pypdf giải thích giới hạn trích xuất](https://pypdf.readthedocs.io/en/stable/user/extract-text.html). Chat API chưa cấu hình trả503 rõ ràng, không gọi API ngoài hoặc lưu câu trả lời giả.

## Test và backup

`npm run test:ai` chạy7 Python tests trong venv, dùng model giả và tempfile, không đọc .env thật. TestClient có cảnh báo deprecation httpx từ framework đã khóa; tests đạt, không tắt cảnh báo. Test này không đo accuracy của best.pt. Nest/Mongo tests nằm trong guide backend.

`db:backup` khi API dừng tạo JSON và, nếu có dữ liệu AI, `<file>.json.assets` cho ảnh/PDF được tham chiếu kèm manifest/hash. Giữ hai phần cạnh nhau. Verify/restore-check kiểm cả bundle; restore-check không chép vào storage vận hành. Restore-new chỉ chép file còn thiếu, từ chối checksum khác, không ghi đè. Trọng số và PDF inbox chưa nhập cần backup riêng.
