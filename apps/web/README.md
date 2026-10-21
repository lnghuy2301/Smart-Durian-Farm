# Smart Durian Web

React + TypeScript + Vite. Giao diện ba role, Farm/Zone/phân công, cây, thu hoạch, canh tác, IoT metadata/monitor/control, HTX approvals/verification và QR public đã nối API. Backend development hiện dùng shared database runtime; [hướng dẫn](../../docs/DATABASE_RUNTIME_IMPLEMENTATION.md), [tiến độ](../../docs/BACKEND_PROGRESS_CURRENT.md).

Chạy từ root:

```powershell
npm ci
npm run dev:api
```

Terminal khác: `npm run dev:web`. Web mặc định http://127.0.0.1:5173, proxy `/api` tới http://127.0.0.1:3000. Cấu hình public VITE_API_BASE_URL/dev-only WEB_DEV_API_TARGET theo `.env.example` của web; không copy backend secrets sang client.

Checks: `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`, `npm run build:web`, `npm run format:check -w apps/web`. Browser `npm run test:web:e2e` dùng fixture memory; full database/MQTT browser `npm run test:e2e:database -w apps/web` cần DB fixture riêng theo runtime guide. Browser cần Edge/Chrome hoặc WEB_TEST_BROWSER executable; không dùng API/broker/demo credentials thật.

[Các module UI](../../docs/frontend/README.md), [workflows](../../docs/frontend/REFERENCE_WORKFLOWS_IMPLEMENTATION.md), [control](../../docs/frontend/modules/ACTUATOR_CONTROL_WEB.md). Control chỉ chủ/assignee hiệu lực; Admin/Manager đọc theo scope. ACK là receipt, không khẳng định bơm/van vật lý. QR public không gửi JWT.

Brand kit nguồn dùng chung tại [assets/brand](../../assets/brand/README.md) qua alias @brand; không tạo bản sao logo không cần thiết. Font local @fontsource/be-vietnam-pro có SIL OFL notice tại /licenses/Be-Vietnam-Pro-OFL.txt. HTML/screenshots tham khảo không được serve như app runtime; giữ làm nguồn thiết kế.
