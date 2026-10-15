// @api/doubao shim：同名导出走本地 Node 服务的 REST 代理。
// 统一返回 ProxyResult：{ httpStatus, code, msg, data, durationMs, request, frames? }。

import type { ProxyResult } from '@shared/schema';

type Query = Record<string, string | number | boolean | undefined>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// 本机服务异常（未启动 / 返回 HTML / 401 等）时也归一为 ProxyResult，避免组件拿到 SyntaxError。
export async function readProxy(response: Response, request: ProxyResult['request'], started: number): Promise<ProxyResult> {
  const text = await response.text();
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { /* 非 JSON 原文 */ }
  const p = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  if (p && 'httpStatus' in p) return { request, durationMs: Date.now() - started, ...p } as unknown as ProxyResult;
  const err = p?.error && typeof p.error === 'object' ? p.error as Record<string, unknown> : null;
  return {
    httpStatus: response.status,
    code: (err?.kind ?? p?.code ?? null) as string | number | null,
    msg: String(err?.message ?? p?.error ?? p?.msg ?? (text.slice(0, 300) || response.statusText)),
    data: p ?? null,
    durationMs: Date.now() - started,
    request,
  };
}

async function call(method: string, path: string, body?: unknown): Promise<ProxyResult> {
  const started = Date.now();
  const request = { method, url: new URL(path, location.origin).toString(), headers: {} as Record<string, string> };
  try {
    const response = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return await readProxy(response, request, started);
  } catch (error) {
    return { httpStatus: 0, code: 'NETWORK_ERROR', msg: `无法连接本机服务：${error instanceof Error ? error.message : String(error)}`, data: null, durationMs: Date.now() - started, request };
  }
}

/** 统一判定 ProxyResult 是否为成功响应（HTTP 2xx 且业务 code 为 0/空）。 */
export function isOk(r: ProxyResult | null | undefined): r is ProxyResult {
  return !!r && r.httpStatus >= 200 && r.httpStatus < 300 && (r.code === null || r.code === undefined || r.code === 0 || r.code === '0');
}
export function failText(r: ProxyResult | null | undefined, fallback = '请求失败') {
  if (!r) return fallback;
  return `${fallback}（HTTP ${r.httpStatus || '—'}${r.code !== null && r.code !== undefined ? ` · code ${r.code}` : ''}）${r.msg ? `：${r.msg}` : ''}`;
}

const id = (v: string) => encodeURIComponent(v);

export async function sessionsCreate(input: { data: { body?: unknown } }) {
  return call('POST', '/api/sessions', input.data.body);
}
export async function sessionsRetrieve(input: { data: { sessionId: string } }) {
  return call('GET', `/api/sessions/${id(input.data.sessionId)}`);
}
export async function sessionsUpdate(input: { data: { sessionId: string; body: unknown } }) {
  return call('PATCH', `/api/sessions/${id(input.data.sessionId)}`, input.data.body);
}
export async function sessionsDelete(input: { data: { sessionId: string } }) {
  return call('DELETE', `/api/sessions/${id(input.data.sessionId)}`);
}
export async function sessionsList(input: { data?: { query?: Query } }) {
  return call('GET', withQuery('/api/sessions', input.data?.query));
}
export async function eventsCreate(input: { data: { sessionId: string; body: unknown } }) {
  return call('POST', `/api/sessions/${id(input.data.sessionId)}/events`, input.data.body);
}
export async function messagesList(input: { data: { sessionId: string; query?: Query } }) {
  return call('GET', withQuery(`/api/sessions/${id(input.data.sessionId)}/messages`, input.data.query));
}
export async function messagesRetrieve(input: { data: { sessionId: string; messageId: string } }) {
  return call('GET', `/api/sessions/${id(input.data.sessionId)}/messages/${id(input.data.messageId)}`);
}

