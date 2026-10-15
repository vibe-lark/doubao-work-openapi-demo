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
import { connection, type Connection } from "./api";
import EmbedDemo from "./EmbedDemo";

function BoundaryView() {
  const [selected, setSelected] = useState<Group>("sessions");
  const group = groups.find((group) => group.id === selected)!;
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">DOUBAO WORK / OPEN API</p>
          <h1>把豆包工作，接入你的业务。</h1>
          <p>先看清能力与边界，再体验业务系统里的豆包侧边栏。</p>
          <a className="button dark" href="#embed">
            体验嵌入演示
          </a>
        </div>
        <div className="hero-note">
          <span>一条完整的工作链路</span>
          <ol>
            <li>传入业务上下文</li>
            <li>豆包执行任务</li>
            <li>取回回复与成果</li>
          </ol>
          <small>业务数据由接入方明确提供</small>
        </div>
      </section>
      <section className="catalog" aria-labelledby="catalog-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CAPABILITIES</p>
            <h2 id="catalog-title">能力边界</h2>
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
export default function App() {
  const [view, setView] = useState(
    location.hash === "#embed" ? "embed" : "capabilities",
  );
  const [status, setStatus] = useState<Connection | null>(null);
  const [statusError, setStatusError] = useState("");
  const [guide, setGuide] = useState(false);
  async function refresh() {
    try {
      setStatus(await connection());
      setStatusError("");
    } catch {
      setStatus(null);
      setStatusError("连接状态暂不可用");
    }
  }
  useEffect(() => {
    const onHash = () =>
      setView(location.hash === "#embed" ? "embed" : "capabilities");
    window.addEventListener("hashchange", onHash);
    refresh();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
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
        <a href="#capabilities" className="brand" aria-label="豆包工作首页">
          <img src="/doubao-work-logo.png" alt="豆包工作" />
          <span>开放能力体验</span>
        </a>
        <nav aria-label="主导航">
          <a
            href="#capabilities"
            aria-current={view === "capabilities" ? "page" : undefined}
          >
            能力边界
          </a>
          <a href="#embed" aria-current={view === "embed" ? "page" : undefined}>
            嵌入演示
          </a>
        </nav>
        <button
          className="quiet"
          onClick={() => {
            setGuide(!guide);
            refresh();
          }}
          aria-expanded={guide}
        >
          接入说明
        </button>
      </header>
      {guide && (
        <section className="connection-guide" aria-label="接入说明">
          <div>
            <h2>真实调用，需要一次用户授权</h2>
            <p>
              在服务端配置应用凭据并登记当前地址的 OAuth
              回调，重启服务后连接飞书。只查看能力边界或示例演示，无需授权。
            </p>
            <p className="small-text">
              {statusError ||
                (status
                  ? `${status.environment === "ppe" ? "PPE 联调环境" : "正式环境"} · ${status.connected ? "已授权" : status.configured ? "应用已配置，等待用户授权" : "应用凭据尚未配置"}`
                  : "正在读取连接状态…")}
            </p>
            <a
              href={`${sourceRoot}README.md#配置-oauth要跑业务接口时`}
              target="_blank"
              rel="noreferrer"
            >
              查看配置文档
            </a>
          </div>
          <div className="guide-actions">
            {status?.configured && !status.connected && (
              <a className="button dark" href="/api/auth/feishu">
                连接飞书
              </a>
            )}
            <button onClick={refresh}>刷新状态</button>
            <button onClick={() => setGuide(false)}>收起</button>
          </div>
        </section>
      )}
      <main id="main" tabIndex={-1}>
        {view === "capabilities" ? <BoundaryView /> : null}
        <div hidden={view !== "embed"}>
          <EmbedDemo
            status={status}
            onConnect={() => {
              setGuide(true);
              refresh();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>
      </main>
      <footer>
        <span>豆包工作 · Open API Demo</span>
        <span>示例业务数据 / 真实调用由你发起</span>
      </footer>
    </>
  );
}
