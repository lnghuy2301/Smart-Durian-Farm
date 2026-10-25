# Thông tin nghiệp vụ dễ đọc trên giao diện

Cập nhật25/10 — `fix/show-assigned-cooperative-manager`: cột Người quản lý tại tổng quan Admin và danh sách HTX hiển thị tên theo manager_id thông qua RecordReference/nguồn `cooperatives` đã phân quyền, thay nhãn chung Đã có Manager. Người đại diện (`director`) độc lập với tài khoản Manager; duyệt/gắn Manager không tự ghi đè director. Dữ liệu liên kết đã lưu đúng không cần seed/duyệt lại. Không thêm directory công khai hoặc đổi API/schema; fallback khi không phân giải được tên theo quy ước dưới đây. Browser `approval-refresh-browser.mjs`5/5 (thêm kiểm tra hai bảng sau duyệt), web unit21/21, lint/typecheck/build đạt. Không ghi dữ liệu vận hành hoặc gửi OTP thật trong kiểm thử.

Nhánh `feat/web-readable-business-information`, kế thừa `4091de9`. Đợt này thay cách trình bày dữ liệu; không sửa dữ liệu vận hành, schema, quyền duyệt hoặc MQTT.

## Quy ước hiển thị

- Dùng tiếng Việt cho tên trường và enum: Người tạo, Người cập nhật, Thời điểm tạo, Hợp tác xã, Cây, Bản nháp, Đã xác nhận, vai trò và loại cảm biến/chức năng bơm van.
- Thời điểm ISO hiển thị theo `Asia/Ho_Chi_Minh`, giờ 24 giờ. Ví dụ `2026-10-05T02:00:06.000Z` thành `09:00 5/10/2026` theo bố cục của Intl. Ngày lịch `2026-10-05` thành `05/10/2026`, không cộng/trừ múi giờ. Ngày không hợp lệ không làm crash màn hình.
- Người dùng hiển thị tên; HTX hiển thị tên HTX; cây hiển thị mã cây; khu vực hiển thị tên; vườn hiện chưa có trường tên nên dùng địa chỉ; thiết bị dùng station_id. Giữ ID bản ghi, mã lô, mã cây, station_id, mã stream/điều khiển để tra cứu.
- Di chuột lên tên đã phân giải để xem ID tham chiếu. Tên là dữ liệu hiện tại, không phải bản sao tên tại thời điểm lập hồ sơ. Nội dung snapshot trước/sau vẫn lấy nguyên từ API, không thay thế bằng hồ sơ hiện tại.
- Khi không tìm được tên hoặc không còn quyền đọc tài nguyên liên quan, giữ mã tham chiếu. Không tự bịa tên, không mở rộng quyền để lấy tên. Lỗi tải tên không làm mất nội dung hoặc thao tác của hồ sơ.
- Số dùng định dạng tiếng Việt, ví dụ `89.3` hiển thị `89,3`. Không dịch mã lô, ghi chú hoặc tên người chỉ vì nội dung trùng từ enum.
- Hồ sơ đơn có hai cột Thông tin / Giá trị ghi nhận. Chỉ so sánh đề xuất với snapshot mới có cột Trước thay đổi / Đề xuất. Nhãn HTX theo ngữ cảnh: gia nhập HTX hoặc HTX liên quan, không gọi HTX phụ trách duyệt thu hoạch là HTX được đề xuất.

## Phạm vi giao diện

Lớp hiển thị dùng chung áp dụng bảng so sánh phiếu duyệt Farm/Zone/phân công/Tree/Harvest/Device/Sensor/Actuator và lịch sử metadata. Bổ sung tên tại phân công, quyền nhập bù, người quản lý HTX, chủ vườn, người tạo/cập nhật thu hoạch, đối tượng/tác giả canh tác và các liên kết chi tiết. Ngày thu hoạch tại danh sách, dashboard và quyền nhập bù cũng được định dạng. Thanh điều hướng/tài khoản dùng vai trò tiếng Việt; giám sát IoT dùng “luồng”, “gói tin”. QR giữ nguyên whitelist công khai, không nối dữ liệu tên người từ API có đăng nhập vào QR.

