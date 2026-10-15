# API 覆盖矩阵（11 接口 × 测试场景）

- 权威接口定义：豆包 OpenAPI 接口文档（11 个接口、对象/状态机、SSE 帧、错误码）。
- 图例：● 主验证　◐ 附带验证　— 不涉及
- 每次运行 `node test/run.js` 后，本文件末尾的「最近一次运行结果」会自动更新；用例明细与脱敏证据见 `reports/`。
- 结论：PASS（符合文档）/ FAIL（与预期相反的执行失败）/ MISMATCH（跑通但与文档不符，待平台确认）/ BLOCKED（前提未形成，如实标记）/ SKIPPED（无 token 或受控不运行）。

## 11 个接口

| # | 接口 | 方法 / 路径 | 状态 |
|---|---|---|---|
| 1 | Sessions Create | `POST /v1/sessions` | 就绪 |
| 2 | Sessions Retrieve | `GET /v1/sessions/{session_id}` | 就绪 |
| 3 | Sessions Update | `PATCH /v1/sessions/{session_id}` | 就绪 |
| 4 | Sessions Delete | `DELETE /v1/sessions/{session_id}` | 就绪 |
| 5 | Sessions List | `GET /v1/sessions` | 就绪 |
| 6 | Events Create | `POST /v1/sessions/{session_id}/events` | 就绪 |
| 7 | Stream（会话级） | `GET /v1/sessions/{session_id}/events` | **文档标注[暂缓]**，B27 真机探测 |
| 8 | MessageStream | `GET /v1/sessions/{session_id}/events/{message_id}` | 就绪 |
| 9 | Messages List | `GET /v1/sessions/{session_id}/messages` | 就绪 |
| 10 | Messages Retrieve | `GET /v1/sessions/{session_id}/messages/{message_id}` | 就绪 |
| 11 | Files Upload | `POST /v1/files` | 就绪 |

## 场景 × 接口覆盖矩阵

| 用例 | 场景 | 1 Create | 2 Retrieve | 3 Update | 4 Delete | 5 List | 6 Events | 7 Stream | 8 MsgStream | 9 MsgList | 10 MsgRetrieve | 11 Upload |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 上传 png/txt/pdf 拿 uri | — | — | — | — | — | — | — | — | — | — | ● |
| S2 | 建会话带 initial_events → 流式完整回复 → reply_id 关系 | ● | ◐ | — | — | — | — | — | ● | ● | ● | ● |
| S3 | 空会话 → 发消息 202 → 流式+轮询 → 终态 | ● | ◐ | — | — | — | ● | — | ● | — | ● | — |
| S4 | 连续 3 轮多轮（严格 idle） | ● | ● | — | — | — | ● | — | ◐ | ● | ● | — |
| S5 | 文本 + 2 附件 | ● | — | — | — | — | ● | — | ● | — | ● | ● |
| S6 | 仅附件无文本 | ● | — | — | — | — | ● | — | ● | — | ● | ● |
| S7 | 长任务 interrupt → cancelled + 半截文本 | ● | ● | — | — | — | ● | — | ● | — | ● | — |
| S8 | 引导 artifact 产出 | ● | — | — | — | — | ● | — | ● | — | ● | ◐ |
| S9 | Messages List page_size=1 真翻页 / asc/desc | ● | — | — | — | — | ◐ | — | — | ● | ● | — |
| S10 | Sessions List 翻页与排序 | ● | — | — | ◐ | ● | — | — | — | — | — | — |
| S11 | Update 改名 → 空串 → 256 字符 | ● | ● | ● | ◐ | — | — | — | — | — | — | — |
| S12 | 删除后 4 个接口全部 404001 | ● | — | ● | ● | — | ● | — | — | ◐ | — | — |
| S13 | 同 uuid 幂等（建会话/上传/事件） | ● | ● | — | ◐ | — | ● | — | — | — | ◐ | ● |
| B1 | 无 token 鉴权 | ◐ | — | — | — | ● | — | — | — | — | — | — |
| B2 | 伪造 token 鉴权 | ◐ | — | — | — | ● | — | — | — | — | — | — |
| B3–B5 | 建会话校验（无 uuid / 双 initial_events / interrupt） | ● | — | — | — | — | — | — | — | — | — | — |
| B6–B10 | 事件 contents/message_id 校验 | — | — | — | — | — | ● | — | — | — | — | — |
| B11–B12 | PATCH name 缺失 / 257 字符 | ● | — | ● | — | — | — | — | — | — | — | — |
| B13–B19 | 分页 0/101/非数字/1/100、改 order、非法 token | — | — | — | — | ● | — | — | — | ● | — | — |
| B20–B21 | 不存在 session / message | — | ● | — | — | — | — | — | — | — | ● | — |
| B22 | in_progress 连发两条 → 409001 | ● | ● | — | — | — | ● | — | — | — | — | — |
| B23–B26 | 空文件 / 坏扩展名 / 超 20MB / 超 100MB | — | — | — | — | — | — | — | — | — | — | ● |
| B27 | 会话级 Stream 真机探测 | ● | — | — | — | — | — | ● | — | — | — | — |
| B28 | 429001（文档定义，受控不运行） | 全部接口 | | | | | | | | | | |
| O1 | SSE seq 单调与帧序 | — | — | — | — | — | ◐ | — | ● | — | — | — |
| O2 | Last-Event-ID 断线续传补发 | — | — | — | — | — | — | — | ● | — | — | — |
| O3 | SSE 与 Retrieve 的 item id 一致 | — | — | — | — | — | — | — | ● | — | ● | — |
| O4 | cancelled 后恢复 idle 可继续对话 | ● | ● | — | — | — | ● | — | ◐ | — | ● | — |
| O5 | token 有效期与 refresh 实测 | OAuth v3 + 全部业务接口 | | | | | | | | | | |
| O6 | PPE / 线上差异 | 双环境对比（破坏性仅 PPE） | | | | | | | | | | |

