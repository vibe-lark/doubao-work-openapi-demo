import report from "../../reports/20261013-1938-ppe.json";

export const evidence = report;
export const sourceRoot =
  "https://github.com/vibe-lark/doubao-work-openapi-demo/blob/c2e450258cd63ea9f08e3f42e93472bfb955e8da/";
export const groups = [
  {
    id: "sessions",
    title: "管理会话",
    subtitle: "开始、找回与整理任务",
    description: "用会话承载一个工作任务，继续对话时复用同一会话。",
  },
  {
    id: "messages",
    title: "对话与进度",
    subtitle: "发送、接收与停止回复",
    description: "把业务上下文交给豆包，接收回复并跟踪到明确终态。",
  },
  {
    id: "files",
    title: "文件与成果",
    subtitle: "让豆包理解业务资料",
    description:
      "先上传文件取得 URI，再作为消息附件发送；成果由任务实际执行结果决定。",
  },
  {
    id: "access",
    title: "接入边界",
    subtitle: "授权、环境与验证范围",
    description:
      "文档定义说明可以如何接入；测试记录说明在什么条件下实际验证过。",
  },
] as const;
export type Group = (typeof groups)[number]["id"];
export type Capability = {
  id: string;
  group: Group;
  name: string;
  method: string;
  path: string;
  supports: string;
  boundary: string;
  tests: string[];
  deferred?: boolean;
};
export const capabilities: Capability[] = [
  {
    id: "create",
    group: "sessions",
    name: "创建会话",
    method: "POST",
    path: "/v1/sessions",
    supports: "创建空会话，或携带首条消息开始任务。",
    boundary: "请求需要 uuid。创建成功或消息受理不代表豆包已经完成工作。",
    tests: ["S2", "S3", "B3", "B4", "B5"],
  },
  {
    id: "list",
    group: "sessions",
    name: "查询会话列表",
    method: "GET",
    path: "/v1/sessions",
    supports: "分页查找当前授权用户的会话。",
    boundary: "分页、排序和游标需要配套使用；当前报告没有验证跨用户隔离。",
    tests: ["S10", "B13", "B14", "B15", "B16", "B17", "B18", "B19"],
  },
  {
    id: "retrieve",
    group: "sessions",
    name: "读取会话",
    method: "GET",
    path: "/v1/sessions/{session_id}",
    supports: "读取指定会话的名称与状态。",
    boundary:
      "会话状态不能替代某次回复的终态；必须关联当前 query_id 查询消息。",
    tests: ["S3", "B20"],
  },
  {
    id: "update",
    group: "sessions",
    name: "修改会话名称",
    method: "PATCH",
    path: "/v1/sessions/{session_id}",
    supports: "修改已有任务的名称，便于业务系统定位。",
    boundary:
      "文档定义的空名称和长度限制仍需在目标环境验证，不能把未运行的用例当成通过。",
    tests: ["S11", "B11", "B12"],
  },
  {
    id: "archive",
    group: "sessions",
    name: "归档会话",
    method: "DELETE",
    path: "/v1/sessions/{session_id}",
    supports: "调用会话归档接口。",
    boundary:
      "归档后的读写行为尚未在本仓库最近报告中验证；不将此操作承诺为数据彻底清除。",
    tests: ["S12"],
  },
  {
    id: "event",
    group: "messages",
    name: "发送消息 / 停止生成",
    method: "POST",
    path: "/v1/sessions/{session_id}/events",
    supports: "提交文字、文件内容，或通过 user.interrupt 请求停止指定回复。",
    boundary:
      "消息受理是异步开始。停止请求受理后，仍需回读到 cancelled 等终态；关闭侧栏不会取消任务。",
    tests: ["S3", "S4", "S5", "S6", "S7", "B6", "B7", "B8", "B9", "B10", "B22"],
  },
  {
    id: "stream",
    group: "messages",
    name: "接收单次回复事件流",
    method: "GET",
    path: "/v1/sessions/{session_id}/events/{query_id}",
    supports:
      "通过 SSE 获取一次回复的增量与状态；支持 Last-Event-ID 续传的接口契约。",
    boundary:
      "query_id 是用户消息 ID。断流、浏览器超时都不能直接判定云端任务失败。嵌入演示采用消息轮询。",
    tests: ["S2", "O1", "O2", "O3"],
  },
  {
    id: "messages",
    group: "messages",
    name: "读取消息历史",
    method: "GET",
    path: "/v1/sessions/{session_id}/messages",
    supports: "读取提问、回复、状态与实际返回的成果。",
    boundary:
      "持续观察时只匹配 reply_id 对应当前提问的回复，不能把上一轮结果当作本轮完成。",
    tests: ["S4", "S8", "S9"],
  },
  {
    id: "message",
    group: "messages",
    name: "读取单条消息",
    method: "GET",
    path: "/v1/sessions/{session_id}/messages/{message_id}",
    supports: "查询一条提问或回复的内容与状态。",
    boundary:
      "区分用户消息 ID 与回复消息 ID；返回结构需以目标环境的实际响应为准。",
    tests: ["S3", "B21"],
  },
  {
    id: "session-stream",
    group: "messages",
    name: "会话级事件流",
    method: "GET",
    path: "/v1/sessions/{session_id}/events",
    supports: "文档列出该接口，但标注暂缓开放。",
    boundary:
      "不要将会话级持续订阅作为当前可交付能力。单次回复使用 MessageStream 或消息查询。",
    tests: ["B27"],
    deferred: true,
  },
  {
    id: "file",
    group: "files",
    name: "上传文件",
    method: "POST",
    path: "/v1/files",
    supports: "通过 multipart 上传资料，取得后续消息可引用的文件 URI。",
    boundary:
      "普通外链不能直接假定为上传 URI。格式、大小、空文件与仅附件消息的支持范围，需要单独验证。",
    tests: ["S1", "S5", "S6", "S13", "B23", "B24", "B25", "B26"],
  },
];
export const verdictLabel: Record<string, string> = {
  PASS: "已通过",
  FAIL: "失败",
  MISMATCH: "与文档有差异",
  SKIPPED: "未验证",
  BLOCKED: "受阻",
};
export const verdictClass: Record<string, string> = {
  PASS: "pass",
  FAIL: "warn",
  MISMATCH: "warn",
  SKIPPED: "",
  BLOCKED: "warn",
};
