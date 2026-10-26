# Tìm nông dân theo tên/điện thoại để phân công

Ngày26/10/2026, nhánh `feat/assignment-farmer-search`, kế thừa `82d5bf1`. Người dùng chốt mời bằng điện thoại hoặc tên, hiển thị cả tên và số điện thoại, chọn lại người từng được phân công. Thay bước nhập UUID bằng bộ chọn; UUID vẫn là định danh nội bộ khi gửi phân công. Không tạo mã giới thiệu mới hoặc gửi SMS mời tự động.

## Luồng web

1. Chủ Farm chọn Zone→Phân công→Mời phụ trách khu vực. Admin vẫn được lập đề xuất với các chấp thuận như trước.
2. Khi mở, danh sách chỉ gợi ý Farmer Active từng có phân công **đã Accepted** ở bất kỳ Zone nào của Farm này, kể cả phân công đã kết thúc. Lời mời Pending chưa tạo lịch sử. Không có lịch sử thì danh sách trống; không tự tải toàn bộ danh bạ.
3. Nhập tên ít nhất2 ký tự hoặc điện thoại ít nhất4 chữ số, bấm **Tìm nông dân** hoặc Enter trong ô tìm. Hỗ trợ tên có/không dấu và không phân biệt hoa thường; điện thoại0/84/+84, dấu cách/dấu phân cách và đoạn số phù hợp. Hiển thị tên và số điện thoại ở hai cột, người trùng tên vẫn chọn riêng được.
4. Bấm **Chọn**; thông báo ghi rõ tên/phone đã chọn. Đổi nội dung ô tìm xóa lựa chọn trước để không gửi nhầm UUID cũ. Kết quả của request cũ bị abort/guard khi đổi query/Zone, không lưu directory vào storage.
5. Chọn thời gian hoặc để mặc định, bấm Lưu thông tin. Khi chưa chọn người thì không gửi POST. Farmer phải chấp nhận trong Phiếu đề xuất mới có quyền. Admin đề xuất vẫn cần chủ Farmer và người nhận chấp thuận. Giới hạn khoảng hiệu lực, giao nhau và quyền correction theo phân công gốc giữ nguyên.
6. Người chưa có tài khoản đăng ký qua trang `/register` trước, rồi chủ vườn tìm lại. Agent không đăng ký/xác minh thay người nhận hoặc gửi tin nhắn bên ngoài.

## API

`GET /api/zones/{zone_id}/assignment-candidates`, Bearer JWT, `Cache-Control: no-store`.

| Query | Kết quả |
| --- | --- |
| Không q hoặc q chỉ khoảng trắng | Người từng được phân công trong Farm của Zone, chỉ Farmer Active |
| `q=Nguyen` hoặc tên có dấu | Tìm tên Farmer Active bằng substring literal, có thể tìm ngoài Farm để mời người mới |
| `q=0900000002`, `q=84900000002`, `q=%2B84900000002` | Cùng phone identity0/84/+84; vẫn trả đúng số đang lưu |
| Đoạn số từ4 chữ số | Tìm theo số/phone identity; dùng thêm chữ số để thu hẹp |

Chỉ chủ Farmer của **chính Farm chứa Zone** hoặc Admin được tra cứu. Farmer chỉ nhận việc, chủ Farm khác và Manager nhận403, không đọc contact qua quyền xem Zone. Farm owner phải là Farmer Active như luồng lập lời mời. PostgreSQL recheck owner/scope trong chính SELECT trả contact để thay đổi chủ đồng thời không mở truy cập sau preflight.

Response200:

```json
{
  "items": [
    {"id":"UUID_FARMER", "user_name":"Tên nông dân", "phone_number":"SỐ_ĐÃ_ĐĂNG_KÝ", "previously_assigned":false}
  ],
  "has_more":false
}
```

Tối đa20 kết quả, không offset/total hoặc tham số mở rộng directory. Nếu `has_more=true`, nhập cụ thể hơn. Sắp xếp tên hiện tại rồi UUID; kết quả không kèm email/password/role/verification/metadata. Controller giới hạn20 lookup/phút/tài khoản đăng nhập, gộp trên các Zone; vượt trả429. Không tự retry lookup hoặc POST ghi. Tên quá ngắn, phone<4 số, query>100 ký tự hoặc field query ngoài DTO trả400; thiếu token401; UUID sai400; Zone không tồn tại404. SQL tham số hóa và strpos, không biến ký tự%/_ thành wildcard.

