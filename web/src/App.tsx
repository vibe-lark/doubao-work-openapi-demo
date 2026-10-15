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
  return (
    <>
      <section className="catalog" aria-label="接口列表说明">
        <div className="group-buttons" aria-label="能力分类">
          {groups.map((item) => (
            <button
              key={item.id}
              className={selected === item.id ? "group active" : "group"}
              aria-pressed={selected === item.id}
              onClick={() => setSelected(item.id)}
            >
              <span>
                <strong>{item.title}</strong>
              </span>
            </button>
          ))}
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
                          : ["create", "list", "event", "messages"].includes(
                                item.id,
                              )
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
                    {["create", "list", "event", "messages"].includes(
                      item.id,
                    ) && (
                      <p className="live-proof">
                        2026-10-15
                        正式环境：已验证会话列表、历史回读、连续对话、业务任务及停止回复。下方历史边界用例仍保留原结论。
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
      <details className="evidence-note">
        <summary>验证记录与范围</summary>
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
      </details>
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
          <section className="login-card" aria-labelledby="login-title">
            <h2 id="login-title">登录开放能力体验</h2>
            <p>Playground · 系统集成 · 接口说明</p>
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
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="login-retry" onClick={refresh}>
              刷新登录状态
            </button>
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
      <main
        id="main"
        className={view === "api" ? "api-main" : "workspace-main"}
        tabIndex={-1}
      >
        <div hidden={view !== "playground"}>
          <EmbedDemo
            key={`playground-${status.account.id}`}
            variant="playground"
            status={status}
          />
        </div>
        <div hidden={view !== "integration"}>
          <EmbedDemo
            key={`integration-${status.account.id}`}
            variant="integration"
            status={status}
          />
        </div>
        {view === "api" && <BoundaryView />}
      </main>
    </>
  );
}
