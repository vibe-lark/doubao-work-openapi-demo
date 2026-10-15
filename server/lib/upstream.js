// 豆包工作 Open API 上游代理核心：
//   · access token 自动刷新（到期前 2 分钟）
//   · 统一注入 Bearer + PPE 头
//   · 统一返回 method/url/脱敏 headers/body/curl/响应/HTTP 状态/耗时
import { OAUTH, PPE_HEADERS, UPSTREAM, config, oauthConfigured } from './config.js';
import { loadToken, saveToken } from './store.js';
import { buildCurl, maskedHeaders } from './mask.js';

export class NotConfiguredError extends Error {
  constructor() { super('OAUTH_NOT_CONFIGURED'); this.code = 'OAUTH_NOT_CONFIGURED'; }
}
export class NotConnectedError extends Error {
  constructor() { super('NOT_CONNECTED'); this.code = 'NOT_CONNECTED'; }
}

function tokenPostHeaders(environment) {
  // 令牌服务固定走飞书账号服务；PPE 联调需要带 PPE 头（与真机验证一致）。
  return { 'Content-Type': 'application/json', ...(environment === 'ppe' ? PPE_HEADERS : {}) };
}

// 用 refresh_token 换新 token；失败返回 null，调用方按未登录处理。
export async function refreshAccessToken(environment) {
  const token = loadToken();
  if (!token?.refreshToken) return null;
  if (!oauthConfigured()) throw new NotConfiguredError();
  let response;
  try {
    response = await fetch(OAUTH.tokenUrl, {
      method: 'POST',
      headers: tokenPostHeaders(environment),
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: config.oauth.clientId,
        client_secret: config.oauth.clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : '刷新令牌网络错误' };
  }
  const text = await response.text();
  let payload = text;
  try { payload = JSON.parse(text); } catch { /* 保留原文 */ }
  if (!response.ok || !payload || typeof payload !== 'object' || !payload.access_token) {
    return { error: `刷新失败 HTTP ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}` };
  }
  return { token: saveToken(payload) };
}

// 取可用 access token；返回 null 表示尚未登录。
export async function getValidAccessToken(environment) {
  const token = loadToken();
  if (!token) return null;
  if (token.expiresAt > Date.now() + 120_000) return token.accessToken;
  const refreshed = await refreshAccessToken(environment);
  if (refreshed?.token) return refreshed.token.accessToken;
  // 刷新失败时保留旧 token（可能仍有少量宽限期）；业务侧会收到真实网关错误，不再静默。
  return token.accessToken;
}

function extract(payload) {
  if (!payload || typeof payload !== 'object') return { code: null, msg: '', data: payload };
  const p = payload;
  return { code: p.code ?? null, msg: String(p.msg ?? p.message ?? ''), data: 'data' in p ? p.data : payload };
}

function upstreamHeaders(environment, token, extra, isJson) {
  return {
    Authorization: `Bearer ${token}`,
    ...(environment === 'ppe' ? PPE_HEADERS : {}),
    ...(isJson ? { 'Content-Type': 'application/json' } : {}),
    ...extra,
  };
}

// 通用 JSON 代理。body 为对象（JSON.stringify）或 undefined（无请求体）。
export async function proxyJson({ environment, method, path, query, body, timeoutMs = 30_000, extraHeaders = {} }) {
  const url = new URL(`${UPSTREAM[environment]}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const urlString = url.toString();
  const hasJsonBody = body !== undefined;
  const token = await getValidAccessToken(environment);
  const shownRequest = {
    method,
    url: urlString,
    headers: maskedHeaders(environment, Boolean(token), extraHeaders),
    ...(hasJsonBody ? { body } : {}),
    curl: '',
  };
  if (!token) {
    shownRequest.curl = buildCurl({ method, url: urlString, headers: maskedHeaders(environment, true, extraHeaders), hasBody: hasJsonBody ? 'json' : undefined, jsonBody: body });
    return { httpStatus: 0, code: 'NOT_CONNECTED', msg: '尚未完成 OAuth 授权', data: null, durationMs: 0, request: shownRequest };
  }
  const headers = upstreamHeaders(environment, token, extraHeaders, hasJsonBody);
  shownRequest.curl = buildCurl({ method, url: urlString, headers, hasBody: hasJsonBody ? 'json' : undefined, jsonBody: body });
  const start = Date.now();
  try {
    const response = await fetch(urlString, {
      method,
      headers,
      body: hasJsonBody ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload = text;
    if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
    return { httpStatus: response.status, ...extract(payload), durationMs: Date.now() - start, request: shownRequest };
  } catch (error) {
    return {
      httpStatus: 0,
      code: 'NETWORK_ERROR',
      msg: error instanceof Error ? error.message : '网络请求失败',
      data: null,
      durationMs: Date.now() - start,
      request: shownRequest,
    };
  }
}

// multipart/form-data 文件上传代理：接收 Node Request 解析出的 FormData，原样重建后透传。
export async function proxyMultipart({ environment, form, timeoutMs = 300_000 }) {
  const urlString = `${UPSTREAM[environment]}/v1/files`;
  const token = await getValidAccessToken(environment);
  const shownRequest = {
    method: 'POST',
    url: urlString,
    headers: maskedHeaders(environment, Boolean(token), { 'Content-Type': 'multipart/form-data' }),
    body: { multipart: true, uuid: form.get('uuid') || '', filename: form.get('filename') || '' },
    curl: '',
  };
  if (!token) {
    shownRequest.curl = buildCurl({ method: 'POST', url: urlString, headers: maskedHeaders(environment, true), hasBody: 'multipart' });
    return { httpStatus: 0, code: 'NOT_CONNECTED', msg: '尚未完成 OAuth 授权', data: null, durationMs: 0, request: shownRequest };
  }
  // 重建上游 FormData（undici 会自动生成 boundary）。
  const upstream = new FormData();
  const uuid = form.get('uuid');
  if (uuid) upstream.set('uuid', String(uuid));
  const filenameOverride = form.get('filename');
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return { httpStatus: 0, code: 'INPUT_MISSING', msg: '缺少 file 字段', data: null, durationMs: 0, request: shownRequest };
  }
  const name = filenameOverride ? String(filenameOverride) : (file.name || 'upload.bin');
  upstream.set('file', new Blob([file], { type: file.type || 'application/octet-stream' }), name);
  if (filenameOverride) upstream.set('filename', String(filenameOverride));
  const headers = { Authorization: `Bearer ${token}`, ...(environment === 'ppe' ? PPE_HEADERS : {}) };
  shownRequest.curl = buildCurl({ method: 'POST', url: urlString, headers, hasBody: 'multipart' });
  const start = Date.now();
  try {
    const response = await fetch(urlString, { method: 'POST', headers, body: upstream, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let payload = text;
    if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
    return { httpStatus: response.status, ...extract(payload), durationMs: Date.now() - start, request: shownRequest };
  } catch (error) {
    return {
      httpStatus: 0,
      code: 'NETWORK_ERROR',
      msg: error instanceof Error ? error.message : '网络请求失败',
      data: null,
      durationMs: Date.now() - start,
      request: shownRequest,
    };
  }
}

// 构造上游 SSE 请求参数（实际管道在 sse.js 中建立，以便随浏览器断连 abort）。
export function buildUpstreamStream({ environment, path, lastEventId, token }) {
  const url = new URL(`${UPSTREAM[environment]}${path}`);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'text/event-stream',
    ...(environment === 'ppe' ? PPE_HEADERS : {}),
    ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
  };
  return { url: url.toString(), headers };
}
