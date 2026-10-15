// 豆包工作 Open API 能力展示台 · 独立 Node 版后端入口
// 启动：node server/server.js   （Node 18+，零运行时依赖，无需 npm install）
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { config, oauthConfigured, redirectUriForRequest } from './lib/config.js';
import {
  clearToken, createState, getEnvironment, loadToken, setEnvironment, validateAndConsumeState,
} from './lib/store.js';
import { buildAuthorizeUrl, exchangeCodeForToken, extractCode, TokenExchangeError } from './lib/oauth.js';
import { buildUpstreamStream, getValidAccessToken, proxyJson, proxyMultipart } from './lib/upstream.js';
import { parseCookies, randomState, sendJson } from './lib/mask.js';
import { pipeSSE } from './lib/sse.js';
import { runBoundary } from './lib/boundary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DIST_DIR = join(REPO_ROOT, 'web', 'dist');
const STATE_COOKIE = 'doubao_oauth_state';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- 请求体解析 ----------
async function readJsonBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

// 用全局 Request.formData() 解析 multipart（Node 18+ 内置 undici 能力）。
async function readMultipart(req) {
  const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: 'half',
  });
  return request.formData();
}

function notConfiguredPayload() {
  return {
    ok: false,
    error: {
      kind: 'OAUTH_NOT_CONFIGURED',
      message: '尚未配置 OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET / REDIRECT_URI，请复制 .env.example 为 .env 填写后重启（或通过环境变量注入）。',
    },
  };
}

// ---------- 业务代理统一出口 ----------
async function handleProxy(req, res, method, path, query, body) {
  const environment = getEnvironment();
  const result = await proxyJson({ environment, method, path, query, body });
  sendJson(res, 200, result);
}

async function handleSSE(req, res, path, explicitLastEventId) {
  const environment = getEnvironment();
  const token = await getValidAccessToken(environment);
  if (!token) {
    sendJson(res, 401, { httpStatus: 0, code: 'NOT_CONNECTED', msg: '尚未完成 OAuth 授权', data: null });
    return;
  }
  const lastEventId = explicitLastEventId || req.headers['last-event-id'] || undefined;
  const { url, headers } = buildUpstreamStream({ environment, path, lastEventId, token });
  await pipeSSE({ req, res, upstreamUrl: url, upstreamHeaders: headers, label: path.includes('/events/') ? 'message-stream' : 'session-stream' });
}

