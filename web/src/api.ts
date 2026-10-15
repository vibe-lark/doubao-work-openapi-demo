export type Connection = {
  connected: boolean;
  environment: "ppe" | "online";
  configured: boolean;
};
export type Message = {
  id: string;
  role: string;
  reply_id?: string;
  status: string;
  items?: Array<{
    type: string;
    text?: string;
    content?: string;
    [key: string]: unknown;
  }>;
};
export async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message || data.msg || `请求失败（HTTP ${response.status}）`,
    );
  return data;
}
export async function connection(): Promise<Connection> {
  const [status, config] = await Promise.all([
    request("/api/auth/status"),
    request("/api/config"),
  ]);
  return {
    connected: status.connected,
    environment: status.environment,
    configured: config.oauthConfigured,
  };
}
export async function proxy(path: string, body?: unknown) {
  const result = await request(path, body);
  if (
    !(result.httpStatus >= 200 && result.httpStatus < 300) ||
    (result.code != null && String(result.code) !== "0")
  ) {
    throw new Error(
      `${result.msg || "豆包请求失败"}（HTTP ${result.httpStatus || "未发出"}，code ${result.code ?? "—"}）`,
    );
  }
  return result.data;
}
export function replyFor(messages: Message[], queryId: string) {
  return messages.find(
    (message) => message.role === "assistant" && message.reply_id === queryId,
  );
}
export function isTerminal(message: Message) {
  return ["completed", "failed", "cancelled"].includes(message.status);
}
export function messageText(message: Message) {
  return (message.items || [])
    .filter((item) => item.type === "text")
    .map((item) => {
      const text = item.text || item.content || "";
      try {
        const blocks = JSON.parse(text);
        if (
          Array.isArray(blocks) &&
          blocks.length &&
          blocks.every(
            (block) =>
              typeof block.block_id === "string" && block.block_type === 10040,
          )
        )
          return message.status === "in_progress" ? "豆包正在思考…" : "";
      } catch {
        /* Ordinary text is the normal response format. */
      }
      return text;
    })
    .filter(Boolean)
    .join("\n");
}
