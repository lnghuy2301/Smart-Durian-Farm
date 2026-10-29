# Admin tìm Farmer và chọn phạm vi nhập bù — 29/10/2026

Form Cấp quyền nhập bù đổi từ nhập UUID sang: tìm tên/số điện thoại → chọn Farmer → chọn vườn → khu vực → ngày/hạn sử dụng/lý do. Kết quả có tên và phone; UUID chỉ nằm trong body API. Đổi tìm kiếm/Farmer/vườn phải xóa lựa chọn phụ thuộc, không giữ Zone cũ.

API mới `GET /api/users/farmers?q=...`: chỉ Admin Active qua AuthGuard/AdminGuard, không cache, giới hạn30 yêu cầu/phút/Admin, tối đa20 Farmer Active và has_more. Tên tối thiểu2 ký tự/tối đa100, tìm có/không dấu không phân biệt hoa thường; điện thoại tối thiểu4 chữ số, hỗ trợ0/84/+84. Chỉ trả id/user_name/phone_number, không email/hash/OTP. Không mở directory toàn hệ thống cho Farmer/Manager. Dùng UserAccounts/store/PG pool đang có, không tạo store hoặc connection thứ hai.

Phạm vi chọn lấy từ các API Admin hiện có và phân trang đầy đủ: tất cả Zone thuộc Farm có owner_id trùng Farmer đã chọn, cộng Zone của phân công Accepted active của chính Farmer đó. Không dùng is_owner toàn cục để đoán quyền; người vừa có vườn vừa nhận việc thấy hợp hai phạm vi. Pending/ended/future assignments không cấp quyền hiện tại. Chỉ hiện Farm có Zone hợp lệ, không chọn Zone vườn khác. Lỗi/tải scope thì khóa Lưu và không đưa dữ liệu cũ sang Farmer mới.

POST harvest-backdate-permissions giữ nguyên user_id/zone_id/harvest_date/expires_at/reason. API kiểm lại Admin, Farmer và quyền làm việc hiện tại; grant không cấp thêm assignment hoặc bỏ kiểm quyền lúc nhập thu hoạch. Giờ local được đổi ISO khi gửi, ngày thu hoạch giữ date-only. Response không chắc chắn thì đối chiếu danh sách, không auto retry. Không migration/seed/đổi dữ liệu hiện có.

Kiểm thử: admin-farmer-search.test.ts kiểm HTTP role/format/no-store/whitelist; admin-farmer-search.integration.ts kiểm PostgreSQL tên Việt/phone và chuỗi có SQL syntax không mở rộng kết quả; harvest-backdate-scope.test.ts kiểm hợp owner/assignee; harvest-backdate-browser.mjs dùng Nest memory thật: tìm tên và phone, scope chủ/nhận việc, xóa selection cũ và POST grant thật. Không gọi DB vận hành hoặc external providers.

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d --pull never
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.integration-dist
node --test apps/api/.integration-dist/test/admin-farmer-search.test.js apps/api/.integration-dist/integration/admin-farmer-search.integration.js
cd apps/web
node test/harvest-backdate-browser.mjs
```
