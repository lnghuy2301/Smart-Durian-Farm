# Kế hoạch tiếp theo — 28/10/2026

Đã có toàn bộ module backend/web đã chốt, kể cả AI ảnh/Groq chatbot. Không triển khai lại module hoặc seed lại để bắt đầu nghiệm thu. [Tiến độ](BACKEND_PROGRESS_CURRENT.md), [quy tắc](PROJECT_BUILD_SPEC.md), [chạy4 terminal](RUN_AND_FULL_ACCEPTANCE.md).

| Ưu tiên | Công việc | Điều kiện hoàn tất |
| --- | --- | --- |
|1|Nghiệm thu kết hợp phần cứng|6 streams đúng trạm/đơn vị, ACK tương ứng taskId/action, thứ tự bơm/van, không tưới/phun đồng thời, Stop/recovery/mất mạng/restart. Quan sát vật lý riêng với ACK |
|2|Thử nhật ký từ phiên điều khiển|Sau Stop đủ ACK, bấm Ghi nhật ký → xác nhận thực tế → kiểm thời lượng/vật tư → lưu; kiểm Zone/tác giả/Pending/Locked/QR. Không tự ghi từ ACK |
|3|Nghiệm thu4 vai trò|SMS/email/Manager approval, Farm/HTX/Zone proposals, assignment scope/expiry, Harvest/correction, Cultivation/hash-chain/QR và AI private history |
|4|Đánh giá AI|Người dùng đã báo hoạt động; kiểm top3 bằng ảnh có nhãn, câu hỏi có/ngoài nguồn, draft/source.page, quota và mạng lỗi. Không coi output hợp lệ là accuracy đạt |
|5|Chốt dữ liệu và bản phát hành|Giữ dữ liệu/tài khoản thật; backup JSON+AI sidecar, ảnh/model/PDF gốc riêng; review frontend đang sửa, gom các nhánh qua PR khi được cho phép |
|6|Chốt triển khai|Host/domain, Auth production, TLS/CORS/broker ACL, giám sát và quy trình backup/restore. Không tự chọn dịch vụ trả phí hoặc mở mạng |

## Quy tắc vận hành

- [MQTT FINAL v1.0](MQTT_HARDWARE_PROTOCOL_FINAL_v1.0.md) là contract đóng băng. Purpose chọn lúc đăng ký, mỗi vai trò đúng một actuator; mọi command kể cả OFF yêu cầu Active.
- ACK là receipt;10s mỗi bước; sau restart không replay ON, trước Start phải Reset. Không đổi metadata Inactive khi tải chưa tắt vì OFF cũng sẽ bị chặn.
- Dữ liệu lịch sử mới chỉ nối sau đuôi hash, không sửa Locked. Công cụ enrichment đã chạy một lần; không cần chạy lại để mở dự án.
- Database fixture luôn dùng `docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml ...`; database chính giữ project riêng và volumes hiện có.
- .env/private guide/model/PDF/backups không commit hoặc gửi cho AI bên ngoài; Postman nhập JWT/UUID/OTP thủ công.
- Nghiệp vụ mới chưa rõ thì hỏi và chờ. Không push/merge khi chưa được cho phép.

Ghi kết quả Pass/Fail/Chưa chạy trong [checklist đầy đủ](RUN_AND_FULL_ACCEPTANCE.md). Không đánh dấu hardware/Auth production/deploy đã đạt chỉ vì test tự động qua.
