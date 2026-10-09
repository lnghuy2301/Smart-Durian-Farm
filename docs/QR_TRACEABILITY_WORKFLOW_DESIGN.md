# QR traceability — phạm vi đã chốt và quyết định còn chờ

Ngày 2026-10-09. Nhánh **feat/qr-traceability** từ **feat/cultivation-events @3ee921b**, kế thừa main647e6ad và Cultivation đã kiểm thử. Đây là thiết kế chuẩn bị, **chưa có API/trang QR runtime**. Không tạo bảng QR, không MongoDB/PostgreSQL persistence, không sửa ERD riêng.

## Quyết định người dùng đã chốt

1. Trang `/trace/{tree_code}` công khai, ai quét cũng xem được, không cần đăng nhập.
2. Dữ liệu công khai: mã cây, giống/ngày trồng/trạng thái cây, tên Zone/HTX, tiêu chuẩn đang gắn, hoạt động canh tác/vật tư/lượng dùng và thu hoạch đã xác nhận. Thông tin cá nhân Farmer, địa chỉ/GPS Farm, số giấy chứng nhận, UUID nội bộ và ghi chú tự do giữ riêng. IoT chưa đưa lên QR đợt đầu.
3. Cultivation **hiển thị cả gốc và các correction**, không chỉ một bản mới nhất. Mốc Locked vẫn là điều kiện công khai; Pending không được công khai. Correction reason là văn bản tự do nên không tự đưa lên QR khi người dùng đã chọn ẩn ghi chú tự do.
4. Thu hoạch từng Confirmed đang Pending chờ sửa: tiếp tục hiển thị nội dung đã xác nhận cũ, chưa công khai proposed_changes. Draft/Pending chưa từng Confirmed không hiển thị.

Tiêu chuẩn đang gắn chỉ mô tả cấu hình hiện tại, không tự tuyên bố Farm đã được chứng nhận. Cultivation dùng snapshot vật tư/tiêu chuẩn đã lưu; đổi danh mục không thay nội dung lịch sử.

## Quyết định target của correction còn chờ

Ví dụ gốc ghi cây A, correction Locked sửa thành B. Người dùng đã chọn xem toàn bộ lịch sử nhưng chưa chọn cách áp dụng yêu cầu đó trên QR từng cây. Câu hỏi bổ sung đã gửi:

- **Phương án đề xuất:** QR A và B đều hiện chuỗi gốc + các correction Locked khi chuỗi từng có bản áp dụng cho cây/Zone đó. Mỗi phiên bản ghi rõ target cây/Zone, đâu là bản mới nhất, có còn áp dụng cho cây đang xem không. QR A ghi rõ nội dung hiện tại đã chuyển sang B; lịch sử gốc không được diễn giải là công việc hiện có của A.
- **Phương án còn lại:** QR mỗi cây chỉ hiện các phiên bản có target khớp chính cây hoặc toàn Zone của cây. Phiên bản target khác không xuất hiện trong QR đó.

**Chờ người dùng chọn trước khi viết code.** Không suy phương án mặc định hoặc coi thời gian chờ là đồng ý. Khi có trả lời, cập nhật mục này thành quy tắc đã chốt rồi triển khai.

## Đối chiếu source và hướng kỹ thuật

- Trees dùng tree_code bất biến `DRN-UUID`, khác id UUID. getByCode hiện yêu cầu JWT; API công khai cần lookup nội bộ riêng và response whitelist, không gỡ guard khỏi endpoint quản lý hiện có.
- Cultivation gốc/correction có root_event_id/reference_event_id, cùng Zone nhưng được đổi target Tree/Zone và action_type. Phải xét lineage và nhãn áp dụng theo quyết định bổ sung; không lọc target trước rồi vô tình đánh dấu một phiên bản cũ là mới nhất.
- Cultivation Pending không public. Lazy lock catch-up vẫn cần hoạt động khi xem trace; không thêm force-lock, không kéo dài deadline hoặc thay rule correction.
- Harvest giữ records và metadata everConfirmed trong cùng instance service. Khi yêu cầu sửa, records giữ nguyên dữ liệu đã xác nhận và chuyển status Pending; proposed_changes nằm trong request. Public projection phải phân biệt Pending sửa với Pending xác nhận lần đầu, không lọc status Confirmed đơn thuần và không serialize raw requests.
- Zone/Farm/HTX/Standards/Trees/Cultivation/Harvest phải dùng đúng dynamic-module instances từ AppModule. Không tạo store mới hoặc gọi forMock lặp lại.
- Public response phải chọn field tường minh, kể cả nested materials/snapshots/warnings. Không trả farmer_id/material_id/standard_id/zone_id/farm_id/tree_id/created_by/updated_by từ raw record; warnings cần thông tin hiển thị không chứa UUID.
- Thu hoạch dùng harvest_date là ngày thực tế; Cultivation hiện chỉ có created_at là thời điểm nhập hệ thống. Giao diện phải ghi đúng nhãn, không gọi created_at là ngày thực hiện.
- Không dùng ACK hoặc hash RAM để tuyên bố công việc thực tế/chuỗi nguồn gốc đã được chứng nhận. Verify toàn Zone hiện yêu cầu JWT và quyền Zone; không tự công khai toàn chain/raw documents.
- QR dẫn đến URL trang web, không dùng JWT hay secret trong URL. Base URL cấu hình cho demo/domain thật cần hướng dẫn đầy đủ khi triển khai; chưa thêm biến vào .env trong bước chuẩn bị này.
- Trang public phải hoạt động ngoài ProtectedLayout và không gửi JWT; giữ thiết kế/brand hiện có. Không cần asset/logo mới nếu assets/brand hiện tại đáp ứng.

## Kiểm thử dự kiến

API public không JWT; tree_code sai/không tồn tại; whitelist sâu và không lộ ghi chú/reason/UUID/contacts/address/GPS; Farm độc lập/HTX; trạng thái cây và dữ liệu rỗng; công việc toàn Zone so với một Tree; gốc/correction Locked, Pending ẩn, đổi target/action và phân biệt phiên bản áp dụng; thu hoạch Confirmed/Pending correction/Pending first confirmation/Draft và nội dung chỉ đổi sau duyệt; pagination/limits và shared stores; URL QR hợp lệ/quét lại được; trang public loading/error/empty/mobile và phiên có JWT không gửi credential lên public API.

Baseline **192/192 API tests + lint/typecheck/build**, web **8 unit/22 browser + typecheck/build** là kết quả đợt Cultivation; chưa chạy lại trong lượt chuẩn bị chỉ đọc source/ghi tài liệu. Khi hoàn tất module phải thêm kiểm thử, Postman nhập JSON/copy tree_code bằng tay và guide tái lập thực tế.

## Tiếp tục session

Đọc AGENTS nếu có, kiểm tra git status/branch/log, MODULE_HANDOFF, PROJECT_BUILD_SPEC, guide này và source liên quan. Nhánh QR kế thừa Cultivation local chưa push; không bắt đầu từ local main cũ làm mất module. Chốt câu hỏi target còn chờ trước code. Giữ .env và các file ERD/MQTT/Postman/UI riêng, không restore file người dùng xóa hoặc stage-all/reset/clean. Không tự push/merge. Hai collection AI_DISEASE_DIAGNOSTICS/CHATBOT_CONVERSATIONS, persistence và nghiệm thu ESP32 vẫn là các đợt riêng.
