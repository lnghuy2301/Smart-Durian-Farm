import { useCallback } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { Camera, MessageCircle, RefreshCw } from "lucide-react";
import { useSession } from "../../auth/session";
import { useResource } from "../../hooks/useResource";
import { Notice, PageHeader } from "../../components/ui";
import { DiagnosisPage } from "./DiagnosisPage";
import { ChatPage } from "./ChatPage";
import type { AiStatus } from "./types";
import "./ai.css";

export default function AiToolsPage() {
  const { api } = useSession();
  const load = useCallback(
    (signal: AbortSignal) => api.request<AiStatus>("ai/status", { signal }),
    [api],
  );
  const status = useResource("ai/status", load);
  return (
    <div className="ai-tools">
      <PageHeader
        title="Hỗ trợ canh tác"
        subtitle="Kiểm tra ảnh và hỏi về cách chăm sóc sầu riêng."
        actions={
          <button className="button secondary" onClick={status.reload}>
            <RefreshCw size={16} /> Kiểm tra kết nối
          </button>
        }
      />
      <nav className="ai-tabs" aria-label="Công cụ hỗ trợ canh tác">
        <NavLink to="/ai/diagnoses">
          <Camera size={19} /> Kiểm tra ảnh sâu bệnh
        </NavLink>
        <NavLink to="/ai/chat">
          <MessageCircle size={19} /> Hỏi trợ lý canh tác
        </NavLink>
      </nav>
      {status.loading && (
        <p role="status" className="table-note">
          Đang kiểm tra dịch vụ hỗ trợ…
        </p>
      )}
      {status.error && (
        <Notice kind="error">
          Chưa kiểm tra được dịch vụ. Bạn vẫn có thể mở lịch sử của mình.{" "}
          <button className="button secondary" onClick={status.reload}>
            Thử lại kết nối
          </button>
        </Notice>
      )}
      <Routes>
        <Route index element={<Navigate to="diagnoses" replace />} />
        <Route
          path="diagnoses"
          element={<DiagnosisPage status={status.data} />}
        />
        <Route path="chat" element={<ChatPage status={status.data} />} />
        <Route path="*" element={<Navigate to="/ai/diagnoses" replace />} />
      </Routes>
      <p className="ai-privacy">
        Ảnh, kết quả và hội thoại được lưu riêng trong tài khoản của bạn. Gợi ý
        AI không tự thay đổi nhật ký hoặc điều khiển thiết bị.
      </p>
    </div>
  );
}
