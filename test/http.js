// 直连豆包网关的测试客户端（绕过本工程 server，保证测试的是上游真实行为）。
// 零依赖：全局 fetch / FormData / Blob / AbortController。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..');

export const UPSTREAM = {
  ppe: 'https://open.feishu.cn/open-apis/agent',
  online: 'https://open.doubao.com/open-apis/agent',
};
export const PPE_HEADERS = { 'X-Tt-Env': 'ppe_doubao_oapi', 'X-Use-Ppe': '1' };

export function loadRuntimeConfig() {
  let env = (process.env.DOUBBAO_ENV || '').trim();
  if (env !== 'ppe' && env !== 'online') {
    try {
      const saved = readFileSync(join(REPO_ROOT, '.tokens', 'environment'), 'utf8').trim();
      if (saved === 'online' || saved === 'ppe') env = saved;
    } catch { /* 默认 ppe */ }
  }
  env = env || 'ppe';

  let token = (process.env.DOUBBAO_USER_TOKEN || '').trim();
  if (!token) {
    const file = process.env.DOUBBAO_TOKEN_FILE || join(REPO_ROOT, '.tokens', 'token.json');
    if (existsSync(file)) {
      try {
        const record = JSON.parse(readFileSync(file, 'utf8'));
        if (record?.access_token) token = String(record.access_token);
      } catch { /* 损坏的 token 文件按无 token 处理 */ }
    }
  }
  return { env, token: token || '', baseUrl: UPSTREAM[env] };
}

function maskHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [
    k,
    /authorization/i.test(k) ? 'Bearer ••••••••' : v,
  ]));
}

