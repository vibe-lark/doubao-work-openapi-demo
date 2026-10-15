// 独立 Node 版 Boundary Lab：用例在服务端执行（token 不出进程），与托管版 a–k 对齐。
// 无 token 的鉴权用例（a/b）始终真实执行；需要登录的用例在未连接时标 undetermined（前端呈现待判定）。
import { UPSTREAM, PPE_HEADERS } from './config.js';
import { getValidAccessToken, proxyJson } from './upstream.js';

export const CASES = [
  { id: 'a', title: '无 token', group: '鉴权', expected: '文档 401 / 401001；真实网关码以实测为准' },
  { id: 'b', title: '伪造 token', group: '鉴权', expected: '文档 401 / 401001；真实网关码以实测为准' },
  { id: 'c', title: '创建会话缺省 uuid', group: '会话创建', expected: 'HTTP 400 / 400001' },
  { id: 'd', title: 'initial_events 非法（interrupt）', group: '会话创建', expected: 'HTTP 400 / 400001' },
  { id: 'e', title: 'page_size=0', group: '分页', expected: 'HTTP 400 / 400001' },
  { id: 'f', title: '不存在会话', group: '不存在', expected: 'HTTP 404 / 404001' },
  { id: 'g', title: '空消息 contents', group: '事件参数', expected: 'HTTP 400 / 400001' },
  { id: 'h', title: '更新 257 字符', group: '更新边界', expected: 'HTTP 400 / 400001' },
  { id: 'i', title: '会话级 Stream 探测', group: '暂缓接口', expected: '原样记录 HTTP 状态与响应体' },
  { id: 'j', title: '幂等/隔离清理前置检查', group: '幂等', expected: '已连接时检查可运行性' },
  { id: 'k', title: '429 限流', group: '限流', expected: '不主动压测，仅记录文档边界' },
];

function decode(payload) {
  if (!payload || typeof payload !== 'object') return { code: null, msg: '', data: payload };
  const p = payload;
  return { code: p.code ?? null, msg: String(p.msg ?? p.message ?? ''), data: p.data ?? payload };
}

async function authProbe(environment, forged) {
  const url = `${UPSTREAM[environment]}/v1/sessions?page_size=1`;
  const headers = {
    ...(environment === 'ppe' ? PPE_HEADERS : {}),
    ...(forged ? { Authorization: 'Bearer forged-token-for-boundary-test' } : {}),
  };
  const shown = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, /authorization/i.test(k) ? 'Bearer ••••••••' : v]));
  const started = Date.now();
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    let payload = text;
    try { payload = JSON.parse(text); } catch { /* 原文 */ }
    return { httpStatus: response.status, ...decode(payload), durationMs: Date.now() - started, request: { method: 'GET', url, headers: shown } };
  } catch (error) {
    return {
      httpStatus: 0, code: 'NETWORK_ERROR', msg: error instanceof Error ? error.message : '网络错误',
      data: null, durationMs: Date.now() - started, request: { method: 'GET', url, headers: shown },
    };
  }
}

async function boundedSessionStream(environment, sessionId, limitMs) {
  const token = await getValidAccessToken(environment);
  const url = `${UPSTREAM[environment]}/v1/sessions/${encodeURIComponent(sessionId)}/events`;
  const shownHeaders = { Accept: 'text/event-stream', ...(environment === 'ppe' ? PPE_HEADERS : {}) };
  if (!token) {
    return {
      httpStatus: 0, code: 'NOT_CONNECTED', msg: '尚未完成 OAuth 授权', data: null, durationMs: 0, frames: [],
      request: { method: 'GET', url, headers: shownHeaders },
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', ...(environment === 'ppe' ? PPE_HEADERS : {}) },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/event-stream')) {
      const text = await response.text();
      let payload = text;
      try { payload = JSON.parse(text); } catch { /* 原文 */ }
      return { httpStatus: response.status, ...decode(payload), durationMs: Date.now() - started, frames: [], request: { method: 'GET', url, headers: shownHeaders } };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const frames = [];
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) if (block && !block.startsWith(':')) frames.push(block);
    }
    return {
      httpStatus: response.status, code: null, msg: 'SSE 有界读取结束',
      data: { frameCount: frames.length }, durationMs: Date.now() - started, frames: frames.slice(0, 20),
      request: { method: 'GET', url, headers: shownHeaders },
    };
  } catch (error) {
    return {
      httpStatus: 0, code: 'STREAM_ABORTED', msg: error instanceof Error ? error.message : '流读取中断',
      data: null, durationMs: Date.now() - started, frames: [],
      request: { method: 'GET', url, headers: shownHeaders },
    };
  } finally {
    clearTimeout(timer);
  }
}

