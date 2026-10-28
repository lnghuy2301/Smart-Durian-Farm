# Nhật ký từ phiên điều khiển — 28/10/2026

Nhánh `feat/control-session-journal`. Người dùng chọn **gợi ý nhập nhật ký, xác nhận trước khi lưu**. Trước thay đổi này, tưới/phun chỉ tạo ACTUATOR_TASKS, không tự tạo CULTIVATION_EVENTS; đây là nguyên nhân không thấy nhật ký khi bật hardware.

## Sử dụng

1. Chủ vườn/Farmer Accepted đang có quyền điều khiển kết thúc công việc bằng Dừng, chờ đủ ACK. Tự quan sát tải thực tế.
2. Trong Tiến trình lệnh của lệnh Dừng, nhấn **Ghi nhật ký từ phiên này**. Có thể chọn lệnh Dừng cũ từ Lịch sử → Xem tiến trình.
3. Form điền Zone, loại tưới/phun, ghi chú tham chiếu số lệnh; tưới điền thời lượng ước tính từ ACK bật đến lần gửi OFF đầu tiên. Người dùng sửa theo thực tế. Phun cần chọn vật tư Active và lượng đã dùng; không đoán vật tư, lưu lượng hoặc liều.
4. Đánh dấu **Tôi đã kiểm tra và xác nhận công việc thực tế**, bấm Lưu. Tạo nhật ký Pending mới, sau15 phút Locked theo workflow cũ. Tác giả/thời điểm ghi do API sinh, không lấy thời gian lệnh làm created_at của nhật ký.
5. Admin/Manager không có nút ghi. Backend POST nhật ký vẫn kiểm lại quyền hiện hành, Zone/Tree, danh mục và phiên đăng nhập. Mất phân công không được ghi mới từ phiên cũ.

## Quy tắc và giới hạn

Chỉ gợi ý sau Stop Confirmed, có Watering/Spraying Confirmed ngay trước nó trong cùng Device theo command_id; Reset con không thành công việc. Failed/Pending, RecoveryStop, Stop liên tiếp hoặc lịch sử đã bị retention cắt mất không đủ dữ kiện thì đề nghị nhập tay. Không suy ra công việc từ một ACK, không tự tạo khi polling/reload/Start/Stop, không gửi thêm lệnh phần cứng.

ACK là CommandReceipt, không phải xác nhận trạng thái vật lý. Thời lượng dựa mốc lệnh chỉ ước tính; với phun, schema hiện không có field thời lượng nên chỉ ghi ước tính trong ghi chú và vẫn bắt buộc danh sách vật tư. Không tự lưu lượng nước hoặc hóa chất.

Dùng GET task/detail/history được phân quyền sẵn và POST cultivation-events hiện có; không thêm endpoint/bảng/migration/store. Form và POST dùng chung JournalEditor/API. Đối chiếu lịch sử có kiểm pagination thay đổi/Device mismatch. Ghi chú tham chiếu riêng tư không đưa lên QR.

Sau lưu, nút ở phiên đang mở báo đã lưu và dẫn tới nhật ký Zone. Chưa có constraint duy nhất nhật ký/task: nếu reload rồi chủ động ghi lại, API coi đó là nhật ký thủ công mới. Không gọi đây là cơ chế chống trùng bền vững. Khi mạng lỗi không chắc đã lưu, form giữ trạng thái đối chiếu; kiểm danh sách trước khi thử lại. Không tự retry.

## Tái lập kiểm thử

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.integration-dist
cd apps/web
node ../../node_modules/vitest/vitest.mjs run
node test/control-journal-browser.mjs
```

Unit kiểm Start→Stop đúng Device/order, tưới30 phút, phun không tự điền vật tư, Failed/Pending/Recovery/Stop lặp bị từ chối, khoảng thời gian sai để nhập tay. Browser fixture Nest memory thật + fake task journal + Vite/Edge: không tự tạo event khi mở form, điền30 phút, xác nhận và lưu đúng Zone/Pending. Không dùng .env/DB/hardware/AI provider thật. Web30/30 unit, browser mới1/1, typecheck/lint/build đạt. Bundle chính còn cảnh báo lớn hơn500kB; không thay ngưỡng để che cảnh báo.
