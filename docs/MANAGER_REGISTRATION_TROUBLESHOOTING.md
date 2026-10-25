# Đăng ký Manager: lỗi kết nối và tài khoản chờ duyệt

## Bản sửa25/10: form duyệt tự đóng và tải lại khi gia hạn phiên

Người dùng đã xác nhận đăng ký/gửi email hoạt động bình thường. Lỗi tiếp theo xảy ra khi Admin chọn HTX để duyệt Manager: giao diện tự thoát cửa sổ và có cảm giác lag. Đã tái hiện bằng browser cô lập: sau refresh JWT, phần tử dialog bị detach khỏi DOM dù request refresh trả200.

Nguyên nhân trong `apps/web/src/components/Shell.tsx`: `ProtectedLayout` gắn `key={auth.session.token}` cho Shell. Refresh theo hoạt động đổi JWT nên React unmount toàn bộ Shell/Outlet, mất state dialog và fetch lại trang. Sửa key theo `auth.session.user.id`; comment giải thích tại source. Token vẫn được cập nhật trong ApiClient hiện có. Logout/đổi tài khoản vẫn unmount/reset UI, backend tiếp tục xác thực token/version/scope như trước. Không thay rule idle15 phút hay tắt refresh để tránh lỗi. Bản sửa áp dụng chung cho các biểu mẫu trong Shell, không đổi giao diện hoặc dữ liệu nghiệp vụ.

Regression `apps/web/test/approval-refresh-browser.mjs` dùng Nest/RAM, email giả và clock JWT/browser; không đọc `.env`, không gửi OTP thật hay ghi database vận hành. Trước sửa fail do dialog detach. Sau sửa3 kiểm tra đạt: lựa chọn HTX giữ qua refresh; bước xác nhận giữ qua refresh lần hai, không tải lại hai danh sách; duyệt chỉ gửi1 PATCH và gắn đúng HTX/Manager Active. Test không dùng global Date.now giả của Playwright. Web unit21/21,56/56 browser regression; lint/typecheck/build đạt. Log local trong `apps/web/test-results/approval-refresh-*.txt` được ignore.

Tái lập từ root:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.integration-dist
cd apps/web
node test/approval-refresh-browser.mjs
```

Cần Edge trên Windows theo WEB_TEST_BROWSER hoặc đường dẫn mặc định trong test. Để nghiệm thu giao diện thật, tải lại trang một lần sau khi cập nhật source; vào Duyệt Manager, chọn HTX, tiếp tục thao tác/chờ qua ít nhất hai chu kỳ gia hạn khoảng15 giây. Dialog/lựa chọn/xác nhận phải giữ nguyên và chỉ đóng khi hủy, duyệt thành công hoặc phiên thực sự hết hạn/thu hồi. Không duyệt lại tài khoản đã xử lý chỉ để thử giao diện.

Cập nhật25/10/2026, nhánh `fix/manager-registration-email`, kế thừa `b203f8d`.

## Kết quả đối chiếu local

Ảnh Vite báo `ECONNRESET` ở `POST /api/auth/registration/email/request` lúc18:38:48. Tiến trình con của `node --watch dist/main.js` có thời điểm khởi động18:38:48, trong khi supervisor bắt đầu18:32:55. Đây là bằng chứng API đã khởi động lại trong khoảng yêu cầu; **chưa xác định tác nhân restart** vì chưa có log terminal API tại thời điểm lỗi. Không mặc định quy lỗi cho SMTP hoặc kết luận đã khắc phục triệt để.

Sau đó kiểm tra GET health qua API3000 và proxy5173 đều200; auth/me không có Bearer trả401. Kiểm tra SMTP kết nối/xác thực thành công, không gửi email. Đây chưa phải nghiệm thu gửi/nhận email thật. Đối chiếu PostgreSQL: số điện thoại/email trong ảnh chưa có tài khoản; không tạo tài khoản thay người dùng, không sửa verification hay dữ liệu hiện có. Không lưu thông tin liên hệ vào tài liệu này.

## Thay đổi kỹ thuật

- Web giải thích rõ HTTP502/504 thay cho thông báo máy chủ chung. Không tự retry POST gửi OTP/đăng ký: kết nối đứt có thể xảy ra sau khi provider/DB đã nhận, tự gửi lại có thể trùng hoặc dùng sai phiên xác minh.
- `start:api` ở root chạy bản đã build, không watch. `dev:api` vẫn phục vụ lập trình nhưng giữ output khi restart để lần sau có thể đối chiếu nguyên nhân.
- Không thay rule email thật, Manager Pending, Admin duyệt và gắn HTX; không thay port/provider/secrets, không gửi SMS/email/command thật trong kiểm thử.

## Chạy thử ổn định

1. Trong terminal API hiện tại, Ctrl+C để dừng `dev:api`. Không chạy hai API cùng port3000.
2. Từ root:

   ```powershell
   npm run build
   npm run start:api
   ```

   Web tiếp tục dùng `npm run dev:web`. Trong lúc xác minh email, không sửa source/build lại hoặc khởi động lại API. Phiên OTP/proof đang dở lưu RAM theo quyết định đã chốt; restart phải xác minh lại. Tài khoản đã tạo trong database vẫn được giữ.

3. Tab riêng/ẩn danh vào `/register`, chọn Quản lý HTX. Gửi mã, nhập mã email, xác minh, rồi bấm xác nhận đăng ký. Chỉ gửi mã hoặc chỉ xác minh email **chưa tạo tài khoản**. Phải thấy màn hình đăng ký thành công/chờ Admin duyệt.
4. Tab Admin đang đăng nhập vẫn hợp lệ độc lập; mở **Duyệt Manager**, bấm **Làm mới**, xóa bộ lọc tìm kiếm nếu có. Chỉ khi bước đăng ký trả201 mới có Pending Manager để duyệt.
5. Admin duyệt/gắn HTX; Manager Active mới đăng nhập được. Pending không có quyền quản trị. Để kiểm tra quyền, dùng tab ẩn danh hoặc đăng xuất trước khi đổi tài khoản; không suy ra role từ trang còn hiển thị trong tab cũ.
6. Nếu tái diễn, cần log terminal API cùng thời điểm lỗi (restart/exception), và status/response của request trong Network. Che OTP/JWT/mật khẩu/contact trước khi chia sẻ. Không reset DB hoặc bỏ xác minh để chữa lỗi kết nối.

## Kiểm thử

Từ apps/api: biên dịch ra `.test-dist`, chạy `email.test.js`, `users.test.js`, `registration-lease.test.js`:16/16 đạt. Bao gồm HTTP yêu cầu mã→xác minh→tạo Pending→Admin thấy danh sách→duyệt HTX; Farmer/Manager bị403 khi gọi API Admin, không token401; proof cũ không dùng lại sau dựng service mới. Provider giả, database/contacts thật không bị ghi.

Web `client.test.ts`:7/7, thêm regression proxy502 không body khi gửi email: hiển thị đúng lỗi, không tự gửi lần hai và không làm mất phiên Admin. Typecheck đạt. Hạn chế còn lại: cần log để xác định tác nhân restart và người dùng thử gửi email thật từ giao diện; chưa khẳng định lỗi gián đoạn không thể tái diễn.
