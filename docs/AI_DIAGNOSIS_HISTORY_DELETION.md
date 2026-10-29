# Xóa lịch sử kiểm tra ảnh — 29/10/2026

Farmer được xóa từng lần chẩn đoán của chính mình, tương tự xóa hội thoại. Lịch sử ảnh có nút Xóa và hộp xác nhận. Nếu xóa bản đang xem, trở lại màn nhập ảnh; nếu xóa dòng cuối trang thì lùi trang. Không xóa tự động hoặc gửi lại model.

API mới: `DELETE /api/ai/diagnoses/:id`, JWT Farmer, không body. Trả `{deleted:true,image_cleanup_pending:false}` khi xóa bản ghi và ảnh thành công. Chỉ filter `_id + farmer_id`, không cho Farmer khác/Admin/Manager xóa thay. ID không tồn tại/đã xóa trả404; vai trò sai403. Ảnh/detail/feedback sau xóa không truy cập được, feedback không upsert tái tạo record.

Store RAM và Mongo dùng chung AiStore port hiện có, không schema/migration/connection mới. Xóa record trước rồi unlink đúng filename được sinh từ ID bản ghi; không nhận đường dẫn từ client, không recursive delete. Thiếu file coi là đã dọn; lỗi filesystem khác trả `image_cleanup_pending:true` để báo cần dọn ảnh orphan khi bảo trì, không phục hồi record hoặc lộ filename/path. Backup cũ có thể còn bản sao, không xóa backup vận hành.

HTTP fixture kiểm quyền4 vai trò, bản ghi/ảnh trước và sau xóa, feedback/DELETE lại sau xóa. Không dùng dữ liệu/provider thật. Tái lập: `npm test --workspace @smart-durian/api`, hoặc compile tests rồi `node --test apps/api/.test-dist/test/ai.test.js`. Browser AI kiểm nút/hủy/xác nhận và bản đang xem; source giao diện AI riêng đang trong workspace được giữ nguyên cùng các sửa đổi khác.
