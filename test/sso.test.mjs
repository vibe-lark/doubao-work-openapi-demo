import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'doubao-sso-test-'));
process.env.DOUBAO_TOKEN_DIR = temp;
const store = await import('../server/lib/store.js');

test('browser sessions isolate tokens and refresh preserves the verified identity', async () => {
  const a = store.newSessionId(), b = store.newSessionId();
  store.saveToken({ access_token: 'legacy-cli-only' });
  assert.equal(store.withBrowserSession(null, () => store.loadToken()), null);
  assert.equal(store.withBrowserSession('../../token', () => store.loadToken()), null);
  await Promise.all([a, b].map((id, i) => store.withBrowserSession(id, async () => {
    store.saveToken({ access_token: `user-${i}`, refresh_token: `refresh-${i}`, account: { id: `id-${i}`, name: `user ${i}` } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.loadToken().accessToken, `user-${i}`);
  })));
  store.withBrowserSession(a, () => {
    store.saveToken({ access_token: 'rotated-a' });
    assert.equal(store.loadToken().account.id, 'id-0');
    assert.equal(store.loadToken().refreshToken, 'refresh-0');
    store.clearToken();
    assert.equal(store.loadToken(), null);
  });
  assert.equal(store.withBrowserSession(b, () => store.loadToken().accessToken), 'user-1');
});

test('HTTP SSO requires matching browser state, isolates users, persists restart and revokes logout', async () => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  async function start() {
    child = spawn(process.execPath, ['--import', './test/sso-provider-fixture.mjs', 'server/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ENV: 'online', OAUTH_CLIENT_ID: 'synthetic-id', OAUTH_CLIENT_SECRET: 'synthetic-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('test server did not start')), 10000);
      child.stdout.on('data', chunk => { if (chunk.toString().includes('监听:')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
    });
  }
  async function stop() { if (child?.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done; } }
  async function login(code) {
    const start = await fetch(`${base}/api/auth/feishu?return_to=integration`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const stateCookie = start.headers.get('set-cookie').split(';')[0];
    const callback = `${base}/api/auth/feishu/callback?code=${code}&state=${state}`;
    const missingCookie = await fetch(callback, { redirect: 'manual' });
    assert.equal(missingCookie.status, 400);
    const response = await fetch(callback, { redirect: 'manual', headers: { cookie: stateCookie } });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/#integration');
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('doubao_session='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const replay = await fetch(callback, { redirect: 'manual', headers: { cookie: stateCookie } });
    assert.equal(replay.status, 400);
    return cookie.split(';')[0];
  }
  try {
    await start();
    assert.equal((await fetch(`${base}/api/sessions`)).status, 401);
    assert.equal((await fetch(`${base}/api/auth/status`).then(r => r.json())).connected, false);
    const a = await login('user-a'), b = await login('user-b');
    for (const [cookie, user] of [[a, 'a'], [b, 'b']]) {
      const status = await fetch(`${base}/api/auth/status`, { headers: { cookie } }).then(r => r.json());
      assert.equal(status.account.name, `测试用户 ${user}`);
      assert.equal(status.connected, true);
      assert.ok(!JSON.stringify(status).includes('synthetic-user'));
      const result = await fetch(`${base}/api/sessions`, { headers: { cookie } }).then(r => r.json());
      assert.equal(result.data.owner, user);
    }
    await stop(); await start();
    assert.equal((await fetch(`${base}/api/auth/status`, { headers: { cookie: b } }).then(r => r.json())).connected, true);
    assert.equal((await fetch(`${base}/api/auth/disconnect`, { method: 'POST', headers: { cookie: a } })).status, 403);
    assert.equal((await fetch(`${base}/api/auth/disconnect`, { method: 'POST', headers: { cookie: a, 'X-Doubao-Request': '1', Origin: 'https://untrusted.test' } })).status, 403);
    const logout = await fetch(`${base}/api/auth/disconnect`, { method: 'POST', headers: { cookie: a, 'X-Doubao-Request': '1', Origin: base } });
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await fetch(`${base}/api/sessions`, { headers: { cookie: a } })).status, 401);
    assert.equal((await fetch(`${base}/api/auth/status`, { headers: { cookie: b } }).then(r => r.json())).connected, true);
    assert.equal((await fetch(`${base}/api/auth/status`, { headers: { cookie: 'broken=%xx' } }).then(r => r.json())).connected, false);
  } finally { await stop(); rmSync(temp, { recursive: true, force: true }); }
});
