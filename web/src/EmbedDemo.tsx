import { useCallback, useEffect, useRef, useState } from "react";
import { proxy, type Connection, type Message } from "./api";
import ChatPanel from "./ChatPanel";
import {
  blankConversation,
  mergeRemote,
  pendingTurn,
  restoreWorkspace,
  turnsFromMessages,
  updateConversation,
  type Conversation,
  type Workspace,
} from "./conversations";
import {
  actions,
  buildTask,
  opportunity,
  record,
  visit,
  type BusinessAction,
} from "./business";

export default function EmbedDemo({
  variant,
  status,
}: {
  variant: "playground" | "integration";
  status: Connection;
}) {
  const isPlayground = variant === "playground";
  const storageKey = `doubao-chat:${status.account?.id}:${variant}`;
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    try {
      return restoreWorkspace(
        JSON.parse(sessionStorage.getItem(storageKey) || "null"),
      );
    } catch {
      return restoreWorkspace(null);
    }
  });
  const [open, setOpen] = useState(
    isPlayground || workspace.conversations.some((c) => c.turns.length),
  );
  const [mobileList, setMobileList] = useState(false);
  const [listError, setListError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [historyError, setHistoryError] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [pageToken, setPageToken] = useState<string | undefined>();
  const listBusy = useRef(false);
  const loadingHistory = useRef(new Set<string>());
  const actionLock = useRef(false);
  const rail = useRef<HTMLElement>(null);
  const active = workspace.conversations.find(
    (c) => c.id === workspace.activeId,
  )!;
  const change = useCallback(
    (id: string, patch: Partial<Conversation>) =>
      setWorkspace((previous) => updateConversation(previous, id, patch)),
    [],
  );
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(workspace));
    } catch {
      setStorageError("无法保存本页进度，请勿刷新。");
    }
  }, [workspace, storageKey]);
  async function loadList(token?: string) {
    if (listBusy.current) return;
    listBusy.current = true;
    setLoading(true);
    setListError("");
    try {
      const data = await proxy(
        `/api/sessions?page_size=50&order=desc${token ? `&page_token=${encodeURIComponent(token)}` : ""}`,
      );
      setWorkspace((previous) => ({
        ...previous,
        conversations: mergeRemote(previous.conversations, data.sessions || []),
      }));
      setPageToken(data.has_more ? data.page_token : undefined);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "读取对话失败");
    } finally {
      listBusy.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    if (isPlayground) void loadList();
  }, [isPlayground]);
  async function loadHistory(chat: Conversation) {
    if (chat.loaded || !chat.sessionId || loadingHistory.current.has(chat.id))
      return;
    loadingHistory.current.add(chat.id);
    setHistoryError((previous) => ({ ...previous, [chat.id]: "" }));
    try {
      let token: string | undefined;
      const messages: Message[] = [];
      const seen = new Set<string>();
      do {
        const data = await proxy(
          `/api/sessions/${encodeURIComponent(chat.sessionId)}/messages?page_size=100&order=asc${token ? `&page_token=${encodeURIComponent(token)}` : ""}`,
        );
        messages.push(...(data.messages || []));
        if (data.has_more && (!data.page_token || seen.has(data.page_token)))
          throw new Error("历史分页未完整返回，请重试");
        token = data.has_more ? data.page_token : undefined;
        if (token) seen.add(token);
      } while (token);
      const turns = turnsFromMessages(messages, chat.sessionId);
      change(chat.id, {
        turns,
        loaded: true,
        ...(chat.title === "Playground 对话" && turns.length
          ? { title: turns[0].question.split("\n")[0].slice(0, 32) }
          : {}),
      });
    } catch (e) {
      setHistoryError((previous) => ({
        ...previous,
        [chat.id]: e instanceof Error ? e.message : "读取历史失败",
      }));
    } finally {
      loadingHistory.current.delete(chat.id);
    }
  }
  useEffect(() => {
    if (!active.loaded) void loadHistory(active);
  }, [active.id]);
  function select(chat: Conversation) {
    setWorkspace((previous) => ({ ...previous, activeId: chat.id }));
    setMobileList(false);
  }
  function createChat() {
    const empty = workspace.conversations.find(
      (c) => c.loaded && !c.turns.length && !c.sessionId,
    );
    if (empty) {
      select(empty);
      return;
    }
    const chat = blankConversation();
    setWorkspace((previous) => ({
      ...previous,
      activeId: chat.id,
      conversations: [chat, ...previous.conversations],
    }));
    setMobileList(false);
  }
  function showRail() {
    setOpen(true);
    if (innerWidth <= 760)
      requestAnimationFrame(() =>
        rail.current?.scrollIntoView({ block: "start", behavior: "smooth" }),
      );
  }
  function launch(action: BusinessAction) {
    if (actionLock.current) return;
    actionLock.current = true;
    const chat = { ...blankConversation(), title: action.label };
    chat.turns = [
      {
        id: crypto.randomUUID(),
        question: action.question,
        wireText: buildTask(action),
        context: true,
        source: "live",
        answer: "",
        status: "queued",
      },
    ];
    setWorkspace((previous) => ({
      version: 2,
      activeId: chat.id,
      conversations: [
        chat,
        ...previous.conversations.filter((c) => c.turns.length || c.sessionId),
      ],
    }));
    showRail();
    setTimeout(() => {
      actionLock.current = false;
    }, 500);
  }
  const panels = workspace.conversations
    .filter((c) => c.loaded)
    .map((chat) => (
      <ChatPanel
        key={chat.id}
        chat={chat}
        variant={variant}
        visible={active.id === chat.id}
        onChange={change}
      />
    ));
  return (
    <section
      className={`workspace ${isPlayground ? "playground" : "integration"}`}
      aria-label={isPlayground ? "Playground" : "系统集成"}
    >
      {isPlayground ? (
        <div className="playground-layout">
          <aside
            className={`chat-list ${mobileList ? "is-open" : ""}`}
            aria-label="对话列表"
          >
            <div className="list-heading">
              <h2>对话</h2>
              <button
                className="text-button"
                onClick={() => loadList()}
                disabled={loading}
              >
                刷新
              </button>
            </div>
            <button className="new-conversation" onClick={createChat}>
              新建对话
            </button>
            <div className="chat-items">
              {workspace.conversations.map((chat) => (
                <button
                  key={chat.id}
                  className="chat-list-item"
                  aria-current={chat.id === active.id ? "true" : undefined}
                  onClick={() => select(chat)}
                  title={chat.title}
                >
                  <span>{chat.title}</span>
                  {pendingTurn(chat.turns) && <small>处理中</small>}
                </button>
              ))}
            </div>
            {pageToken && (
              <button
                className="text-button"
                disabled={loading}
                onClick={() => loadList(pageToken)}
              >
                {loading ? "加载中…" : "加载更早对话"}
              </button>
            )}
            {loading && !pageToken && (
              <p className="muted small-text">加载中…</p>
            )}
            {listError && (
              <p className="error" role="alert">
                {listError}
                <button
                  className="text-button"
                  onClick={() => loadList(pageToken)}
                >
                  重试
                </button>
              </p>
            )}
          </aside>
          <div className="chat-main">
            <header className="chat-heading">
              <button
                className="mobile-list-toggle"
                onClick={() => setMobileList(!mobileList)}
                aria-expanded={mobileList}
              >
                对话列表
              </button>
              <h1>{active.title}</h1>
              <span className="environment-label">
                {status.environment === "online" ? "正式环境" : "PPE"}
              </span>
            </header>
            {!active.loaded && (
              <div className="history-state">
                {historyError[active.id] ? (
                  <>
                    <p className="error">{historyError[active.id]}</p>
                    <button onClick={() => loadHistory(active)}>重试</button>
                  </>
                ) : (
                  "正在读取对话…"
                )}
              </div>
            )}
            {panels}
          </div>
        </div>
      ) : (
        <div className={`crm-shell ${open ? "with-assistant" : ""}`}>
          <div className="crm-main">
            <header className="crm-toolbar">
              <span>客户 / {opportunity.customer}</span>
              <span className="badge">模拟业务系统</span>
              <button
                className="text-button"
                onClick={() => (open ? setOpen(false) : showRail())}
              >
                {open ? "收起豆包" : "打开豆包"}
              </button>
            </header>
            <div className="opportunity-heading">
              <div>
                <h1>{opportunity.name}</h1>
                <p>{opportunity.customer}</p>
              </div>
              <button onClick={() => launch(actions[2])}>分析风险</button>
            </div>
            <dl className="crm-fields">
              <div>
                <dt>阶段</dt>
                <dd>{opportunity.stage}</dd>
              </div>
              <div>
                <dt>负责人</dt>
                <dd>{opportunity.owner}</dd>
              </div>
              <div>
                <dt>预计金额</dt>
                <dd>{opportunity.amount}</dd>
              </div>
              <div>
                <dt>预计签约</dt>
                <dd>10 月底 · 待确认</dd>
              </div>
            </dl>
            <section className="crm-section">
              <div className="crm-section-heading">
                <h2>最近跟进</h2>
                <button onClick={() => launch(actions[0])}>检查记录</button>
              </div>
              <p className="record-meta">10 月 12 日 · 陈晓</p>
              <p className="record-text">{record}</p>
            </section>
            <section className="crm-section">
              <div className="crm-section-heading">
                <h2>下次拜访</h2>
                <button onClick={() => launch(actions[1])}>准备拜访</button>
              </div>
              <p className="record-meta">
                {visit.date} · {visit.contact}
              </p>
              <p>{visit.purpose}</p>
            </section>
          </div>
          <aside
            className="integration-rail"
            ref={rail}
            hidden={!open}
            aria-label="豆包工作侧边栏"
          >
            <header className="chat-heading">
              <h2>豆包工作</h2>
              {workspace.conversations.filter((c) => c.turns.length).length >
                1 && (
                <select
                  aria-label="切换任务"
                  value={active.id}
                  onChange={(e) =>
                    select(
                      workspace.conversations.find(
                        (c) => c.id === e.target.value,
                      )!,
                    )
                  }
                >
                  {workspace.conversations.map((c, i) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                      {pendingTurn(c.turns) ? " · 处理中" : ""} ·{" "}
                      {workspace.conversations.length - i}
                    </option>
                  ))}
                </select>
              )}
            </header>
            {panels}
          </aside>
        </div>
      )}
      {storageError && (
        <p className="error" role="alert">
          {storageError}
        </p>
      )}
    </section>
  );
}
