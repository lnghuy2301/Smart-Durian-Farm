# Thu hoạch trên web

Nhánh `feat/web-harvest-management`. Mẫu `manage_harvest/code.html`, `screen.png`; tích hợp vào danh sách/detail `/tree-harvests`, phiếu `/requests?kind=harvest` và `/harvest-backdates`.

| Thao tác | API và quyền |
| --- | --- |
| Ghi nhận nháp | POST `/tree-harvests`, chủ Farmer hoặc Farmer đang phân công; chọn Tree được đọc |
| Sửa / xóa Draft | PATCH / DELETE `/:id`, tác giả hoặc chủ đang có quyền ghi |
| Gửi xác nhận | PATCH `/:id/submit`, chỉ tác giả; tác giả là chủ thì Confirmed ngay; assignee cần chủ duyệt |
| Yêu cầu sửa Confirmed | POST `/:id/correction-requests`, `{reason, changes?}`; tác giả hết phân công chỉ gửi reason |
| Chuẩn bị thay đổi | PATCH `/harvest-requests/:id/changes`, chủ/người yêu cầu còn quyền ghi |
| Duyệt / từ chối | PATCH `/harvest-requests/:id/approve\|reject`; xác nhận lần đầu do chủ; sửa do Manager hiện tại hoặc Admin khi vườn độc lập |
| Nhập bù | GET/POST `/harvest-backdate-permissions`, PATCH `/:id/revoke`; cấp/thu hồi Admin |

Không có chỉnh trực tiếp hồ sơ Confirmed. Chỉ gửi field thực sự thay đổi khi sửa. Payload không nhận status, updated_by, created_by hoặc tree_id trong PATCH. Ngày thu hoạch là ngày lịch Việt Nam YYYY-MM-DD, không đổi thành UTC timestamp. Ngày hết quyền nhập bù là ISO có timezone.

Backend kiểm tra một Tree/ngày; batch_code chỉ chung trong một Zone/ngày; số quả nguyên 1–2147483647; kg 0.01–99999.99 tối đa hai chữ số thập phân. Nhập bù trong 7 ngày lịch Việt Nam hoặc cần quyền đúng người/Zone/ngày còn hạn; cây Dead/Removed chỉ nhập ngày cũ. Không tự giả định batch_code unique toàn hệ thống hoặc Confirmed tương đương khóa/hash nhật ký.

Tái lập: chủ hoặc assignee tạo Draft; tác giả gửi; nếu assignee, chủ dùng phiếu Confirm để duyệt. Tạo Correct cho Confirmed, kiểm tra dữ liệu chưa đổi; Manager đúng HTX hoặc Admin độc lập duyệt; GET phải trả updated_by/updated_at từ người sửa thực tế. Kết thúc phân công tác giả, thử yêu cầu reason-only; chủ bổ sung bằng nút Chuẩn bị nội dung đính chính. Thử đổi HTX/owner hoặc sửa bản ghi trong lúc Pending để xác nhận API chặn phiếu lỗi thời. Thử nhập quá 7 ngày rồi Admin cấp quyền đúng phạm vi. Kiểm tra dialog ở viewport thấp/mobile và lỗi mạng gửi kép.

Danh sách lọc mùa vụ/mã lô, Zone, Tree, trạng thái bằng API trước phân trang. Mẫu có bộ lọc thời gian chưa có DTO tương ứng nên không giả gửi query không hỗ trợ. Dữ liệu runtime AppModule vẫn RAM; chạy kiểm thử cô lập bằng `npm run test:web:e2e`. Báo cáo toàn bộ module ghi tại tài liệu triển khai mẫu mới.
