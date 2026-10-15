// Test-only provider. The production server does not import this file.
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(url);
  if (target.href === 'https://accounts.feishu.cn/oauth/v3/token') {
    const body = JSON.parse(init.body);
    if (!['user-a', 'user-b'].includes(body.code)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ access_token: `synthetic-${body.code}`, expires_in: 7200, scope: 'doubao:session:read' });
  }
  const authorization = new Headers(init.headers).get('authorization');
  const user = authorization === 'Bearer synthetic-user-a' ? 'a' : authorization === 'Bearer synthetic-user-b' ? 'b' : null;
  if (!user) return Response.json({ code: 99991668 }, { status: 400 });
  if (target.pathname === '/open-apis/authen/v1/user_info') return Response.json({ code: 0, data: { open_id: `test-open-id-${user}`, name: `测试用户 ${user}`, avatar_url: 'https://example.test/avatar.png' } });
  if (target.hostname === 'open.doubao.com') return Response.json({ code: 0, data: { owner: user, sessions: [] } });
  throw new Error(`Unexpected upstream in isolated test: ${target.hostname}`);
};
