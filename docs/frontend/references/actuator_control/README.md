# Tài nguyên mẫu màn hình điều khiển IoT

Folder nhận HTML/ảnh/assets từ bên thiết kế theo [brief](../../ACTUATOR_CONTROL_DESIGN_BRIEF.md).

Tệp dự kiến: code.html,desktop.png,mobile.png; states/ cho Reset/WaitingAck/RecoveryStop/Failed/Offline/read-only; assets/ cho ảnh/logo dùng trong mẫu. Chưa có asset/mockup mới được tạo ở đây. Không đưa `.env`, credentials/JWT/OTP hoặc số điện thoại thật vào thư mục.

Folder này tách khỏi giám sát/registry IoT hiện có. Không thay mẫu riêng khác hoặc triển khai frontend trong đợt backend/persistence. API, quyền và ACK semantics theo brief; mẫu không có API thì không tự thêm tác vụ giả.
