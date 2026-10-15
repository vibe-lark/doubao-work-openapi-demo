import { useEffect, useState } from "react";
import {
  capabilities,
  evidence,
  groups,
  sourceRoot,
  verdictClass,
  verdictLabel,
  type Group,
} from "./catalog";
import { connection, request, type Connection } from "./api";
import EmbedDemo from "./EmbedDemo";

function BoundaryView() {
  const [selected, setSelected] = useState<Group>("sessions");
  const group = groups.find((group) => group.id === selected)!;
  return (
    <>
      <div className="section-heading api-heading">
        <div>
          <p className="eyebrow">OPEN API REFERENCE</p>
          <h1>接口列表说明</h1>
          <p>按工作流程查看接口用途、使用边界与验证依据。</p>
        </div>
      </div>
      <section className="catalog" aria-labelledby="catalog-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CAPABILITIES</p>
            <h2 id="catalog-title">接口能力与边界</h2>
          </div>
          <span className="muted">10 项业务接口 · 1 项暂缓接口</span>
        </div>
        <div className="group-buttons" aria-label="能力分类">
          {groups.map((item, index) => (
            <button
              key={item.id}
              className={selected === item.id ? "group active" : "group"}
              aria-pressed={selected === item.id}
              onClick={() => setSelected(item.id)}
            >
              <span className="group-number">0{index + 1}</span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="group-intro">
          <h3>{group.title}</h3>
          <p>{group.description}</p>
        </div>
        {selected === "access" ? (
          <AccessBoundaries />
        ) : (
          <>
            {capabilities
              .filter((item) => item.group === selected)
              .map((item) => (
                <details className="capability" key={item.id}>
                  <summary>
                    <span className="cap-title">
                      {item.name}
                      <span className={`badge ${item.deferred ? "warn" : ""}`}>
                        {item.deferred
                          ? "暂缓开放"
                          : ["create", "event", "messages"].includes(item.id)
                            ? "基础链路已实测"
                            : "文档定义 · 待实测"}
                      </span>
                    </span>
                    <span className="endpoint">
                      <span className="method">{item.method}</span>
                      <code>{item.path}</code>
                    </span>
                    <span className="details-label">查看边界</span>
                  </summary>
                  <div className="cap-body">
                    {["create", "event", "messages"].includes(item.id) && (
                      <p className="live-proof">
                        2026-10-15
                        正式环境：已验证创建会话、携带记录提问、同会话追问及停止回复。仅证明本次基础链路；下方历史边界用例仍保留原结论。
                      </p>
                    )}
                    <div className="boundary-copy">
                      <div>
                        <h4>可以做什么</h4>
                        <p>{item.supports}</p>
                      </div>
                      <div>
                        <h4>使用边界</h4>
                        <p>{item.boundary}</p>
                      </div>
                    </div>
                    <details className="evidence">
                      <summary>
                        查看相关测试记录（{item.tests.length} 项）
                      </summary>
                      <p className="muted">
                        PPE · 2026-10-13 历史报告；以下记录不代表当前线上状态。
                      </p>
                      <ul>
                        {evidence.results
                          .filter((result) => item.tests.includes(result.id))
                          .map((result) => (
                            <li key={result.id}>
                              <span
                                className={`badge ${verdictClass[result.verdict]}`}
                              >
                                {verdictLabel[result.verdict]}
                              </span>
                              <div>
                                <strong>
                                  {result.id} · {result.title}
                                </strong>
                                <p>{result.summary}</p>
                              </div>
                            </li>
                          ))}
                      </ul>
                    </details>
                  </div>
                </details>
              ))}
            {selected === "files" && (
              <div className="plain-note">
                <h4>成果不是固定输出类型</h4>
                <p>
                  文档、表格等成果取决于任务和实际返回内容。本仓库 S8
                  成果用例仍为未验证，不承诺每次请求都生成文件，也不承诺写回你的业务系统。
                </p>
              </div>
            )}
          </>
        )}
      </section>
      <aside className="evidence-note">
        <strong>验证范围保持透明</strong>
        <p>
          仓库历史报告（2026-10-13，PPE）：{evidence.counts.PASS}{" "}
          项环境配置观察通过、{evidence.counts.MISMATCH} 项鉴权文档差异、
          {evidence.counts.SKIPPED}{" "}
          项未验证。该通过项不证明双环境业务链路可用；演示中的单次成功也不代表全部边界已验证。
        </p>
        <p>
          本次嵌入演示另在正式环境完成两轮回复与停止生成验证。
          <a
            href="https://github.com/vibe-lark/doubao-work-openapi-demo/blob/codex/simplify-api-capabilities/docs/embedded-live-verification.json"
            target="_blank"
            rel="noreferrer"
          >
            查看本次链路证据
          </a>
        </p>
        <a
          href={`${sourceRoot}reports/20261013-1938-ppe.md`}
          target="_blank"
          rel="noreferrer"
        >
          查看原始报告
        </a>
      </aside>
    </>
  );
}
function AccessBoundaries() {
  return (
    <div className="access-grid">
      <div>
        <h4>用户授权后才能调用</h4>
        <p>
          业务接口使用用户访问令牌和对应 doubao
          scope。应用令牌、租户令牌不能替代用户授权；密钥与令牌留在服务端。
        </p>
        <span className="badge warn">鉴权错误码存在差异</span>
        <p className="small-text">
          B1 / B2 实测 HTTP 400、99991661 / 99991668；与文档 401 / 401001 不同。
        </p>
      </div>
      <div>
        <h4>环境结论不互相外推</h4>
        <p>
          PPE 使用 open.feishu.cn 和环境请求头；正式环境使用
          open.doubao.com。此处历史报告来自 PPE，不证明正式环境已通过。
        </p>
      </div>
      <div>
        <h4>业务系统负责上下文与写回</h4>
        <p>
          侧边栏不会自动读取整个业务系统。接入方选择并发送内容，豆包返回结果；是否写回字段，由业务系统单独实现。
        </p>
      </div>
      <div>
        <h4>尚不能作出承诺的边界</h4>
        <p>
          跨用户隔离、限流阈值、长期稳定性、24
          小时幂等窗口和全部文件格式，未获得完整实测证明。
        </p>
      </div>
    </div>
  );
}
const tabs = [
  { id: "playground", label: "Playground" },
  { id: "integration", label: "系统集成" },
  { id: "api", label: "接口列表说明" },
] as const;
function currentTab() {
  const hash = location.hash.slice(1);
  return hash === "embed"
    ? "integration"
    : hash === "capabilities"
      ? "api"
      : tabs.some((tab) => tab.id === hash)
        ? hash
        : "playground";
}
export default function App() {
  const [view, setView] = useState(currentTab);
  const [status, setStatus] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  async function refresh() {
    try {
      setStatus(await connection());
      setError("");
    } catch {
      setError("暂时无法连接服务，请重试。");
    }
  }
  useEffect(() => {
    const onHash = () => setView(currentTab());
    const onExpired = () =>
      setStatus((previous) =>
        previous ? { ...previous, connected: false, account: null } : previous,
      );
    window.addEventListener("hashchange", onHash);
    window.addEventListener("focus", refresh);
    window.addEventListener("doubao:login-required", onExpired);
    const timer = setInterval(refresh, 60000);
    refresh();
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("doubao:login-required", onExpired);
      clearInterval(timer);
    };
  }, []);
  async function logout() {
    setLoggingOut(true);
    try {
      await request("/api/auth/disconnect", {});
      const prefix = `doubao-chat:${status?.account?.id}:`;
      try {
        Object.keys(sessionStorage)
          .filter((key) => key.startsWith(prefix))
          .forEach((key) => sessionStorage.removeItem(key));
      } catch {
        /* Browser storage may be unavailable. */
      }
      setStatus((previous) =>
        previous ? { ...previous, connected: false, account: null } : previous,
      );
      setError("");
    } catch {
      setError("退出登录失败，请重试。");
    } finally {
      setLoggingOut(false);
    }
  }
  if (!status?.connected || !status.account)
    return (
      <div className="login-page">
        <header className="login-header">
          <img src="/doubao-work-logo.png" alt="豆包工作" />
          <span>开放能力体验</span>
        </header>
        <main className="login-layout">
          <section className="login-story">
            <p className="eyebrow">DOUBAO WORK / OPEN API</p>
            <h1>
              从一句话，
              <br />
              到你的业务系统。
            </h1>
            <p>
              连接飞书身份，体验豆包工作如何理解问题、完成任务，并融入日常工作。
            </p>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <h3>Playground</h3>
                  <p>直接对话，体验连续追问。</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <h3>系统集成</h3>
                  <p>在模拟商机系统中使用豆包侧栏。</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <h3>接口列表说明</h3>
                  <p>了解能力范围、接口边界与验证依据。</p>
                </div>
              </li>
            </ol>
          </section>
          <section className="login-card" aria-labelledby="login-title">
            <p className="eyebrow">WELCOME</p>
            <h2 id="login-title">登录开放能力体验</h2>
            <p>使用你的飞书账号安全登录。</p>
            {status?.configured ? (
              <a
                className="button dark sso-login"
                href={`/api/auth/feishu?return_to=${view}`}
              >
                使用飞书 SSO 登录
              </a>
            ) : (
              <button className="dark sso-login" disabled>
                {status ? "应用尚未配置" : "正在检查登录状态…"}
              </button>
            )}
            {status && !status.configured && (
              <p className="login-help">
                请在服务端配置应用 App ID、App Secret 和 OAuth
                回调地址后重启服务。
              </p>
            )}
            <p className="login-help">
              已有飞书登录态可用于身份确认。首次使用或授权过期时，飞书会提示确认授权。
            </p>
            {status && (
              <span className="badge">
                {status.environment === "online" ? "正式环境" : "PPE 联调环境"}
              </span>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="login-retry" onClick={refresh}>
              刷新登录状态
            </button>
            <p className="login-privacy">
              登录状态仅关联当前浏览器；退出后将撤销本应用会话，不影响飞书账号本身。
            </p>
          </section>
        </main>
      </div>
    );
  return (
    <>
      <a
        className="skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        跳到主要内容
      </a>
      <header className="topbar">
        <a href="#playground" className="brand" aria-label="豆包工作首页">
          <img src="/doubao-work-logo.png" alt="豆包工作" />
          <span>开放能力体验</span>
        </a>
        <nav aria-label="主导航">
          {tabs.map((tab) => (
            <a
              key={tab.id}
              href={`#${tab.id}`}
              aria-current={view === tab.id ? "page" : undefined}
            >
              {tab.label}
            </a>
          ))}
        </nav>
        <div className="account-menu">
          {status.account.avatar ? (
            <img
              src={status.account.avatar}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="account-initial" aria-hidden="true">
              {status.account.name.slice(0, 1)}
            </span>
          )}
          <span>{status.account.name}</span>
          <button className="quiet" onClick={logout} disabled={loggingOut}>
            {loggingOut ? "退出中…" : "退出登录"}
          </button>
        </div>
      </header>
      {error && (
        <p className="app-error" role="alert">
          {error}
          <button onClick={refresh}>重试</button>
        </p>
      )}
      <main id="main" tabIndex={-1}>
        <div hidden={view !== "playground"}>
          <EmbedDemo
            key={`playground-${status.account.id}`}
            variant="playground"
            status={status}
            onConnect={refresh}
          />
        </div>
        <div hidden={view !== "integration"}>
          <EmbedDemo
            key={`integration-${status.account.id}`}
            variant="integration"
            status={status}
            onConnect={refresh}
          />
        </div>
        {view === "api" && <BoundaryView />}
      </main>
      <footer>
        <span>豆包工作 · Open API Demo</span>
        <span>
          {status.environment === "online" ? "正式环境" : "PPE 联调环境"} ·
          已通过飞书 SSO 登录
        </span>
      </footer>
    </>
  );
}
