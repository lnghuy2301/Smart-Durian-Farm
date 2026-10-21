# Persistence foundation — CLI, schema và seed

Cập nhật21/10/2026. Foundation và tất cả adapters/shared database runtime đã hoàn tất trong source nền1f6c1fd. [Runtime và kiểm thử hiện hành](DATABASE_RUNTIME_IMPLEMENTATION.md), [thiết kế](PERSISTENCE_DESIGN.md), [seed profile](PERSISTENCE_SEED_SPEC.md). Hướng dẫn này giữ CLI/recovery, không lặp các checkpoint RAM và số lượng seed cũ.

## Source

Tính từ apps/api/src/persistence:

| File | Vai trò |
| --- | --- |
| postgres-schema.ts | Initial schema001:13 business tables và technical tables |
| mongo-schema.ts | Schema002 validators/indexes của domain/private state |
| migrations.ts và các schema import | Manifest001–014/checksum/ledger/advisory lock, schema gia tăng |
| transactions.ts | Transaction client, parent/batch locks |
| seed-config.ts / seed.ts | Preflight/profile/seed_key, không overwrite |
| mappers.ts | Decimal/time/ObjectId/BSON mapping giữ canonical hash |
| cli.ts | status/migrate/seed, đọc .env local, đóng pool/client |
| database-runtime.module.ts / persistence-runtime.module.ts | Shared bindings/preflight/providers |

Interfaces scaffolding contracts.ts không có consumer đã bỏ; các domain async ports và repository bundle đang được dùng thực tế.

## Migration: lệnh và phục hồi

Từ thư mục gốc dự án, cấu hình DATABASE_URL/MONGODB_URI trong .env local và dùng Compose hiện có:

```powershell
docker compose -p smart-durian-farm up -d postgres mongodb mongo-init
npm run db:status
npm run db:migrate
npm run db:status
```

Không tự migrate khi API boot. PostgreSQL cần quyền CREATE/schema/extension btree_gist; Mongo phải là writable replica set. Không reset database/volume nếu authentication lỗi; kiểm tra cấu hình đang dùng. CLI log lỗi driver bằng mã, không dump SQL detail/URI. Khi migration lịch sử khác checksum/store hoặc có ID lạ/gap, dừng và dùng đúng revision, không chỉnh ledger để vượt qua.

001 SQL + ledger commit/rollback cùng client. 002 Mongo DDL không atomic với PostgreSQL ledger: mỗi thao tác createCollection/collMod/createIndex idempotent và chỉ mark Applied khi toàn bộ thành công. Nếu ngắt giữa 002, giữ nguyên ledger 001 và chạy lại 002 trên cùng revision; không xóa collection để thử lại. Database có bảng/index cùng tên nhưng schema khác có thể báo conflict; không tự bỏ dữ liệu người dùng. Không cung cấp down/reset cho database demo.

Nếu npm wrapper Windows báo EPERM, từ apps/api dùng công cụ local tương đương:

```powershell
node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
node dist/persistence/cli.js status
node dist/persistence/cli.js migrate
node dist/persistence/cli.js seed
```

## Seed và dữ liệu demo

Chỉ chạy `npm run db:seed` khi cần chuẩn bị/bổ sung profile đã kiểm tra. [Seed spec hiện hành](PERSISTENCE_SEED_SPEC.md) liệt kê cấu hình, six-stream mappings, accounts, số lượng fresh profile và quy tắc không ghi đè. Không reset password, role/status/verification, UUID, station, unit hoặc history đang có.

Seed không gửi mail/SMS/MQTT và không tạo ACK/telemetry/Locked journal giả cho trạm thật. Manager mẫu Pending không thay Manager thật đã verify; dữ liệu workflow demo tạo qua API. Database local đã có dữ liệu thì kiểm kê/backup trước, không xóa volume/reseed để chữa login.

## Kiểm thử cô lập

```powershell
docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml up -d
npm run test:persistence
```

Fixture riêng ports15432/27028, tên databases có prefix kiểm soát; không dùng database demo để chạy integration. Mongo cần primary replica set. Mỗi suite có kiểm tra endpoint và cleanup database test; mất kết nối là lỗi, không coi skipped là pass. Tests hiện hành có full AppModule/HTTP/MQTT/QR/restart, khác giới hạn foundation ban đầu.

Sau test: `docker compose -p sdf-persistence-test -f docker-compose.persistence-test.yml down`, không -v. Không tác động project smart-durian-farm. [Runtime guide](DATABASE_RUNTIME_IMPLEMENTATION.md) có nguồn tests, cấu hình và lệnh Windows fallback cho từng đợt.

Backend unit/quality: npm test, npm run lint/typecheck/build; web commands ở README gốc. Không gửi SMS/email/control hardware thật trong automated tests. [Kế hoạch nghiệm thu](IMPLEMENTATION_PLAN.md), [bàn giao](MODULE_HANDOFF.md).
