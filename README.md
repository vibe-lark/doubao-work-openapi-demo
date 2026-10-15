# 豆包工作 Open API Demo · 能力展示台（独立 Node 版）

用真实请求验证 [豆包工作（Doubao Work）Open API](https://open.doubao.com/open-apis/agent) 的交付级开源工程：

- **独立 Node 后端**：Node 18+ **零运行时依赖**，`node server/server.js` 直接起；
- **React 前端**：源码在 `web/`，构建产物 `web/dist/` 已提交，**clone 即可用、免构建**；
- **全量测试套件**：`node test/run.js`，零依赖 runner，47 条用例覆盖 11 个接口的端到端链路、边界矩阵与协议观察；
- **双向文档**：客户排查手册（`docs/TROUBLESHOOTING.md`）+ 给豆包研发的问题登记（`docs/ISSUES.md`）+ 覆盖矩阵（`docs/API_COVERAGE.md`）。

页面上所有结果都来自真实接口请求；未执行的用例明确显示「SKIPPED / BLOCKED / 尚未运行」，**不用任何示意数据冒充真实响应，不编造任何测试结果**。

## 两种形态

| 形态 | 位置 | 适用场景 |
| --- | --- | --- |
| **独立 Node 版（本仓库重点）** | `server/` + `web/` + `test/` | 客户/伙伴 clone 到本机或自部署：真实 127.0.0.1 OAuth 回调、浏览器→Node→豆包的持久 SSE 管道、multipart 透传、全量测试 |
| 平台托管 BFF 版（原始形态） | `platform-hosted/` | 在 AnyGen 类托管平台上以 actions 形式部署：无长期宿主，SSE 只能 8 秒限时读取、回调需手动粘贴 code。其 README 见该目录 |

## 30 秒快速开始

前置：Node 18+（本机实测 v24；仅需全局 `fetch`/`FormData`/`Request.formData`，Node 18 起内置）。

```bash
# 1) 启动（无需 npm install）
node server/server.js

# 2) 浏览器打开
open http://127.0.0.1:4110

# 3) 另开终端，先跑无 token 自检（B1/B2 是真实的网关鉴权探测）
node test/run.js
```

### 配置 OAuth（要跑业务接口时）

在飞书开放平台建自建应用，拿到 App ID / Secret，登记重定向 URI 为
`http://127.0.0.1:4110/api/auth/feishu/callback`，并开通 6 个 `doubao:*` 权限：

```
doubao:session.event:write
doubao:session.message:read
doubao:session:write
doubao:session:read
doubao:session.event:read
doubao:file:write
```

然后用环境变量启动（也可复制 `.env.example` 为 `.env` 自行 source；server 本身只读 `process.env`）：

```bash
OAUTH_CLIENT_ID=cli_xxxxxxxxxxxx \
OAUTH_CLIENT_SECRET=xxxxxxxx \
REDIRECT_URI=http://127.0.0.1:4110/api/auth/feishu/callback \
PORT=4110 ENV=ppe \
node server/server.js
```

打开页面点「用飞书授权连接」：

- 本机浏览器：自动接住 `127.0.0.1:4110` 回调，换 token，落盘 `.tokens/`（权限 0600，已 gitignore），到期前 2 分钟自动 refresh；
- 云端/无本机服务：授权后把地址栏的裸 `code` 或整段回调 URL 粘到首页输入框（`POST /api/auth/manual-code`）。

> 令牌端点固定用新版 v3：`https://accounts.feishu.cn/oauth/v3/token`。旧版无 scope 的 user_access_token 调豆包 API 会被拒，见 [ISSUE-003](docs/ISSUES.md)。

## 目录结构

```
README.md                 本文件
server/                   独立 Node 后端（零依赖）
  server.js               HTTP 入口、路由、静态托管
  lib/config.js           环境变量 / 上游域名 / OAuth v3 端点 / PPE 头
  lib/store.js            .tokens 落盘（0600）、环境选择、OAuth state
  lib/oauth.js            授权 URL、code 提取、code 换 token
  lib/upstream.js         Bearer 注入、自动刷新、JSON/multipart 代理、统一证据结构
  lib/sse.js              持久 SSE 管道（透传帧/id/Last-Event-ID、断连 abort、心跳）
  lib/boundary.js         页面 Boundary Lab（a–k）服务端执行
  lib/mask.js             脱敏 / curl 生成
web/                      前端
  src/                    React 19 + shadcn/Radix（复用自托管版）
  src/api-shim/           @api/auth|doubao|boundary → 本地 fetch('/api/...') 适配层
  shared/schema.ts        zod 契约（与 platform-hosted 一致）
  dist/                   已提交的构建产物（免构建）
test/                     零依赖全量测试
  run.js                  runner + 报告 + 自动同步覆盖矩阵
  http.js                 直连网关客户端 / SSE 收集 / 轮询
  fixtures.js             本地即时生成 png/txt/pdf/空文件/大文件
  cases-business.js       S1–S13
  cases-boundary.js       B1–B28
  cases-observation.js    O1–O6
docs/
  ISSUES.md               给豆包研发的问题登记（含真实日期与脱敏证据）
  TROUBLESHOOTING.md      给客户/伙伴的对接排查手册
  API_COVERAGE.md         11 接口 × 场景覆盖矩阵（末尾自动更新运行结果）
reports/                  每次测试的脱敏 md/json 报告
platform-hosted/          原平台托管 BFF 形态源码（适用场景见其 README）
.env.example .gitignore LICENSE
```

## server 路由清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（node 版本、环境、OAuth 是否配置、dist 是否就绪） |
| GET | `/api/config` | 公开配置（不含密钥） |
| GET | `/api/auth/status` | 连接状态 / 到期时间 / 环境 |
| GET | `/api/auth/feishu` | 302 发起 v3 授权（state 写 HttpOnly cookie） |
| POST | `/api/auth/start` | 返回授权 URL（前端弹窗式流程用），同时 Set-Cookie |
| GET | `/api/auth/feishu/callback` | **真实承接 127.0.0.1:4110 回调**，校验 state 后换 token |
| POST | `/api/auth/manual-code` | 粘贴裸 code / 完整回调 URL 的备用流程 |
| POST | `/api/auth/disconnect` | 清除本地令牌 |
| POST | `/api/environment` | 切换 ppe / online（持久化到 `.tokens/environment`） |
| POST | `/api/boundary/run` | Boundary Lab a–k（服务端执行） |
| POST | `/api/files` | multipart 透传 `/v1/files` |
| POST/GET/PATCH/DELETE | `/api/sessions[/:id]` | Sessions Create/Retrieve/Update/Delete/List |
| POST | `/api/sessions/:id/events` | Events Create（message / interrupt） |
| GET | `/api/sessions/:id/events` | **会话级 Stream 持久 SSE 透传**（透传 `Last-Event-ID`） |
| GET | `/api/sessions/:id/events/:messageId` | **MessageStream 持久 SSE 透传** |
| GET | `/api/sessions/:id/messages[/:messageId]` | Messages List / Retrieve |
| GET | `/*` | `web/dist` 静态资源 + SPA 回退 |

所有 JSON 代理统一返回：`method/url/脱敏 headers/body/curl/响应/HTTP 状态/耗时`；
SSE 代理是浏览器→Node→豆包的**持久流式管道**：原样转发 `text/event-stream` 帧与 SSE `id`、透传 `Last-Event-ID`、浏览器断开立即 abort 上游、15 秒保活心跳、错误帧传播。

## 测试套件

47 条用例（13 端到端 + 28 边界 + 6 协议观察）：

```bash
node test/run.js                          # 全量；无 token 时业务用例 SKIPPED，B1/B2 真实执行
DOUBBAO_USER_TOKEN=u-xxxx node test/run.js
node test/run.js S2 S7 O2                 # 只跑部分
node test/run.js --group 分页
RUN_LARGE_FILES=1 node test/run.js B26    # 101MB 用例默认跳过
```

每条记录请求 / 脱敏响应 / HTTP / code / 耗时 / 期望 / 实际 / 结论（PASS/FAIL/MISMATCH/SKIPPED/BLOCKED），
产出 `reports/YYYYMMDD-HHmm-<env>.{md,json}` 并自动更新 `docs/API_COVERAGE.md` 末尾结果区。

## 环境与安全

- `ENV=ppe`（默认）走 `open.feishu.cn` 并注入 `X-Tt-Env: ppe_doubao_oapi` + `X-Use-Ppe: 1`；`ENV=online` 走 `open.doubao.com`，切线上由前端二次确认。
- `client_secret`、access/refresh token、授权 code **绝不入库、绝不下发浏览器**；`.tokens/`、`.env` 已 gitignore；证据中的 Authorization 恒定打码，报告落盘前再做一遍模式化脱敏。
- 破坏性 / 边界用例默认只在 PPE 跑；`429001` 只记录文档定义，不压测。

## 从源码重新构建前端（可选）

`web/dist` 已提交，一般不需要。要改前端：

```bash
cd web
npm install
npm run dev      # 5173，/api 代理到 4110（先起 server）
npm run build    # 产物输出到 web/dist
```

## License

[MIT](LICENSE)
