# Bổ sung lịch sử canh tác — 28/10/2026

Nhánh `feat/cultivation-history-enrichment`. Chỉ bổ sung nhật ký bằng các repository nghiệp vụ hiện có; không tạo tài khoản/đổi credentials, không sửa nhật ký Locked, không chèn telemetry/ACK hoặc phát lệnh hardware. Đây là dữ liệu khởi tạo do người dùng cho phép, không phải bằng chứng đã thao tác vật lý. Provenance riêng `GeneratedOperationalHistory` được giữ trong bảng kỹ thuật; giao diện hiển thị nội dung chăm sóc tiếng Việt.

## Phạm vi

- Tưới toàn khu: thời lượng/lượng nước/ghi chú khác nhau.
- Bón phân toàn khu và riêng cây, vật tư Active, snapshot/đơn vị/cảnh báo ngoài tiêu chuẩn như API.
- Phun chế phẩm sinh học riêng từng cây Active; lượng dùng chỉ là dữ liệu khởi tạo, không phải khuyến cáo điều trị.
- Hoạt động Khác: tỉa cành/vệ sinh lá, tỉa hoa, tỉa trái. Tên công việc và ghi chú tự do vẫn riêng tư theo quy tắc QR.
- Tác giả là chủ Farm Active của Zone, không giả Farmer có phân công. Farm, tiêu chuẩn và target được repository kiểm tra lại khi tạo.
- Tối đa10 bản ghi/Zone, chọn giờ sáng/chiều trong28 ngày trước, **chỉ sau lock_at cuối cùng đã có trong Zone** và sau ngày tạo tác giả. Không tính lại hash cũ để chèn lùi lịch sử. Zone có hoạt động quá mới có thể không còn khoảng phù hợp và được bỏ qua.
- Thời gian lịch sử chỉ được tiêm vào bundle offline của CLI development/test; API vận hành không nhận created_at/lock_at từ người dùng.

## Tái lập

Dừng API sau khi xác nhận bơm/van thực tế đã tắt. Docker/database vẫn chạy. Không seed lại hoặc xóa volume.

```powershell
npm run db:cultivation:preview --workspace @smart-durian/api
npm run db:cultivation:expand --workspace @smart-durian/api
```

Preview chỉ đọc và báo số lượng theo hoạt động. Apply tự tạo backup JSON **kèm sidecar ảnh/PDF AI** trước/sau; giữ hai phần cùng nhau trong backups. Các maintenance locks chặn chạy đồng thời API/migration. Nếu CLI báo lỗi, giữ dữ liệu đã ghi và chạy lại sau khi xử lý; không reset database.

Plan được cố định trong `technical.entity_metadata` (`dataset_profiles/cultivation-diversity-month-v1`); mỗi bước có checkpoint `dataset_steps`. Nếu Mongo đã tạo bản ghi nhưng PG checkpoint chưa kịp ghi, lần sau nhận lại bản ghi theo tác giả/thời điểm/target/loại, không tạo đôi. Không có transaction chéo PG/Mongo; không nhận danh sách thời gian tùy ý từ HTTP. Khi Complete, chạy lại tạo0 bản ghi.

Sau cùng dùng store khóa nhật ký đến hạn và verify mọi chuỗi Zone đã thêm. Thời hạn15 phút, context chủ Farm, snapshot danh mục và hash v1 không đổi. Không dọn/xóa Locked để giải phóng dung lượng.

## Kiểm chứng

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d --pull never
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.integration-dist
node --test apps/api/.integration-dist/integration/cultivation-enrichment.integration.js
```

**Bắt buộc `-p sdf-persistence-test`** cho fixture, tránh dùng tên project của database chính. Test trên database ngẫu nhiên riêng: đa dạng hoạt động/target, giả lỗi mất checkpoint, resume không trùng, hash-chain hợp lệ, không đổi bảng public/IoT và chạy lại giữ nguyên checksum. Test đã đạt1/1. Không gọi hardware/OTP/AI provider.

Kiểm giao diện: chủ vườn mở Nhật ký canh tác → chọn từng Zone/loại, mở chi tiết bản Tree/Zone, snapshot vật tư, trạng thái Locked và kiểm chuỗi. Farmer phụ trách xem nhật ký trong scope; Manager HTX chỉ đọc; QR không công khai tên công việc Khác/ghi chú riêng tư.

Local28/10 đã thêm160 bản ghi/16 Zone:48 Other,48 Watering,32 Fertilizing,32 Spraying. Tổng nhật ký130→290. Backup trước `2026-10-28T04-11-10-253Z-4a96cdd5-c646-4d4e-9f87-c5c972a91466.json` và sau `2026-10-28T04-11-29-759Z-6147352e-370b-4a6e-a37e-24c32c485526.json` có16 AI assets/sidecar. Đối chiếu giữ nguyên2.358 dòng PG cũ và1.975 tài liệu Mongo cũ ngoài technical state (gồm toàn bộ nhật ký/hash cũ, AI, telemetry/tasks); technical state chỉ nối context/head/ledger. Các bản mới đều Locked và verify thành công. Preview sau apply báo Complete; số planned160 là tổng của plan đã hoàn thành, không phải160 còn phải thêm.
