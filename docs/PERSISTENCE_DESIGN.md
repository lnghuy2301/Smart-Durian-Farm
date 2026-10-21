# Persistence — thiết kế hiện hành

Cập nhật21/10/2026. Việc chuyển runtime đã hoàn tất trong source nền `1f6c1fd`; [runtime guide](DATABASE_RUNTIME_IMPLEMENTATION.md) chứa cấu hình, commands, source và test evidence. Không còn kế hoạch “API vẫn RAM chờ adapters”. Memory được giữ cho fixture/chế độ explicit.

## Phân chia dữ liệu đã duyệt

- PostgreSQL13 bảng nghiệp vụ theo [đặc tả](PROJECT_BUILD_SPEC.md); technical.entity_metadata, workflow_requests, audit_events, notifications cùng schema_migrations.
- MongoDB IOT_TELEMETRIES, ACTUATOR_TASKS, CULTIVATION_EVENTS và technical state cho counter/context/Zone head/ledger/ownership.
- QR là projection public, không bảng riêng. Hai AI collections chưa triển khai.
- Một bảng nghiệp vụ TREE_HARVESTS; nội dung đề xuất chờ duyệt ở workflow_requests, không thêm bảng business correction/batch.
- OTP/email/SMS proof dở lưu ngắn hạn, restart xác minh lại. Account verification/password/token_version và proposals đã lưu vẫn còn.

## Những dữ liệu phụ phải đi cùng nghiệp vụ

| Nhóm | Ngữ cảnh lưu bền |
| --- | --- |
| Metadata | Version, snapshots, seed key/origin, account token version, ever_confirmed |
| Workflow | Farm signatures/membership, Admin proposals, assignment invitations/end, Harvest confirm/correct/backdate grants, HTX edits |
| Audit/notifications | Actor, operation, expected/resulting version, trạng thái duyệt/lịch sử và thông báo đúng scope |
| Cultivation | Phân công/owner gốc, root lineage, original deadline, Locked event/context/Zone head và ledger |
| Tasks | Numeric allocator, receipt steps, terminal journal, owner fence; acknowledged mode Unknown sau restart |

Không chèn riêng business row rồi bỏ technical metadata. Không dùng client-supplied actor/verified/confirmed_at để thay backend authority.

## Ràng buộc và transaction

- Phone identity chuẩn hóa, email unique, một Manager/HTX; parent/role/scope được recheck khi commit.
- Zone areas≤Farm; tiêu chuẩn gắn mới Active. USERS_ZONES interval [start,end) không giao nhau trên Zone.
- tree_code backend bất biến; không chuyển Zone. Device station UNIQUE/bất biến; installed_at/cost bắt buộc. Sensor unique Device+stream, Actuator unique Device+capability, giữ định danh kể cả Inactive.
- Harvest unique Tree+date, batch không unique và chỉ cùng Zone/ngày. Khóa batch cũ/mới theo thứ tự cố định; ngày thực tế DATE, giới hạn nhập bù theo lịch Việt Nam.
- PG record/request/version/audit atomic bằng transaction. Mongo telemetry append/counter/eviction atomic; tasks allocator/journal/receipts atomic; Cultivation event/context/head/ledger atomic. Không có transaction chung giữa hai databases; dùng context/locks/recheck theo adapter đã kiểm thử.
- Giữ hash v1 canonical mapping khi Date/ObjectId/decimal chuyển sang JSON. Không hash lại Locked hoặc sửa snapshot lịch sử cho khớp seed mới.

## Restart và retention

Runtime đọc database, không seed tự động hoặc fallback RAM khi lỗi. PG/Mongo clients/pool dùng chung cho HTTP/MQTT/workers/QR. Task controller có PG session advisory lease/Mongo fence, không tự replay ON; Pending cũ Failed, mode Unknown, Start sau Reset đủ ACK10s/step. ACK chỉ receipt, physical_state Unknown.

Telemetry FIFO tổng10.000 readings, thứ tự counter bền vững; hardware khoảng15s vẫn nhận mọi packet hợp lệ. Tasks cap5.000 theo terminal policy. Cultivation cap10.000 không FIFO xóa Locked; lock Pending đúng deadline15 phút bằng catch-up512 events/transaction, quyền correction phân công gốc giữ nguyên.

## Schema, seed và tái lập

[Manifest](../apps/api/src/persistence/migrations.ts) liệt kê001–014 cùng mọi source schema. Không sửa source/checksum đã apply; thay đổi mới thêm migration. Preflight startup kiểm migration ledger, replica set và validators/indexes. Chạy migrate/seed bằng CLI riêng, không tự apply ở boot.

[Seed profile](PERSISTENCE_SEED_SPEC.md) additive/idempotent, không reset password/role/status/verification/identity/history. Thiếu dữ liệu cấu hình hoặc profile conflict thì fail rõ ràng, không chèn một phần hay tự phát mail/SMS/MQTT.

[Foundation](PERSISTENCE_FOUNDATION_IMPLEMENTATION.md) giữ hướng dẫn CLI/checksum/seed; các kết quả/số lượng ở checkpoint foundation là lịch sử. Chi tiết persistence hiện hành ở POSTGRES_* và MONGO_* guides trong [mục lục](README.md). Còn backup/restore thực và nghiệm thu demo/hardware/deploy theo [kế hoạch](IMPLEMENTATION_PLAN.md).
