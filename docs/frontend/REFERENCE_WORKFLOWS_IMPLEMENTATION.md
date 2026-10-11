# Triển khai các mẫu quản lý Smart Durian — 2026-10-11

Đợt này thực hiện yêu cầu đọc HTML/ảnh trong `references/stitch_smart_durian_farmer_dashboard` và dựng frontend tương ứng với API hiện tại. Base `feat/postgres-farm-workflows`; không thay backend, `.env`, dependencies, migrations hoặc dữ liệu DB. AppModule nghiệp vụ vẫn RAM; các adapter PG đã hoàn thành trước đó giữ nguyên trạng thái. Font/cỡ chữ, brand kit và thiết kế đăng nhập/đăng ký đã duyệt được giữ nguyên.

## Đầu vào và phạm vi

Đã đối chiếu 11 file HTML, 12 ảnh screenshot và DESIGN chung. `approve manager_admin` chỉ có screenshot, dùng HTML trong `cooperative management_admin`. `manage_HTX` trùng SHA-256 cả HTML lẫn ảnh với `cooperative management_admin`, nên tiếp tục component HTX hiện có. Giữ nguyên các nguồn mẫu, ảnh vườn gốc và thay đổi riêng của người dùng; không chạy script demo hoặc đóng gói HTML tham khảo vào app.

| Mẫu mới | Frontend | API / tài liệu module |
| --- | --- | --- |
| `manage_farm and zone` | Vườn, khu vực, đề xuất, gia nhập/rời HTX, phân công, thông báo Manager | [Vườn/khu vực](modules/FARMS_ZONES_WEB.md) |
| `manage_tree` | Danh sách/bộ lọc, chủ ghi trực tiếp, Admin đề xuất, snapshot phê duyệt, lịch sử, link QR công khai | [Cây](modules/TREES_WEB.md) |
| `manage_harvest` | Nháp, gửi/xác nhận, đính chính, bổ sung nội dung, quyền nhập bù | [Thu hoạch](modules/HARVESTS_WEB.md) |
| `cultivation_event` | Danh sách thẻ, Watering/Spraying/Fertilizing, hạn khóa, lịch sử đính chính, kiểm tra chuỗi | [Nhật ký](modules/CULTIVATION_WEB.md) |
| `manage_IoT` | Trạm/cảm biến/bơm van, tab quan hệ, lịch sử metadata, đề xuất Admin/chủ duyệt | [IoT metadata](modules/IOT_METADATA_WEB.md) |
| `manage_HTX` | Giữ list/detail/create/edit Admin, bổ sung cập nhật Manager email→SMS và lịch sử | [HTX](modules/COOPERATIVE_UPDATES_WEB.md) |

Các dashboard Farmer/Admin/Manager bổ sung nhật ký thật và liên kết đến các luồng mới. `/account` dùng thông tin session đã xác minh bởi `/auth/me`, có mã tài khoản chỉ đọc để sao chép; không tạo endpoint danh bạ. Người dùng đã xác nhận **giữ nhập mã tài khoản tạm thời** cho chọn chủ vườn, Farmer được mời và quyền nhập bù.

## Cấu trúc và nhánh

Các nhánh là chuỗi kế thừa, không cần cherry-pick chồng các commit chung:

1. `feat/web-workflow-foundation` — `d2a7d72`: forms/dialogs, relation selectors, mutation/abort, CSS giới hạn `.workflow-*`.
2. `feat/web-farms-zones` — `d48f4d0`: Farm/Zone/membership/assignment/request center.
3. `feat/web-tree-management` — `f136fc9`: Tree owner/Admin flows, relational filters.
4. `feat/web-harvest-management` — `0253648`: harvest drafts/requests/backdate permissions.
5. `feat/web-cultivation-journals` — `c1752af`: cultivation, lineage/chain và dashboard.
6. `feat/web-iot-metadata` — `6cd7488`: IoT registry, child tabs, proposal review.
7. `feat/web-cooperative-workflows` — `0968811`: HTX Manager xác minh, trang mã tài khoản; kế thừa tất cả module trên.
8. `feat/web-reference-integration` — nhánh làm việc cuối, ghi các kiểm tra, tinh chỉnh responsive/feedback, format và tài liệu toàn bộ đợt.

`apps/web/src/workflows/` chứa schema form theo domain và primitives dùng chung. `pages/Resources.tsx` giữ list/detail/pagination chuẩn, thêm action tương ứng domain, bộ lọc quan hệ và statistics lấy đủ các trang theo cùng bộ lọc. `pages/Requests.tsx` dùng bảng/snapshot/diff/chữ ký với quyền theo loại phiếu. Các trang đặc thù Cultivation, FarmWorkflows, HarvestBackdates, CooperativeUpdates xử lý hợp đồng riêng; không gom workflow OTP vào các phiếu duyệt Admin.