POST `/api/zones/{zone_id}/assignment-requests` vẫn dùng `{ "user_id":"UUID_FARMER", "end_date":null }` và `start_date` tùy chọn; không nhận tên/phone như bằng chứng quyền. Adapter recheck Farmer Active và khoảng phân công khi gửi/duyệt. Kết quả tìm không phải lời mời hoặc quyền làm việc.

## Source và persistence

- `assignments/assignment-candidates.ts`: projection, cap, chuẩn hóa query và tên không dấu; không dùng extension PostgreSQL unaccent hoặc migration mới.
- `AssignmentRecords.candidates`: hợp đồng async chung. Memory gọi AssignmentsService.managementContext và chính MockUserStore/MockZoneAssignmentStore hiện có; PG dùng PostgresAssignmentsRepository và cùng pool/Users/Farms/Zones repositories. Không tạo store hoặc bộ danh bạ độc lập.
- `AssignmentRequestsController`: GET theo Zone, DTO, rate limit riêng theo actor, no-store.
- `workflows/AssignmentInviteDialog.tsx`: tìm/chọn và form thời gian, dùng EditorDialog/useResource/API client hiện có. `pages/FarmWorkflows.tsx` mở dialog theo key Zone. Không thay OTP, phiên15 phút, quyền Farm/Zone hoặc MQTT.
- Không đổi schema, seed, dữ liệu vận hành, `.env` hay các file tài khoản private. Không phát SMS/email/hardware thật trong kiểm thử.

## Kiểm thử và tái lập

Khởi động lại API sau cập nhật source (proof OTP/email đang dở sẽ mất như policy hiện hành), tải lại web; không cần migrate/seed/config mới. Source chạy được với database runtime và mode memory đã hỗ trợ.

```powershell
# Root, build fixture cho test; không start API vận hành
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.integration-dist
node --test apps/api/.integration-dist/test/assignment-candidates.test.js apps/api/.integration-dist/test/assignments.test.js
# Docker fixture đã có, cùng quy trình persistence cũ
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d --pull never
node --test apps/api/.integration-dist/integration/assignment-workflows.integration.js
node apps/web/test/assignment-search-browser.mjs
```

Memory unit/HTTP kiểm name/phone aliases, strict projection, scope owner/Admin, Manager/assignee bị từ chối, query/UUID,429, lịch sử Farm Accepted/end, cap20/has_more và literal injection. PG integration kiểm tên không dấu/điện thoại, contact scope, history riêng Farm và loại Locked; tên fixture đặc biệt để không trùng user seed sẵn. Browser3 case kiểm hai người trùng tên/khác phone, đổi query xóa lựa chọn, gửi đúng UUID/chưa có quyền trước chấp nhận và gợi ý lịch sử cùng Farm. Suite workflow web cũ đổi bước nhập UUID thành tìm/chọn, vẫn nghiệm thu Farmer nhận việc qua API thật của fixture.

[Postman JSON nhập trực tiếp](postman/Assignment-Farmer-Search.postman_collection.json): copy JWT/UUID bằng tay; đổi token sang người nhận trước PATCH approve. Không scripts/environment, không chạy cả collection tự động. Không đưa credentials từ `.env` vào collection.

Kết quả cuối: **260/260 backend**, **16/16 PostgreSQL assignment integration**, **21/21 web unit**, **58/58 browser tổng thể** và **3/3 browser lookup mới** đạt. API/web lint/typecheck và web build đạt; build vẫn có cảnh báo bundle lớn đã ghi ở báo cáo rà soát. Test API/SQL không ghi database vận hành, provider thật hoặc hardware. Lỗi kỳ vọng fixture trùng tên/đoạn phone đã sửa bằng tên đặc biệt và kiểm membership cho đoạn số (nhiều kết quả là hợp lệ), không thay logic tìm để ép một kết quả. Source cũ nhập UUID trong browser workflow đã đổi sang tìm/chọn.
