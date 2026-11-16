import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  MessageCircle,
  Plus,
  Send,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import { ConfirmDialog } from "../../workflows/shared";
import { ChatMarkdown } from "./ChatMarkdown";
import { ApiError } from "../../api/client";
import { useSession } from "../../auth/session";
import { useResource } from "../../hooks/useResource";
import { useTask } from "../../hooks/useTask";
import {
  DataState,
  Field,
  Notice,
  Pagination,
  dateTime,
} from "../../components/ui";
import type { Page } from "../../types/api";
import type {
  AiStatus,
  Citation,
  Conversation,
  ConversationSummary,
} from "./types";

export function ChatPage({ status }: { status?: AiStatus }) {
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  const [question, setQuestion] = useState("");
  const [warning, setWarning] = useState("");
  const [revision, setRevision] = useState(0);
  const chatPanel = useRef<HTMLElement>(null);
  const enabled = !!status?.chat_provider_configured;
  return (
    <>
      <div className="ai-page-intro">
        <h2>Hỏi trợ lý canh tác</h2>
        <p>
          Hỏi về chăm sóc sầu riêng hoặc trao đổi với trợ lý. Nguồn chỉ hiện khi
          câu trả lời sử dụng tài liệu.
        </p>
      </div>
      {status && !enabled && (
        <Notice>
          Trợ lý hiện chưa được kết nối dịch vụ trả lời. Bạn vẫn có thể xem hội
          thoại đã lưu. Khi dịch vụ sẵn sàng, hãy bấm Kiểm tra kết nối để tiếp
          tục.
        </Notice>
      )}
      {warning && <Notice kind="warning">{warning}</Notice>}
      <section
        ref={chatPanel}
        tabIndex={-1}
        className="panel ai-chat"
        aria-label="Hội thoại với trợ lý"
      >
        <div className="ai-chat-heading">
          <h3>
            <MessageCircle size={20} />{" "}
            {id ? "Hội thoại của bạn" : "Bạn muốn hỏi điều gì?"}
          </h3>
          {id && (
            <Link
              className="button secondary"
              to="/ai/chat"
              onClick={() => {
                setQuestion("");
                setWarning("");
              }}
            >
              <Plus size={17} /> Cuộc trò chuyện mới
            </Link>
          )}
        </div>
        {id ? (
          <ChatThread
            key={id}
            id={id}
            enabled={enabled}
            question={question}
            setQuestion={setQuestion}
            initiallyBlocked={!!warning}
            onReconciled={() => setWarning("")}
            onSaved={() => {
              setWarning("");
              setRevision((value) => value + 1);
            }}
          />
        ) : (
          <NewChat
            enabled={enabled}
            question={question}
            setQuestion={setQuestion}
            onOpen={(recordId, error) => {
              setWarning(error ?? "");
              if (!error) setQuestion("");
              setRevision((value) => value + 1);
              setParams({ id: recordId });
            }}
          />
        )}
      </section>
      <ChatHistory
        revision={revision}
        selected={id}
        onDeleted={(deletedId) => {
          if (deletedId === id) {
            setQuestion("");
            setWarning("");
            setParams({});
          }
          setRevision((value) => value + 1);
        }}
        onSelect={() => {
          setQuestion("");
          setWarning("");
          chatPanel.current?.focus({ preventScroll: true });
          chatPanel.current?.scrollIntoView({ block: "start" });
        }}
      />
    </>
  );
}

function Composer({
  question,
  setQuestion,
  disabled,
  busy,
  onSubmit,
}: {
  question: string;
  setQuestion: (value: string) => void;
  disabled: boolean;
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form className="ai-composer" ref={form} onSubmit={onSubmit}>
      <Field
        label="Câu hỏi của bạn"
        hint="Enter để gửi, Shift + Enter để xuống dòng."
      >
        <textarea
          required
          maxLength={4000}
          rows={3}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ví dụ: Tôi cần lưu ý gì khi chăm sóc sầu riêng sau thu hoạch?"
          disabled={busy}
          onKeyDown={(event) => {
            // Do not submit while a Vietnamese IME is committing a word.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              if (!disabled && !busy && question.trim())
                form.current?.requestSubmit();
            }
          }}
        />
      </Field>
      <div className="ai-composer-actions">
        <span className="table-note">
          {question.length.toLocaleString("vi-VN")} / 4.000 ký tự
        </span>
        <button
          className="button"
          disabled={disabled || busy || !question.trim()}
        >
          <Send size={17} /> {busy ? "Đang tra cứu…" : "Gửi câu hỏi"}
        </button>
      </div>
    </form>
  );
}

