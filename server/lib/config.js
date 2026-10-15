// 环境配置：所有密钥只来自环境变量；缺配置时不崩溃，页面给出引导。
//
//   OAUTH_CLIENT_ID     飞书自建应用 App ID（cli_ 开头）
//   OAUTH_CLIENT_SECRET App Secret（仅服务端持有，绝不入库、绝不下发浏览器）
//   REDIRECT_URI        固定兜底 OAuth 回调；正常情况下按当前请求 Host 动态生成
//   PUBLIC_BASE_URL     当前访问地址不可用时的公开地址，例如 http://10.37.209.144:4110
//   PORT                本地端口，默认 4110
//   HOST                绑定地址，默认 127.0.0.1（仅本机）；需要局域网访问可显式设 0.0.0.0
//   ENV                 ppe（默认）| online
//
// Node 18+ 零运行时依赖：只用全局 http / fetch / FormData / Blob / Request.formData。

export const DEFAULT_PORT = 4110;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_REDIRECT_URI = `http://127.0.0.1:${process.env.PORT || DEFAULT_PORT}/api/auth/feishu/callback`;
export const OAUTH_CALLBACK_PATH = '/api/auth/feishu/callback';

function firstHeader(value) {
  return String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isLoopbackHost(host) {
  const hostname = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : host.split(':')[0];
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

export const config = {
  port: Number(process.env.PORT || DEFAULT_PORT),
  host: process.env.HOST || DEFAULT_HOST,
  env: process.env.ENV === 'online' ? 'online' : 'ppe',
  oauth: {
    clientId: (process.env.OAUTH_CLIENT_ID || '').trim(),
    clientSecret: (process.env.OAUTH_CLIENT_SECRET || '').trim(),
    redirectUri: (process.env.REDIRECT_URI || DEFAULT_REDIRECT_URI).trim(),
    publicBaseUrl: normalizeBaseUrl(process.env.PUBLIC_BASE_URL),
  },
};

export function oauthConfigured() {
  return Boolean(config.oauth.clientId && config.oauth.clientSecret && config.oauth.redirectUri);
}

// 优先使用代理头或浏览器当前访问的 Host；只有 Host 缺失/为环回地址时才使用公开兜底地址。
export function redirectUriForRequest(req) {
  const forwardedHost = firstHeader(req.headers['x-forwarded-host']);
  const requestHost = forwardedHost || firstHeader(req.headers.host);
  const publicBaseUrl = config.oauth.publicBaseUrl;
  if (!requestHost || isLoopbackHost(requestHost)) {
    if (publicBaseUrl) return `${publicBaseUrl}${OAUTH_CALLBACK_PATH}`;
  }
  if (!requestHost) return config.oauth.redirectUri;
  const forwardedProto = firstHeader(req.headers['x-forwarded-proto']);
  const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  return `${protocol}://${requestHost}${OAUTH_CALLBACK_PATH}`;
}

// 上游域名：PPE 走 open.feishu.cn 并带 PPE 头；线上走 open.doubao.com。
export const UPSTREAM = {
  ppe: 'https://open.feishu.cn/open-apis/agent',
  online: 'https://open.doubao.com/open-apis/agent',
};

// OAuth v3：授权页端点路径仍为 authen/v1/authorize，但必须显式带 doubao:* scope；
// 换 token 走 v3 端点（旧版 authen/v1/access_token 且授权无 scope 的 token 会被豆包 API 拒绝，
// 见 docs/ISSUES.md ISSUE-003）。
export const OAUTH = {
  authorizeUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
  tokenUrl: 'https://accounts.feishu.cn/oauth/v3/token',
  scopes: [
    'doubao:session.event:write',
    'doubao:session.message:read',
    'doubao:session:write',
    'doubao:session:read',
    'doubao:session.event:read',
    'doubao:file:write',
    // offline_access：飞书只有授权时带上该 scope 才会下发 refresh_token；缺少时 token 约 2 小时后失效且无法自动续期。
    // 需应用后台已开通对应权限，否则授权页会报 scope 错误，因此按 OAUTH_OFFLINE_ACCESS=1 显式开启。
    ...(process.env.OAUTH_OFFLINE_ACCESS === '1' ? ['offline_access'] : []),
  ],
};

export const PPE_HEADERS = { 'X-Tt-Env': 'ppe_doubao_oapi', 'X-Use-Ppe': '1' };