## Quy tắc dữ liệu và giao diện

- Mọi danh sách thực lấy từ API, có loading/empty/error/retry. Phân trang20; relationship/statistics/dashboard lấy đủ các trang100, kiểm tra total/mục trùng. Thống kê không lấy trang đầu làm toàn bộ hệ thống. Thống kê harvest chỉ cộng hồ sơ Confirmed, không quy số bản ghi thành batch/vụ giả.
- Quyền chủ dựa trên Farm.owner_id hiện tại, không dựa role Farmer hoặc `is_owner` chung. Chủ ghi Zone/Tree/IoT trực tiếp; Admin đề xuất; Manager/assignee không sửa metadata. Farm luôn đề xuất. Harvest và nhật ký có quyền tác giả/phân công riêng.
- PATCH gửi field thay đổi, không nhận ID bất biến/owner/role/status backend quản lý. Date-local ở metadata chuyển sang ISO có timezone; sửa field khác không làm mất giây của timestamp cũ. Harvest dùng ngày lịch Việt Nam. Decimal/integer/range theo DTO; threshold cặp và materials trùng được kiểm tra trước gửi.
- Không tự retry mutation. `useTask` chặn gửi kép, abort khi unmount/đổi phiên; client dispose hủy response của phiên cũ. Lỗi0/409/5xx yêu cầu kiểm tra lại, không giả thành công khi kết quả chưa rõ. Phiếu vẫn do backend kiểm quyền/version/chữ ký cuối cùng.
- Logo, màu, font local theo kit chính thức; không thêm thư viện. Bảng cuộn trong panel, dialog có cuộn dọc, nội dung dùng grid/flex; CSS mới giới hạn workflow classes. Không sửa auth component/validation/OTP/session logic hoặc theme chung.
- Không tạo nút AI/PDF/export chưa có API. IoT metadata không điều khiển relay. QR công khai đã có từ đợt trước, vẫn ngoài AuthProvider và không gửi JWT.

## Chạy và tái lập

Node>=20.19, dependencies đã có thì bỏ `npm ci`. Từ root, hai terminal:

```powershell
npm ci
npm run dev:api
# Terminal khác
npm run dev:web
```

Mở http://127.0.0.1:5173. Proxy mặc định API http://127.0.0.1:3000; nếu khác, cấu hình public/dev theo [README web](../../apps/web/README.md), không copy secrets root vào frontend. Đăng nhập các tài khoản dev đang có, tạo dữ liệu qua workflow, không chạy seed/migrate để demo UI. Với AppModule RAM, restart API làm mất dữ liệu runtime; không nhầm với kiểm tra các repository PG biệt lập.

Trình tự manual: Farmer tạo Farm → Admin duyệt → chủ tạo Zone với Standard Active → chủ thêm Tree → Admin đề xuất/chủ duyệt → chủ mời Farmer qua mã tài khoản, người nhận chấp nhận → assignee ghi Harvest và chủ xác nhận → tạo đính chính/đúng reviewer duyệt → Farmer ghi nhật ký, sửa trước hạn, xem khóa/lineage → chủ cấu hình Device/Sensor/Actuator → Manager sửa HTX và xác minh email/SMS. Kiểm tra read-only cho Manager/assignee ở metadata; tham khảo guide từng module cho lỗi409, lý do-only và nhập bù.

## Kiểm tra tự động

```powershell
npm run lint:web
npm run typecheck:web
npm run test:web
npm run build:web
npm run test:web:e2e
npm run format:check -w apps/web
```

Browser dùng Edge có sẵn hoặc `WEB_TEST_BROWSER` trỏ Chrome/Edge, chạy Nest/Vite/MQTT loopback riêng, email capture/mock SMS và stores RAM. Không đọc root `.env`, không gửi tin thật, không gọi phần cứng/DB thật. `test/workflows-browser.mjs` được gọi từ suite hiện có: tạo/duyệt qua UI, stale409, scope sau phân công, reason-only harvest correction, null sensor thresholds, nhật ký lock/correction/chain, HTX OTP hai bước và viewport1440×1000,1366×640,390×844. Fixture nhật ký đặt deadline cũ trước khi khóa, không thay đồng hồ/JWT toàn môi trường. Failure screenshot và report đặt trong `apps/web/test-results/` bị Git ignore.

