import { useSession } from "../auth/session";
import { Field, PageHeader } from "../components/ui";
export function AccountPage() {
  const { user } = useSession();
  return (
    <>
      <PageHeader
        title="Thông tin tài khoản"
        subtitle="Thông tin tài khoản đang đăng nhập."
      />
      <section className="panel workflow-summary">
        <h2>{user.user_name}</h2>
        <dl className="details">
          <div>
            <dt>Vai trò</dt>
            <dd>{user.role}</dd>
          </div>
          <div>
            <dt>Số điện thoại</dt>
            <dd>{user.phone_number}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.gmail ?? "Chưa có email"}</dd>
          </div>
          <div>
            <dt>Xác minh email</dt>
            <dd>{user.gmail_verify ? "Đã xác minh" : "Chưa xác minh"}</dd>
          </div>
        </dl>
        <Field
          label="Mã tài khoản"
          hint="Sao chép mã này để chủ vườn mời bạn phụ trách khu vực. Mã không thay thế quyền truy cập."
        >
          <input readOnly value={user.id} onFocus={(e) => e.target.select()} />
        </Field>
      </section>
    </>
  );
}
