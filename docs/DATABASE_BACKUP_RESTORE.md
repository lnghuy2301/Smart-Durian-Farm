# Bổ sung AI — schema017 (26/10/2026)

Cập nhật018: nguồn/trang/dự thảo lưu cùng corpus/citations; backup014–017 vẫn tương thích. [Corpus thực và restore-check](AI_RAG_CORPUS_IMPLEMENTATION.md) có15 snapshot PDF trong sidecar. PDF gốc trong inbox và weights phải sao lưu riêng.

Backup mới bao gồm ba collection AI. Khi có ảnh chẩn đoán/PDF đã nhập, CLI tạo thêm `<archive>.json.assets/` với manifest/checksum; phải giữ và chuyển cùng file JSON. `verify` và `restore-check` kiểm tra cả hai; `restore-new` chỉ bổ sung file thiếu, từ chối ghi đè file khác hash. Archive014–016 vẫn phục hồi theo schema gốc rồi migrate tiếp. best.pt và PDF chưa nhập trong inbox là đầu vào riêng, cần tự sao lưu. Xem [AI_BACKEND_IMPLEMENTATION](AI_BACKEND_IMPLEMENTATION.md). Không đưa JSON/assets/model/private accounts lên Git.

# Sao lưu, kiểm chứng phục hồi và chuẩn bị demo

Ngày21/10/2026, nhánh `feat/database-backup-restore`, kế thừa MQTT final `fd7a4fb`. Chỉ dùng local CLI, không có endpoint HTTP backup/restore và không khởi tạo Nest/Auth/SMTP/MQTT providers.

## Phạm vi và nguyên tắc

- Lưu13 bảng nghiệp vụ +4 bảng dữ liệu kỹ thuật PG và4 Mongo collections (ba domain +PERSISTENCE_STATE). Manifest migration001–014/checksums đi kèm; khi restore phải dùng cùng source revision/schema.
- SQL JSON giữ dưới dạng text để giữ microsecond timestamp/decimal/bigint. Mongo canonical Extended JSON giữ Date/ObjectId/numeric BSON types; không hash lại Cultivation Locked hoặc đổi counter/context/receipt.
- Đây là logical data backup của schema do migrations quản lý. Migrations tạo lại constraints/validators/indexes. Không sao lưu roles/server config/credentials/extension binaries/custom unmanaged objects hoặc hứa transaction chung hai DB.
- Schema_migrations được tạo lại khi chạy đúng migrations; applied_at mới thuộc lần restore. Dữ liệu business/technical phải khớp data_sha256 trước khi báo thành công.
- File có phone/email/password hash và lịch sử riêng. Thư mục `backups/` đã ignore Git; không đưa file này lên Git, Postman hoặc AI vẽ sơ đồ. SHA-256 phát hiện sai dữ liệu, không mã hóa hoặc ký xác thực archive.

## Tạo backup

Nếu thiết bị đang chạy, người vận hành chủ động Dừng và kiểm đủ ACK trước bảo trì; agent không tự gửi lệnh thật. Dừng API bằng Ctrl+C, giữ PG/Mongo chạy. Mọi ON/OFF vẫn cần metadata Active theo FINAL.

Từ root:

```powershell
npm run db:backup
```

