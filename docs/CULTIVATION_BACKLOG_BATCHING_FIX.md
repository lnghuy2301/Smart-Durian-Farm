# Khóa backlog nhật ký trong transaction nhỏ hơn — 27/10/2026

Nhánh `fix/cultivation-backlog-batches`, kế thừa `33a6923` (Gemini). Phát hiện khi rà soát toàn dự án: full persistence311 có một subtest tải10.000 nhật ký thất bại tại `store.lockDue()` với MongoBulkWriteError, parent cũng bị đánh dấu thất bại; chạy riêng nhóm15/15 đạt. Không liên quan key/Gemini, không sửa dữ liệu vận hành để kiểm thử.

## Điều chỉnh

MongoCultivationStore đọc và xác minh snapshot đầy đủ trong cùng transaction trước khi khóa một phần backlog. Snapshot có thể chứa10.000 events và private contexts, đọc theo chunk100 để tránh getMore/CSOT. Lô512 replacements dùng chung ngân sách10 giây với toàn bộ bước đọc/xác minh; khi tải thay đổi có thể hết ngân sách trước khi commit.

Giảm số bản ghi khóa mỗi transaction từ512 xuống128, giữ nguyên timeout10 giây và maxCommitTime10 giây. Vẫn khóa prefix theo thứ tự cũ; event/context/hash/head/ledger revision commit nguyên tử từng lô. Vòng lặp tiếp tục đến khi không còn Pending đến hạn. Không đổi hạn15 phút, correction, phân quyền, giới hạn10.000, hash format hoặc immutable Locked; không bỏ hash verification, không xóa bớt dữ liệu và không retry uncertain commit ở lớp ứng dụng.

Đánh đổi: backlog lớn cần nhiều transaction/snapshot hơn. Đây là giảm kích thước mỗi lượt ghi, không đảm bảo độ trễ cố định trong mọi môi trường; chưa thay kiến trúc ledger hoặc thêm caching. Không migration/seed hoặc chỉnh Mongo server settings. Source có comment giải thích ngân sách transaction.

## Xác nhận

Chạy lại full persistence bằng fixture15432/27028, không chạy đồng thời browser hoặc API vận hành. Giữ nguyên bài test10.000, kiểm đủ số bản ghi Locked, hash-chain đúng, overflow429 và không eviction; không giảm fixture hoặc tăng timeout cho test. Các workflow race/correction/restart/backup cùng được kiểm tra lại.

Log ignored `apps/api/.integration-dist/gemini-backlog-fixed-persistence.txt`; thông tin driver chỉ thu trong preload chẩn đoán fixture ở backups, không thêm logger chứa nội dung nhật ký/credential vào production. Kết quả cuối ghi trong checkpoint handoff/Gemini guide sau khi chạy hoàn tất.

Kết quả cuối27/10: **311/311 full persistence đạt,23 nhóm,0 fail/skip**, tổng582 giây; bài10.000 giữ nguyên và đạt, riêng phần capacity khoảng283 giây. Đánh đổi thời gian backlog được chấp nhận để giữ transaction nhỏ, không mô tả đây là tăng throughput. Lint/build đạt; backend271/271, Python10/10, web24 unit +58 regression +10 AI +5 database browser đã đạt ở checkpoint Gemini trước thay đổi DB-only này. Không thêm key, migration hoặc thay dữ liệu vận hành trong nhánh sửa.
