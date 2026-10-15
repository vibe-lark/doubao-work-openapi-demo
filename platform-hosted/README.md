> **适用场景说明（2026-10-13 增补）**
>
> 本目录是本项目的**平台托管 BFF 形态**原始源码（AnyGen 类托管平台 actions：`api/lambda/*` + React `src/` + zod 契约 `shared/`）。它依赖托管平台运行时，没有长期本机宿主：SSE 最多 8 秒限时读取，OAuth 回调打不开时需手动粘贴 code。
>
> 面向外部客户/伙伴的**独立 Node 形态**（零依赖 `node server/server.js`、真实 127.0.0.1 回调、浏览器→Node→豆包持久 SSE、全量测试套件）在仓库根的 `server/`、`web/`、`test/`，入口见根 [README](../README.md)。两套形态共用同一套接口契约与视觉设计，本目录保留作为托管部署参考与组件来源。

# 豆包工作 Open API Demo · 能力展示台

用真实请求验证[豆包工作（Doubao Work）Open API](https://open.doubao.com/open-apis/agent) 的示例工程：OAuth 用户授权、会话与消息、流式事件、文件上传，以及一组覆盖参数校验、错误码、幂等、分页、并发与打断的边界用例（Boundary Lab）。

页面上所有结果都来自真实接口请求；未执行的用例明确显示「待运行」，不使用任何示意数据冒充真实响应。

## 能力一览

| 模块 | 覆盖的 Open API |
| --- | --- |
| 连接授权 | 用户 OAuth（新版 v3 授权码流程）、token 存储与自动刷新、PPE / 线上环境切换 |
| Sessions | `POST/GET/PATCH/DELETE /v1/sessions`、`GET /v1/sessions/{id}`、分页与 `page_token` |
| Events | `POST /v1/sessions/{id}/events`：`user.message`（文本/文件）与 `user.interrupt` 打断 |
| Messages | `GET .../messages`（历史）、`GET .../messages/{message_id}`（轮询终态） |
| Stream | MessageStream（`GET .../events/{message_id}`，SSE）；会话级 Stream（标注[暂缓]，仅探测） |
| Files | `POST /v1/files`（multipart 上传，拿 `uri` 后在消息中引用） |
| Boundary Lab | a–k 声明式用例：400001/401/404001/409001、uuid 幂等、分页边界、文件 400002/400004/413001、打断 cancelled 等，自动比对并导出脱敏 Markdown 报告 |

每个请求都可展开查看完整证据：HTTP 方法、URL、请求头（`Authorization` 恒定打码）、请求体、可复制的 curl、响应 JSON、HTTP 状态码与耗时。

## 架构

```
浏览器（React 19 SPA，src/）
        │  一去一回的 action RPC
        ▼
服务端 Actions（api/lambda/，BFF）
  · 统一注入 Bearer token；PPE 环境附加 X-Tt-Env / X-Use-Ppe
  · client_secret、token、refresh_token 只存在于服务端
        │  服务端 fetch
        ▼
豆包工作 Open API
  · PPE：https://open.feishu.cn/open-apis/agent（带 PPE 头）
  · 线上：https://open.doubao.com/open-apis/agent
```

前后端共用一份契约 `shared/schema.ts`（zod）。前端不直接持有密钥，也不直接请求豆包网关。

## 运行形态说明（重要）

本仓库源码有两种运行形态：

1. **托管 BFF 形态（本仓库默认）**：后端是一组服务端 action（`Api(Post(...), Data(schema), handler)`，见 `api/lambda/`），通过平台函数通道被前端调用，不创建独立 HTTP 服务器、不监听端口。action 中对 SSE 接口采用**限时读取**（默认 8 秒窗口）把已收到的原始帧打包返回，前端通过「窗口连续续取（透传 `Last-Event-ID`）+ 消息轮询兜底」实现近实时渲染；这不是浏览器到网关的持久 SSE 长连接。
2. **自有 Node 宿主**：如需浏览器到服务端的持久 SSE（逐字流式、原生断线续传）以及自动承接 OAuth 回调，可在本工程外再包一层标准 Node/HTTP 服务监听 `0.0.0.0:4110`，把 `api/lambda/` 中的代理逻辑（`_client.ts` / `_doubao.ts`）挂到普通 HTTP 路由即可。前端静态文件由该宿主托管。

> 托管形态下 `@anygen/server` 的 `Api / Data / Post / useAnygen` 与 `@api/*`、`@shared/*` 路径别名由宿主构建层提供；迁移到自有 Express/Fastify 等宿主时，把 action handler 改成普通路由处理函数即可，业务逻辑（签名、PPE 头、SSE 帧解析、用例判定）均可直接复用。

## 配置

复制 `.env.example` 并填入飞书开放平台应用凭证（仅服务端使用，切勿提交真实值）：

```bash
OAUTH_CLIENT_ID=your_feishu_client_id
OAUTH_CLIENT_SECRET=your_feishu_client_secret
REDIRECT_URI=http://127.0.0.1:4110/api/auth/feishu/callback
PORT=4110
```

- 授权入口：`https://accounts.feishu.cn/open-apis/authen/v1/authorize`（`client_id`、`redirect_uri`、`state`，以及显式 `scope`）
- 换 token：`POST https://accounts.feishu.cn/oauth/v3/token`（PPE 联调时该请求同样带 `X-Tt-Env: ppe_doubao_oapi`、`X-Use-Ppe: 1`）
- 需要的 scope：`doubao:session.event:write` `doubao:session.message:read` `doubao:session:write` `doubao:session:read` `doubao:session.event:read` `doubao:file:write`

豆包工作 Open API 仅接受**新版 v3 OAuth 流程**换到的 `user_access_token`；旧版历史授权流程（`authen/v1/access_token`，授权不带 scope）换到的 token 会被拒绝。

回调地址必须与开放平台登记值逐字一致。浏览器授权后跳转到本机 `127.0.0.1` 页面打不开是常见现象，Demo 门禁页提供「粘贴裸 code 或完整回调 URL」的备用连接方式，并校验一次性 `state`。

## 目录

```
src/            前端 React 页面与组件（连接门禁、总览、Sessions、Playground、Files、Boundary Lab）
api/lambda/     服务端 actions：OAuth、豆包接口代理、SSE 限时读取、文件中转、边界用例
shared/         前后端共享 zod schema
.env.example    服务端配置模板（真实值禁止入库）
manifest.json   应用清单
AGENTS.md       维护约定（环境、安全、流式与探针注意事项）
```

## PPE 与线上

- PPE（默认联调）：`https://open.feishu.cn/open-apis/agent`，每个请求带 `X-Tt-Env: ppe_doubao_oapi` 与 `X-Use-Ppe: 1`。
- 线上：`https://open.doubao.com/open-apis/agent`，不带 PPE 头。线上调用会产生真实数据，破坏性边界用例请在 PPE 运行。
- 若应用开启了 IP 白名单，调用方出口 IP 需要先在开放平台应用安全设置中放行。

## 安全

- `client_secret`、`access_token`、`refresh_token`、授权 `code` 绝不进入前端产物、URL 之外的日志或导出报告；`Authorization` 头在所有证据中打码。
- `.env`、token 落盘文件与私有运行数据已在 `.gitignore` 中排除。
- Boundary Lab 导出的 Markdown 报告同样使用脱敏证据。
- 不主动压测限流（429001）；自然遇到时如实记录。

## 参考

- 豆包开放平台开发指南：https://open.larkoffice.com/document/doubao-developer-guide/openapi-call-flow
- 豆包 OpenAPI 接口文档以开放平台最新发布为准（接口路径、请求/响应与错误码均在代码中按文档实现）。