Kết quả ngày 2026-10-11: **37/37 browser (29 hồi quy +8 workflow mới), 8/8 unit**, lint/typecheck/build/format đạt. Browser không có uncaught error; report và 16 ảnh preview nằm trong `apps/web/test-results/`. Sau đối chiếu ảnh mobile, bảng quản lý được giới hạn bằng `.workflow-record-scroll` với chiều rộng tối thiểu960px/cột tên180px để mã không vỡ thành từng mẩu; cuộn ngang vẫn nằm trong panel. Các kiểm tra workflow được chạy lại sau tinh chỉnh này. Production bundle khoảng440kB JS (gzip128kB), CSS32kB (gzip7kB), ảnh vườn hiện có3.69MB; không thêm ảnh/thư viện trong đợt này. Các con số29browser trước đây là checkpoint cũ; backend228/persistence85 là checkpoint của đợt backend trước, không chạy lại DB trong đợt UI này.

### Đối chiếu thực tế theo vai trò

| Tình huống | Cách kiểm tra và kết quả mong đợi |
| --- | --- |
| Farmer chủ vườn | Gửi Farm → chưa có Farm chính thức → Admin duyệt → tạo Zone/Tree trực tiếp; metadata hiện đúng sau GET lại. |
| Admin đề xuất | Sửa Tree/Device qua đề xuất → bản chính chưa đổi → chủ mở snapshot/diff và duyệt; snapshot cũ bị backend trả409, dialog khóa gửi lại. |
| Farmer được phân công | Nhận lời mời bằng mã tài khoản → chấp nhận → đọc metadata không có nút sửa; ghi Harvest → chủ xác nhận. |
| Farmer đã hết phân công | Harvest có bản xác nhận cũ cho phép tác giả gửi lý do, không tự sửa nội dung; chủ chuẩn bị proposed_changes rồi reviewer Admin/Manager phù hợp duyệt. |
| Nhật ký | Tạo/sửa Watering không gia hạn deadline; khóa → tạo correction → bản Locked gốc giữ nguyên → chain xác minh hợp lệ; Admin/Manager không có nút ghi. |
| Manager HTX | Đề xuất tên mới → HTX giữ tên cũ → xác minh email → gửi/xác minh SMS → Accepted và HTX đổi tên. |
| Responsive | Các list/detail/filter mới không tràn body ở1440×1000,1366×640,390×844; bảng cuộn riêng, form vật tư/dialog cuộn dọc và đóng được. |

Fixture browser tự tạo tài khoản/catalog/Farm/Zone/Tree/IoT theo API trong server biệt lập, không cần đưa sẵn dữ liệu vào DB. OTP chỉ được lấy qua capture/mock transport trong test harness; source sản phẩm không lấy mã OTP từ endpoint debug. Các biến thể lỗi/hết hạn/cancel/backdate/membership còn lại có hướng dẫn manual theo module; không coi bảng trên là chứng cứ đã thử mọi tổ hợp nghiệp vụ hoặc thiết bị thật.

## Hạn chế được giữ rõ

Chưa có API directory Farmer/Manager Active; dùng mã tài khoản được người dùng chấp nhận, không giả dropdown tên. Không có farm_name hoặc đơn vị diện tích xác định trong DTO: dùng chứng nhận/địa chỉ và giữ số gốc. Harvest API chưa có query khoảng ngày: không gửi query không hỗ trợ. Các tác vụ radio/AI và persistence đầy đủ không thuộc đợt UI này. Tiếp backend theo roadmap Zone persistence đã chốt, không làm lại Users/HTX/catalogs/Farm PG.

## Dấu vết nguồn tham khảo

SHA-256 của HTML dùng để đối chiếu mẫu khi tái lập; ảnh gốc giữ tại folder tương ứng:

| Folder | `code.html` SHA-256 |
| --- | --- |
| `manage_farm and zone` | `b69a78d607144efb52c4c264cd3b520170bfc17d36d43c8698eafd9df9434839` |
| `manage_tree` | `b186f3332ae476439e534c1b5b6983a63916ed109d90325a2ccbac4d9431c9bd` |
| `manage_harvest` | `80f5f218d2d38c7faf05e25b2bdd58ff1b13af94cde242e8683be4d17e9c0af5` |
| `cultivation_event` | `afed0a100f984641bd9c86a3e539fd1fc433bd683d71d45ac0e9949d5b0206e3` |
| `manage_IoT` | `02a9a5989d466a651c53fb19aa74f60cc07212e368a2bcafc4f974e3e63805c2` |
| `manage_HTX` | `09ef5a76ca28c7e8fea243d60dd3758aa1bcf811e900453226659c2b70906001` |