Windows npm wrapper lỗi EPERM thì dùng local tools:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.build.json
node apps/api/dist/persistence/backup-cli.js create
```

Không cần thêm key vào .env; đọc DATABASE_URL/MONGODB_URI hiện có, không sửa file. Output chỉ file path/counts/data checksum. File timestamp+UUID mới, ghi với wx, không overwrite backup cũ; giới hạn prototype128MiB mỗi file.

CLI giữ migration advisory lock và controller advisory lock, từ chối khi API đang giữ controller lease. Khóa SHARE17 data tables và ledger, fail ngay nếu đang có writer xung đột; PG repeatable-read và Mongo snapshot trong thời gian PG bị giữ nguyên. Không tạo bản backup live rồi gọi hai stores atomic. Source có bảng/collection ngoài allowlist hoặc ledger sai thì từ chối để tránh bỏ sót dữ liệu.

Nếu BACKUP_STOP_API_AND_MIGRATIONS_FIRST, dừng API/migration/seed rồi thử lại. Không kill một tiến trình chưa xác định hoặc sửa ledger để vượt lỗi. Lỗi driver không dump URI/row contents ra console.

## Kiểm tra file và restore rehearsal

Thay `backups/FILE.json` bằng tên vừa xuất. Đường tương đối tính từ root repository; đường tuyệt đối cũng được.

```powershell
npm run db:backup:verify -- backups/FILE.json
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d --pull never
npm run db:restore:check -- backups/FILE.json
```

Fallback tương đương:

```powershell
node apps/api/dist/persistence/backup-cli.js verify backups/FILE.json
node apps/api/dist/persistence/backup-cli.js restore-check backups/FILE.json
```

Verify kiểm format/checksum/tables/columns/row keys/EJSON/manifest trước khi tạo target. Restore-check chỉ dùng fixture PG15432/Mongo27028 đã cấu hình sẵn trong Compose test; không dùng URI demo để ghi lại database gốc.

Tạo hai database cùng tên ngẫu nhiên `sdf_restore_<32hex>`, chỉ chấp nhận target rỗng; chạy migrations, insert theo FK order/SQL transaction, Mongo transaction, đọc lại toàn bộ data và đối chiếu SHA-256. Cleanup chỉ database do lệnh vừa tạo; không drop source/demo/volumes. Nếu đã tồn tại dữ liệu, restore từ chối chứ không truncate/upsert.

Kết thúc fixture: `docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml down`, không -v.

## Phục hồi khi thật sự cần dùng dữ liệu

```powershell
npm run db:restore:new -- backups/FILE.json
```

Hoặc `node apps/api/dist/persistence/backup-cli.js restore-new backups/FILE.json`. Dùng server endpoints trong .env nhưng tạo database mới ngẫu nhiên, không ghi đè database được cấu hình. Chỉ báo restored=true sau đối chiếu khớp. Giữ target mới nếu thất bại để người vận hành kiểm tra; không tự thay URI .env hoặc xóa source.

Sau kiểm tra, người vận hành quyết định cutover cả DATABASE_URL và database path trong MONGODB_URI sang cùng target mới; giữ credentials/replica options. API startup vẫn preflight schema. Task Pending cũ thành Failed/mode Unknown; không ON tự động, Start sau Reset đủ ACK. OTP dở xác minh lại, proposals/token versions/history thuộc thời điểm backup được giữ. Phục hồi backup cũ cũng là quay trạng thái tài khoản về mốc cũ; cần xét thu hồi phiên/đổi JWT secret khi dùng lại backup cũ trong môi trường thật.

Đây không phải rollback atomic xuyên PG/Mongo; mọi lỗi import chỉ ảnh hưởng target mới. Không promote target lỗi hoặc tự retry bằng ghi đè database đang dùng.

## Kiểm tra dữ liệu demo không lộ identity

```powershell
npm run db:demo:check
```

Fallback: `node apps/api/dist/persistence/backup-cli.js demo-check`. Chỉ trả account readiness/counts, liên kết Farm/HTX, streams cần sửa metadata, recipe readiness và cờ có cấu hình SMS/email. Không in phone/email/UUID/password/hash/broker, không gửi OTP hoặc thay dữ liệu. Có cấu hình không chứng minh provider đã gửi SMS/email thành công.

## Source và tests

- `apps/api/src/persistence/backup.ts`: allowlist, snapshot/checksum/manifest, restore empty/new target, exact data comparison.
- `backup-cli.ts`: local file/create/verify/restore-check/restore-new/demo-check, cleanup owned databases và sanitized errors.
- `demo-readiness.ts`: audit tài khoản/hardware chỉ đọc, không fake verified Manager.
- `apps/api/integration/backup.integration.ts`:8 checks, gồm từ chối active API, dữ liệu Locked chain/context/receipt/allocator, Pending proposal, Confirmed Harvest, SQL microseconds/BSON, archive hỏng/sai schema, chống overwrite và CLI rehearsal cleanup.

Chạy `npm run test:backup -w apps/api`; fallback compile `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir apps/api/.integration-dist`, rồi `node --test apps/api/.integration-dist/integration/backup.integration.js`. Test không đọc .env thật/gửi SMTP/SMS/hardware. Bộ8 tests đã đạt trên fixture riêng; [báo cáo dữ liệu demo thật](DEMO_READINESS_20261021.md) ghi riêng actual backup/restore.
