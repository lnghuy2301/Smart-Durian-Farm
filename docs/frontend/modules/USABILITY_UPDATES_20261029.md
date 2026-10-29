# Sáu điều chỉnh sử dụng — 29/10/2026

Nhánh API ảnh `feat/ai-diagnosis-history-delete`, tìm Farmer `feat/admin-harvest-farmer-picker`, giao diện `fix/web-usability-six-adjustments`. Giữ mọi thay đổi riêng đang có; không reset/stage workspace hoặc đổi dữ liệu vận hành.

## Kết quả theo yêu cầu

1. IoT: Pagination có tùy chọn hideSinglePage, chỉ bật ở màn IoT. Một trang đủ dữ liệu thì ẩn cả số đếm và nút Trước/Sau vô hiệu, không hiện1–6/6 hoặc1–2/2. Nhiều trang hoặc offset>0 vẫn giữ điều hướng để không mắc kẹt ở trang cũ. Bỏ đoạn chú thích số đo gần nhất bị lặp; timestamps, lần cập nhật và trạng thái kết nối vẫn hiển thị để nhận biết dữ liệu cũ.
2. Nhật ký: huy hiệu khóa có margin-inline-start8px, áp dụng trong danh sách/chi tiết/lineage, không đổi trạng thái hoặc thời hạn khóa.
3. Bộ lọc hiển thị ngắn **Do tôi ghi**, query mine=1 và quyền xem lịch sử giữ nguyên; đã tìm toàn source để bỏ nhãn cũ ở trường lọc này.
4. Farmer có nút Xóa ở từng dòng lịch sử ảnh, hộp xác nhận/hủy, xóa bản đang xem trở lại upload và cập nhật phân trang. API/ảnh riêng tư: [hướng dẫn](../../AI_DIAGNOSIS_HISTORY_DELETION.md). Xóa không chạy model hoặc gọi provider.
5. Admin tìm Farmer bằng tên/phone rồi chọn Farm/Zone đúng sở hữu hoặc phân công đang hiệu lực; giữ ngày/hạn/lý do. Bố cục tìm kiếm có wrap và grid ngày/vườn hai cột, mobile một cột. [API/quyền/kiểm thử](../../ADMIN_HARVEST_BACKDATE_PICKER.md).
6. Nút Thêm tiêu chuẩn/Thêm vật tư của Admin chuyển lên PageHeader cạnh Làm mới, bỏ nút cũ bên dưới để không trùng. Form/API tạo/sửa hiện có giữ nguyên; Farmer/Manager không được thêm. Thứ tự danh mục chung: Tiêu chuẩn trước, Vật tư sau, đồng nhất Farmer.

## Source và kiểm tra

- components/ui.tsx: tùy chọn Pagination, mặc định các màn khác không đổi.
- pages/Iot.tsx, Cultivation.tsx, JournalUsability.css: số đếm/ghi chú/nhãn/khoảng cách.
- Resources.tsx và components/navigation.ts: hành động Admin ở tiêu đề và thứ tự menu.
- workflows/HarvestBackdateEditor.tsx/CSS, pages/HarvestBackdates.tsx: luồng chọn Farmer và phạm vi.
- pages/ai/DiagnosisPage.tsx/DiagnosisHistory.css và API AiStore/AiService/controller: xóa lịch sử ảnh theo tác giả.
- Postman riêng [JSON nhập trực tiếp](../../postman/Usability-Updates-20261029.postman_collection.json), không sửa collection AI/Users/Twilio riêng đang có.

Tái lập: build backend rồi npm run dev:web/start:api như RUN_AND_FULL_ACCEPTANCE. Các browser fixture dùng RAM/providers giả, test DB dùng project sdf-persistence-test; không dùng broker/database/AI provider thật. Lệnh mới: node apps/web/test/harvest-backdate-browser.mjs (chạy trong apps/web: node test/harvest-backdate-browser.mjs), node test/ai-browser.mjs, node test/catalog-admin-browser.mjs. Compile integration trước khi chạy: node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.integration-dist.

Kiểm thủ công desktop/mobile: IoT đủ6 chỉ số không có pager thừa; có>10 số đo vẫn đổi trang được; nhãn ngắn không bị cắt; badge khóa cách ngày/nhãn bên cạnh8px; Admin có nút thêm ngay tiêu đề; xóa ảnh Hủy không mất dữ liệu, Xác nhận xóa khỏi danh sách/detail; đổi Farmer không giữ Zone cũ. Đổi quyền/phân công trong lúc form mở thì backend vẫn kiểm lại khi Lưu.

Giao diện AI và nhiều cải tiến trước đang là source riêng chưa commit chung; giữ nguyên trong workspace, cần review khi phát hành. Không đưa .env/token/ảnh hoặc dữ liệu người dùng vào Git. Không auto push/merge.

Kết quả: backend283/283, web34/34 unit,60/60 browser regression,13/13 AI browser,4/4 catalog browser,1/1 browser nhập bù (gồm320px/desktop thấp),2/2 PostgreSQL/Mongo targeted integration; lint/typecheck/build đạt. Một lượt chạy rộng ban đầu timeout compile khi chạy nhiều compiler và một lượt chờ hàng Manager; chạy lại tuần tự đạt60/60, không sửa production để bỏ qua ca đó. Test xóa ảnh hủy/xác nhận giữ đúng dữ liệu. Form nhập bù đã sửa overflow min-content trên320px. Bundle chính vẫn có cảnh báo>500kB, không tăng ngưỡng để che cảnh báo.