// 有界 SSE 读取（限时探测）：直接 fetch SSE 端点，收集帧，保留真实 HTTP 状态。
// 持久实时流请用 openMessageStream()（EventSource），见 PlaygroundPage。
async function boundedStream(path: string, lastEventId?: string, limitMs = 5000): Promise<ProxyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);
  const started = Date.now();
  try {
    const response = await fetch(path, {
      headers: {
        Accept: 'text/event-stream',
        ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/event-stream')) {
      const text = await response.text();
      let payload: unknown = text;
      try { payload = JSON.parse(text); } catch { /* 非 JSON 原文 */ }
      const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
      return {
        httpStatus: response.status,
        code: (p.code ?? null) as string | number | null,
        msg: String(p.msg ?? text).slice(0, 500),
        data: null,
        durationMs: Date.now() - started,
        frames: [],
        limitedRead: true,
        request: { method: 'GET', url: new URL(path, location.origin).toString(), headers: { Accept: 'text/event-stream' } },
      };
    }
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const frames: string[] = [];
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) if (block && !block.startsWith(':')) frames.push(block);
    }
    if (buffer.trim() && !buffer.trim().startsWith(':')) frames.push(buffer.trim());
    return {
      httpStatus: response.status,
      code: null,
      msg: '有界 SSE 读取结束',
      data: { frameCount: frames.length },
      durationMs: Date.now() - started,
      frames,
      limitedRead: true,
      request: { method: 'GET', url: new URL(path, location.origin).toString(), headers: { Accept: 'text/event-stream' } },
    };
  } catch (error) {
    return {
      httpStatus: 0,
      code: 'STREAM_ABORTED',
      msg: error instanceof Error ? error.message : '流读取中断',
      data: null,
      durationMs: Date.now() - started,
      frames: [],
      limitedRead: true,
      request: { method: 'GET', url: new URL(path, location.origin).toString(), headers: { Accept: 'text/event-stream' } },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function messageStream(input: {
  data: { sessionId: string; messageId: string; query?: Query; lastEventId?: string; limitMs?: number };
}) {
  const { sessionId, messageId, lastEventId, limitMs } = input.data;
  return boundedStream(`/api/sessions/${id(sessionId)}/events/${id(messageId)}`, lastEventId, limitMs ?? 5000);
}

export async function sessionStreamProbe(input: { data: { sessionId: string; limitMs?: number } }) {
  return boundedStream(`/api/sessions/${id(input.data.sessionId)}/events`, undefined, input.data.limitMs ?? 5000);
}

// 持久 SSE：浏览器原生 EventSource，浏览器→Node→豆包 全程长连接。
// 浏览器断线重连时自动带 Last-Event-ID；服务端在浏览器断开时 abort 上游。
export function openMessageStream(
  sessionId: string,
  messageId: string,
  handlers: {
    onFrame: (frame: { event: string; data: string; id?: string; lastEventId: string }) => void;
    onOpen?: () => void;
    onError?: (error: Event) => void;
  },
): EventSource {
  const source = new EventSource(`/api/sessions/${id(sessionId)}/events/${id(messageId)}`);
  const frameTypes = [
    'message.created', 'message.in_progress', 'message.completed', 'message.failed', 'message.cancelled',
    'session.in_progress', 'session.idle', 'session.failed',
    'text', 'text.start', 'text.delta',
    'reasoning', 'reasoning.start', 'reasoning.delta',
    'artifact', 'tool_use', 'tool_result',
    'subagent.created', 'subagent.closed', 'error',
  ];
  for (const type of frameTypes) {
    source.addEventListener(type, ((event: MessageEvent) => {
      // 'error' 同时是 EventSource 的连接错误事件（无 data），只把服务端真实下发的 error 帧当作帧处理。
      if (typeof event.data !== 'string') return;
      handlers.onFrame({ event: type, data: event.data, id: event.lastEventId || undefined, lastEventId: event.lastEventId });
    }) as EventListener);
  }
  // 无 event 字段的帧走默认 message
  source.onmessage = (event) => {
    handlers.onFrame({ event: 'message', data: event.data, id: event.lastEventId || undefined, lastEventId: event.lastEventId });
  };
  source.onopen = () => handlers.onOpen?.();
  source.onerror = (error) => handlers.onError?.(error);
  return source;
}

export async function filesUpload(input: {
  data: { uuid: string; filename: string; contentType: string; base64: string };
}) {
  const { uuid, filename, contentType, base64 } = input.data;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.set('uuid', uuid);
  form.set('filename', filename);
  form.set('file', new Blob([bytes], { type: contentType }), filename);
  const started = Date.now();
  const request = { method: 'POST', url: new URL('/api/files', location.origin).toString(), headers: {} as Record<string, string> };
  try {
    const response = await fetch('/api/files', { method: 'POST', body: form });
    return await readProxy(response, request, started);
  } catch (error) {
    return { httpStatus: 0, code: 'NETWORK_ERROR', msg: `上传未送达本机服务：${error instanceof Error ? error.message : String(error)}`, data: null, durationMs: Date.now() - started, request } as ProxyResult;
  }
}

// 兼容 SessionsPage 使用的 invokeDoubao 操作分发。
type InvokeInput = {
  data: {
    operation: string;
    sessionId?: string;
    messageId?: string;
    query?: Query;
    body?: unknown;
    lastEventId?: string;
  };
};

export async function invokeDoubao(input: InvokeInput): Promise<ProxyResult> {
  const d = input.data;
  const sid = d.sessionId ? id(d.sessionId) : '';
  const mid = d.messageId ? id(d.messageId) : '';
  switch (d.operation) {
    case 'sessions.create':
      return call('POST', '/api/sessions', d.body);
    case 'sessions.retrieve':
      return call('GET', `/api/sessions/${sid}`);
    case 'sessions.update':
      return call('PATCH', `/api/sessions/${sid}`, d.body);
    case 'sessions.delete':
      return call('DELETE', `/api/sessions/${sid}`);
    case 'sessions.list':
      return call('GET', withQuery('/api/sessions', d.query));
    case 'events.create':
      return call('POST', `/api/sessions/${sid}/events`, d.body);
    case 'events.stream':
      return boundedStream(`/api/sessions/${sid}/events`, d.lastEventId, 5000);
    case 'message.stream':
      return boundedStream(`/api/sessions/${sid}/events/${mid}`, d.lastEventId, 5000);
    case 'messages.list':
      return call('GET', withQuery(`/api/sessions/${sid}/messages`, d.query));
    case 'messages.retrieve':
      return call('GET', `/api/sessions/${sid}/messages/${mid}`);
    default:
      return { httpStatus: 0, code: 'UNKNOWN_OPERATION', msg: `未知操作 ${d.operation}`, data: null, durationMs: 0, request: { method: '', url: '', headers: {} } };
  }
}
