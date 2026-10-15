// 本地凭据存储：token / refresh_token / 环境选择落在仓库外不入版本库的 .tokens/ 目录。
// .tokens/ 已在根 .gitignore；本模块还负责把文件权限收紧到 0600。
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  existsSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
// server/lib → server → 仓库根
export const REPO_ROOT = join(here, "..", "..");
export const TOKENS_DIR =
  process.env.DOUBAO_TOKEN_DIR || join(REPO_ROOT, ".tokens");
const TOKEN_FILE = join(TOKENS_DIR, "token.json");
const ENV_FILE = join(TOKENS_DIR, "environment");
const browserContext = new AsyncLocalStorage();
export const SESSION_COOKIE = "doubao_session";
export const LOGIN_MAX_AGE = 7 * 24 * 60 * 60;
export const newSessionId = () => randomBytes(32).toString("hex");
export function withBrowserSession(id, fn) {
  return browserContext.run(
    { id: /^[a-f0-9]{64}$/.test(id || "") ? id : null },
    fn,
  );
}
function tokenFile() {
  const context = browserContext.getStore();
  // Legacy CLI data is never used by HTTP requests, including anonymous ones.
  if (!context) return TOKEN_FILE;
  return context.id
    ? join(
        TOKENS_DIR,
        "sessions",
        `${createHash("sha256").update(context.id).digest("hex")}.json`,
      )
    : null;
}
function envFile() {
  const context = browserContext.getStore();
  return !context
    ? ENV_FILE
    : tokenFile()
      ? `${tokenFile()}.environment`
      : null;
}
export function sessionCookie(id, secure = false) {
  return `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${id ? LOGIN_MAX_AGE : 0}${secure ? "; Secure" : ""}`;
}

function ensureDir() {
  mkdirSync(TOKENS_DIR, { recursive: true, mode: 0o700 });
}

function writeSecret(file, value) {
  ensureDir();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, value, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* 某些文件系统不支持 chmod，忽略 */
  }
}

// ---- token ----
export function loadToken() {
  try {
    const file = tokenFile();
    if (!file) return null;
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (raw.login_expires_at && raw.login_expires_at <= Date.now()) return null;
    if (!raw || typeof raw.access_token !== "string" || !raw.access_token)
      return null;
    return {
      accessToken: raw.access_token,
      account: raw.account || null,
      loginExpiresAt: raw.login_expires_at || null,
      refreshToken:
        typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
      // 兼容两种字段名：新写法 expires_at（毫秒），旧写法 expires_in（秒，相对落盘时刻）
      expiresAt: Number(
        raw.expires_at ??
          (raw.saved_at
            ? raw.saved_at + Number(raw.expires_in || 7200) * 1000
            : Date.now() + 7200_000),
      ),
      scope: typeof raw.scope === "string" ? raw.scope : undefined,
    };
  } catch {
    return null;
  }
}

export function saveToken(payload) {
  const now = Date.now();
  const file = tokenFile();
  if (!file) throw new Error("BROWSER_SESSION_REQUIRED");
  const previous = loadToken();
  const record = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || previous?.refreshToken || "",
    account: payload.account || previous?.account || null,
    login_expires_at: previous?.loginExpiresAt || now + LOGIN_MAX_AGE * 1000,
    expires_at: now + Number(payload.expires_in || 7200) * 1000,
    expires_in: Number(payload.expires_in || 7200),
    scope: payload.scope || previous?.scope || "",
    token_type: payload.token_type || "Bearer",
    saved_at: now,
  };
  writeSecret(file, JSON.stringify(record, null, 2));
  return {
    accessToken: record.access_token,
    account: record.account,
    loginExpiresAt: record.login_expires_at,
    refreshToken: record.refresh_token || undefined,
    expiresAt: record.expires_at,
    scope: record.scope || undefined,
  };
}

export function clearToken() {
  try {
    const file = tokenFile();
    if (file) {
      rmSync(file, { force: true });
      rmSync(`${file}.environment`, { force: true });
    }
  } catch {
    /* ignore */
  }
}

// ---- 环境选择（ENV 为初始值，运行时可切换并持久化）----
export function getEnvironment() {
  try {
    const file = envFile();
    if (!file) return config.env;
    const saved = readFileSync(file, "utf8").trim();
    if (saved === "online" || saved === "ppe") return saved;
  } catch {
    /* 首次启动用 ENV */
  }
  return config.env;
}

export function setEnvironment(value) {
  const file = envFile();
  if (!file) throw new Error("BROWSER_SESSION_REQUIRED");
  writeSecret(file, value === "online" ? "online" : "ppe");
}

// ---- OAuth state：内存表 + Cookie 双校验，10 分钟有效，一次性消费 ----
const states = new Map();

export function createState(value, metadata = {}) {
  states.set(value, {
    createdAt: Date.now(),
    consumed: false,
    returnTo: ["playground", "integration", "api"].includes(metadata.returnTo)
      ? metadata.returnTo
      : "playground",
    redirectUri:
      typeof metadata.redirectUri === "string"
        ? metadata.redirectUri
        : undefined,
  });
  // 顺手清理过期项
  for (const [k, v] of states)
    if (Date.now() - v.createdAt > 10 * 60_000) states.delete(k);
}

export class StateError extends Error {}

export function validateAndConsumeState(supplied, cookieValue) {
  if (!supplied || !cookieValue || supplied !== cookieValue)
    throw new StateError("STATE_MISMATCH");
  const value = supplied;
  if (!value) throw new StateError("STATE_MISSING_OR_EXPIRED");
  const record = states.get(value);
  if (!record || Date.now() - record.createdAt > 10 * 60_000)
    throw new StateError("STATE_MISSING_OR_EXPIRED");
  if (record.consumed) throw new StateError("STATE_ALREADY_USED");
  if (supplied && cookieValue && supplied !== cookieValue)
    throw new StateError("STATE_MISMATCH");
  record.consumed = true;
  states.delete(value);
  return record;
}
