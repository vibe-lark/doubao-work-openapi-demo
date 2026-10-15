// 本地凭据存储：token / refresh_token / 环境选择落在仓库外不入版本库的 .tokens/ 目录。
// .tokens/ 已在根 .gitignore；本模块还负责把文件权限收紧到 0600。
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
// server/lib → server → 仓库根
export const REPO_ROOT = join(here, '..', '..');
export const TOKENS_DIR = join(REPO_ROOT, '.tokens');
const TOKEN_FILE = join(TOKENS_DIR, 'token.json');
const ENV_FILE = join(TOKENS_DIR, 'environment');

function ensureDir() {
  mkdirSync(TOKENS_DIR, { recursive: true, mode: 0o700 });
}

function writeSecret(file, value) {
  ensureDir();
  writeFileSync(file, value, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* 某些文件系统不支持 chmod，忽略 */ }
}

// ---- token ----
export function loadToken() {
  try {
    const raw = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    if (!raw || typeof raw.access_token !== 'string' || !raw.access_token) return null;
    return {
      accessToken: raw.access_token,
      refreshToken: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
      // 兼容两种字段名：新写法 expires_at（毫秒），旧写法 expires_in（秒，相对落盘时刻）
      expiresAt: Number(raw.expires_at ?? (raw.saved_at ? raw.saved_at + Number(raw.expires_in || 7200) * 1000 : Date.now() + 7200_000)),
      scope: typeof raw.scope === 'string' ? raw.scope : undefined,
    };
  } catch {
    return null;
  }
}

export function saveToken(payload) {
  const now = Date.now();
  const record = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || '',
    expires_at: now + Number(payload.expires_in || 7200) * 1000,
    expires_in: Number(payload.expires_in || 7200),
    scope: payload.scope || '',
    token_type: payload.token_type || 'Bearer',
    saved_at: now,
  };
  writeSecret(TOKEN_FILE, JSON.stringify(record, null, 2));
  return {
    accessToken: record.access_token,
    refreshToken: record.refresh_token || undefined,
    expiresAt: record.expires_at,
    scope: record.scope || undefined,
  };
}

export function clearToken() {
  try { rmSync(TOKEN_FILE, { force: true }); } catch { /* ignore */ }
}

// ---- 环境选择（ENV 为初始值，运行时可切换并持久化）----
export function getEnvironment() {
  try {
    const saved = readFileSync(ENV_FILE, 'utf8').trim();
    if (saved === 'online' || saved === 'ppe') return saved;
  } catch { /* 首次启动用 ENV */ }
  return config.env;
}

export function setEnvironment(value) {
  writeSecret(ENV_FILE, value === 'online' ? 'online' : 'ppe');
}

// ---- OAuth state：内存表 + Cookie 双校验，10 分钟有效，一次性消费 ----
const states = new Map();

export function createState(value, metadata = {}) {
  states.set(value, {
    createdAt: Date.now(),
    consumed: false,
    redirectUri: typeof metadata.redirectUri === 'string' ? metadata.redirectUri : undefined,
  });
  // 顺手清理过期项
  for (const [k, v] of states) if (Date.now() - v.createdAt > 10 * 60_000) states.delete(k);
}

export class StateError extends Error {}

export function validateAndConsumeState(supplied, cookieValue) {
  const value = supplied || cookieValue;
  if (!value) throw new StateError('STATE_MISSING_OR_EXPIRED');
  const record = states.get(value);
  if (!record || Date.now() - record.createdAt > 10 * 60_000) throw new StateError('STATE_MISSING_OR_EXPIRED');
  if (record.consumed) throw new StateError('STATE_ALREADY_USED');
  if (supplied && cookieValue && supplied !== cookieValue) throw new StateError('STATE_MISMATCH');
  record.consumed = true;
  states.delete(value);
  return record;
}
