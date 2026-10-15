# 豆包工作 Open API · SSO 与三 Tab 体验

通过飞书 SSO 登录后，进入三个 Tab：

- **Playground**：直接与豆包工作对话，支持连续追问、新建对话、查看进度与停止回复。
- **系统集成**：模拟商机系统中的豆包侧栏，选择业务记录作为上下文。默认真实调用，也可切换明确标注的预置示例。
- **接口列表说明**：按会话、消息、文件与接入边界展示 11 个接口，展开查看用途、限制和验证证据。

登录后显示飞书返回的真实姓名和头像。每个浏览器通过独立 HttpOnly Cookie 关联服务端令牌；无登录会话的业务 API 返回 401。退出只撤销当前浏览器登录，不退出飞书账号，也不影响其他浏览器。详细验收见 [SSO 与三 Tab 验证](docs/SSO-TABS.md)。

沿用豆包工作浅蓝 `#CAE4FF`、黑白、系统字体与官方 Logo。主应用仅依赖 React / React DOM，不再包含通用调试台、文件工作台和边界批量运行界面。

## 启动

Node.js 18+。仓库提交了 `web/dist`，运行不需要安装前端依赖；进入应用需先配置飞书自建应用并完成 SSO 登录。

```sh
node server/server.js
# 打开 http://127.0.0.1:4110
```

## 真实调用

配置飞书自建应用，登记回调地址 `http://127.0.0.1:4110/api/auth/feishu/callback`，开通所需用户权限，然后启动：

```sh
OAUTH_CLIENT_ID=cli_xxx OAUTH_CLIENT_SECRET=xxx ENV=ppe node server/server.js
```

在登录页点击「使用飞书 SSO 登录」。复用已有飞书登录态完成账号确认后，服务端兑换令牌、调用 `authen/v1/user_info` 验证身份，再签发浏览器会话。用户令牌保存在被 Git 忽略的 `.tokens/sessions/`，权限为 0600；浏览器只持有不透明 HttpOnly 会话 Cookie，不接收 access/refresh token。旧版全局 `.tokens/token.json` 不会用于 HTTP 登录或业务请求。

需申请的权限：`doubao:session:read`、`doubao:session:write`、`doubao:session.event:read`、`doubao:session.event:write`、`doubao:session.message:read`、`doubao:file:write`。如需自动续期，在应用开通 `offline_access` 后设置 `OAUTH_OFFLINE_ACCESS=1`。

默认 `ENV=ppe` 使用 `open.feishu.cn` 并注入 PPE 头；`ENV=online` 使用 `open.doubao.com`。不要把一个环境的测试结论外推到另一个环境。

`.env.example` 是配置模板，服务本身只读环境变量。Node.js 22+ 可用 `node --env-file=.env server/server.js` 加载填写后的文件。

## 演示路径

1. 点击「使用飞书 SSO 登录」，确认账号，返回之前选择的 Tab。
2. 在 Playground 输入问题并连续追问，或新建一个空白对话。
3. 切换「系统集成」，选择业务记录并在侧栏分析；两处对话上下文互不混用。
4. 切换「接口列表说明」，展开接口查看边界与测试依据。
5. 点击右上角「退出登录」，撤销本浏览器登录；再次访问会回到登录页。

浏览器 → 同源 Node BFF → 豆包工作 API → 消息轮询 → 侧栏结果。没有本地 Agent 替代服务。侧栏使用最新 100 条消息按 `reply_id` 匹配当前 query，每 4 秒查询；仅 completed / failed / cancelled 结束观察。关闭侧栏、网络错误和页面重载不被解释为云端停止。未确认的提交使用原 uuid 找回；sessionStorage 按用户及 Playground / 系统集成分别保存本标签页任务与上下文，退出时清理当前用户的记录。停止操作提交真实 `user.interrupt` 并等待终态。

此演示不自动抓取其他业务数据，不自动写回商机，不演示文件上传操作；文件能力及其限制在能力页中说明。默认监听本机地址。已实现浏览器会话和令牌隔离；公开生产部署仍需配置 HTTPS、应用可见范围和组织准入策略。

## 结构

```text
web/src/App.tsx        SSO 登录页、用户信息与三个 Tab
web/src/catalog.ts    11 个接口及历史测试映射
web/src/EmbedDemo.tsx  共用对话逻辑：Playground 与业务侧栏
web/src/api.ts        HTTP 客户端与回复匹配
web/src/styles.css    豆包视觉与响应式布局
server/               浏览器会话、飞书 SSO、Node BFF、SSE 与上传代理
test/                 原有真实 API 测试套件
reports/              已脱敏的历史报告
docs/                 接口覆盖、问题记录、改造与验证说明
platform-hosted/      历史托管平台实现；不参与当前应用的构建或运行
```

旧版工作台可通过 Git 历史找回。平台托管版本仍在原目录，当前改造针对独立 Node 版。

## 开发与验证

```sh
cd web
npm ci
npm run dev         # Vite /api 代理到 4110
npm run build       # 严格 TypeScript 检查与生产构建
npm test            # 对话及 SSO 隔离/退出/重启回归测试
```

原接口套件 `node test/run.js` 是独立 CLI，会产生真实网络请求和报告，不读取浏览器的 SSO 会话；未单独注入令牌时多数用例跳过。不要用这类跳过结果证明业务接口已可用。

能力页直接引用仓库 `reports/20261013-1938-ppe.json` 的历史证据，不会用示例输出修改报告。此报告的 1 项 PASS 是 O6 环境配置观察，不代表双环境业务链路已通过；另有 2 项文档差异和 44 项未验证。

- [改造及验证说明](docs/SIMPLIFICATION.md)
- [API 覆盖矩阵](docs/API_COVERAGE.md)
- [排查手册](docs/TROUBLESHOOTING.md)
- [问题记录](docs/ISSUES.md)

MIT，见 [LICENSE](LICENSE)。