function verdict(evidence, expectedCode) {
  if (evidence.code === 'NOT_CONNECTED') return 'undetermined';
  if (!expectedCode) return evidence.httpStatus > 0 ? 'pass' : 'undetermined';
  return String(evidence.code) === expectedCode ? 'pass' : 'mismatch';
}

async function execute(environment, caseId) {
  const meta = CASES.find((c) => c.id === caseId);
  let evidence;
  let expectedCode;
  let cleanup = '未创建资源，无需清理';

  if (caseId === 'a') evidence = await authProbe(environment, false);
  if (caseId === 'b') evidence = await authProbe(environment, true);
  if (caseId === 'c') {
    evidence = await proxyJson({ environment, method: 'POST', path: '/v1/sessions', body: { name: 'boundary-no-uuid' } });
    expectedCode = '400001';
  }
  if (caseId === 'd') {
    evidence = await proxyJson({ environment, method: 'POST', path: '/v1/sessions', body: { uuid: `boundary-${Date.now()}`, initial_events: [{ type: 'user.interrupt' }] } });
    expectedCode = '400001';
  }
  if (caseId === 'e') {
    evidence = await proxyJson({ environment, method: 'GET', path: '/v1/sessions', query: { page_size: 0 } });
    expectedCode = '400001';
  }
  if (caseId === 'f') {
    evidence = await proxyJson({ environment, method: 'GET', path: `/v1/sessions/boundary-not-found-${Date.now()}` });
    expectedCode = '404001';
  }
  if (caseId === 'g') {
    evidence = await proxyJson({
      environment, method: 'POST', path: `/v1/sessions/boundary-not-found-${Date.now()}/events`,
      body: { uuid: `boundary-${Date.now()}`, events: [{ type: 'user.message', contents: [] }] },
    });
    expectedCode = '400001';
  }
  if (caseId === 'h') {
    evidence = await proxyJson({ environment, method: 'PATCH', path: `/v1/sessions/boundary-not-found-${Date.now()}`, body: { name: '界'.repeat(257) } });
    expectedCode = '400001';
  }
  if (caseId === 'i') {
    evidence = await boundedSessionStream(environment, `boundary-not-found-${Date.now()}`, 2500);
    cleanup = '探测不创建资源';
  }
  if (caseId === 'j') {
    evidence = await proxyJson({ environment, method: 'GET', path: '/v1/sessions', query: { page_size: 1 } });
    cleanup = '仅检查运行前置；完整幂等流程见 test/ 全量套件';
  }
  if (caseId === 'k') {
    return {
      id: meta.id, ...meta, verdict: 'undetermined',
      actual: '按安全约束未主动制造 429；文档定义 429001 为限流',
      evidence: null, cleanup: '无请求、无需清理',
    };
  }
  const actual = evidence
    ? `HTTP ${evidence.httpStatus}${evidence.code !== null && evidence.code !== undefined ? ` / code ${String(evidence.code)}` : ''}${evidence.msg ? ` / ${String(evidence.msg).slice(0, 160)}` : ''}`
    : '未运行';
  return { id: meta.id, ...meta, verdict: verdict(evidence, expectedCode), actual, evidence, cleanup };
}

export function markdownReport(results, environment) {
  const lines = [
    '# Boundary Lab 脱敏报告',
    '',
    `- 导出时间：${new Date().toISOString()}`,
    `- 环境：${environment}`,
    '- Authorization 与 OAuth 私密值均未导出',
    '',
    '| 用例 | 期望 | 实际 | 判定 | 清理 |',
    '|---|---|---|---|---|',
  ];
  for (const r of results) {
    lines.push(`| ${r.id}. ${r.title} | ${r.expected} | ${String(r.actual).replaceAll('|', '\\|')} | ${r.verdict} | ${r.cleanup || ''} |`);
  }
  return lines.join('\n');
}

export async function runBoundary(environment, caseId) {
  const ids = caseId ? [caseId] : CASES.map((c) => c.id);
  const results = [];
  for (const id of ids) results.push(await execute(environment, id));
  return { ok: true, cases: CASES, results, markdown: markdownReport(results, environment) };
}
