# Tiến độ hiện hành — 28/10/2026

Các checkpoint cũ đã được hợp nhất. Nguồn đầy đủ: [đặc tả](PROJECT_BUILD_SPEC.md), [kế hoạch](IMPLEMENTATION_PLAN.md), [chạy/nghiệm thu](RUN_AND_FULL_ACCEPTANCE.md). Không lấy số liệu hoặc mô tả “chưa có AI/persistence” của guide triển khai cũ làm backlog hiện tại.

| Phần | Đã có | Còn phải xác nhận |
| --- | --- | --- |
| Tài khoản/HTX | Farmer, Manager, Admin; email/SMS, duyệt/gắn HTX, cập nhật HTX hai bước | Nghiệm thu đầy đủ từng vai trò, OTP lỗi/hết hạn và phiên đăng nhập |
| Nghiệp vụ sản xuất | Farm/Zone, phân công Accepted, Tree, Harvest, vật tư/tiêu chuẩn/bridge và approvals/correction | Kiểm chéo scope/đề xuất đồng thời trên dữ liệu thực |
| Persistence |13 bảng PG nghiệp vụ + bảng kỹ thuật; Mongo telemetry/tasks/cultivation/AI;18 migrations, backup AI assets và restore-check | Vận hành/backup định kỳ ở môi trường triển khai |
| IoT | MQTT FINAL,6 streams, latest/history, Active/presence; Reset/Start/Stop/recovery/receipt | Chốt bằng chứng end-to-end hardware thật, mất mạng/ACK/restart |
| Nhật ký/QR | Pending15 phút, correction/context/hash-chain, QR whitelist và đầy đủ lineage | Người dùng kiểm kết quả trên từng cây/Zone; không coi ACK là công việc thực |
| Nhật ký từ điều khiển | Đã có nút gợi ý sau Stop hoàn tất; form xác nhận thực tế, vật tư do người dùng nhập | Người dùng thử một phiên tưới và phun thật rồi lưu. Xem [hướng dẫn](CONTROL_SESSION_JOURNAL.md) |
| AI | YOLO11s-cls/top3/lịch sử riêng;15 PDF/1.220 chunks có provenance; Groq RAG chatbot | Người dùng báo AI đã hoạt động; chưa có bộ ảnh có nhãn để đo accuracy hoặc bộ đánh giá câu trả lời |
| Web | Dashboard theo vai trò, workflows, tiếng Việt, IoT/control, QR, AI | Duyệt giao diện thực tế, mobile/độ trễ; main bundle vẫn lớn hơn500kB |
| Phát hành | Source/nhánh local và tài liệu tái lập | Review các sửa đổi frontend riêng, push/merge theo quyền; chốt host/Auth/TLS/broker và triển khai |

Ước lượng theo phạm vi web/backend đã chốt: backend/API khoảng90–95%, toàn sản phẩm local khoảng85–90%. Đây là đánh giá phạm vi, không phải số đo nghiệm thu hoặc cam kết production. AI đã có đủ module; Android không thuộc phạm vi hiện tại. Không ghi100% trước khi người dùng hoàn tất kiểm thử kết hợp và release.

## Dữ liệu local đã đối chiếu

15 tài khoản,8 Farm,16 Zone,414 cây. Nhật ký130→290 sau [bổ sung lịch sử](CULTIVATION_HISTORY_ENRICHMENT.md):148 Watering,52 Fertilizing,42 Spraying,48 Other. Có cả Zone/Tree, tỉa cành/hoa/trái, không đổi nhật ký/hash cũ. Lịch sử điều khiển hiện có3 task; số này không được diễn giải là3 phiên canh tác thành công.

Sau bổ sung:2.519 PG rows/2.444 Mongo documents (gồm kỹ thuật),16 ảnh/PDF AI trong backup sidecar. Backup/restore-check khớp checksum010f8c76e95e4f2cc18f143561393f6632d15968d8d160db1d97740ad075891c. Không ghi telemetry/ACK giả cho trạm thật.

## Kiểm chứng đợt rà soát

Backend276/276 unit/HTTP/loopback; Python10/10; web30/30 unit,60/60 browser regression và10/10 AI browser; integration enrichment1/1; browser nhật ký từ điều khiển1/1; lint/typecheck/build đạt. Sửa kỳ vọng menu AI cũ (Farmer nay có hai liên kết ảnh/chat) và chờ điều hướng trước khi đọc aria-current. Xem [báo cáo đợt dọn](PROJECT_CLEANUP.md) cho kết quả cuối.

Pre-check cuối: database,18 migrations,corpus/tài khoản/metadata và Groq config ready; image worker chưa chạy. Người dùng mở lại npm run dev:ai/API/web để nghiệm thu, không cần seed/migrate. Không tự khởi động API với MQTT_ENABLED=true trong lúc bảo trì.

Full persistence311/311 là kết quả checkpoint trước; không gọi đó là lượt vừa chạy trong đợt28/10. Các test tự động dùng fixture/provider giả, không thay bằng chứng bơm/van vật lý hoặc chất lượng AI thật.
