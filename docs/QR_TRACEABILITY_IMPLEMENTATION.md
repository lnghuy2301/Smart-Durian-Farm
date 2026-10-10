# QR traceability — API, demo và tái lập

Ngày 2026-10-10; nhánh **feat/qr-traceability** từ Cultivation **3ee921b**. Đã có API public, SVG QR, web `/trace/{tree_code}` và link “Truy xuất / mã QR” từ trang cây. [Quy trình đã duyệt](QR_TRACEABILITY_WORKFLOW_DESIGN.md); [Postman nhập JSON trực tiếp](postman/QR-Traceability-Local-Test.postman_collection.json). Không có bảng QR hoặc business persistence.

## Cấu hình và chạy

Một biến backend mới đã thêm vào `.env.example` và **nối thêm vào `.env` local**, giữ nguyên toàn bộ giá trị cũ:

```dotenv
TRACE_PUBLIC_BASE_URL=http://localhost:5173
```

Đây là **origin web**, không phải API/broker/station_id. Default khi thiếu khóa: http://localhost:5173. Chỉ HTTP/HTTPS origin, tối đa200 ký tự; không credentials/path/query/fragment; dấu `/` cuối được chuẩn hóa. Sai cấu hình làm startup fail với tên khóa, không echo giá trị. Không lấy Host/X-Forwarded-Host request để tạo QR. Giữ Auth/MQTT/OTP hiện có.

Từ root, dùng hai terminal:

```powershell
npm ci
npm run dev:api
```

```powershell
npm run dev:web
```

Web http://localhost:5173; Swagger http://localhost:3000/api/docs; OpenAPI http://localhost:3000/api/docs-json. Vite proxy `/api` sang backend theo cấu hình frontend đã có. MQTT có thể disabled; không cần hardware/SMS/DB để đọc demo RAM. Readiness503 khi DB không chạy không chứng minh lỗi QR. AUTH_MODE=mock chỉ demo local như guide trước.

Quét bằng điện thoại cùng mạng: đặt `TRACE_PUBLIC_BASE_URL=http://<IP-LAN-của-máy>:5173`, restart API, chạy `npm run dev:web -- --host 0.0.0.0`. Điện thoại phải truy cập được web qua mạng/firewall; localhost trên điện thoại là chính điện thoại. Backend vẫn qua proxy web, không cần đổi MQTT/firmware. Domain thật: đặt HTTPS origin web, cấu hình SPA fallback `/trace/*` và proxy `/api` đến API. Module không tự deploy/cấu hình hạ tầng đó.

## API công khai

Thay TREE_CODE bằng mã backend sinh khi tạo cây, **không dùng trees.id**. Cả bốn route No Auth, không token trong URL:

| GET `/api/traceability/trees/TREE_CODE...` | Kết quả |
|---|---|
| không suffix | tree, zone, cooperative hoặc null, standard hiện tại, trace_url |
| `/cultivation?limit=20&offset=0` | Page phiên bản Locked của các chuỗi liên quan |
| `/harvests?limit=20&offset=0` | Page nội dung thu hoạch đã từng xác nhận |
| `/qr.svg` | SVG QR encode trace_url web |

Page `{items,total,limit,offset}`; default20/0, limit1..100, offset0..100000. Không arbitrary filter/farmer_id/status/zone_id. Tree code sai400, đúng định dạng nhưng không tồn tại404, query sai/field ngoài DTO400. Không POST/PATCH/DELETE public. Cây Dead/Removed vẫn đọc được. Các API quản lý giữ JWT/scope.

Metadata whitelist mọi cấp. Không trả các field farmer_id/owner_id/manager_id/zone_id/farm_id/tree_id/material_id/standard_id, địa chỉ/GPS, chứng nhận, ghi chú/reason, proposal, raw hash/contacts. tree_code và batch_code là mã public; biết mã/UUID không cấp quyền thao tác private. tree_code hiện có dạng DRN-UUID nên ẩn field id không biến mã cây thành secret.

Mỗi version có history_key (SHA-256 khóa nhóm public), version/latest_version, is_correction/is_latest, applies_to_tree/latest_applies_to_tree, target/latest_target, action_type, entered_at/locked_at và details. Target `{type:Tree|Zone,label:mã-cây|tên-Zone}`. Watering có duration_minutes/water_volume_l nullable; Spraying/Fertilizing có materials `{name,quantity,unit,standard_linked}`. Mọi bản giữ standard_snapshot `{code,name}`. Phân trang đếm phiên bản, không đếm chuỗi; metadata latest vẫn đúng khi trang cắt chuỗi.

Harvest chỉ season_name, harvest_date, fruit_count, total_weight_kg, batch_code, confirmation_state=Confirmed. Pending correction vẫn trả **nội dung được duyệt trước đó**; Draft/Pending lần đầu không trả. Không request/reviewer/editor fields.

## Demo thủ công, không scripts

