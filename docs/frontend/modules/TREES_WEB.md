# Quản lý cây sầu riêng

Nhánh `feat/web-tree-management`, kế thừa module vườn/khu vực. Mẫu `manage_tree/code.html` và `screen.png` được chuyển thành `/trees`, `/trees/:id` và `/requests?kind=tree` trong shell chung.

Chủ Farmer tạo cây bằng POST `/trees` và chỉnh sửa bằng PATCH `/trees/:id`; Admin dùng POST `/trees/requests` hoặc `/:id/update-requests`. Chỉ chủ Farmer của vườn chứa Zone được duyệt đề xuất Admin. Manager và Farmer nhận phân công có bảng, bộ lọc, hồ sơ, lịch sử và truy xuất; không có nút sửa metadata.

Bộ chọn Zone lấy dữ liệu có quyền đọc; khi ghi trực tiếp chỉ giữ Zone thuộc vườn của Farmer hiện tại. Backend sinh `id/tree_code`, không có ô nhập mã cây, không cho đổi Zone, không xóa cây. Trạng thái Active/Dead/Removed và lịch sử được giữ. Ngày trồng dùng datetime-local rồi chuyển thành ISO có timezone; chỉnh field khác không làm mất giây trong ngày trồng cũ.

Bảng có bộ lọc Zone, trạng thái và tìm theo giống/mã, GET trước phân trang 20. Detail liên kết `/trees/:id/history`, thu hoạch theo cây và trang công khai `/trace/:treeCode` phục vụ QR thật từ API. Trang công khai vẫn nằm ngoài session. Không tải ảnh ngoài, không thêm thư viện.

Tái lập: sau khi có vườn/Zone được duyệt, chủ thêm cây; kiểm tra DRN do server sinh; Admin đề xuất đổi giống; chủ vào Phiếu đề xuất → Cây để đối chiếu snapshot/thay đổi rồi chấp nhận. Thử chỉnh trực tiếp trong khi phiếu còn Pending: phiếu cũ phải trả 409 khi duyệt và UI yêu cầu kiểm tra lại. Thử Manager/assignee: không thấy nút sửa. Trên mobile bảng chỉ cuộn ngang bên trong panel, dialog có thể cuộn dọc. Lint/typecheck/build và kiểm thử API thật được tổng hợp trong tài liệu triển khai các mẫu mới.
