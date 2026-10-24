import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClient, apiBaseUrl, publicApi } from "../api/client";
import type { LoginResponse, User } from "../types/api";
import { tokenDeadline } from "./token";

const storageKey = "smart-durian.access-token";
const idleStorageKey = "smart-durian.idle-deadline";
const IDLE_MS = 15 * 60 * 1000;
function storedToken() {
  try {
    return sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}
function persist(token?: string, idleDeadline?: number) {
  try {
    if (token) sessionStorage.setItem(storageKey, token);
    else {
      sessionStorage.removeItem(storageKey);
      sessionStorage.removeItem(idleStorageKey);
    }
    if (token && idleDeadline !== undefined)
      sessionStorage.setItem(idleStorageKey, String(idleDeadline));
  } catch {
    /* Phiên trong RAM vẫn dùng được khi storage bị chặn. */
  }
}
interface Session {
  user: User;
  api: ApiClient;
  deadline: number;
  token: string;
}
interface AuthState {
  session?: Session;
  loading: boolean;
  message: string;
  login: (
    phone: string,
    password: string,
    signal: AbortSignal,
  ) => Promise<void>;
  logout: () => void;
  reloadProfile: () => Promise<void>;
}
const Context = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const active = useRef<ApiClient | undefined>(undefined);
  const generation = useRef(0);
  const sessionRef = useRef<Session | undefined>(undefined);
  sessionRef.current = session;
  const idleDeadlineRef = useRef(0);
  function close(reason = "") {
    generation.current++;
    active.current?.dispose();
    active.current = undefined;
    persist();
    setSession(undefined);
    setLoading(false);
    setMessage(reason);
  }
  async function establish(
    token: string,
    deadline: number,
    signal: AbortSignal,
    idleDeadline = deadline,
  ) {
    const current = ++generation.current;
    active.current?.dispose();
    const api = new ApiClient(apiBaseUrl, token, () => {
      if (current === generation.current)
        close(
          "Phiên đã hết hạn hoặc tài khoản đã thay đổi. Vui lòng đăng nhập lại.",
        );
    });
    active.current = api;
    try {
      const user = await api.request<User>("auth/me", { signal });
      if (current !== generation.current || signal.aborted)
        throw new DOMException("Đã huỷ", "AbortError");
      if (
        !["Admin", "Manager", "Farmer"].includes(user.role) ||
        user.status !== "Active" ||
        deadline <= Date.now()
      )
        throw new Error("Tài khoản hoặc phiên đăng nhập không hợp lệ.");
      if (idleDeadline <= Date.now())
        throw new Error("Phiên đã hết hạn do không hoạt động.");
      idleDeadlineRef.current = idleDeadline;
      persist(token, idleDeadline);
      setMessage("");
      setSession({ user, api, deadline, token });
      setLoading(false);
    } catch (error) {
      api.dispose();
      if (current === generation.current) {
        active.current = undefined;
        persist();
        setSession(undefined);
        setLoading(false);
      }
      throw error;
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const token = storedToken();
    const deadline = token ? tokenDeadline(token) : undefined;
    let savedIdle = 0;
    try {
      savedIdle = Number(sessionStorage.getItem(idleStorageKey));
    } catch {
      /* storage có thể bị chặn */
    }
    if (token && deadline && deadline > Date.now()) {
      void establish(
        token,
        deadline,
        controller.signal,
        savedIdle > 0 ? savedIdle : deadline,
      ).catch((error: unknown) => {
        if (!controller.signal.aborted)
          setMessage(
            error instanceof Error
              ? error.message
              : "Không khôi phục được phiên.",
          );
      });
    } else {
      persist();
      setLoading(false);
      if (token) setMessage("Phiên đăng nhập đã hết hạn.");
    }
    return () => {
      controller.abort();
      active.current?.dispose();
    };
    // Chỉ khôi phục một lần khi mount; các phiên mới dùng login bên dưới.
  }, []);
  useEffect(() => {
    if (!session) return;
    const api = session.api,
      currentGeneration = generation.current;
    let pending = false,
      lastRefresh = Date.now(),
      lastPersist = 0,
      dirty = false;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const current = sessionRef.current;
      if (
        current?.api === api &&
        (Date.now() >= idleDeadlineRef.current ||
          Date.now() >= (tokenDeadline(current.token) ?? 0))
      )
        close(
          "Phiên đã hết hạn sau 15 phút không hoạt động hoặc không thể gia hạn. Vui lòng đăng nhập lại.",
        );
    };
    const renew = () => {
      trailing = undefined;
      check();
      const current = sessionRef.current;
      if (
        !dirty ||
        pending ||
        !current ||
        current.api !== api ||
        currentGeneration !== generation.current
      )
        return;
      const now = Date.now();
      pending = true;
      dirty = false;
      lastRefresh = now;
      void api
        .request<LoginResponse>("auth/refresh", { method: "POST", body: {} })
        .then((response) => {
          if (
            currentGeneration !== generation.current ||
            sessionRef.current?.api !== api
          )
            return;
          const expiration = tokenDeadline(response.access_token);
          if (
            !expiration ||
            expiration <= Date.now() ||
            response.user.id !== current.user.id
          ) {
            close("Máy chủ trả phiên không hợp lệ.");
            return;
          }
          api.replaceToken(response.access_token);
          persist(response.access_token, idleDeadlineRef.current);
          setSession({
            ...current,
            user: response.user,
            token: response.access_token,
            deadline: idleDeadlineRef.current,
          });
        })
        .catch(() => {
          /* Không tự retry khi lỗi mạng; thao tác người dùng kế tiếp sẽ thử lại. */
        })
        .finally(() => {
          pending = false;
          if (
            dirty &&
            currentGeneration === generation.current &&
            trailing === undefined
          )
            trailing = setTimeout(
              renew,
              Math.max(0, 15000 - (Date.now() - lastRefresh)),
            );
        });
    };
    const activity = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible") return;
      check();
      const current = sessionRef.current;
      if (
        !current ||
        current.api !== api ||
        currentGeneration !== generation.current
      )
        return;
      const now = Date.now();
      idleDeadlineRef.current = now + IDLE_MS;
      dirty = true;
      if (now - lastPersist >= 1000) {
        persist(current.token, idleDeadlineRef.current);
        lastPersist = now;
      }
      if (pending) return;
      if ((tokenDeadline(current.token) ?? 0) - now <= 30000) {
        if (trailing !== undefined) clearTimeout(trailing);
        trailing = undefined;
        renew();
        return;
      }
      if (trailing !== undefined) return;
      if (now - lastRefresh >= 15000) renew();
      else trailing = setTimeout(renew, 15000 - (now - lastRefresh));
    };
    // User input alone counts as activity. Focus, auth/me, MQTT and polling
    // only check expiry; a hidden tab cannot keep the session alive by itself.
    const events = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "touchstart",
      "input",
    ];
    for (const name of events)
      window.addEventListener(name, activity, { passive: true });
    const timer = setInterval(check, 1000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      if (trailing !== undefined) clearTimeout(trailing);
      for (const name of events) window.removeEventListener(name, activity);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [session?.api]);
  async function login(phone: string, password: string, signal: AbortSignal) {
    const response = await publicApi.request<LoginResponse>("auth/login", {
      method: "POST",
      body: { phone_number: phone, password },
      signal,
    });
    const deadline = tokenDeadline(response.access_token);
    if (!deadline || deadline <= Date.now())
      throw new Error("Máy chủ trả phiên không hợp lệ.");
    await establish(
      response.access_token,
      Math.min(deadline, Date.now() + response.expires_in * 1000),
      signal,
    );
  }
  async function reloadProfile() {
    const api = active.current;
    if (!api) return;
    const user = await api.request<User>("auth/me");
    setSession((current) =>
      current?.api === api ? { ...current, user } : current,
    );
  }
  return (
    <Context.Provider
      value={{
        session,
        loading,
        message,
        login,
        logout: () => close(),
        reloadProfile,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("Thiếu AuthProvider");
  return value;
}
export function useSession() {
  const { session } = useAuth();
  if (!session) throw new Error("Thiếu phiên đăng nhập");
  return session;
}
