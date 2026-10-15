// OAuth v3 授权码流程：构造授权 URL、code 换 token。
// 令牌端点与真机验证一致：POST https://accounts.feishu.cn/oauth/v3/token，PPE 环境带两个 PPE 头。
import { OAUTH, PPE_HEADERS, config } from './config.js';
import { saveToken } from './store.js';

export function buildAuthorizeUrl(state, redirectUri = config.oauth.redirectUri) {
  const query = new URLSearchParams({
    client_id: config.oauth.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: OAUTH.scopes.join(' '),
  });
  return `${OAUTH.authorizeUrl}?${query.toString()}`;
}

// 从「裸 code」或「完整回调 URL」中提取 code（以及可能附带的 state）。
export function extractCode(codeOrUrl) {
  const input = String(codeOrUrl || '').trim();
  if (!input) return { code: '' };
  if (input.startsWith('http://') || input.startsWith('https://')) {
    try {
      const u = new URL(input);
      return {
        code: u.searchParams.get('code') || '',
        state: u.searchParams.get('state') || undefined,
      };
    } catch {
      return { code: '' };
    }
  }
  // 容忍 "code=xxx&state=yyy" 这种粘贴片段。
  if (input.includes('code=')) {
    try {
      const params = new URLSearchParams(input.includes('?') ? input.slice(input.indexOf('?') + 1) : input);
      return { code: params.get('code') || '', state: params.get('state') || undefined };
    } catch { /* 落到裸 code */ }
  }
  return { code: input };
}

export class TokenExchangeError extends Error {
  constructor(kind, message, httpStatus = 0) {
    super(message);
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

function classifyFailure(status, payload, fallback) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const text = String(p.error_description || p.msg || p.error || (typeof payload === 'string' ? payload : '') || fallback);
  const lower = text.toLowerCase();
  if (lower.includes('used') || lower.includes('invalid_grant') || lower.includes('code')) {
    return new TokenExchangeError('CODE_USED_OR_INVALID', text, status);
  }
  if (lower.includes('redirect') || lower.includes('uri')) {
    return new TokenExchangeError('CALLBACK_MISMATCH', text, status);
  }
  return new TokenExchangeError('TOKEN_EXCHANGE_FAILED', text, status);
}

// 用授权码换 token。environment 决定是否给令牌端点加 PPE 头。
export async function exchangeCodeForToken(code, environment, redirectUri = config.oauth.redirectUri) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(OAUTH.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(environment === 'ppe' ? PPE_HEADERS : {}) },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.oauth.clientId,
        client_secret: config.oauth.clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new TokenExchangeError('TOKEN_EXCHANGE_FAILED', error instanceof Error ? error.message : '令牌服务不可达', 0);
  }
  const text = await response.text();
  let payload = text;
  try { payload = JSON.parse(text); } catch { /* 非 JSON 走错误分类 */ }
  if (!response.ok) throw classifyFailure(response.status, payload, `令牌换取失败 HTTP ${response.status}`);
  if (!payload || typeof payload !== 'object' || !payload.access_token) {
    throw classifyFailure(response.status, payload, '响应中没有 access_token');
  }
  const token = saveToken(payload);
  return {
    connected: true,
    expiresAt: token.expiresAt,
    scope: token.scope ?? null,
    durationMs: Date.now() - started,
  };
}
