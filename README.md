# Smart Durian Farm

Hướng dẫn hiện hành: [4 terminal, lệnh chạy và checklist kiểm thử toàn diện](docs/RUN_AND_FULL_ACCEPTANCE.md). Dùng dữ liệu hiện có, không seed lại; AI worker/API/web chạy riêng, database chạy nền qua Docker.

Chatbot hiện chọn [Groq: điền key, restart API và kiểm thử](docs/GROQ_CHATBOT_IMPLEMENTATION.md). Key riêng `GROQ_API_KEY` trong `.env`; không cần nhập lại PDF hoặc đổi model ảnh.

Ứng dụng quản lý vườn sầu riêng: React/TypeScript/Vite, NestJS, PostgreSQL, MongoDB, MQTT/ESP32 và AI ảnh/chatbot RAG. Cập nhật28/10/2026: [tiến độ thực tế](docs/BACKEND_PROGRESS_CURRENT.md), [nhật ký từ phiên điều khiển](docs/CONTROL_SESSION_JOURNAL.md) và [lịch sử canh tác đã bổ sung](docs/CULTIVATION_HISTORY_ENRICHMENT.md).

## Đọc trước

- [Mời/phân công Farmer bằng tên hoặc điện thoại](docs/ASSIGNMENT_FARMER_SEARCH.md): tìm người, hiện tên+phone, chọn lịch sử cùng vườn; giữ bước chấp nhận phân công.

- [Rà soát26/10 và công việc còn lại](docs/BACKEND_PROGRESS_CURRENT.md): kiểm chứng hiện hành, quản trị danh mục mới và kế hoạch nghiệm thu/deploy.

- [Backend theo PDF24/10](docs/BACKEND_PDF_REQUIREMENTS.md): phiên theo hoạt động, phone0/+84, hồ sơ/OTP, liều số và công việc Khác; migrations015–016 đã áp dụng local,17 vật tư và Postman riêng.

- [Mục lục tài liệu](docs/README.md): chọn hướng dẫn theo nghiệp vụ, database, hardware hoặc giao diện.
- [Tiến độ và phần chưa nghiệm thu](docs/BACKEND_PROGRESS_CURRENT.md).
- [Bàn giao session](docs/MODULE_HANDOFF.md), [quy tắc nghiệp vụ](docs/PROJECT_BUILD_SPEC.md), [kế hoạch tiếp theo](docs/IMPLEMENTATION_PLAN.md).
- [Database runtime: cấu hình, source, kiểm thử, giới hạn](docs/DATABASE_RUNTIME_IMPLEMENTATION.md).
- [MQTT đang triển khai và cách thay bản cấu hình](docs/MQTT_COMMUNICATION_IMPLEMENTATION.md).
- [Backup/restore và kiểm tra demo](docs/DATABASE_BACKUP_RESTORE.md), [kết quả dữ liệu demo](docs/RUN_AND_FULL_ACCEPTANCE.md).
- [Dữ liệu IoT mẫu offline](docs/OFFLINE_DEMO_TELEMETRY.md): đã nạp1.440 readings cho hai Device mô phỏng; MQTT vẫn tắt, trạm thật giữ nguyên.
- [Chuẩn hóa dữ liệu khởi tạo và kiểm tra từng vai trò](docs/OPERATIONAL_DATA_REFRESH.md): nội dung nghiệp vụ tự tạo, bỏ nhãn demo; giữ tài khoản và hardware thật.
- [Bộ dữ liệu vận hành một tháng](docs/RICH_OPERATIONAL_DATASET.md): HTX/Farm/nhân sự đa dạng, lịch sử canh tác/thu hoạch, tài khoản tham khảo trong .env.
- [Thông tin dễ đọc trên giao diện](docs/frontend/modules/READABLE_BUSINESS_INFORMATION.md): tên thay UUID trong phạm vi quyền, nhãn tiếng Việt, ngày giờ Việt Nam và hướng dẫn kiểm tra.
- [Checklist kiểm tra từng module và vai trò](docs/MODULE_ACCEPTANCE_CHECKLIST.md): bản chia sẻ; bản có tài khoản tại `docs/LOCAL_MODULE_ACCEPTANCE.private.md` chỉ lưu local, không đưa lên Git.

## Chạy local

Yêu cầu Node theo `package.json`, npm, Docker Compose. Giữ `.env` hiện có; máy mới sao chép `.env.example` và điền cấu hình local, không đưa secrets lên Git.

```powershell
npm ci
docker compose -p smart-durian-farm up -d
npm run db:status
```

Nếu status còn migration Pending, chạy `npm run db:migrate` rồi kiểm tra lại. Chỉ chạy `npm run db:seed` khi cần chuẩn bị/bổ sung profile demo đã kiểm tra; seed không ghi đè dữ liệu hoặc reset mật khẩu đã tồn tại. Không xóa volume để chữa đăng nhập.

```powershell
npm run dev:api
```

Terminal khác:

```powershell
npm run dev:web
```

API mặc định `http://localhost:3000/api`; Swagger `/api/docs`, OpenAPI `/api/docs-json`. Web `http://127.0.0.1:5173`; proxy API và cấu hình public xem [web README](apps/web/README.md).

Development mặc định lưu database; test mặc định memory. `BUSINESS_STORAGE=database|memory` ghi đè lựa chọn này. `AUTH_MODE=mock` là Auth development/test, không quyết định nơi lưu nghiệp vụ. Startup không tự migrate, seed hoặc fallback RAM.

## Phạm vi hiện có

Auth/Users/duyệt Manager, HTX, vật tư/tiêu chuẩn/liên kết, Farm/Zone/phân công, cây/thu hoạch, Device/Sensor/Actuator, MQTT/telemetry/điều khiển, nhật ký canh tác/hash-chain và QR public. Database runtime dùng chung pool/client/repositories cho HTTP, Auth, MQTT, workers và QR.

Backend AI có YOLO11s-cls, top3 nhãn Việt/lịch sử riêng, corpus15 PDF có nguồn/trang/dự thảo và [Groq chatbot](docs/GROQ_CHATBOT_IMPLEMENTATION.md). Key riêng GROQ_API_KEY trong .env; đổi key/model cần restart API. [Chạy/nghiệm thu](docs/RUN_AND_FULL_ACCEPTANCE.md), [cài Python/model](ai/README.md). Người dùng báo AI đã hoạt động; đánh giá accuracy và nghiệm thu hardware xuyên suốt vẫn cần bằng chứng thực tế. Android ngoài phạm vi. MQTT FINAL đã tích hợp; ACK xác nhận nhận command, không chứng minh trạng thái vật lý bơm/van.

## Kiểm tra

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run lint:web
npm run typecheck:web
npm run test:web
npm run build:web
```

Database integration và browser tests dùng fixture riêng, xem [runtime guide](docs/DATABASE_RUNTIME_IMPLEMENTATION.md). Không dùng database demo hoặc broker thật làm fixture.

## Cấu trúc

| Đường dẫn | Nội dung |
| --- | --- |
| `apps/api` | Backend, migrations/seed, unit và integration tests |
| `apps/web` | Giao diện React và kiểm thử web |
| `docs` | Tài liệu hiện hành, nguồn ERD/MQTT, Postman và mẫu thiết kế |
| `assets/brand` | Bộ nhận diện gốc được dùng qua alias `@brand` |

Postman dùng collection JSON trực tiếp, copy JWT/UUID/OTP bằng tay. Không cần environment files. Không commit `.env`, secrets hoặc dữ liệu cá nhân thật. [Quy tắc dọn dự án và kết quả](docs/PROJECT_CLEANUP.md).