1. Dùng các collection Auth/danh mục/Farm/Zones/Trees hiện có để tạo Farm Accepted, Zone và cây A/B. Copy JWT/UUID/tree_code bằng tay; không thay Postman riêng. Dữ liệu cũ dùng được nếu backend chưa restart.
2. Import collection QR mới, thay PASTE_TREE_CODE trong URL bằng code A. Request public No Auth. Metadata/QR đọc ngay; nhật ký/thu hoạch chưa đủ điều kiện có Page rỗng.
3. Dùng collection Cultivation tạo Watering cây A/duration_minutes5; đợi15 phút khóa. QR A hiện gốc. Tạo correction sang B/duration8; Pending: A vẫn chỉ gốc, B chưa có chuỗi đó. Đợi correction Locked: A/B đều có hai bản; A ghi rõ hiện tại áp dụng B, B đánh dấu bản mới nhất áp dụng B. Bấm target để sang QR cây kia. Pending tiếp theo không công khai.
4. Dùng collection Harvest tạo Draft A/gửi xác nhận; chủ là tác giả thì auto-confirm. Public hiện nội dung. Correction Pending tăng fruit_count: QR giữ số cũ. Duyệt bằng Manager nếu Farm thuộc HTX, Admin nếu độc lập; bấm “Tải lại thu hoạch” thấy số được duyệt mới. Không dùng Admin vượt rule HTX.
5. Web `/trees`/chi tiết cây: bấm “Truy xuất / mã QR”; public mở cả khi đăng xuất. Tải SVG/in/quét hoặc mở link. Lịch sử có nút tải lại/phân trang riêng. Dùng brand kit hiện có, không cần asset/logo mới.

## Source và kiểm thử

Module/config/controller/service/schema/types: `apps/api/src/traceability/`. Adapter nội bộ TreesService.getTraceRecordByCode, CultivationEventsService.lockedForTrace, TreeHarvestsService.confirmedForTrace lấy shared stores và clone/projection; không expose API quản lý bỏ guard. AppModule tái dùng harvestsModule/cultivationModule, UsersModule cung cấp shared HTX store.

Frontend: pages/Traceability.tsx/CSS và types/traceability.ts. App đặt trace ngoài AuthProvider/ProtectedLayout; publicApi không lấy JWT. UI giữ privacy, nhãn version/applicability và ngày nhập/ngày thu hoạch đúng nghĩa. Backend [node-qrcode](https://github.com/soldair/node-qrcode)1.5.4 tạo SVG; [jsQR](https://github.com/cozmo/jsQR)1.4.0 chỉ dev-test, độc lập giải mã ảnh QR browser để kiểm tra URL, không đưa decoder vào production bundle.

Từ root:

```powershell
npm run test --workspace @smart-durian/api
npm run lint --workspace @smart-durian/api
npm run typecheck --workspace @smart-durian/api
npm run build --workspace @smart-durian/api
npm run test --workspace @smart-durian/web
npm run lint --workspace @smart-durian/web
npm run typecheck --workspace @smart-durian/web
npm run build --workspace @smart-durian/web
npm run test:e2e --workspace @smart-durian/web
```

Browser dùng Edge local hoặc WEB_TEST_BROWSER trỏ Chromium, không tự tải browser. API207/207 (15 QR mới); web8/8 unit; browser29/29 (7 QR mới); lint/typecheck/build API+web đạt. Tests cô lập Nest/Vite/RAM/MQTT loopback, không `.env` thật/tin thật/business DB. traceability-browser.mjs kiểm tra anonymous/privacy/lineage/Pending harvest/QR decode-download/storedJWT/mobile-empty/network404. Artifacts ignored: apps/web/test-results/report.json, trace-desktop.png, trace-mobile.png.

Collection mới có15 request GET; đã parse JSON, kiểm tra không scripts/variables/body và đối chiếu mọi URL với OpenAPI runtime trong test module. Hai guide QR đã kiểm tra các link local tồn tại. Các collection riêng của người dùng không sửa hoặc stage.

Nếu npm shim Windows EPERM, chạy tools từ workspace: `node ../../node_modules/typescript/bin/tsc --noEmit`; API build thêm `-p tsconfig.build.json`, API test compile `--outDir .test-dist` rồi `node --test --test-concurrency=2 .test-dist/test`; lint `node ../../node_modules/eslint/bin/eslint.js src test integration` (web: src test vite.config.ts); web unit `node ../../node_modules/vitest/vitest.mjs run`, build `node ../../node_modules/vite/bin/vite.js build`, browser `node test/e2e.mjs`.

## Handoff và giới hạn

Session mới đọc AGENTS nếu có, git status/branch/log, MODULE_HANDOFF, IMPLEMENTATION_NOTES/PLAN, PROJECT_BUILD_SPEC, ERD hiện có, guide QR/source trước code. Nhánh kế thừa Cultivation local, không dùng main cũ làm mất module. Không triển khai trùng QR/Cultivation. Không reset/clean/stage-all; ERD/MQTT/Postman/UI riêng và `.env` ngoài commit. Không tự push/merge.

Nguồn nghiệp vụ vẫn RAM; restart mất tree_code/history/correction context. Chưa PostgreSQL/MongoDB persistence/migration/seed; chưa nghiệm thu hardware/camera điện thoại/domain thật. QR/SHA-256 không chứng nhận nguồn gốc hay blockchain. Còn AI_DISEASE_DIAGNOSTICS, CHATBOT_CONVERSATIONS, persistence, hardware acceptance và workflow ghi/control frontend cần đợt riêng. AI/chat cần chốt model/corpus/provider/business trước code.
