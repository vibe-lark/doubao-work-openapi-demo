import { Api, Data, Get, Post, useAnygen } from '@anygen/server';
import { environmentInputSchema, exchangeCodeSchema, oauthPrivateSchema } from '@shared/schema';
import { clearToken, DEFAULT_REDIRECT_URI, getEnvironment, getOAuthPrivate, getToken, saveOAuthPrivate, saveState, saveToken, SCOPES, setEnvironmentValue, tokenFromPayload, validateAndConsumeState } from './_doubao';

const TOKEN_URL = 'https://accounts.feishu.cn/oauth/v3/token';

function failure(kind: string, message: string, httpStatus = 0, detail?: unknown) {
  return { ok: false as const, error: { kind, message, httpStatus, ...(detail === undefined ? {} : { detail }) } };
}
function classifyTokenFailure(status: number, payload: unknown) {
  const p = payload && typeof payload === 'object' ? payload as Record<string,unknown> : {};
  const text = String(p.error_description || p.msg || p.error || payload || '令牌换取失败');
  const lower = text.toLowerCase();
  if (lower.includes('used') || lower.includes('invalid_grant') || lower.includes('code')) return failure('CODE_USED_OR_INVALID', text, status);
  if (lower.includes('redirect')) return failure('CALLBACK_MISMATCH', text, status);
  return failure('TOKEN_EXCHANGE_FAILED', text, status);
}

export const configureOAuthPrivate = Api(Post('/oauth/private'), Data(oauthPrivateSchema), async ({ data }) => {
  const ag = useAnygen();
  if (!ag.user.isOwner) { const error = new Error('仅应用所有者可配置 OAuth 私密信息') as Error & { status?: number }; error.status = 403; throw error; }
  await saveOAuthPrivate(ag, { clientId: data.client_id, clientSecret: data.client_secret, redirectUri: data.redirect_uri });
  return { ok: true, configured: true, clientId: data.client_id, redirectUri: data.redirect_uri, secretStored: true };
});

export const startAuthorization = Api(Post('/oauth/start'), async () => {
  const ag = useAnygen();
  const oauth = await getOAuthPrivate(ag);
  const state = ag.uuid();
  await saveState(ag, state);
  const query = new URLSearchParams({ client_id: oauth.clientId, redirect_uri: oauth.redirectUri || DEFAULT_REDIRECT_URI, response_type: 'code', state, scope: SCOPES.join(' ') });
  return { url: `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${query.toString()}`, state };
});

export const exchangeCode = Api(Post('/oauth/exchange'), Data(exchangeCodeSchema), async ({ data }) => {
  const ag = useAnygen(); let code = data.codeOrUrl; let suppliedState: string | undefined;
  const oauth = await getOAuthPrivate(ag);
  try {
    const parsed = new URL(data.codeOrUrl);
    const expected = new URL(oauth.redirectUri);
    if (parsed.origin !== expected.origin || parsed.pathname !== expected.pathname) return failure('CALLBACK_MISMATCH', `回调地址应为 ${oauth.redirectUri}`);
    code = parsed.searchParams.get('code') || '';
    suppliedState = parsed.searchParams.get('state') || undefined;
  } catch { /* bare code */ }
  if (!code) return failure('CODE_MISSING', '未找到 code，请粘贴裸 code 或完整回调 URL');
  try { await validateAndConsumeState(ag, suppliedState); }
  catch (error) {
    const raw = error instanceof Error ? error.message : 'STATE_INVALID';
    if (raw === 'STATE_ALREADY_USED') return failure('CODE_USED_OR_INVALID', '该授权流程已使用，请重新发起授权');
    if (raw === 'STATE_MISMATCH') return failure('CALLBACK_MISMATCH', '回调 state 与本次授权不匹配');
    return failure('STATE_MISSING_OR_EXPIRED', '授权 state 缺失或已过期，请重新发起授权');
  }
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'Content-Type':'application/json', 'x-tt-env':'ppe_doubao_oapi', 'x-use-ppe':'1' }, body: JSON.stringify({ grant_type:'authorization_code', code, redirect_uri:oauth.redirectUri, client_id:oauth.clientId, client_secret:oauth.clientSecret }) });
  } catch (error) { return failure('TOKEN_EXCHANGE_FAILED', error instanceof Error ? error.message : '令牌服务不可达'); }
  const text = await response.text(); let payload: unknown = text;
  try { payload = JSON.parse(text); } catch { /* structured below */ }
  if (!response.ok) return { ...classifyTokenFailure(response.status, payload), durationMs: Date.now() - started };
  try {
    const token = tokenFromPayload(payload); await saveToken(ag, token);
    return { ok: true as const, connected: true, expiresAt: token.expiresAt, scope: token.scope ?? null, durationMs: Date.now() - started };
  } catch (error) { return failure('TOKEN_EXCHANGE_FAILED', error instanceof Error ? error.message : '令牌响应无效', response.status); }
});

export const connectionStatus = Api(Get('/oauth/status'), async () => {
  const ag = useAnygen(); const token = await getToken(ag);
  return { connected: !!token, expiresAt: token?.expiresAt ?? null, scope: token?.scope ?? null, environment: await getEnvironment(ag), account: { name: ag.user.name || null, avatar: ag.user.avatar || null } };
});
export const disconnect = Api(Post('/oauth/disconnect'), async () => { const ag = useAnygen(); await clearToken(ag); return { ok: true, connected: false }; });
export const setEnvironment = Api(Post('/settings/environment'), Data(environmentInputSchema), async ({ data }) => { const ag = useAnygen(); await setEnvironmentValue(ag, data.environment); return { ok: true, environment: data.environment }; });
export const health = Api(Get('/app-health'), async () => ({ ok: true, runtime: 'platform-actions', callbackListener: false, time: new Date().toISOString() }));

// Keep this probe in the established auth action entry: no storage, OAuth, network, or initialization.
export const runtimeProbe = Api(Get('/runtime-probe'), async () => ({
  ok: true,
  ts: new Date().toISOString(),
  runtime: 'platform-actions' as const,
}));