function NewChat({
  enabled,
  question,
  setQuestion,
  onOpen,
}: {
  enabled: boolean;
  question: string;
  setQuestion: (value: string) => void;
  onOpen: (id: string, error?: string) => void;
}) {
  const { api } = useSession();
  const task = useTask();
  return (
    <>
      <div className="ai-chat-welcome">
        <BookOpen size={34} />
        <p>
          Mô tả giống cây, giai đoạn sinh trưởng và điều bạn đang gặp để câu hỏi
          rõ hơn.
        </p>
        <div className="ai-question-suggestions">
          {[
            "Chăm sóc sầu riêng sau thu hoạch cần lưu ý những gì?",
            "Khi kiểm tra cây có dấu hiệu thán thư, tôi cần ghi nhận gì?",
            "Nhật ký canh tác nên ghi những thông tin nào?",
          ].map((text) => (
            <button
              className="button secondary"
              disabled={task.busy}
              key={text}
              onClick={() => setQuestion(text)}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      {task.error && (
        <Notice kind="error">
          {task.error} Nội dung câu hỏi vẫn được giữ. Nếu mất kết nối, hãy kiểm
          tra lịch sử trước khi gửi lại.
        </Notice>
      )}
      <Composer
        question={question}
        setQuestion={setQuestion}
        disabled={!enabled}
        busy={task.busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (!enabled || !question.trim()) return;
          void task.run(async (signal) => {
            let created: Conversation | undefined;
            try {
              created = await api.request<Conversation>("ai/conversations", {
                method: "POST",
                body: { session_title: question.trim().slice(0, 120) },
                signal,
              });
              await api.request<Conversation>(
                `ai/conversations/${created.id}/messages`,
                {
                  method: "POST",
                  body: { message: question.trim() },
                  signal,
                  timeoutMs: 45000,
                },
              );
              onOpen(created.id);
            } catch (error) {
              if (signal.aborted) return;
              // Creating and sending are two existing APIs, not one transaction.
              // Keep the known conversation and draft after a failed/ambiguous send.
              if (created)
                onOpen(
                  created.id,
                  error instanceof Error
                    ? error.message
                    : "Chưa gửi được câu hỏi.",
                );
              else throw error;
            }
          });
        }}
      />
    </>
  );
}

function ChatThread({
  id,
  enabled,
  question,
  setQuestion,
  initiallyBlocked,
  onSaved,
  onReconciled,
}: {
  id: string;
  enabled: boolean;
  question: string;
  setQuestion: (value: string) => void;
  initiallyBlocked: boolean;
  onSaved: () => void;
  onReconciled: () => void;
}) {
  const { api } = useSession();
  const load = useCallback(
    (signal: AbortSignal) =>
      api.request<Conversation>(`ai/conversations/${encodeURIComponent(id)}`, {
        signal,
      }),
    [api, id],
  );
  const resource = useResource(`ai/conversations/${id}`, load);
  const [saved, setSaved] = useState<Conversation>();
  const [blocked, setBlocked] = useState(initiallyBlocked);
  const [reviewing, setReviewing] = useState(false);
  const [denied, setDenied] = useState<Error>();
  const task = useTask();
  useEffect(() => {
    if (reviewing && !resource.loading) {
      if (resource.data) {
        setBlocked(false);
        setDenied(undefined);
        task.setError("");
        onReconciled();
      }
      setReviewing(false);
    }
  }, [reviewing, resource.loading, resource.data, task.setError, onReconciled]);
  const record = denied ? undefined : (saved ?? resource.data);
  const messages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the message pane. Opening history must not push the whole
    // page down to the composer and hide the conversation heading.
    if (messages.current)
      messages.current.scrollTop = messages.current.scrollHeight;
  }, [record?.messages.length]);
  const view = denied
    ? { ...resource, data: undefined, error: denied, loading: false, reload }
    : { ...resource, data: record, reload };
  function reload() {
    setSaved(undefined);
    setBlocked(true);
    setReviewing(true);
    resource.reload();
  }
  return (
    <>
      <div className="ai-toolbar">
        <p className="table-note">{record?.session_title}</p>
        <button
          className="button secondary"
          disabled={task.busy || resource.loading}
          onClick={reload}
        >
          Tải lại hội thoại
        </button>
      </div>
      <DataState resource={view}>
        {(value) => (
          <div
            ref={messages}
            className="ai-messages"
            role="log"
            aria-label="Nội dung hội thoại"
            aria-live="polite"
          >
            {!value.messages.length && (
              <p className="ai-empty">
                Hội thoại chưa có câu trả lời. Nội dung chưa gửi vẫn ở ô bên
                dưới.
              </p>
            )}
            {value.messages.map((message, index) => (
              <article key={index} className={`ai-message ${message.role}`}>
                <div className="ai-message-label">
                  {message.role === "user" ? "Bạn" : "Trợ lý canh tác"}
                  <span>{dateTime(message.created_at)}</span>
                </div>
                {message.role === "assistant" ? (
                  <ChatMarkdown text={message.content} />
                ) : (
                  <p>{message.content}</p>
                )}
                {message.role === "assistant" && (
                  <Sources citations={message.citations} />
                )}
              </article>
            ))}
          </div>
        )}
      </DataState>
      {task.error && <Notice kind="error">{task.error}</Notice>}
      {blocked && (
        <Notice kind="warning">
          Nội dung câu hỏi vẫn được giữ. Hãy tải lại hội thoại và đối chiếu tin
          đã lưu trước khi gửi tiếp.
        </Notice>
      )}
      {!denied && (
        <Composer
          question={question}
          setQuestion={setQuestion}
          disabled={
            !enabled ||
            blocked ||
            !record ||
            resource.loading ||
            !!resource.error
          }
          busy={task.busy}
          onSubmit={(event) => {
            event.preventDefault();
            if (!enabled || blocked || !record || !question.trim()) return;
            void task.run(async (signal) => {
              try {
                const updated = await api.request<Conversation>(
                  `ai/conversations/${id}/messages`,
                  {
                    method: "POST",
                    body: { message: question.trim() },
                    signal,
                    timeoutMs: 45000,
                  },
                );
                setSaved(updated);
                setQuestion("");
                onSaved();
              } catch (error) {
                if (
                  error instanceof ApiError &&
                  [403, 404].includes(error.status)
                ) {
                  setSaved(undefined);
                  setDenied(error);
                }
                if (
                  !(error instanceof ApiError) ||
                  [0, 409, 502, 503, 504].includes(error.status)
                )
                  setBlocked(true);
                throw error;
              }
            });
          }}
        />
      )}
    </>
  );
}

