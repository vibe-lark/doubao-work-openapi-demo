# 豆包工作 Open API · 能力与嵌入演示

只保留两个入口：

- **能力边界**：免登录查看会话、消息、文件与接入限制。展开接口可看文档定义、使用边界与历史测试记录；未验证不标为已支持。
- **嵌入演示**：模拟商机系统，在豆包侧栏检查跟进记录、准备拜访问题、分析风险。示例模式是预置内容；真实模式走现有 Node BFF 与豆包 API。

沿用豆包工作浅蓝 `#CAE4FF`、黑白、系统字体与官方 Logo。主应用仅依赖 React / React DOM，不再包含通用调试台、文件工作台和边界批量运行界面。

## 启动

Node.js 18+。仓库提交了 `web/dist`，查看演示不需要安装依赖或配置凭据。

```sh
node server/server.js
# 打开 http://127.0.0.1:4110
```

## 真实调用

配置飞书自建应用，登记回调地址 `http://127.0.0.1:4110/api/auth/feishu/callback`，开通所需用户权限，然后启动：

```sh
OAUTH_CLIENT_ID=cli_xxx OAUTH_CLIENT_SECRET=xxx ENV=ppe node server/server.js
```

在页面点击「接入说明 → 连接飞书」。密钥仅由服务端读取，用户令牌保存在被 Git 忽略的 `.tokens/`，不下发浏览器。

需申请的权限：`doubao:session:read`、`doubao:session:write`、`doubao:session.event:read`、`doubao:session.event:write`、`doubao:session.message:read`、`doubao:file:write`。如需自动续期，在应用开通 `offline_access` 后设置 `OAUTH_OFFLINE_ACCESS=1`。

默认 `ENV=ppe` 使用 `open.feishu.cn` 并注入 PPE 头；`ENV=online` 使用 `open.doubao.com`。不要把一个环境的测试结论外推到另一个环境。

`.env.example` 是配置模板，服务本身只读环境变量。Node.js 22+ 可用 `node --env-file=.env server/server.js` 加载填写后的文件。

## 演示路径

1. 在「能力边界」切换四个分类，展开一项接口与测试记录。
2. 打开「嵌入演示」，查看左侧模拟客户的跟进记录。
3. 选择问题并点击「查看示例」，展示侧栏交互；输出明确标为预置示例。
4. 授权后切换「真实调用」，确认是否附带记录，发送问题。
5. 收到回复后可继续提问；真实调用复用会话。取消勾选只影响新附加内容，不清除先前上下文。

浏览器 → 同源 Node BFF → 豆包工作 API → 消息轮询 → 侧栏结果。没有本地 Agent 替代服务。侧栏使用最新 100 条消息按 `reply_id` 匹配当前 query，每 4 秒查询；仅 completed / failed / cancelled 结束观察。关闭侧栏、网络错误和页面重载不被解释为云端停止。未确认的提交使用原 uuid 找回；sessionStorage 保存本标签页的任务编号和合成上下文。停止操作提交真实 `user.interrupt` 并等待终态。

此演示不自动抓取其他业务数据，不自动写回商机，不演示文件上传操作；文件能力及其限制在能力页中说明。仅面向本机单用户，公开多用户部署前需补充访问控制与令牌隔离。

## 结构

```text
web/src/App.tsx        两个入口、能力与接入说明
web/src/catalog.ts    11 个接口及历史测试映射
web/src/EmbedDemo.tsx  模拟业务系统与真实豆包侧栏
web/src/api.ts        HTTP 客户端与回复匹配
web/src/styles.css    豆包视觉与响应式布局
server/               原有 Node BFF、OAuth、SSE 与上传代理
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
```

原接口套件 `node test/run.js` 会产生真实网络请求和报告；未授权时多数用例跳过。不要用这类跳过结果证明业务接口已可用。

能力页直接引用仓库 `reports/20261013-1938-ppe.json` 的历史证据，不会用示例输出修改报告。此报告的 1 项 PASS 是 O6 环境配置观察，不代表双环境业务链路已通过；另有 2 项文档差异和 44 项未验证。

- [改造及验证说明](docs/SIMPLIFICATION.md)
- [API 覆盖矩阵](docs/API_COVERAGE.md)
- [排查手册](docs/TROUBLESHOOTING.md)
- [问题记录](docs/ISSUES.md)

MIT，见 [LICENSE](LICENSE)。
