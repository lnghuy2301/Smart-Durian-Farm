# Rà soát dự án ngày26/10/2026

Nhánh `feat/catalog-admin-completion`, kế thừa `87aea89`; workspace giữ các chỉnh sửa riêng trên `feat/web-usability-refinements`. Không reset/clean, stage toàn bộ, ghi `.env`, migrate/seed, push/merge hoặc gửi OTP/command thật. Ngày trong báo cáo theo giờ Việt Nam. Các checkpoint cũ trong tài liệu là lịch sử; không lập lại backlog RAM/persistence đã hoàn tất.

## Những gì đã có

| Nhóm | Hiện trạng | Giới hạn cần phân biệt |
| --- | --- | --- |
| Auth/Users/HTX | Đăng ký Farmer; Manager email thật→Pending→Admin duyệt/gắn HTX; OTP SMS/đổi mật khẩu; hồ sơ/email; refresh theo hoạt động/idle15 phút; HTX sửa qua email rồi SMS | Auth hiện phục vụ development/test; production Auth chưa được thiết kế/xác nhận triển khai |
| Danh mục | API vật tư/tiêu chuẩn/liên kết, Active/Inactive và liều số+đơn vị+cơ sở đã có; đợt này hoàn thiện thao tác quản trị trên web | Không suy đoán số từ mô tả cũ; cấu hình liều không phải hướng dẫn nông học đã được chuyên gia thẩm định |
| Farm/Zone/phân công/cây | Đề xuất/duyệt đối ứng, membership HTX, phân công Accepted và phạm vi thời gian; cây/Zone theo quyền chủ, Admin đề xuất | Không chuyển Zone cây/Device; không mở thêm nghiệp vụ chưa chốt |
| Thu hoạch/canh tác/QR | Draft/Pending/Confirmed và correction thu hoạch; nhật ký khóa15 phút/correction/hash-chain theo Zone; QR công khai theo whitelist và toàn chuỗi Locked | Hash-chain SHA-256 không phải blockchain; không đưa dữ liệu tự do riêng tư lên QR |
| IoT | Metadata Device/Sensor/Actuator,6 streams MQTT FINAL; telemetry/latest/history; Reset/Start/Stop/ACK/recovery, phân quyền và persistence | ACK là receipt; không chứng minh relay/bơm/van đã hoạt động; cần nghiệm thu xuyên suốt bằng ESP32 thật |
| Dữ liệu/vận hành |13 bảng PG nghiệp vụ, technical workflows/audit;3 collection Mongo nghiệp vụ; migrations001–016, seed không ghi đè, backup/restore-check | Không có transaction chung PG/Mongo; backup cần dừng API theo guide, không coi là snapshot live |
| Web | Theo vai trò, workflow/đối chiếu, QR tải PNG, tài khoản, IoT/control và các cải tiến26/10 đã có trong workspace | Nhiều thay đổi giao diện còn chưa commit; không tự gom/push thay người dùng |
| AI | Chẩn đoán bệnh và chatbot chưa có | Đã thống nhất hoãn, không tự chọn provider/model hoặc giả kết quả |

## Công việc đã thực hiện ngay trong đợt này

Phát hiện web mới tra cứu danh mục và liên kết: thiếu thao tác Admin dù backend đã có đầy đủ quyền/API. Bổ sung `workflows/CatalogTools.tsx`, tích hợp vào `pages/Resources.tsx`:

- Admin tạo/sửa vật tư, số liều0.001–1.000.000 tối đa3 số lẻ, đơn vị≤10 ký tự, cơ sở≤60 ký tự, số ngày cách ly nguyên≥0, loại/trạng thái theo enum API. Ghi trực tiếp qua POST/PATCH danh mục đã được AdminGuard bảo vệ; không dùng workflow Farm/Zone cho catalog.
- Admin tạo/sửa tiêu chuẩn: mã/tên/đơn vị chứng nhận/mô tả/status; mô tả được để trống hoặc xóa về chuỗi rỗng. `InputField.includeEmpty` trong serializer chỉ bật cho field cần gửi chuỗi rỗng hợp lệ, các form cũ giữ cơ chế bỏ field trống.
- Chi tiết tiêu chuẩn có danh sách vật tư liên kết: phân trang10, tìm/lọc phía server, gắn vật tư và xác nhận bỏ liên kết. Inactive vẫn được cấu hình bridge như API hiện có; Zone/Cultivation kiểm Active theo nghiệp vụ riêng. Bỏ bridge không xóa vật tư/tiêu chuẩn hoặc nhật ký cũ.
- Farmer/Manager chỉ đọc. Không mở API directory hoặc phân quyền mới. Lỗi ghi409/mạng/5xx dùng cơ chế form hiện có: dừng gửi tiếp, đóng/tải lại để kiểm tra; không tự retry ghi.
- Vật tư legacy chỉ có mô tả vẫn sửa tên/trạng thái mà không ép suy ra liều số. Khi chuẩn hóa cần nhập đủ số và cơ sở để backend kiểm cặp. Snapshot đã ghi không bị sửa.

## Đối chiếu local và evidence

Database local ban đầu chưa chạy; đã mở Docker Desktop và đúng compose project `smart-durian-farm`, giữ nguyên volumes. Chỉ đọc để kiểm tra:15 Users,4 HTX,8 Farm,16 Zone,414 Tree,17 vật tư; Mongo1.440 telemetry,130 Cultivation,0 task. Các số này là thời điểm rà soát, không phải invariant seed. User đã xác nhận Farmer chính/SMS và đăng ký/duyệt Manager hoạt động; dữ liệu Manager bootstrap không được coi là bằng chứng xác minh email thật cho mọi tài khoản.

