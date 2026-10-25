import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  ChevronDown,
  UserRound,
} from "lucide-react";
import { useAuth, useSession } from "../auth/session";
import { Brand } from "./Brand";
import { Notice, PageHeader } from "./ui";
import {
  navigationForRole,
  selectedNavigation,
  routeRoles,
} from "./navigation";
import type { Role } from "../types/api";
import { valueLabels } from "./presentation";
import "./RoleNavigation.css";

export function ProtectedLayout() {
  const auth = useAuth();
  if (auth.loading)
    return <main className="data-state">Đang kiểm tra phiên…</main>;
  if (!auth.session) return <Navigate to="/login" replace />;
  // JWT thay đổi khi người dùng còn hoạt động; không remount trang/form vì
  // gia hạn credentials. Đổi tài khoản vẫn dựng lại cây UI để bỏ state cũ.
  return <Shell key={auth.session.user.id} />;
}
function Shell() {
  const { user } = useSession();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const selected = selectedNavigation(user.role, location.pathname);
  const [expanded, setExpanded] = useState<string | undefined>(
    selected?.group.id,
  );
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setExpanded(selected?.group.id);
  }, [location.pathname, selected?.group.id]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  const roleLabel = {
    Admin: "Quản trị hệ thống",
    Farmer: "Nhà vườn",
    Manager: "Quản lý hợp tác xã",
  }[user.role];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Đến nội dung chính
      </a>
      {open && (
        <button
          className="nav-backdrop"
          aria-label="Đóng menu"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        className={`sidebar role-sidebar ${open ? "open" : ""}`}
      >
        <div className="sidebar-brand">
          <Link to="/" onClick={() => setOpen(false)}>
            <Brand />
          </Link>
          <button
            className="icon-button mobile-menu"
            aria-label="Đóng menu"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-label">
          <span className="section-label">KHÔNG GIAN LÀM VIỆC</span>
          <strong>{roleLabel}</strong>
        </div>
        <nav aria-label="Điều hướng chính">
          <NavLink to="/" end onClick={() => setOpen(false)}>
            <LayoutDashboard size={19} />
            {user.role === "Admin"
              ? "Tổng quan quản trị"
              : user.role === "Manager"
                ? "Tổng quan HTX"
                : "Tổng quan"}
          </NavLink>
          {navigationForRole(user.role).map((group) => {
            const Icon = group.icon,
              isOpen = expanded === group.id;
            return (
              <div className="role-nav-group" key={group.id}>
                <button
                  type="button"
                  className={`role-nav-toggle ${selected?.group.id === group.id ? "current" : ""}`}
                  aria-expanded={isOpen}
                  aria-controls={`nav-${group.id}`}
                  onClick={() => setExpanded(isOpen ? undefined : group.id)}
                >
                  <Icon size={19} />
                  <span>{group.title}</span>
                  <ChevronDown size={16} className={isOpen ? "expanded" : ""} />
                </button>
                <div
                  id={`nav-${group.id}`}
                  className="role-nav-items"
                  hidden={!isOpen}
                >
                  {group.items.map(({ to, title }) => (
                    <Link
                      key={to}
                      to={to}
                      className={
                        selected?.item.to === to ? "active" : undefined
                      }
                      aria-current={
                        selected?.item.to === to ? "page" : undefined
                      }
                      onClick={() => setOpen(false)}
                    >
                      {title}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <NavLink
            className="role-account-link"
            to="/account"
            onClick={() => setOpen(false)}
          >
            <UserRound size={18} />
            Tài khoản
          </NavLink>
          <div className="user-block">
            <span className="avatar">
              {user.user_name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user.user_name}</strong>
              <small>{valueLabels[user.role]}</small>
            </div>
          </div>
          <button className="logout" onClick={logout}>
            <LogOut size={18} />
            Đăng xuất
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="actions">
            <button
              className="icon-button mobile-menu"
              aria-label="Mở menu"
              aria-expanded={open}
              aria-controls="workspace-sidebar"
              ref={menuButton}
              onClick={() => setOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Smart Durian <span>/</span>{" "}
              {location.pathname === "/"
                ? "Tổng quan"
                : location.pathname === "/account"
                  ? "Tài khoản"
                  : (selected?.item.title ?? "Chi tiết")}
            </span>
          </div>
          <span className="topbar-role">
            <span className="status-dot" />
            {roleLabel}
          </span>
        </header>
        <main id="main-content" tabIndex={-1} className="page-content">
          <Outlet />
        </main>
        <footer className="app-footer">
          Smart Durian Farm · Quản lý nông nghiệp thông minh
        </footer>
      </div>
    </div>
  );
}
export function AdminGuard() {
  return <RoleGuard roles={routeRoles.administration} />;
}
export function RoleGuard({ roles }: { roles: readonly Role[] }) {
  return roles.includes(useSession().user.role) ? (
    <Outlet />
  ) : (
    <>
      <PageHeader title="Không có quyền truy cập" />
      <Notice kind="warning">
        Trang này không thuộc quyền truy cập của vai trò hiện tại.
      </Notice>
      <Link className="button" to="/">
        Về tổng quan
      </Link>
    </>
  );
}
