import { useState, type FormEvent } from "react";
import { Mail, ShieldCheck, UserRound } from "lucide-react";
import { useAuth, useSession } from "../auth/session";
import { useTask } from "../hooks/useTask";
import { Field, Notice } from "./ui";

export function AccountTools() {
  const { api, user } = useSession();
  const { logout, reloadProfile } = useAuth();
  const task = useTask();
  const [name, setName] = useState(user.user_name);
  const [email, setEmail] = useState(user.gmail ?? "");
  const [emailOtp, setEmailOtp] = useState("");
  const [verification, setVerification] = useState<string>();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [passwordRequested, setPasswordRequested] = useState(false);
  const [message, setMessage] = useState("");
  const [activeSection, setActiveSection] = useState<
    "name" | "email" | "password"
  >();
  function submit(
    event: FormEvent,
    section: "name" | "email" | "password",
    work: () => Promise<void>,
  ) {
    event.preventDefault();
    setActiveSection(section);
    setMessage("");
    void task.run(work);
  }
  return (
    <div className="account-settings-grid">
      <section
        className="panel account-setting account-name"
        aria-label="Tên hiển thị"
      >
        <div className="account-section-heading">
          <span className="account-section-icon">
            <UserRound size={22} />
          </span>
          <div>
            <h2>Thông tin cá nhân</h2>
            <p>Tên hiển thị giúp mọi người nhận ra bạn khi làm việc.</p>
          </div>
        </div>
        {activeSection === "name" && (
          <>
            {message && <Notice kind="success">{message}</Notice>}
            {task.error && <Notice kind="error">{task.error}</Notice>}
          </>
        )}
        <form
          className="account-name-form"
          onSubmit={(event) =>
            submit(event, "name", async () => {
              await api.request("account/profile", {
                method: "PATCH",
                body: { user_name: name.trim() },
              });
              await reloadProfile();
              setMessage("Đã cập nhật tên hiển thị.");
            })
          }
        >
          <Field label="Tên hiển thị mới">
            <input
              required
              minLength={1}
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <button className="button secondary" disabled={task.busy}>
            Lưu tên
          </button>
        </form>
      </section>
      <section className="panel account-setting" aria-label="Email tài khoản">
        <div className="account-section-heading">
          <span className="account-section-icon">
            <Mail size={22} />
          </span>
          <div>
            <span className="section-label">LIÊN HỆ</span>
            <h2>Email tài khoản</h2>
          </div>
        </div>
        <p className="muted">
          Email mới chỉ được lưu sau khi xác minh. Email đăng ký của Quản lý HTX
          vẫn bắt buộc được xác minh.
        </p>
        {activeSection === "email" && (
          <>
            {message && <Notice kind="success">{message}</Notice>}
            {task.error && <Notice kind="error">{task.error}</Notice>}
          </>
        )}
        <form
          className="workflow-form"
          onSubmit={(event) =>
            submit(event, "email", async () => {
              const response = await api.request<{ verification_id: string }>(
                "account/email/request",
                { method: "POST", body: { gmail: email.trim() } },
              );
              setVerification(response.verification_id);
              setEmailOtp("");
              setMessage("Đã yêu cầu gửi mã tới email mới. Mã có hạn 10 phút.");
            })
          }
        >
          <Field label="Email cần xác minh">
            <input
              type="email"
              required
              maxLength={255}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setVerification(undefined);
              }}
            />
          </Field>
          <button className="button secondary" disabled={task.busy}>
            Gửi mã xác minh email
          </button>
        </form>
        {verification && (
          <div className="account-verification">
            <h3>Xác minh email mới</h3>
            <p className="muted">
              Nhập mã 6 số được gửi tới {email}. Mã có hạn 10 phút.
            </p>
            <form
              className="workflow-form"
              onSubmit={(event) =>
                submit(event, "email", async () => {
                  await api.request("account/email/verify", {
                    method: "POST",
                    body: { verification_id: verification, otp: emailOtp },
                  });
                  setVerification(undefined);
                  setEmailOtp("");
                  await reloadProfile();
                  setMessage("Đã xác minh và lưu email tài khoản.");
                })
              }
            >
              <Field label="Mã xác minh email">
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={emailOtp}
                  onChange={(event) => setEmailOtp(event.target.value)}
                />
              </Field>
              <button className="button" disabled={task.busy}>
                Xác minh email tài khoản
              </button>
            </form>
          </div>
        )}
      </section>
      <section
        className="panel account-setting account-security"
        aria-label="Đổi mật khẩu"
      >
        <div className="account-section-heading">
          <span className="account-section-icon">
            <ShieldCheck size={22} />
          </span>
          <div>
            <span className="section-label">BẢO MẬT</span>
            <h2>Đổi mật khẩu</h2>
          </div>
        </div>
        <p className="muted">
          Cần mật khẩu hiện tại và OTP gửi tới số điện thoại đã đăng ký. Đổi
          xong sẽ đăng xuất các phiên cũ.
        </p>
        {activeSection === "password" && (
          <>
            {message && <Notice kind="success">{message}</Notice>}
            {task.error && <Notice kind="error">{task.error}</Notice>}
          </>
        )}
        <form
          className="workflow-form"
          onSubmit={(event) =>
            submit(event, "password", async () => {
              await api.request("account/password/request", {
                method: "POST",
                body: { current_password: oldPassword },
              });
              setPasswordRequested(true);
              setPhoneOtp("");
              setMessage(
                "Đã yêu cầu gửi OTP tới số điện thoại tài khoản. Mã có hạn 5 phút.",
              );
            })
          }
        >
          <Field label="Mật khẩu hiện tại">
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="current-password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
            />
          </Field>
          <button className="button secondary" disabled={task.busy}>
            Gửi OTP đổi mật khẩu
          </button>
        </form>
        {passwordRequested && (
          <div className="account-verification">
            <h3>Xác nhận mật khẩu mới</h3>
            <p className="muted">
              Nhập OTP gửi tới {user.phone_number}. Mã có hạn 5 phút.
            </p>
            <form
              className="workflow-form"
              onSubmit={(event) =>
                submit(event, "password", async () => {
                  await api.request("account/password/confirm", {
                    method: "POST",
                    body: {
                      current_password: oldPassword,
                      new_password: newPassword,
                      otp: phoneOtp,
                    },
                  });
                  setOldPassword("");
                  setNewPassword("");
                  setPhoneOtp("");
                  logout();
                })
              }
            >
              <Field label="Mã OTP đổi mật khẩu">
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={phoneOtp}
                  onChange={(event) => setPhoneOtp(event.target.value)}
                />
              </Field>
              <Field label="Mật khẩu mới">
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </Field>
              <button className="button" disabled={task.busy}>
                Xác nhận đổi mật khẩu
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
