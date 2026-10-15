import type { Environment } from '@shared/schema';

type AppData = { get(key: string, fallback?: unknown): Promise<unknown>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> };
export type AgLike = { appData: AppData };
export type OAuthPrivate = { clientId: string; clientSecret: string; redirectUri: string };
export type TokenRecord = { accessToken: string; refreshToken?: string; expiresAt: number; scope?: string };
export type StateRecord = { value: string; createdAt: number; consumed: boolean };

const PRIVATE_KEY = 'doubao/private/oauth';
const TOKEN_KEY = 'doubao/private/token';
const ENV_KEY = 'doubao/settings/environment';
const STATE_KEY = 'doubao/private/oauth-state';
export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:4110/api/auth/feishu/callback';
export const SCOPES = [
  'doubao:session.event:write',
  'doubao:session.message:read',
  'doubao:session:write',
  'doubao:session:read',
  'doubao:session.event:read',
  'doubao:file:write',
] as const;

export async function saveOAuthPrivate(ag: AgLike, value: OAuthPrivate) { await ag.appData.set(PRIVATE_KEY, value); }
export async function getOAuthPrivate(ag: AgLike): Promise<OAuthPrivate> {
  const value = await ag.appData.get(PRIVATE_KEY, null);
  if (!value || typeof value !== 'object') throw new Error('OAUTH_NOT_CONFIGURED');
  const record = value as Partial<OAuthPrivate>;
  if (!record.clientId || !record.clientSecret || !record.redirectUri) throw new Error('OAUTH_NOT_CONFIGURED');
  return record as OAuthPrivate;
}
export async function getEnvironment(ag: AgLike): Promise<Environment> {
  const value = await ag.appData.get(ENV_KEY, 'ppe');
  return value === 'online' ? 'online' : 'ppe';
}
export async function setEnvironmentValue(ag: AgLike, value: Environment) { await ag.appData.set(ENV_KEY, value); }
export async function getToken(ag: AgLike): Promise<TokenRecord | null> {
  const value = await ag.appData.get(TOKEN_KEY, null);
  if (!value || typeof value !== 'object' || !('accessToken' in value)) return null;
  return value as TokenRecord;
}
export async function saveToken(ag: AgLike, token: TokenRecord) { await ag.appData.set(TOKEN_KEY, token); }
export async function clearToken(ag: AgLike) { await ag.appData.delete(TOKEN_KEY); }
export async function saveState(ag: AgLike, value: string) { await ag.appData.set(STATE_KEY, { value, createdAt: Date.now(), consumed: false }); }
export async function validateAndConsumeState(ag: AgLike, supplied?: string) {
  const state = await ag.appData.get(STATE_KEY, null) as StateRecord | null;
  if (!state?.value || Date.now() - state.createdAt > 10 * 60_000) throw new Error('STATE_MISSING_OR_EXPIRED');
  if (state.consumed) throw new Error('STATE_ALREADY_USED');
  if (supplied && supplied !== state.value) throw new Error('STATE_MISMATCH');
  await ag.appData.set(STATE_KEY, { ...state, consumed: true });
}
export function tokenFromPayload(payload: unknown): TokenRecord {
  const p = payload as Record<string, unknown>;
  const accessToken = String(p.access_token || '');
  if (!accessToken) throw new Error(String(p.error_description || p.msg || p.error || '响应中没有 access_token'));
  return { accessToken, refreshToken: p.refresh_token ? String(p.refresh_token) : undefined, expiresAt: Date.now() + Number(p.expires_in || 7200) * 1000, scope: p.scope ? String(p.scope) : undefined };
}
export function maskedHeaders(environment: Environment, auth = true): Record<string, string> {
  return { ...(auth ? { Authorization: 'Bearer ••••••••' } : {}), ...(environment === 'ppe' ? { 'X-Tt-Env': 'ppe_doubao_oapi', 'X-Use-Ppe': '1' } : {}) };
}
