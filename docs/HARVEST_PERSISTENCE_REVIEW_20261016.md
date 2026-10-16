# Harvest persistence — điểm cần thống nhất trước code

Nhánh **feat/postgres-harvests-persistence** từ Tree **5aca62a**. Người dùng đã chốt **chặn correction đổi ngày sang hôm nay khi Tree Dead/Removed; vẫn sửa nội dung khi giữ nguyên ngày**, kiểm tra lúc gửi/prepare/approve. Đang triển khai adapter/migration010 và kiểm thử; không còn chờ câu trả lời. Tree đã đạt233 backend/131 DB/37 browser, migration009 Applied, dữ liệu demo/private sources giữ nguyên. AppModule chính vẫn RAM. Phần bên dưới lưu lại tình huống trước khi sửa.

## Trường hợp đã tái lập

1. Chủ tạo thu hoạch ngày hôm qua cho cây Active và submit → Confirmed.
2. Chủ đổi cây thành Dead.
3. Tạo thu hoạch mới ngày hôm nay bị400 như quy tắc đã chốt.
4. Chủ gửi correction cho bản Confirmed ở bước1, đổi harvest_date sang hôm nay và batch_code sang mã mới.
5. Admin duyệt ở Farm độc lập → thành công, bản chính Confirmed có harvest_date hôm nay dù cây hiện Dead. Luồng Manager trong HTX dùng cùng validation.

Fixture chạy trực tiếp trên RAM services hiện hành, không .env/provider/hardware hoặc database demo. Kết quả chỉ in cờ: `tree_status=Dead`, `new_create_today_blocked=true`, `confirmed_correction_to_today_applied=true`, `status=Confirmed`.

Source: TreeHarvestsService.correction/prepareCorrection/approve gọi validateDetails với checkTree=false; create/updateDraft dùng true. Guide TREE_HARVESTS_IMPLEMENTATION.md nói cây Dead/Removed chỉ tạo/sửa nháp ngày cũ và correction được giữ nguyên ngày đã lưu; workflow design nói không nhập ngày hiện tại. Chưa có test cho **correction đổi ngày sang hôm nay** trên cây Dead/Removed, nên đây là điểm cần xác nhận trước khi port sang PG, không tự hiểu toàn bộ correction là nhập mới hoặc tự nới quy tắc.

Câu hỏi đã gửi: chặn đổi harvest_date sang hôm nay khi cây hiện Dead/Removed, vẫn cho sửa nội dung nếu giữ nguyên ngày; hay cho correction đổi sang hôm nay khi được reviewer duyệt? Đề xuất là cách đầu, kiểm tra lúc gửi/prepare/approve và recheck trạng thái Tree khi áp dụng. Trường hợp cây Active khi đề xuất nhưng Dead trước approve cũng cần cùng kiểm tra. Giữ nguyên ngày hiện có vẫn sửa được quantity/weight/batch/season, kể cả ngày hiện có là hôm nay. Không suy mốc lịch sử đổi trạng thái Tree ngoài dữ liệu đã lưu.

## Phần kỹ thuật đã rà soát, chưa triển khai

HarvestRecords async port/wrapper phải chia sẻ TreeHarvestsService hiện tại. PG repository nhận chung Users/Farms/Zones/Assignments/Trees/pool; dùng domain-access cùng client/user-parent locks, không trộn PG HTTP với consumers RAM trong AppModule.

Một bảng business TREE_HARVESTS, metadata giữ version/ever_confirmed; workflows Confirm/Correct giữ snapshot/proposal/expected version. Pending Confirm chưa công khai; Pending Correct giữ nội dung đã duyệt trên bảng chính, QR dùng ever_confirmed. updated_by/updated_at chỉ ghi khi correction được duyệt, editor khác reviewer; first confirmation giữ null. Quyền nhập bù là record riêng trong technical.workflow_requests, bound user/Zone/ngày/expiry/revocation/Active Admin grantor, không diễn giải mọi Accepted request thành grant.

Mọi thao tác create/update/approve phải khóa batch cũ/mới theo thứ tự cố định trước validation/ghi; giữ UNIQUE(tree_id,harvest_date), batch nhiều cây cùng Zone/ngày và không UNIQUE(batch_code). Pending proposals không thay official batch/date trước approval. Không auto cộng số khi POST trùng; client sửa cộng dồn bản Draft đúng rule hiện tại.

Chỉ xóa Draft chưa từng Confirmed. Sau khi Confirm bị reject rồi Draft bị xóa, **lịch sử request vẫn đọc được** theo snapshot/tree còn tồn tại; không JOIN request chỉ qua live Harvest làm mất lịch sử. Approve/reject/prepare terminal request phải409 trước khi tìm live Harvest đã xóa. Snapshot/permissions/proposals/audit không được mất khi restart.

Phân công/owner/HTX/editor/requester/reviewer/Grantor Active phải recheck sau lock. Quyền nhập bù của editor chỉ kiểm tra khi ngày đổi sang quá hạn; sửa quantity/weight hoặc first confirmation không bắt xin lại vì thời gian trôi qua. Khi grant được revoke hoặc grantor bị Locked/đổi role, không tiếp tục coi grant hợp lệ. Các grantor cần khóa trước parent hoặc lấy lại context, không khóa thêm user sau Farm/Zone.

Tiếp sau Harvest: Device/Sensor/Actuator PG → telemetry/tasks/Cultivation Mongo → async guards/QR/shared database runtime → restart/frontend/hardware acceptance. Giữ tất cả quyết định khác, không hỏi lại seed/phone/station/duyệt đã chốt; không tự push/merge hoặc sửa nguồn riêng.
