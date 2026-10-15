import type { Environment, ProxyResult } from '@shared/schema';
import { getEnvironment, getOAuthPrivate, getToken, maskedHeaders, saveToken, tokenFromPayload, type AgLike } from './_doubao';

const TOKEN_URL = 'https://accounts.feishu.cn/oauth/v3/token';

function extract(payload: unknown) {
  if (!payload || typeof payload !== 'object') return { code: null, msg: '', data: payload };
  const p = payload as Record<string, unknown>;
  return { code: (p.code as string | number | undefined) ?? null, msg: String(p.msg ?? p.message ?? ''), data: p.data ?? payload };
}
function requestView(method: string, url: string, headers: Record<string,string>, body?: unknown) {
  return { method, url, headers, ...(body === undefined ? {} : { body: body instanceof FormData ? { multipart: true } : body }) };
}
export function baseUrl(environment: Environment) { return environment === 'ppe' ? 'https://open.feishu.cn/open-apis/agent' : 'https://open.doubao.com/open-apis/agent'; }

async function accessToken(ag: AgLike): Promise<string | null> {
  let token = await getToken(ag);
  if (!token) return null;
  if (token.expiresAt > Date.now() + 120_000) return token.accessToken;
  if (!token.refreshToken) return null;
  const oauth = await getOAuthPrivate(ag);
  const response = await fetch(TOKEN_URL, {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', 'x-tt-env': 'ppe_doubao_oapi', 'x-use-ppe': '1' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: token.refreshToken, client_id: oauth.clientId, client_secret: oauth.clientSecret }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) return null;
  token = tokenFromPayload(payload);
  await saveToken(ag, token);
  return token.accessToken;
}

export async function proxyRequest(ag: AgLike, method: string, path: string, body?: unknown, query?: Record<string,string|number|boolean>, extraHeaders?: Record<string,string>): Promise<ProxyResult> {
  const environment = await getEnvironment(ag);
  const token = await accessToken(ag);
  const url = new URL(`${baseUrl(environment)}${path}`);
  Object.entries(query || {}).forEach(([key,value]) => url.searchParams.set(key, String(value)));
  const shownHeaders = { ...maskedHeaders(environment, !!token), ...extraHeaders };
  if (!token) return { httpStatus: 0, code: 'NOT_CONNECTED', msg: '尚未完成 OAuth 授权', data: null, durationMs: 0, request: requestView(method, url.toString(), shownHeaders, body) };
  const headers: Record<string,string> = { Authorization: `Bearer ${token}`, ...(environment === 'ppe' ? { 'X-Tt-Env': 'ppe_doubao_oapi', 'X-Use-Ppe': '1' } : {}), ...extraHeaders };
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const start = Date.now();
  try {
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(8500) });
    const text = await response.text();
    let payload: unknown = text;
    if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
    const parsed = extract(payload);
    return { httpStatus: response.status, ...parsed, durationMs: Date.now() - start, request: requestView(method, url.toString(), shownHeaders, body) };
  } catch (error) {
    return { httpStatus: 0, code: 'NETWORK_ERROR', msg: error instanceof Error ? error.message : '网络请求失败', data: null, durationMs: Date.now() - start, request: requestView(method, url.toString(), shownHeaders, body) };
  }
}

export async function streamRequest(ag: AgLike, path: string, query: Record<string,string|number|boolean> | undefined, lastEventId: string | undefined, limitMs: number): Promise<ProxyResult> {
  const environment = await getEnvironment(ag);
  const token = await accessToken(ag);
  const url = new URL(`${baseUrl(environment)}${path}`);
  Object.entries(query || {}).forEach(([key,value]) => url.searchParams.set(key, String(value)));
  const shownHeaders = { ...maskedHeaders(environment, !!token), Accept: 'text/event-stream', ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) };
  if (!token) return { httpStatus: 0, code: 'NOT_CONNECTED', msg: '尚未完成 OAuth 授权', data: null, durationMs: 0, request: requestView('GET', url.toString(), shownHeaders), limitedRead: true, frames: [] };
  const headers: Record<string,string> = { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', ...(environment === 'ppe' ? { 'X-Tt-Env':'ppe_doubao_oapi','X-Use-Ppe':'1' } : {}), ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) };
  const start = Date.now(); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), limitMs);
  let httpStatus = 0; const frames: string[] = []; let buffer = '';
  try {
    const response = await fetch(url, { headers, signal: controller.signal }); httpStatus = response.status;
    if (!response.body) { buffer = await response.text(); }
    else {
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      while (true) { const part = await reader.read(); if (part.done) break; buffer += decoder.decode(part.value, { stream: true }); const chunks = buffer.split(/\r?\n\r?\n/); buffer = chunks.pop() || ''; frames.push(...chunks.filter(Boolean)); }
    }
  } catch (error) { if (!(error instanceof Error) || error.name !== 'AbortError') buffer += `\n[read-error] ${error instanceof Error ? error.message : 'unknown'}`; }
  finally { clearTimeout(timer); }
  if (buffer.trim()) frames.push(buffer.trim());
  return { httpStatus, code: null, msg: '托管形态限时读取已结束', data: { frameCount: frames.length }, frames, limitedRead: true, durationMs: Date.now() - start, request: requestView('GET', url.toString(), shownHeaders) };
}
