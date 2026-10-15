import { useEffect, useRef, useState, type FormEvent } from "react";
import { proxy, replyFor, messageText, isTerminal, type Message } from "./api";
import { pendingTurn, type Conversation, type Turn } from "./conversations";
import ResponseText from "./ResponseText";

export default function ChatPanel({
  chat,
  variant,
  visible,
  onChange,
}: {
  chat: Conversation;
  variant: "playground" | "integration";
  visible: boolean;
  onChange: (id: string, patch: Partial<Conversation>) => void;
}) {
  const [turns, setTurns] = useState(chat.turns);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const inFlight = useRef(false);
  const conversation = useRef<HTMLDivElement>(null);
  const pending = pendingTurn(turns);
  const busy = !!pending || sending;
  const isPlayground = variant === "playground";
  const fieldId = `${variant}-question-${chat.id}`;
  function update(id: string, patch: Partial<Turn>) {
    setTurns((previous) =>
      previous.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }
  useEffect(() => {
    onChange(chat.id, {
      turns,
      sessionId: turns.find((t) => t.sessionId)?.sessionId || chat.sessionId,
    });
  }, [turns, chat.id, onChange]);
  useEffect(() => {
    if (visible && conversation.current)
      conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [visible, turns.length, turns.at(-1)?.answer]);
  useEffect(() => {
    if (!pending?.sessionId || !pending.queryId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const current = pending;
    async function poll() {
      try {
        const data = await proxy(
          `/api/sessions/${encodeURIComponent(current.sessionId!)}/messages?page_size=100&order=desc`,
        );
        if (disposed) return;
        const reply = replyFor(data.messages || [], current.queryId!);
        setPollError("");
        if (reply) {
          update(current.id, {
            replyId: reply.id,
            answer: messageText(reply),
            status: reply.status,
          });
          if (isTerminal(reply)) {
            setStopping(false);
            return;
          }
        }
      } catch (e) {
        if (!disposed)
          setPollError(
            `连接中断，正在重试。${e instanceof Error ? e.message : ""}`,
          );
      }
      if (!disposed) timer = setTimeout(poll, 4000);
    }
    poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [pending?.id, pending?.sessionId, pending?.queryId]);
  async function submit(turn: Turn) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError("");
    update(turn.id, { status: "submitting" });
    try {
      const event = {
        type: "user.message",
        contents: [{ type: "text", text: turn.wireText }],
      };
      const data = turn.sessionId
        ? await proxy(
            `/api/sessions/${encodeURIComponent(turn.sessionId)}/events`,
            { uuid: turn.id, events: [event] },
          )
        : await proxy("/api/sessions", {
            uuid: turn.id,
            name: isPlayground
              ? `Playground · ${turn.question.slice(0, 80)}`
              : `系统集成 · ${chat.title}`,
            initial_events: [event],
          });
      const sessionId = turn.sessionId || data.session?.id || data.id;
      const queryId = (data.messages || data.session?.messages || []).find(
        (m: Message) => m.role === "user",
      )?.id;
      if (!sessionId || !queryId) throw new Error("未收到完整任务编号");
      update(turn.id, { sessionId, queryId, status: "in_progress" });
    } catch (e) {
      setError(
        `提交待确认：${e instanceof Error ? e.message : "网络异常"}。可找回原请求。`,
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  // Business buttons queue once with a stable UUID; reload/retry never creates a second task.
  useEffect(() => {
    if (pending?.status === "queued") void submit(pending);
  }, [pending?.id]);
  function send(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || busy || inFlight.current) return;
    const question = prompt.trim();
    const turn: Turn = {
      id: crypto.randomUUID(),
      question,
      wireText: question,
      context: false,
      source: "live",
      answer: "",
      status: "submitting",
      sessionId:
        turns.findLast((t) => t.sessionId)?.sessionId || chat.sessionId,
    };
    if (!turns.length)
      onChange(chat.id, {
        title: question.slice(0, 32),
        updatedAt: Date.now(),
      });
    setTurns((previous) => [...previous, turn]);
    setPrompt("");
    void submit(turn);
  }
  async function stop() {
    if (!pending?.sessionId || !pending.replyId || stopping) return;
    setStopping(true);
    setError("");
    try {
      await proxy(
        `/api/sessions/${encodeURIComponent(pending.sessionId)}/events`,
        {
          uuid: crypto.randomUUID(),
          events: [{ type: "user.interrupt", message_id: pending.replyId }],
        },
      );
    } catch (e) {
      setStopping(false);
      setError(e instanceof Error ? e.message : "停止失败");
    }
  }
  return (
    <div className="chat-panel" hidden={!visible} data-chat-id={chat.id}>
      <div
        className="conversation"
        ref={conversation}
        aria-live={visible ? "polite" : "off"}
      >
        {!turns.length && (
          <div className="chat-empty">
            <h2>
              {isPlayground ? "有什么想交给豆包？" : "从左侧选择一个任务"}
            </h2>
          </div>
        )}
        {turns.map((turn) => (
          <article className="turn" key={turn.id}>
            <div className="question">
              <p>{turn.question}</p>
              {turn.context && (
                <details className="sent-context">
                  <summary>已附业务上下文</summary>
                  <pre>{turn.wireText}</pre>
                </details>
              )}
            </div>
            <div className="answer">
              <strong>豆包工作</strong>
              <ResponseText
                text={
                  turn.answer ||
                  (["queued", "submitting"].includes(turn.status)
                    ? "正在提交…"
                    : !["completed", "failed", "cancelled"].includes(
                          turn.status,
                        )
                      ? "正在处理…"
                      : "")
                }
              />
              {turn.status === "completed" && !turn.answer && (
                <p>任务已完成，未返回文字。</p>
              )}
              {turn.status === "failed" && (
                <p className="warning">任务失败，可重新提问。</p>
              )}
              {turn.status === "cancelled" && <p className="muted">已停止</p>}
            </div>
          </article>
        ))}
      </div>
      <form className="composer" onSubmit={send}>
        <label className="sr-only" htmlFor={fieldId}>
          {isPlayground ? "发消息" : "继续追问"}
        </label>
        <textarea
          id={fieldId}
          rows={2}
          placeholder={isPlayground ? "发消息给豆包工作…" : "继续追问…"}
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="compose-actions">
          {pending?.replyId && (
            <button type="button" disabled={stopping} onClick={stop}>
              {stopping ? "正在停止…" : "停止生成"}
            </button>
          )}
          {pending && !pending.queryId ? (
            <button
              type="button"
              disabled={sending}
              onClick={() => submit(pending)}
            >
              {sending ? "正在提交…" : "找回原请求"}
            </button>
          ) : (
            <button
              className="ai-primary"
              type="submit"
              disabled={busy || !prompt.trim()}
            >
              {busy ? "处理中…" : "发送"}
            </button>
          )}
        </div>
        {(error || pollError) && (
          <p className="error" role="alert">
            {error || pollError}
          </p>
        )}
      </form>
    </div>
  );
}
