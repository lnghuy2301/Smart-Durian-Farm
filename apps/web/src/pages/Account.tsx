import { useSession } from "../auth/session";
import { Badge, Field, PageHeader } from "../components/ui";
import { Mail, Phone, UserRound } from "lucide-react";
import { valueLabels } from "../components/presentation";
import { AccountTools } from "../components/AccountTools";
import "./Account.css";
export function AccountPage() {
  const { user } = useSession();
  return (
    <div className="account-page">
      <PageHeader
        title="Thông tin tài khoản"
        subtitle="Quản lý thông tin cá nhân, liên hệ và bảo mật của bạn."
      />
      <section className="panel account-overview" aria-label="Hồ sơ tài khoản">
        <div className="account-profile">
          <span className="account-avatar" aria-hidden="true">
            <UserRound size={30} />
          </span>
          <div>
            <h2>{user.user_name}</h2>
            <p>{valueLabels[user.role]}</p>
          </div>
        </div>
        <dl className="account-contact-details">
          <div>
            <dt>
              <Phone size={16} /> Số điện thoại
            </dt>
            <dd>{user.phone_number}</dd>
          </div>
          <div>
            <dt>
              <Mail size={16} /> Email
            </dt>
            <dd>
              {user.gmail ?? "Chưa có email"}{" "}
              <Badge
                status={user.gmail_verify ? "Đã xác minh" : "Chưa xác minh"}
              />
            </dd>
          </div>
        </dl>
        <details className="account-id">
          <summary>Xem mã tài khoản</summary>
          <Field
            label="Mã tài khoản"
            hint="Sao chép mã này để chủ vườn mời bạn phụ trách khu vực. Mã không thay thế quyền truy cập."
          >
            <input
              readOnly
              value={user.id}
              onFocus={(e) => e.target.select()}
            />
          </Field>
        </details>
      </section>
      <AccountTools />
    </div>
  );
}