## 边界矩阵明细

| 用例 | 输入 | 文档预期 |
|---|---|---|
| B1 | 无 Authorization | 401 / 401001（实测 99991661，见 ISSUE-001） |
| B2 | 伪造 Bearer token | 401 / 401001（实测 99991668，见 ISSUE-001） |
| B3 | Create 缺 uuid | 400 / 400001 |
| B4 | initial_events 两条 | 400 / 400001 |
| B5 | initial_events 放 user.interrupt | 400 / 400001 |
| B6 | contents=[] | 400 / 400001 |
| B7 | 纯空白文本 | 400 / 400001 |
| B8 | file 块无 uri | 400 / 400001 |
| B9 | user.message 带 message_id | 400 / 400001 |
| B10 | user.interrupt 带 contents | 400 / 400001 |
| B11 | PATCH 缺 name | 400 / 400001 |
| B12 | name 257 字符 | 400 / 400001 |
| B13 | page_size=0 | 400 / 400001 |
| B14 | page_size=101 | 400 / 400001 |
| B15 | page_size=abc | 400 / 400001 |
| B16 | page_size=1 | 200，至多 1 条 |
| B17 | page_size=100 | 200，至多 100 条 |
| B18 | 带 page_token 改 order | 400 / 400001 |
| B19 | 非法 page_token | 400 / 400001 |
| B20 | 不存在 session | 404 / 404001 |
| B21 | 不存在 message | 404（记录实际 code） |
| B22 | in_progress 连发第二条 | 409 / 409001 |
| B23 | 0 字节文件 | 400 / 400004 |
| B24 | .exe 坏扩展名 | 400 / 400002 |
| B25 | 21MB png | 413 / 413001 |
| B26 | 101MB txt（RUN_LARGE_FILES=1） | 413 / 413001 |
| B27 | 会话级 Stream | 文档[暂缓]，记录真实 HTTP/帧 |
| B28 | 429001 | 文档定义，受控不运行 |

## 运行方式

```bash
# 无 token：框架自检 + B1/B2 真实鉴权探测，业务用例 SKIPPED
node test/run.js

# 有 token（二选一）
DOUBBAO_USER_TOKEN='u-xxxx' node test/run.js
# 或完成本机 OAuth 后直接读取 .tokens/token.json（server 与 test 共用）
node test/run.js

# 选择运行
node test/run.js S2 S3 O1 O2
node test/run.js --group 分页
RUN_LARGE_FILES=1 node test/run.js B26
DOUBBAO_ENV=online node test/run.js B16 B17   # 线上只跑非破坏性
```

---

## 最近一次运行结果（自动更新）

<!-- AUTO:RESULTS:START -->
最近一次自动运行：2026-10-13T11:38:36.576Z · 环境 ppe

PASS 1 · FAIL 0 · MISMATCH 2 · BLOCKED 0 · SKIPPED 44

| 用例 | 接口 | 结论 | 摘要 |
|---|---|---|---|
| S1 | POST /v1/files | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S2 | POST /v1/sessions + MessageStream | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S3 | POST /v1/events + MessageStream | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S4 | 连续多轮 Events Create | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S5 | Events Create（文本+2 附件） | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S6 | Events Create（仅附件） | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S7 | user.interrupt | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S8 | artifact 观察 | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S9 | Messages List 分页 | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S10 | Sessions List 分页排序 | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S11 | PATCH /v1/sessions/{id} | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S12 | 删除后 404001 | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| S13 | uuid 幂等 | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B1 | GET /v1/sessions | MISMATCH | HTTP 400 / code 99991661 / Missing access token for authorization. Please make a request with token attached. |
| B2 | GET /v1/sessions | MISMATCH | HTTP 400 / code 99991668 / Invalid access token for authorization. Please make a request with token attached. |
| B3 | POST /v1/sessions | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B4 | POST /v1/sessions | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B5 | POST /v1/sessions | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B6 | POST /v1/events | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B7 | POST /v1/events | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B8 | POST /v1/events | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B9 | POST /v1/events | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B10 | POST /v1/events | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B11 | PATCH /v1/sessions/{id} | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B12 | PATCH /v1/sessions/{id} | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B13 | GET /v1/sessions | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B14 | GET /v1/sessions | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B15 | GET /v1/sessions | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B16 | GET /v1/sessions | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B17 | GET /v1/sessions | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B18 | page_token + order | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B19 | page_token 非法 | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B20 | GET /v1/sessions/{id} | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B21 | GET .../messages/{id} | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B22 | in_progress 连发两条 | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B23 | POST /v1/files（空文件） | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B24 | POST /v1/files（坏扩展名） | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B25 | POST /v1/files（>20MB 图片） | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B26 | POST /v1/files（>100MB 文件） | SKIPPED | 设置 RUN_LARGE_FILES=1 以执行 101MB 上传用例（默认跳过以节省带宽） |
| B27 | GET /v1/sessions/{id}/events | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| B28 | 429001 | SKIPPED | 受控不运行：429001 仅记录文档定义，不进行任何压测 |
| O1 | SSE seq/帧序 | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| O2 | Last-Event-ID 续传 | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| O3 | SSE/Messages item id | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| O4 | cancelled 后恢复 idle | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| O5 | token 有效期/refresh | SKIPPED | 未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件 |
| O6 | PPE/线上差异 | PASS | env=ppe；差异对比留待真机双环境受控运行 |
<!-- AUTO:RESULTS:END -->
