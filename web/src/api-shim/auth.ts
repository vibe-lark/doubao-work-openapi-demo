// @api/auth shim：独立 Node 版前端走同源 fetch，由 server/server.js 承接。
// 函数签名与托管版 @api/auth 保持一致（入参 { data: ... }），组件无需改动。
// 非 2xx 或非 JSON 响应统一抛出可读 Error（服务端错误体为 { ok:false, error:{ kind, message } }）。

async function jsonFetch(url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) },
    });
  } catch (error) {
    throw new Error(`无法连接本机服务：${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  let payload: Record<string, any> | null = null;
  try { payload = JSON.parse(text); } catch { /* 非 JSON */ }
  if (!payload || typeof payload !== 'object') throw new Error(`服务返回非 JSON 响应（HTTP ${response.status}）`);
  if (!response.ok) {
    const message = payload.error?.message || payload.msg || `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return payload;
}

export async function connectionStatus() {
  return jsonFetch('/api/auth/status');
}

export async function startAuthorization() {
  return jsonFetch('/api/auth/start', { method: 'POST' });
}

export async function exchangeCode(input: { data: { codeOrUrl: string } }) {
  return jsonFetch('/api/auth/manual-code', {
    method: 'POST',
    body: JSON.stringify(input.data),
  });
}

export async function disconnect() {
  return jsonFetch('/api/auth/disconnect', { method: 'POST' });
}

export async function setEnvironment(input: { data: { environment: 'ppe' | 'online' } }) {
  return jsonFetch('/api/environment', {
    method: 'POST',
    body: JSON.stringify(input.data),
  });
}
