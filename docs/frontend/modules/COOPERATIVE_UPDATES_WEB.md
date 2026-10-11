# HTX và xác minh cập nhật của Manager

Nhánh `feat/web-cooperative-workflows`, kế thừa năm module mới. `manage_HTX` hiện có cùng các màn list/detail/create/edit như mẫu HTX Admin trước; giữ các component hiện có, thêm luồng backend còn thiếu cho Manager thay vì tạo hai màn cùng chức năng.

Admin tạo/sửa trực tiếp `/cooperatives/new`, `/:id/edit`; danh sách/detail hiển thị đúng thông tin pháp lý, trạng thái đã/chưa gắn Manager và lifecycle cảnh báo7ngày/xét xóa30ngày. Không lấy director làm tên Manager: API chỉ trả manager_id, không có danh bạ Manager Active. Cảnh báo lifecycle và thông báo HTX vẫn do backend xử lý.

Manager đúng HTX dùng nút Yêu cầu cập nhật HTX tại detail để POST `/cooperatives/:id/update-requests`. Chỉ gửi cooperative_name/director/address/contact_number thực sự thay đổi; certificate_number không có ô sửa. Danh sách `/cooperative-updates` GET `/cooperative-update-requests`, phân trang20; detail GET `/:id`, hiển thị trạng thái và deadline server. Admin theo dõi, chỉ Manager tác giả xác minh.

EmailPending: POST `/:id/email/verify` `{otp}` hoặc `email/resend` `{}`. EmailVerified: POST `sms/send` `{}`. SmsPending: POST `sms/verify` `{otp}` hoặc gửi lại SMS. Mã6chữ số. Chỉ sau cả hai bước API áp dụng và trả Accepted, UI liên kết về hồ sơ HTX. PATCH `cancel` `{}` hủy ở bước phù hợp. UI không gọi `/test-sms` để lấy OTP; endpoint đó chỉ dùng bởi browser fixture mock.

Email10phút, sau verify email10phút để bắt đầu SMS, SMS5phút; không tự gia hạn ngoài response mới. Gửi lại có cooldown60s trên UI và rate limit backend. Lỗi OTP400 có thể nhập lại có chủ ý; lỗi0/409/5xx khóa thao tác cho đến khi người dùng Kiểm tra trạng thái. Backend vẫn kiểm tra phiên, tài khoản, phiên bản HTX và quyền sau await. Đăng nhập lại có thể đọc/tiếp tục request còn hạn; không lưu OTP vào storage.

Tái lập: dùng Manager đã được Admin gắn HTX, sửa tên; GET HTX vẫn cũ; nhận OTP email từ SMTP dev của bạn, verify, gửi SMS, nhập OTP điện thoại, kiểm tra Accepted và GET HTX mới. Browser suite dùng email capture và mock SMS, không gửi tin thật và không đọc .env. Với live SMS cần cấu hình HTX riêng theo [backend HTX](../../COOPERATIVES_IMPLEMENTATION.md), không dùng chung chứng cứ OTP reset password. Kiểm tra lỗi OTP, cooldown, hết hạn, cancel, đổi HTX trong lúc xác minh và desktop/mobile.

Phần đăng nhập/đăng ký, validation/auth token và OTP đăng ký/reset hiện có giữ nguyên. Mẫu HTX có số liệu/name demo không có trong API thì không bịa dữ liệu. Tài liệu tổng hợp mô tả nhánh, kiểm tra và tái lập toàn bộ giao diện mới.