// ---------- 静态资源 ----------
async function serveStatic(req, res, pathname) {
  if (!existsSync(DIST_DIR)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;max-width:720px">
<h2>web/dist 尚未构建</h2>
<p>仓库通常已附带构建好的 <code>web/dist</code>，可直接使用。若你是从源码启动，请在 <code>web/</code> 下执行 <code>npm install &amp;&amp; npm run build</code>，或直接使用仓库已提交的 dist。</p>
<p>API 健康检查：<a href="/api/health">/api/health</a></p></body>`);
    return;
  }
  let rel = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST_DIR, safePath);
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    // SPA 回退
    try {
      const index = await readFile(join(DIST_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(index);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  }
}

function callbackHtml(ok, detail) {
  const color = ok ? '#0066FF' : '#D92D20';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>OAuth 回调</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#F7F8FA;color:#1A1A1A;display:grid;place-items:center;min-height:100vh;margin:0}
.card{background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:32px;width:min(520px,90vw)}
h1{font-size:20px;margin:0 0 10px;color:${color}}code{background:#F2F4F7;border-radius:4px;padding:2px 6px}</style></head>
<body><div class="card"><h1>${ok ? '✅ 授权成功，令牌已保存' : '❌ 授权失败'}</h1>
<p>${detail}</p>
<p><a href="/" style="color:#0066FF">返回展示台首页</a></p>
${ok ? '<script>setTimeout(()=>{location.href="/"},1500)</script>' : ''}
</div></body></html>`;
}

// ---------- 路由 ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method;
  const segments = pathname.split('/').filter(Boolean); // ['api','sessions', ...]
  try {
    // ---- 系统 ----
    if (method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true, runtime: 'node-http', node: process.version, time: new Date().toISOString(),
        environment: getEnvironment(), oauthConfigured: oauthConfigured(), dist: existsSync(DIST_DIR),
      });
    }
    if (method === 'GET' && pathname === '/api/config') {
      return sendJson(res, 200, {
        oauthConfigured: oauthConfigured(),
        redirectUri: redirectUriForRequest(req),
        environment: getEnvironment(),
        scopesConfigured: true,
      });
    }
    if (method === 'GET' && pathname === '/api/auth/status') {
      // 先按需刷新：到期或即将到期时用 refresh_token 续期；无法续期的过期 token 视为未连接，
      // 避免页面显示「已连接」而所有业务调用都返回 401 99991677。
      let token = loadToken();
      if (token && token.expiresAt <= Date.now() + 120_000 && oauthConfigured()) {
        await getValidAccessToken(getEnvironment()).catch(() => null);
        token = loadToken();
      }
      const expired = Boolean(token && token.expiresAt <= Date.now());
      return sendJson(res, 200, {
        connected: Boolean(token) && !expired,
        expired,
        refreshable: Boolean(token?.refreshToken),
        expiresAt: token?.expiresAt ?? null,
        scope: token?.scope ?? null,
        environment: getEnvironment(),
        account: { name: null, avatar: null },
      });
    }

    // ---- OAuth 发起（两种入口：直接 302 / 前端取 URL）----
    if (method === 'GET' && pathname === '/api/auth/feishu') {
      if (!oauthConfigured()) return sendJson(res, 503, notConfiguredPayload());
      const state = randomState();
      const redirectUri = redirectUriForRequest(req);
      createState(state, { redirectUri });
      res.writeHead(302, {
        Location: buildAuthorizeUrl(state, redirectUri),
        'Set-Cookie': `${STATE_COOKIE}=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`,
        'Cache-Control': 'no-store',
      });
      return res.end();
    }
    if (method === 'POST' && pathname === '/api/auth/start') {
      if (!oauthConfigured()) return sendJson(res, 503, notConfiguredPayload());
      const state = randomState();
      const redirectUri = redirectUriForRequest(req);
      createState(state, { redirectUri });
      res.setHeader('Set-Cookie', `${STATE_COOKIE}=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`);
      return sendJson(res, 200, { url: buildAuthorizeUrl(state, redirectUri), state, redirectUri });
    }

    // ---- OAuth 回调：按授权时记录的当前访问地址真实承接 ----
    if (method === 'GET' && pathname === '/api/auth/feishu/callback') {
      const code = url.searchParams.get('code') || '';
      const state = url.searchParams.get('state') || '';
      const cookies = parseCookies(req);
      let stateRecord;
      try {
        stateRecord = validateAndConsumeState(state, cookies[STATE_COOKIE]);
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(callbackHtml(false, `state 校验失败（${error.message}）。请回到首页重新发起授权；若在云端打开导致回调页打不开，请改用首页的「粘贴 code / 完整 URL」方式。`));
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(callbackHtml(false, '回调中没有 code 参数。'));
      }
      try {
        await exchangeCodeForToken(code, getEnvironment(), stateRecord.redirectUri || redirectUriForRequest(req));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(callbackHtml(true, '正在自动返回首页…'));
      } catch (error) {
        const kind = error instanceof TokenExchangeError ? error.kind : 'TOKEN_EXCHANGE_FAILED';
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(callbackHtml(false, `令牌换取失败（${kind}）：${error instanceof Error ? error.message : '未知错误'}。可回到首页用手动粘贴方式重试。`));
      }
    }

    // ---- 手动粘贴 code / 完整回调 URL ----
    if (method === 'POST' && pathname === '/api/auth/manual-code') {
      if (!oauthConfigured()) return sendJson(res, 503, notConfiguredPayload());
      const body = await readJsonBody(req);
      const extracted = extractCode(body.codeOrUrl);
      if (!extracted.code) {
        return sendJson(res, 200, { ok: false, error: { kind: 'CODE_MISSING', message: '未找到 code，请粘贴裸 code 或完整回调 URL' } });
      }
      const cookies = parseCookies(req);
      let stateRecord;
      try {
        stateRecord = validateAndConsumeState(extracted.state, cookies[STATE_COOKIE]);
      } catch (error) {
        const raw = error.message;
        const kind = raw === 'STATE_ALREADY_USED' ? 'CODE_USED_OR_INVALID'
          : raw === 'STATE_MISMATCH' ? 'CALLBACK_MISMATCH' : 'STATE_MISSING_OR_EXPIRED';
        const message = raw === 'STATE_ALREADY_USED' ? '该授权流程已使用，请重新发起授权'
          : raw === 'STATE_MISMATCH' ? '回调 state 与本次授权不匹配' : '授权 state 缺失或已过期，请先点「用飞书授权连接」再粘贴';
        return sendJson(res, 200, { ok: false, error: { kind, message } });
      }
      try {
        const result = await exchangeCodeForToken(extracted.code, getEnvironment(), stateRecord.redirectUri || redirectUriForRequest(req));
        return sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        const kind = error instanceof TokenExchangeError ? error.kind : 'TOKEN_EXCHANGE_FAILED';
        return sendJson(res, 200, { ok: false, error: { kind, message: error instanceof Error ? error.message : '令牌换取失败', httpStatus: error instanceof TokenExchangeError ? error.httpStatus : 0 } });
      }
    }

    if (method === 'POST' && pathname === '/api/auth/disconnect') {
      clearToken();
      return sendJson(res, 200, { ok: true, connected: false });
    }

    if (method === 'POST' && pathname === '/api/environment') {
      const body = await readJsonBody(req);
      if (body.environment !== 'ppe' && body.environment !== 'online') {
        return sendJson(res, 400, { ok: false, error: { kind: 'BAD_INPUT', message: "environment 必须是 'ppe' 或 'online'" } });
      }
      setEnvironment(body.environment);
      return sendJson(res, 200, { ok: true, environment: body.environment });
    }

    // ---- Boundary Lab（a–k 服务端执行）----
    if (method === 'POST' && pathname === '/api/boundary/run') {
      const body = await readJsonBody(req);
      const result = await runBoundary(getEnvironment(), body.caseId);
      return sendJson(res, 200, result);
    }

    // ---- 文件上传（multipart 透传）----
    if (method === 'POST' && pathname === '/api/files') {
      const environment = getEnvironment();
      const form = await readMultipart(req);
      const result = await proxyMultipart({ environment, form });
      return sendJson(res, 200, result);
    }

    // ---- Sessions / Events / Messages ----
    // /api/sessions | /api/sessions/:id | /api/sessions/:id/(events|messages)[/:messageId]
    if (segments[0] === 'api' && segments[1] === 'sessions') {
      const sessionId = segments[2];
      const sub = segments[3];
      const leafId = segments[4];

      if (!sessionId) {
        if (method === 'GET') return handleProxy(req, res, 'GET', '/v1/sessions', {
          page_size: url.searchParams.get('page_size') ?? undefined,
          page_token: url.searchParams.get('page_token') ?? undefined,
          order: url.searchParams.get('order') ?? undefined,
        });
        if (method === 'POST') {
          const body = await readJsonBody(req);
          return handleProxy(req, res, 'POST', '/v1/sessions', undefined, body);
        }
      } else if (!sub) {
        const sid = encodeURIComponent(sessionId);
        if (method === 'GET') return handleProxy(req, res, 'GET', `/v1/sessions/${sid}`);
        if (method === 'PATCH') {
          const body = await readJsonBody(req);
          return handleProxy(req, res, 'PATCH', `/v1/sessions/${sid}`, undefined, body);
        }
        if (method === 'DELETE') return handleProxy(req, res, 'DELETE', `/v1/sessions/${sid}`);
      } else if (sub === 'events') {
        const sid = encodeURIComponent(sessionId);
        if (method === 'POST') {
          const body = await readJsonBody(req);
          return handleProxy(req, res, 'POST', `/v1/sessions/${sid}/events`, undefined, body);
        }
        if (method === 'GET') {
          const lastEventId = url.searchParams.get('lastEventId') || url.searchParams.get('last_event_id') || undefined;
          if (leafId) {
            // MessageStream：leafId 是 query（用户消息）id
            return handleSSE(req, res, `/v1/sessions/${sid}/events/${encodeURIComponent(leafId)}`, lastEventId);
          }
          // 会话级 Stream（文档标注[暂缓]，真实探测）
          return handleSSE(req, res, `/v1/sessions/${sid}/events`, lastEventId);
        }
      } else if (sub === 'messages') {
        const sid = encodeURIComponent(sessionId);
        if (method === 'GET') {
          if (leafId) return handleProxy(req, res, 'GET', `/v1/sessions/${sid}/messages/${encodeURIComponent(leafId)}`);
          return handleProxy(req, res, 'GET', `/v1/sessions/${sid}/messages`, {
            page_size: url.searchParams.get('page_size') ?? undefined,
            page_token: url.searchParams.get('page_token') ?? undefined,
            order: url.searchParams.get('order') ?? undefined,
          });
        }
      }
    }

    // ---- 静态资源（含 SPA 回退）----
    if (method === 'GET' && !pathname.startsWith('/api/')) {
      return await serveStatic(req, res, pathname);
    }

    return sendJson(res, 404, { ok: false, error: { kind: 'NOT_FOUND', message: `No route: ${method} ${pathname}` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器内部错误';
    if (message === 'PAYLOAD_TOO_LARGE') return sendJson(res, 413, { ok: false, error: { kind: 'PAYLOAD_TOO_LARGE', message: '请求体超过服务器限制' } });
    if (message === 'INVALID_JSON') return sendJson(res, 400, { ok: false, error: { kind: 'INVALID_JSON', message: '请求体不是合法 JSON' } });
    console.error(`[server] ${method} ${pathname} 失败:`, error);
    if (!res.headersSent) return sendJson(res, 500, { ok: false, error: { kind: 'INTERNAL', message } });
    res.end();
  }
});

server.listen(config.port, config.host, () => {
  console.log('──────────────────────────────────────────────────');
  console.log('  豆包工作 Open API 能力展示台 · 独立 Node 版');
  console.log(`  监听: http://${config.host}:${config.port}`);
  console.log(`  环境: ${getEnvironment()}${config.env !== getEnvironment() ? `（ENV 初始值 ${config.env}，已被本地运行时选择覆盖）` : ''}`);
  console.log(`  OAuth: ${oauthConfigured() ? '已从环境变量读取配置' : '未配置（页面将引导填写 OAUTH_CLIENT_ID/SECRET/REDIRECT_URI）'}`);
  console.log(`  Web dist: ${existsSync(DIST_DIR) ? '已就绪' : '未找到（页面给出构建提示）'}`);
  console.log('──────────────────────────────────────────────────');
});