function buildUrl(baseUrl, path, query) {
  const url = new URL(`${baseUrl}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url;
}

// 通用 JSON 请求。authOverride：undefined=用配置 token；null=不带 Authorization；字符串=原样带（伪造 token 测试）。
export async function call(method, path, opts = {}) {
  const { env, token, baseUrl } = opts.runtime || loadRuntimeConfig();
  const url = buildUrl(baseUrl, path, opts.query);
  const headers = {
    ...(env === 'ppe' ? PPE_HEADERS : {}),
    ...(opts.extraHeaders || {}),
  };
  let authHeader = null;
  if (opts.authOverride === undefined) {
    if (token) authHeader = `Bearer ${token}`;
  } else if (opts.authOverride !== null) {
    authHeader = opts.authOverride;
  }
  if (authHeader) headers.Authorization = authHeader;
  const hasBody = opts.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';

  const request = {
    method,
    url: url.toString(),
    headers: maskHeaders(headers),
    ...(hasBody ? { body: opts.body } : {}),
  };
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs || 30_000),
    });
    const text = await response.text();
    let payload = null;
    if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }
    const code = payload && typeof payload === 'object' && 'code' in payload ? payload.code : null;
    const msg = payload && typeof payload === 'object' ? String(payload.msg ?? payload.message ?? '') : (text ? text.slice(0, 300) : '');
    return {
      ok: response.ok,
      httpStatus: response.status,
      code,
      msg,
      data: payload && typeof payload === 'object' && 'data' in payload ? payload.data : (payload ?? text),
      raw: payload,
      rawText: text,
      durationMs: Date.now() - started,
      request,
    };
  } catch (error) {
    return {
      ok: false, httpStatus: 0, code: 'NETWORK_ERROR',
      msg: error instanceof Error ? error.message : '网络错误',
      data: null, raw: null, rawText: '', durationMs: Date.now() - started, request,
    };
  }
}

// multipart 文件上传。
export async function uploadFile(opts) {
  const { runtime, uuid, filename, bytes, contentType, contentOverride = true, authOverride } = opts;
  const { env, token, baseUrl } = runtime;
  const url = new URL(`${baseUrl}/v1/files`);
  const form = new FormData();
  form.set('uuid', uuid);
  form.set('file', new Blob([bytes], { type: contentType || 'application/octet-stream' }), filename);
  const headers = { ...(env === 'ppe' ? PPE_HEADERS : {}) };
  let auth = null;
  if (authOverride === undefined) auth = token ? `Bearer ${token}` : null;
  else if (authOverride !== null) auth = authOverride;
  if (auth) headers.Authorization = auth;
  const request = {
    method: 'POST', url: url.toString(),
    headers: maskHeaders({ ...headers, 'Content-Type': 'multipart/form-data' }),
    body: { multipart: true, uuid, filename, size: bytes.length },
  };
  const started = Date.now();
  try {
    const response = await fetch(url, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(opts.timeoutMs || 120_000) });
    const text = await response.text();
    let payload = null;
    if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }
    const code = payload && typeof payload === 'object' && 'code' in payload ? payload.code : null;
    const msg = payload && typeof payload === 'object' ? String(payload.msg ?? '') : text.slice(0, 300);
    return {
      ok: response.ok, httpStatus: response.status, code, msg,
      data: payload && typeof payload === 'object' && 'data' in payload ? payload.data : null,
      raw: payload, durationMs: Date.now() - started, request,
    };
  } catch (error) {
    return {
      ok: false, httpStatus: 0, code: 'NETWORK_ERROR',
      msg: error instanceof Error ? error.message : '网络错误', data: null, raw: null,
      durationMs: Date.now() - started, request,
    };
  }
}

// 解析 SSE 帧块。
export function parseFrameBlock(block) {
  let event = 'message';
  const dataLines = [];
  let id;
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    else if (line.startsWith('id:')) id = line.slice(3).trim();
  }
  const data = dataLines.join('\n');
  let parsed = null;
  try { parsed = JSON.parse(data); } catch { /* 保留原文 */ }
  return { event, id, data, parsed };
}

// 有界收集 SSE：直到 shouldStop(frame, frames) 返回真、空闲超时或总超时。
export async function collectStream(path, opts = {}) {
  const runtime = opts.runtime || loadRuntimeConfig();
  const { env, token, baseUrl } = runtime;
  const url = new URL(`${baseUrl}${path}`);
  const headers = {
    Accept: 'text/event-stream',
    ...(env === 'ppe' ? PPE_HEADERS : {}),
    ...(opts.lastEventId ? { 'Last-Event-ID': opts.lastEventId } : {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), opts.maxMs || 120_000);
  const started = Date.now();
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/event-stream')) {
      const text = await response.text();
      clearTimeout(totalTimer);
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* 非 json */ }
      return {
        ok: false, connected: false, httpStatus: response.status,
        code: payload?.code ?? null, msg: payload?.msg ?? text.slice(0, 300),
        frames: [], durationMs: Date.now() - started,
        request: { method: 'GET', url: url.toString(), headers: maskHeaders(headers) },
      };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const frames = [];
    let reason = '';
    for (;;) {
      let part;
      try {
        part = await reader.read();
      } catch (abortError) {
        reason = abortError?.name === 'AbortError' ? 'timeout' : 'read-error';
        break;
      }
      if (part.done) { reason = 'server-closed'; break; }
      buffer += decoder.decode(part.value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        if (!block.trim() || block.startsWith(':')) continue;
        const frame = parseFrameBlock(block);
        frames.push(frame);
        if (opts.onFrame) opts.onFrame(frame);
        if (opts.shouldStop && opts.shouldStop(frame, frames)) {
          reason = 'terminal-frame';
          controller.abort();
          break;
        }
      }
      if (reason) break;
    }
    clearTimeout(totalTimer);
    try { controller.abort(); } catch { /* ignore */ }
    return {
      ok: true, connected: true, httpStatus: response.status, code: null, msg: '',
      frames, stopReason: reason, durationMs: Date.now() - started,
      request: { method: 'GET', url: url.toString(), headers: maskHeaders(headers) },
    };
  } catch (error) {
    clearTimeout(totalTimer);
    return {
      ok: false, connected: false, httpStatus: 0,
      code: error?.name === 'AbortError' ? 'STREAM_TIMEOUT' : 'NETWORK_ERROR',
      msg: error instanceof Error ? error.message : '流读取失败',
      frames: [], durationMs: Date.now() - started,
      request: { method: 'GET', url: url.toString(), headers: maskHeaders(headers) },
    };
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 轮询直到 session.status === idle（或 failed），返回最后一次 retrieve。
export async function waitForIdle(sessionId, runtime, opts = {}) {
  const deadline = Date.now() + (opts.maxMs || 180_000);
  const interval = opts.intervalMs || 2000;
  let last;
  while (Date.now() < deadline) {
    last = await call('GET', `/v1/sessions/${encodeURIComponent(sessionId)}`, { runtime });
    const status = last.data?.session?.status;
    if (status === 'idle' || status === 'failed') return { status, evidence: last, timedOut: false };
    await sleep(interval);
  }
  return { status: last?.data?.session?.status || 'unknown', evidence: last, timedOut: true };
}

// 轮询单条消息到终态。
export async function waitForMessageTerminal(sessionId, messageId, runtime, opts = {}) {
  const deadline = Date.now() + (opts.maxMs || 180_000);
  const interval = opts.intervalMs || 1500;
  let last;
  while (Date.now() < deadline) {
    last = await call('GET', `/v1/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`, { runtime });
    const status = last.data?.status;
    if (['completed', 'failed', 'cancelled'].includes(status)) return { status, evidence: last, timedOut: false };
    await sleep(interval);
  }
  return { status: last?.data?.status || 'unknown', evidence: last, timedOut: true };
}