## API bổ sung cho tên tham chiếu

`GET /api/display-references/{kind}/{id}`, Bearer JWT. Không nhận danh sách user UUID tùy ý.

`kind` gồm `farms`, `zones`, `trees`, `devices`, `sensors`, `actuators`, `tree-harvests`, `zone-assignments`, `cultivation-events`, `cooperatives`, `harvest-backdate-permissions` và tám loại `farm/zone/tree/device/sensor/actuator/harvest/assignment-requests`. ID là UUID v4; riêng Cultivation là ObjectId 24 ký tự.

Ví dụ phản hồi (giá trị minh họa):

```json
{"labels":{"uuid-nguoi-tao":"Nguyễn Văn An","uuid-cay":"DRN-macaydangco"}}
```

Luôn gọi `get/getRequest` đã phân quyền của cùng repository trước khi tra tên. Quyền nhập bù chỉ tìm trong danh sách được phép xem. Chỉ tra các khóa tham chiếu cố định lấy từ hồ sơ đó, tối đa 50 tham chiếu/độ sâu 5; quan hệ khác kiểm tra quyền bằng port `get` hiện có. Account trả đúng `user_name`, không trả phone/email/password/token version. Không có `/users/{id}` tra tên toàn hệ thống; kind không hỗ trợ hoặc ID sai trả 400; thiếu JWT trả 401; hồ sơ ngoài quyền giữ lỗi 403/404 của domain.

Wiring memory dùng lại chính dynamic modules đã tạo; database dùng ports từ PersistenceRuntimeModule. Không thêm store/cache authority, pool hoặc migration. Frontend không cache thư mục tên toàn cục/localStorage; request hủy khi unmount và key dữ liệu gồm tài khoản + đường dẫn.

## Source và tái lập

- `apps/web/src/components/presentation.ts`: nhãn, ngày/giờ, số và giá trị lồng nhau.
- `apps/web/src/components/ReadableValue.tsx`: scope tên theo phiên đăng nhập/hồ sơ; tooltip ID.
- `apps/web/src/workflows/shared.tsx`: Diff và lịch sử dùng chung.
- `apps/api/src/display/display.controller.ts`: API đọc tham chiếu trong phạm vi.
- `apps/api/test/display-references.test.ts`, `apps/web/test/presentation.test.ts`, phần xác nhận thu hoạch trong `apps/web/test/workflows-browser.mjs`.

Khởi động lại API và web sau khi chuyển branch vì có controller mới. Không seed/migrate lại, không cần điền biến `.env` mới.

```powershell
# Từ thư mục gốc, hoặc dùng npm scripts tương ứng
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.integration-dist
node --test apps/api/.integration-dist/test/display-references.test.js
cd apps/web
node ../../node_modules/vitest/vitest.mjs run
node test/e2e.mjs
```

Kiểm thử thủ công lần lượt Admin/Manager/chủ vườn/Farmer nhận việc: mở phiếu thu hoạch như ảnh phản hồi, kiểm tra Người tạo là tên, Cây là mã cây, giờ theo Việt Nam, trạng thái tiếng Việt, mã lô/ID giữ nguyên; mở đề xuất sửa để kiểm tra trước/sau; kiểm tra tên HTX, phân công và lịch sử. Sau khi kết thúc phân công, kiểm tra quyền đọc cũ vẫn bị thu hồi theo API. Không lấy tên từ tài khoản khác khi không được xem nguồn.

Đã kiểm tra: 249/249 backend, 18/18 web unit; API/web lint, typecheck/build đạt. Database browser có 5/5 checks, bao gồm tra tên qua port PostgreSQL, chặn Farmer ngoài phạm vi, restart, MQTT TCP cô lập và QR không lộ thông tin riêng. Browser memory 54/54 checks, gồm xác nhận thu hoạch kiểm tra tên tác giả/mã cây/không còn tên cột và giờ ISO thô; ảnh `apps/web/test-results/readable-harvest-request.png`. Kiểm thử bổ sung giữ nguyên mã lô dù trùng giá trị tham chiếu và không phân nhóm số trong mã điều khiển. Không dùng MQTT/OTP thật hoặc sửa DB vận hành để chạy các tests này.
