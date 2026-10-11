# Vườn, khu vực và phân công trên web

Nhánh `feat/web-farms-zones`, kế thừa `feat/web-workflow-foundation`. Mẫu: `../references/stitch_smart_durian_farmer_dashboard/manage_farm and zone/code.html` và `screen.png`. Giao diện dùng brand kit chính thức, bảng có cuộn ngang riêng, biểu mẫu trong dialog có cuộn dọc; không đưa thanh chuyển kịch bản hoặc dữ liệu mẫu vào sản phẩm.

## Đường dẫn và API

| Web | API / hành vi |
| --- | --- |
| `/farms`, `/farms/:id` | GET danh sách/chi tiết; POST `/farms/requests`, `/farms/:id/update-requests` |
| `/farms/:id/membership` | POST `join-requests` với `cooperative_id` hoặc `leave-requests` với `{}` |
| `/zones`, `/zones/:id` | GET; chủ Farmer POST/PATCH trực tiếp; Admin POST `/zones/requests` hoặc `/:id/update-requests` |
| `/requests?kind=farm\|zone\|assignment` | GET danh sách và chi tiết, PATCH `approve`/`reject` |
| `/assignments?zone_id=…` | GET `/zone-assignments`; POST `/zones/:id/assignment-requests`; PATCH `/:id/end` hoặc Admin POST `/:id/end-requests` |
| `/farm-notifications` | GET `/farm-notifications`, chỉ dành Manager trong điều hướng |

Danh sách phân trang 20, offset 0–100000. Bộ chọn quan hệ lấy đủ các trang 100 mục trong phạm vi API, kiểm tra total và mục trùng để không âm thầm bỏ sót. Không nhận `farm_name`, không tự quy đổi diện tích sang ha khi contract chưa xác định đơn vị. Không sửa `owner_id`, `farm_id` hoặc quyền trong PATCH.

## Quyền và trạng thái

Farmer chỉ sửa vườn của mình; quyền dựa trên `farm.owner_id`, không dựa trên `is_owner` để mở toàn hệ thống. Tạo/sửa vườn luôn là đề xuất. Admin đề xuất khu vực, chủ vườn ghi khu vực trực tiếp. Người được phân công và Manager chỉ đọc khu vực. Gia nhập cần HTX có Manager và chữ ký theo `required_approvals`. Rời HTX cần các bên liên quan đồng ý rồi mới phát thông báo. Manager đọc snapshot của phiếu gia nhập trước khi có quyền đọc vườn chính thức.

Phân công là lời mời; người nhận chấp nhận, thêm chữ ký chủ nếu Admin đề xuất. Chủ kết thúc trực tiếp, Admin đề xuất kết thúc. Một khu vực không có khoảng phân công chồng lấn. Backend quyết định thời hạn và quyền đính chính sau khi kết thúc.

Không có API danh sách Farmer ở checkpoint triển khai: người dùng xác nhận giữ nhập mã tài khoản tạm thời. Các thao tác yêu cầu tài khoản khác nhận mã UUID v4, có nhãn rõ và backend kiểm tra Farmer Active. Farmer mở tên tài khoản trên sidebar → `/account` để chọn/sao chép mã của mình. Không giả danh sách người dùng hoặc đoán tên từ UUID.

## Tái lập và kiểm tra

Chạy API và web theo [README web](../../../apps/web/README.md). Tạo Farmer, dùng chính Farmer gửi đề xuất vườn, Admin vào Phiếu đề xuất → Vườn để chấp nhận. Farmer vào chi tiết vườn và Khu vực để tạo Zone với tiêu chuẩn Active. Admin gửi đề xuất cập nhật Zone, chủ Farmer so sánh và duyệt. Đối chiếu kết quả GET sau mỗi thao tác; vườn phải chưa đổi khi chữ ký còn thiếu.

Thử Farmer nhận phân công vào chi tiết Zone: không được có nút sửa metadata. Mời Farmer thứ hai bằng mã tài khoản; người đó vào Phiếu đề xuất → Phân công để chấp nhận. Thử lời mời chồng lấn và đề xuất lỗi thời: API trả lỗi, không tự thử lại. Kiểm tra desktop, màn hình thấp và mobile 390px; bảng cuộn trong panel, dialog không cắt nút.

Mutation chỉ chạy khi submit/xác nhận, chặn gửi kép, hủy request khi rời trang hoặc đổi phiên. Lỗi kết nối/409/5xx ở biểu mẫu yêu cầu đóng và tải lại trạng thái trước khi gửi lại. Luồng phê duyệt cũng yêu cầu tải lại khi lỗi, không suy đoán đã thành công. API là nguồn quyết định cuối cùng.

Dữ liệu AppModule hiện vẫn là RAM; frontend không chạy migrate/seed và không thay đổi cấu hình persistence. Kiểm thử tổng hợp và báo cáo browser được ghi trong tài liệu triển khai các mẫu mới sau khi hoàn tất toàn bộ module.
