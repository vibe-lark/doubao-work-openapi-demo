// 脱敏 / curl 生成 / 统一响应工具。Authorization 在任何对外结构里恒定打码。
import { PPE_HEADERS } from './config.js';

const SECRET_KEY = /authorization|cookie|set-cookie|token|secret|code/i;

export function maskHeaderValue(name, value, environment) {
  if (/authorization/i.test(name)) return 'Bearer ••••••••';
  if (/cookie|set-cookie/i.test(name)) return '••••••••';
  return value;
}

// 代理请求实际发送的头（给排查看的脱敏版本）。
export function maskedHeaders(environment, hasToken, extra = {}) {
  const headers = {
    ...(hasToken ? { Authorization: 'Bearer ••••••••' } : {}),
    ...(environment === 'ppe' ? { ...PPE_HEADERS } : {}),
    ...extra,
  };
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, maskHeaderValue(k, v, environment)]));
}

export function deepMask(value) {
  if (Array.isArray(value)) return value.map(deepMask);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [
      k,
      SECRET_KEY.test(k) ? '••••••••（已脱敏）' : deepMask(v),
    ]));
  }
  return value;
}

export function buildCurl({ method, url, headers, hasBody, jsonBody }) {
  const headerParts = Object.entries(headers)
    .map(([k, v]) => `  -H '${k}: ${maskHeaderValue(k, v)}'`)
    .join(' \\\n');
  let bodyPart = '';
  if (hasBody === 'json') {
    bodyPart = ` \\\n  --data '${JSON.stringify(deepMask(jsonBody)).replaceAll("'", "'\\''")}'`;
  } else if (hasBody === 'multipart') {
    bodyPart = ` \\\n  -F 'uuid=<uuid>' -F 'file=@<本地文件>'`;
  }
  return `curl -X ${method} '${url}'${headerParts ? ` \\\n${headerParts}` : ''}${bodyPart}`;
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function randomState() {
  // Node 18 没有全局 crypto.randomUUID 的兜底（实际 18.x 也有 webcrypto），双重保险。
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