function Sources({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <details className="ai-sources">
      <summary>
        <BookOpen size={16} /> Xem {citations.length} nguồn tham khảo
      </summary>
      {citations.map((citation, index) => (
        <div className="ai-source" key={`${citation.chunk_id}:${index}`}>
          <strong>
            {index + 1}. {citation.source?.filename ?? citation.filename}
          </strong>
          <span>Trang {citation.source?.page ?? citation.page}</span>
        </div>
      ))}
    </details>
  );
}

function ChatHistory({
  revision,
  selected,
  onSelect,
  onDeleted,
}: {
  revision: number;
  selected: string | null;
  onSelect: () => void;
  onDeleted: (id: string) => void;
}) {
  const { api } = useSession();
  const [offset, setOffset] = useState(0);
  const [deleting, setDeleting] = useState<ConversationSummary>();
  const historyPanel = useRef<HTMLDetailsElement>(null);
  const path = `ai/conversations?limit=10&offset=${offset}`;
  const load = useCallback(
    (signal: AbortSignal) =>
      api.request<Page<ConversationSummary>>(path, { signal }),
    [api, path],
  );
  const history = useResource(`${path}:${revision}`, load);
  return (
    <details ref={historyPanel} className="panel ai-history ai-chat-history">
      <summary>Lịch sử trò chuyện của tôi</summary>
      <div className="ai-toolbar">
        <p className="table-note">
          Các cuộc trò chuyện riêng trong tài khoản của bạn.
        </p>
        <button className="button secondary" onClick={history.reload}>
          Làm mới lịch sử trò chuyện
        </button>
      </div>
      <DataState resource={history}>
        {(data) =>
          data.items.length ? (
            <ul className="ai-history-list">
              {data.items.map((item) => (
                <li key={item.id}>
                  <div className="ai-history-description">
                    <strong>{item.session_title}</strong>
                    <span>{dateTime(item.updated_at)}</span>
                  </div>
                  <div className="actions">
                    <Link
                      className="button secondary"
                      to={`?id=${item.id}`}
                      aria-current={selected === item.id ? "page" : undefined}
                      onClick={() => {
                        if (historyPanel.current)
                          historyPanel.current.open = false;
                        onSelect();
                      }}
                    >
                      <ArrowUpRight size={17} /> Xem lại
                    </Link>
                    <button
                      type="button"
                      className="button secondary ai-delete-chat"
                      aria-label={`Xóa hội thoại: ${item.session_title}`}
                      onClick={() => setDeleting(item)}
                    >
                      <Trash2 size={17} /> Xóa
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ai-empty">
              Chưa có hội thoại nào. Câu hỏi và trả lời sẽ xuất hiện ở đây sau
              khi được lưu.
            </p>
          )
        }
      </DataState>
      {history.data && <Pagination {...history.data} onChange={setOffset} />}
      {deleting && (
        <ConfirmDialog
          title="Xóa cuộc hội thoại"
          method="DELETE"
          path={`ai/conversations/${encodeURIComponent(deleting.id)}`}
          onClose={() => setDeleting(undefined)}
          onSaved={() => {
            const deletedId = deleting.id;
            setDeleting(undefined);
            if (offset > 0 && history.data?.items.length === 1)
              setOffset(Math.max(0, offset - 10));
            history.reload();
            onDeleted(deletedId);
          }}
        >
          <p>
            Xóa “{deleting.session_title}” và toàn bộ tin nhắn trong hội thoại?
            Bạn không thể khôi phục sau khi xóa.
          </p>
        </ConfirmDialog>
      )}
    </details>
  );
}