`MQTT_ENABLED=false` giữ nguyên. Không nạp dữ liệu giả vào trạm thật, không phát lệnh Bật/Dừng để kiểm thử tự động. Có thể bật hardware sau theo [checklist FINAL](IMPLEMENTATION_PLAN.md) và [metadata trạm thật](REAL_HARDWARE_DATABASE_READINESS.md).

Kiểm tra các Markdown trong docs, loại file private: không thấy relative link trỏ tới file không tồn tại. Không sửa/xóa nguồn MQTT/ERD/PDF, tài liệu tài khoản private hoặc asset của người dùng. Kiểm tra này không xác thực anchor hoặc nội dung từng sơ đồ; ERD vật lý phải đối chiếu cả migrations015/016 như guide backend PDF.

## Kiểm thử và tái lập

- Backend258/258; persistence302/302 trên22 suite fixture riêng. API lint/typecheck đạt; không thay source/backend schema trong đợt này.
- Browser mới `catalog-admin-browser.mjs`:4 nhóm kiểm tra đạt, dùng Nest/RAM và provider giả: tạo/sửa liều số; tạo/sửa/xóa mô tả tiêu chuẩn, gắn/bỏ vật tư; giữ legacy; Farmer không thấy nút ghi và API PATCH trả403. Không dùng tài khoản hoặc database vận hành.
- Web unit21/21, TypeScript/lint/build đạt. Bundle chính khoảng507kB còn cảnh báo kích thước; không tăng ngưỡng để che, chưa coi là lỗi chức năng. Chia bundle là việc tối ưu sau.
- Các lượt full browser/database/PDF của đợt ghi ở checkpoint hoàn tất bên dưới. Một lượt full browser dừng do tiêu đề bảng mới khác tiêu đề cũ; đã giữ nguyên “Vật tư liên kết” và chạy lại. Không bỏ test để che lỗi.

Kết quả cuối: **58/58 browser regression,5/5 browser database/MQTT loopback,5/5 PDF/tài khoản và4/4 nhóm browser catalog mới** đạt. Các con số fixture không thay thế nghiệm thu ESP32 hoặc provider thật. Đã dừng riêng project fixture sau khi xong; database local giữ chạy để người dùng kiểm tra.

```powershell
# Từ root, compile fixture một lần trước browser standalone
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.integration-dist
npm run test:web
npm run test:e2e:catalog --workspace @smart-durian/web
npm run test:web:e2e
# Persistence: Docker Desktop đã mở, fixture riêng; không dùng volume vận hành
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d --pull never
npm run test:persistence
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml stop
```

Xem logs ignored `apps/api/.integration-dist/review-20261026-*.txt`, `apps/web/test-results/review-20261026-*.txt`, `catalog-admin-review.txt`. Không gửi backup/private accounts/ảnh có PII cho AI khác để vẽ sơ đồ.

## Công việc thực sự còn lại, theo thứ tự

1. **Nghiệm thu nghiệp vụ bằng bốn tài khoản chính trên database/web.** Dùng [checklist module](MODULE_ACCEPTANCE_CHECKLIST.md), thông tin đăng nhập trong file private đang có. Kiểm chủ Farm/Farmer nhận việc/Manager/Admin; membership HTX và các duyệt đối ứng, correction, hết phân công, QR. Chỉ xác nhận Pass khi có kết quả thực; không tự gắn Farm với HTX hoặc duyệt dữ liệu thay người dùng chỉ để hoàn thành checklist.
2. **ESP32 xuyên suốt web→API→broker→hardware→ACK/telemetry→database.** Protocol đã chốt/hardware-tested; phần cần nghiệm thu là bản tích hợp server hiện hành:6 streams, thứ tự Reset/van/bơm, thiếu/trễ/sai ACK, disconnect, Stop preemption, restart và kiểm quan sát vật lý. Agent không tự bật tải thật. Ghi Pass/Fail/NotRun, revision, expected/actual; che credentials.
3. **Chốt nơi triển khai và Auth production.** Cần domain/host, TLS/reverse proxy, broker/quyền truy cập, cấu hình SMTP/SMS, vận hành/backup và mô hình Auth production. Hiện không tự đổi AUTH_MODE hoặc triển khai publicly bằng cấu hình test. Chưa có quyết định môi trường thì không thể đánh dấu mục này xong.
4. **Chốt release Git và nghiệm thu giao diện.** Review các thay đổi riêng chưa commit, commit theo nhánh/module, sau đó mới push/PR khi được yêu cầu. Có thể tối ưu bundle và ảnh nặng sau khi chốt giao diện. Không xóa file chưa commit chỉ vì chưa được track.
5. **Hai module AI** chỉ bắt đầu khi người dùng muốn và chốt model/provider, dữ liệu bệnh/corpus, phạm vi tư vấn và cách đánh giá. Android là phạm vi riêng, không tự thêm vào backlog hoàn thành web/backend.

Không còn một module nghiệp vụ SQL/Mongo đã chốt nào cần viết lại từ đầu. Danh sách trên là nghiệm thu, release/deploy và phần mở rộng; không dùng một tỷ lệ % thiếu cơ sở để thay cho các điều kiện đạt.
