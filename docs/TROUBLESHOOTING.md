# 对接排查手册（给客户 / 伙伴工程师）

面向对接工程师的自助排查：按「现象 / 错误码」组织，命令均可直接复制。
所有命令默认在本工程仓库根目录执行，本机已安装 Node 18+。

- 启动服务：`node server/server.js`（默认 http://127.0.0.1:4110）
- 健康检查：`curl -s http://127.0.0.1:4110/api/health`
- 连接状态：`curl -s http://127.0.0.1:4110/api/auth/status`
- 跑一遍无 token 自检：`node test/run.js B1 B2`
- PPE 与线上域名：
  - PPE：`https://open.feishu.cn/open-apis/agent`，必须带头 `X-Tt-Env: ppe_doubao_oapi`、`X-Use-Ppe: 1`
  - 线上：`https://open.doubao.com/open-apis/agent`，不带 PPE 头

错误码速查：

| 你看到的 | 大致含义 | 先看 |
| --- | --- | --- |
| 99991401 | 出口 IP 不在应用白名单 | [99991401](#99991401) |
| 99991661 / 99991668 / 401001 | token 缺失/失效/被拒 | [9999166x](#99991661--99991668--401001) |
| 400001 | 参数非法 | [400001](#400001) |
| 400002 | 文件类型不支持 | [400002](#400002) |
| 400004 | 空文件 | [400004](#400004) |
| 404001 | session/message 不存在（含已删除） | [404001](#404001) |
| 409001 | 还有回复在生成中 | [409001](#409001) |
| 413001 | 文件超过大小上限 | [413001](#413001) |
| 429001 | 触发限流 | [429001](#429001) |

---

## 99991401

**现象**：任何业务请求返回 `HTTP 400`，body 类似 `{"code":99991401,"msg":"ip 1.2.3.4 is denied by app setting"}`。

**原因**：应用开启了 IP 白名单，而你本机 / 服务器的出口 IP 不在名单内。PPE、线上都会拦。

**自查步骤**：

```bash
# 1) 看自己当前的出口公网 IP
curl -s https://ifconfig.me; echo

# 2) 不带业务、直接打豆包网关复现（PPE）
curl -i -s 'https://open.feishu.cn/open-apis/agent/v1/sessions?page_size=1' \
  -H 'X-Tt-Env: ppe_doubao_oapi' -H 'X-Use-Ppe: 1'
```

**解决办法**：去开发者后台应用安全设置，把出口 IP（注意是办公网/机房 NAT IP，不是本机 127.0.0.1）加入白名单，等待生效后重试。使用代理/VPN 时以实际出口 IP 为准。

**参考**：[ISSUE-002](ISSUES.md#issue-002--开启-ip-白名单后非白名单出口统一返回-99991401与鉴权错误难以区分)

---

## 99991661 / 99991668 / 401001

**现象**：业务请求返回 `HTTP 400` 且 `code` 为 `99991661`（Missing access token）或 `99991668`（Invalid access token）；文档写的是 `401 / 401001`。

**原因**（按出现顺序排查）：
1. 根本没带 `Authorization: Bearer <user_access_token>`；
2. token 拼错、被截断，或用了 `tenant_access_token` / 旧版无 scope token；
3. token 已过期（user_access_token 实测约 1 小时量级）且 refresh 失败；
4. 用的是旧版 OAuth（`authen/v1/access_token`，授权无 `doubao:*` scope）换的 token，豆包不认；
5. PPE 漏带头，打到了错误的环境鉴权链路。

**自查步骤**：

```bash
# 1) 本服务当前连接状态（不回显 token 原文）
curl -s http://127.0.0.1:4110/api/auth/status

# 2) 无 token / 伪造 token 的网关真实返回（自检，安全）
node test/run.js B1 B2

# 3) 手工带 token 直连验证（把 $TOKEN 换成你的 user_access_token）
TOKEN='u-xxxxxxxxxxxx'
curl -i -s 'https://open.feishu.cn/open-apis/agent/v1/sessions?page_size=1' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'X-Tt-Env: ppe_doubao_oapi' -H 'X-Use-Ppe: 1'
```

**解决办法**：
- 重新走新版 v3 授权：授权页显式带 6 个 `doubao:*` scope，换 token 用 `https://accounts.feishu.cn/oauth/v3/token`；
- 云端回调打不开时，在首页「手动粘贴 code / 完整回调 URL」完成连接；
- token 过期：本服务到期前 2 分钟自动刷新；只有授权时带 `offline_access` scope 才会下发 refresh_token（设 `OAUTH_OFFLINE_ACCESS=1`，需应用后台已开通「刷新 user_access_token」）。无 refresh_token 时到期后页面自动回到授权页，重新授权即可；
- 9999166x 与文档 401001 不一致是已登记的网关行为，客户端可同等对待，但以平台后续确认为准。

**参考**：[ISSUE-001](ISSUES.md)、[ISSUE-003](ISSUES.md)、[ISSUE-004](ISSUES.md)

---

## 400001

**现象**：`HTTP 400 {"code":400001,...}`。

**原因**：请求参数不合法。高频原因：

- `POST /v1/sessions` 缺 `uuid`；`initial_events` 传了两条或放了 `user.interrupt`；
- `POST .../events`：`events` 不是恰好一条；`contents` 为空数组；文本全是空白；`file` 块缺 `uri`；`user.message` 带了 `message_id`；`user.interrupt` 带了 `contents`；
- `PATCH /v1/sessions/{id}`：没传 `name`，或 `name` 超过 256 字符；
- 分页：`page_size` 不在 1–100、不是数字；翻页时改了 `order`；`page_token` 非法或过期。

**自查步骤**：

```bash
# 让套件自动覆盖全部参数边界（需 token）
DOUBBAO_USER_TOKEN='u-xxxx' node test/run.js --group 会话创建
DOUBBAO_USER_TOKEN='u-xxxx' node test/run.js --group 事件参数
DOUBBAO_USER_TOKEN='u-xxxx' node test/run.js --group 分页
DOUBBAO_USER_TOKEN='u-xxxx' node test/run.js --group 更新边界
```

**解决办法**：按接口文档修正字段；`page_token` 必须原样透传，翻页时保持首次请求的 `order` 与过滤条件一致。

---

## 400002

**现象**：上传文件返回 `HTTP 400 {"code":400002}`。

**原因**：文件类型不在白名单。图片只支持 png/jpg/jpeg/webp/gif；其它文件按扩展名白名单（pdf、doc/docx、xls/xlsx、ppt/pptx、csv、txt、md、json 及常见代码、音频后缀）。`.exe` 等可执行类型会被拒。

**自查步骤**：

```bash
# 伪造扩展名复现（需 token）
DOUBBAO_USER_TOKEN='u-xxxx' node test/run.js B24
```

**解决办法**：改用白名单扩展名；注意平台按扩展名/类型判定，仅改 Content-Type 不能绕过。

---

## 400004

**现象**：上传返回 `HTTP 400 {"code":400004}`。

**原因**：上传了 0 字节空文件。

**自查步骤**：

```bash
DOUBBAO_USER_TOKEN='u-xxxx' node test/run.js B23
```

**解决办法**：上传前在客户端校验文件大小 > 0 并提前提示。

---

## 404001

**现象**：`HTTP 404 {"code":404001}`。

**原因**：session 不存在，或已被删除（删除即归档，之后 retrieve/update/events/messages 全部 404001，List 也不再返回）；message id 不属于该 session 或不存在。

**自查步骤**：

```bash
SID='7442600000000000001'
curl -i -s "https://open.feishu.cn/open-apis/agent/v1/sessions/$SID" \
  -H "Authorization: Bearer $TOKEN" -H 'X-Tt-Env: ppe_doubao_oapi' -H 'X-Use-Ppe: 1'
```

**解决办法**：确认 id 复制完整、环境没切错（PPE 建的会话在线上查不到）；删除后的访问 404001 是预期，不要当故障重试。

---

## 409001

**现象**：发消息返回 `HTTP 409 {"code":409001,"msg":"session has a message in progress"}`。

**原因**：session 还在 `in_progress`，上一条回复没结束就发了下一条。

**自查步骤**：

```bash
# 发送后轮询 session 状态，确认 idle 再发下一条
curl -s "https://open.feishu.cn/open-apis/agent/v1/sessions/$SID" \
  -H "Authorization: Bearer $TOKEN" -H 'X-Tt-Env: ppe_doubao_oapi' -H 'X-Use-Ppe: 1'
```

**解决办法**：多轮对话严格等 `session.status=idle`（或上一条 assistant 消息 completed/failed/cancelled）再发；不要用固定 sleep 代替状态判断。要停止当前回复用 `user.interrupt`。注意该错误的自动化复现依赖真实生成窗口，套件抢不到窗口会标 BLOCKED 而不是 FAIL（见 ISSUE-008）。

**参考**：[ISSUE-008](ISSUES.md)

---

## 413001

**现象**：上传返回 `HTTP 413 {"code":413001}`。

**原因**：图片超过 20MB，或其它文件超过 100MB。也可能是你自己的网关/反向代理先于豆包拦截——要区分拦截层。

**自查步骤**：

```bash
# 21MB 伪图片（约 21MB 上行，默认开启）
DOUBBAO_USER_TOKEN='u-xxxx' node test/run.js B25
# 101MB 伪文件（101MB 上行，需显式开启）
DOUBBAO_USER_TOKEN='u-xxxx' RUN_LARGE_FILES=1 node test/run.js B26
```

**解决办法**：客户端压缩/裁剪图片、拆分或走对象存储；若响应不是豆包通用 JSON 结构而是代理/CDN 的错误页，说明请求没到豆包，需要调大你自己链路的 body 上限。

---

## 429001

**现象**：`HTTP 429 {"code":429001}`。

**原因**：触发平台限流。

**自查步骤**：本工程**不提供压测脚本**，请只在自然使用中观察；记录被限流时的接口、时间、请求频率与重试间隔。

**解决办法**：指数退避 + 抖动重试，降低并发；批量调用串行化。不要用并发洪水「试探」限流阈值。B28 仅记录文档定义。

---

## code 已使用 / invalid_grant

**现象**：手动粘贴 code 换 token 返回 code 已使用、`invalid_grant` 一类错误。

**原因**：授权码有效期只有几分钟且一次性；刷新页面、重复提交都会导致二次使用。

**自查步骤**：确认粘贴的是浏览器地址栏最新一次跳转里的 `code`。

**解决办法**：回到首页重新点「用飞书授权连接」，走完整授权后立刻粘贴新 code。

---

## 回调页打不开（127.0.0.1）

**现象**：授权后浏览器跳到 `http://127.0.0.1:4110/...` 显示无法访问。

**原因**：你在云端/远程环境打开授权页，本机没有起 4110 服务；这是固定本机回调的预期限制。

**解决办法**：
1. 在本机启动 `node server/server.js`，再走授权（可自动接住）；
2. 或保留那个「打不开」的地址栏 URL，复制整段（或其中的 `code=...`），回到展示台首页粘进手动输入框提交。

**参考**：[ISSUE-006](ISSUES.md)

---

## SSE 收不到帧 / EventSource 报错

**现象**：对话发出后一直「等待」，没有流式内容；或浏览器 EventSource 反复重连。

**自查步骤**：

```bash
# 1) 未登录时 SSE 路由应明确返回 NOT_CONNECTED（说明路由在）
curl -i -s -N 'http://127.0.0.1:4110/api/sessions/demo/events/1' -H 'Accept: text/event-stream'

# 2) 有 token 时直连 MessageStream，观察是否有 event:/data: 帧
curl -i -s -N "https://open.feishu.cn/open-apis/agent/v1/sessions/$SID/events/$QUERY_MSG_ID" \
  -H "Authorization: Bearer $TOKEN" -H 'Accept: text/event-stream' \
  -H 'X-Tt-Env: ppe_doubao_oapi' -H 'X-Use-Ppe: 1'
```

**解决办法**：
- 确认 path 里最后一个 id 是**触发回复的用户消息 id（query）**，不是 assistant 的 message id，也不是 `reply_id`；
- 会话级 Stream 文档标注[暂缓]，行为以 B27 真机探测为准；
- 经过 nginx/网关时关闭缓冲（本服务已发 `X-Accel-Buffering: no`），支持 SSE；
- 浏览器原生 EventSource 断线会自动重带 `Last-Event-ID`，本服务在浏览器断开时会 abort 上游，无僵尸连接。

---

## token 刚连上很快又失效

**现象**：授权成功，短时间（约 1 小时）后业务调用失败；或刷新后仍失败。

**自查步骤**：

```bash
curl -s http://127.0.0.1:4110/api/auth/status   # 看 expiresAt
# 具备 OAUTH_CLIENT_ID/SECRET 时可实测刷新链路（会轮转 refresh_token，结果回写本地）
OAUTH_CLIENT_ID='cli_xxx' OAUTH_CLIENT_SECRET='xxx' DOUBBAO_USER_TOKEN='u-xxxx' node test/run.js O5
```

**解决办法**：依赖本服务的自动刷新；长时间不用后重新授权；确认系统时钟准确（expires_at 按本机时间判断）。refresh_token 的轮转/有效期以平台确认为准（ISSUE-004）。

---

## 旧版 token 被拒

**现象**：用历史 OAuth 教程换到的 token 调豆包接口一律鉴权失败，但 token 本身在其它飞书接口可用。

**原因**：豆包工作 OpenAPI 只认显式申请了 `doubao:*` scope 的新版 v3 用户 token。

**解决办法**：按 [README](../README.md) 的 OAuth 配置重新做授权（6 个 scope + `/oauth/v3/token`），不要复用旧 token。

**参考**：[ISSUE-003](ISSUES.md)

---

## 仍然没解决

1. 跑一次完整无 token 自检并保存报告：`node test/run.js`（报告在 `reports/`，已自动脱敏）；
2. 有 token 时跑全量，把出问题用例的**脱敏**证据（HTTP 状态、code、msg、请求 id，如有）连同环境（PPE/线上）、出口 IP 是否加白一起反馈；
3. 先查 [ISSUES.md](ISSUES.md) 是否已登记同一问题。
