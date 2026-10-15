# 豆包工作 Open API 展示台维护说明

- 产品默认 PPE；线上环境值为 `online`，切换必须二次确认。
- OAuth client secret、access token、refresh token 和 code 永不进入前端、证据或日志。
- 私密配置、一次性 state 与 token 使用服务端 `ag.appData`；配置 action 不回显 secret。
- 固定 OAuth 回调是 `http://127.0.0.1:4110/api/auth/feishu/callback`。平台托管版不能监听 4110，只能手动粘贴 code/回调 URL。
- 平台托管版不创建 Node/Express server，不监听端口，不依赖环境变量；README 中的 0.0.0.0:4110 只描述自有 Node 宿主。
- 业务 action 统一返回 `{httpStatus, code, msg, data, durationMs, request}`，请求头中的 Authorization 恒定打码。
- PPE 业务请求与 token 换取注入 `X-Tt-Env: ppe_doubao_oapi`、`X-Use-Ppe: 1`。
- MessageStream 与 sessionStreamProbe 只做最多 8 秒限时读取，逐帧返回已收到的原始 SSE，不承诺永久连接。
- Boundary Lab 的 a–k 在服务端执行并导出脱敏 Markdown；429 不主动压测，缺少 OAuth/生成窗口时标待判定。
- `runtimeProbe` 必须保留在既有 `api/lambda/auth.ts` 动作入口，且始终是无存储、无 OAuth、无网络、无初始化副作用的本地探针，返回 `{ok, ts, runtime:'platform-actions'}`。单独放入新 `runtime.ts` 时动作清单虽已生成，但发布路由曾稳定返回 HTML 404；迁入既有入口后，重新发布立即调用及后续 4 次连续调用全部成功。若再现，先以 `health` 对照区分单动作注册与全局平台路由问题。
- 对话页跟踪开始先立即 `messagesRetrieve`，随后 `messageStream` 连续 8 秒窗口与每 1.8 秒 retrieve 并行；流式请求失败会自动退化为纯轮询，切换会话/卸载通过 epoch + timer 清理令旧请求结果失效，终态自动停止。
- SSE 与 retrieve 共用 item id（即 block_id）合并并按 seq 排序；完整/落库 item 覆盖 delta 预览，reasoning 的 summary[] 保持分段，artifact 保留富卡片数据；原始帧保留在日志抽屉，Last-Event-ID 必须可见可复制。
- `connectionStatus` 会在可用时返回当前平台用户姓名/头像；前端拿不到时只显示“已授权账号”，不得猜测姓名。
