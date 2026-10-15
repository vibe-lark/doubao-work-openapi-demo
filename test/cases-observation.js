// 协议一致性观察项 O1–O6：有真实结果就登记，行为与文档不符标 MISMATCH。
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PPE_HEADERS, sleep } from './http.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..');
const uuid = () => globalThis.crypto.randomUUID();
const TERMINAL_EVENTS = ['message.completed', 'message.failed', 'message.cancelled'];

// 发消息并收集 SSE（返回 sent/queryId/stream）。
async function startTurn(t, sid, text) {
  const sent = await t.call('POST', `/v1/sessions/${sid}/events`, {
    body: { uuid: uuid(), events: [{ type: 'user.message', contents: [{ type: 'text', text }] }] },
  });
  const queryId = sent.data?.messages?.[0]?.id;
  return { sent, queryId };
}

export const OBSERVATION_CASES = [
  {
    id: 'O1', group: '协议观察', api: 'SSE seq/帧序', needToken: true,
    title: 'SSE seq 单调与帧序（start → delta → item）',
    doc: '带 seq 帧在一条回复内单调递增；流式类型帧序为 start、若干 delta、item。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'O1 seq' } });
      t.state.o1 = created.data?.id;
      const { queryId } = await startTurn(t, created.data.id, '请用三段话介绍杭州西湖，每段三句。');
      const stream = await t.stream(`/v1/sessions/${created.data.id}/events/${queryId}`, {
        maxMs: 180_000,
        shouldStop: (frame) => TERMINAL_EVENTS.includes(frame.event),
      });
      t.attach('stream', { ...stream, frames: stream.frames.slice(0, 60) });
      const seqs = stream.frames.map((f) => Number(f.parsed?.seq)).filter((n) => Number.isFinite(n));
      let monotonic = true;
      for (let i = 1; i < seqs.length; i += 1) if (seqs[i] < seqs[i - 1]) { monotonic = false; break; }
      t.check('带 seq 帧单调不减', monotonic, '单调不减', monotonic ? `是（${seqs.length} 帧）` : `否：${seqs.join(',')}`);

      // 以 text item 为锚：同一 id 的 start/delta 必须出现在 item 帧之前。
      const orderOk = [];
      const textIds = new Set(stream.frames.filter((f) => f.event === 'text').map((f) => f.parsed?.id));
      for (const id of textIds) {
        const idx = { start: -1, delta: -1, item: -1 };
        stream.frames.forEach((f, i) => {
          if (f.parsed?.id !== id) return;
          if (f.event === 'text.start' && idx.start < 0) idx.start = i;
          if (f.event === 'text.delta' && idx.delta < 0) idx.delta = i;
          if (f.event === 'text') idx.item = i;
        });
        if (idx.item >= 0) orderOk.push(idx.start < 0 ? true : idx.start < idx.item && (idx.delta < 0 || idx.delta < idx.item));
      }
      if (orderOk.length) t.check('start/delta 早于 item 帧', orderOk.every(Boolean), '全部满足', `${orderOk.filter(Boolean).length}/${orderOk.length}`);
      else t.check('观察到 text 帧序', false, '至少 1 个流式 text item', '未观察到（回复可能过短）');
      await t.waitIdle(created.data.id, { maxMs: 60_000 });
    },
    async cleanup(t) { if (t.state.o1) await t.call('DELETE', `/v1/sessions/${t.state.o1}`); },
  },
  {
    id: 'O2', group: '协议观察', api: 'Last-Event-ID 续传', needToken: true,
    title: 'Last-Event-ID 断线续传：补发帧严格在断点之后',
    doc: '重连带 Last-Event-ID（message_id:seq），服务端从该 seq 之后补发落库帧再接实时；最终收到终态。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'O2 resume' } });
      t.state.o2 = created.data?.id;
      const { queryId } = await startTurn(t, created.data.id, '请从 1 数到 30，每个数字单独成段，尽量多输出一些文字。');
      // 第一次连接：收到至少一个带 id 的落库帧后主动断开。
      let checkpoint = '';
      let checkpointSeq = 0;
      const first = await t.stream(`/v1/sessions/${created.data.id}/events/${queryId}`, {
        maxMs: 120_000,
        shouldStop: (frame) => {
          if (frame.id && Number(frame.parsed?.seq) > 0) {
            checkpoint = frame.id;
            checkpointSeq = Number(frame.parsed.seq);
            return true;
          }
          return false;
        },
      });
      t.attach('stream.before-resume', { ...first, frames: first.frames.slice(-10) });
      if (!checkpoint) t.block('首次连接未取得任何带 id 的落库帧，无法测试续传');
      await sleep(500);
      // 第二次连接：带 Last-Event-ID 续到终态。
      const resumed = await t.stream(`/v1/sessions/${created.data.id}/events/${queryId}`, {
        lastEventId: checkpoint,
        maxMs: 180_000,
        shouldStop: (frame) => TERMINAL_EVENTS.includes(frame.event),
      });
      t.attach('stream.resumed', { ...resumed, frames: resumed.frames.slice(0, 60) });
      t.check('续传连接成功', resumed.connected, 'connected', `connected=${resumed.connected} ${resumed.msg}`);
      t.check('续传收到终态帧', resumed.frames.some((f) => TERMINAL_EVENTS.includes(f.event)), 'message.* 终态帧', resumed.stopReason);
      const backfilled = resumed.frames.filter((f) => f.id && Number.isFinite(Number(f.parsed?.seq)));
      const afterCheckpoint = backfilled.every((f) => Number(f.parsed.seq) > checkpointSeq || !String(f.id).startsWith(queryId));
      // 生命周期帧可能带相同 seq；只校验内容/落库帧严格在断点之后。
      const contentAfter = resumed.frames
        .filter((f) => ['text', 'reasoning', 'artifact'].includes(f.event))
        .every((f) => Number(f.parsed?.seq) > checkpointSeq);
      t.check('补发内容帧 seq 严格大于断点', contentAfter, `seq > ${checkpointSeq}`, contentAfter ? '是' : `否（断点 ${checkpointSeq}）`);
      t.check('补发帧不早于断点（含生命周期帧参考）', afterCheckpoint, 'seq 不回退', afterCheckpoint ? '是' : '否');
      await t.waitIdle(created.data.id, { maxMs: 60_000 });
      return `断点 ${checkpoint}，续传帧 ${resumed.frames.length}`;
    },
    async cleanup(t) { if (t.state.o2) await t.call('DELETE', `/v1/sessions/${t.state.o2}`); },
  },
  {
    id: 'O3', group: '协议观察', api: 'SSE/Messages item id', needToken: true,
    title: '同一 item 在 SSE 与 Messages Retrieve 中 id 一致',
    doc: '流上的内容帧与 Messages 返回的 item 同 id。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'O3 item id' } });
      t.state.o3 = created.data?.id;
      const { queryId } = await startTurn(t, created.data.id, '请写一首四句的短诗。');
      const stream = await t.stream(`/v1/sessions/${created.data.id}/events/${queryId}`, {
        maxMs: 180_000,
        shouldStop: (frame) => TERMINAL_EVENTS.includes(frame.event),
      });
      const terminal = await t.waitMessage(created.data.id, queryId, { maxMs: 60_000 });
      t.attach('stream', { connected: stream.connected, frameCount: stream.frames.length });
      t.attach('retrieve', terminal.evidence);
      const sseIds = new Set(stream.frames.filter((f) => ['text', 'reasoning', 'artifact'].includes(f.event)).map((f) => f.parsed?.id).filter(Boolean));
      const retrieveIds = new Set((terminal.evidence.data?.items || []).map((i) => i.id));
      const common = [...sseIds].filter((id) => retrieveIds.has(id));
      t.check('SSE item id 与 Retrieve 交集非空', common.length > 0, `至少 1 个同 id（SSE ${sseIds.size} / Retrieve ${retrieveIds.size}）`, `交集 ${common.length}`);
      if (sseIds.size > 0) t.check('SSE 内容帧全部可在 Retrieve 找到', common.length === sseIds.size, `${sseIds.size}/${sseIds.size}`, `${common.length}/${sseIds.size}`);
      await t.waitIdle(created.data.id, { maxMs: 60_000 });
    },
    async cleanup(t) { if (t.state.o3) await t.call('DELETE', `/v1/sessions/${t.state.o3}`); },
  },
  {
    id: 'O4', group: '协议观察', api: 'cancelled 后恢复 idle', needToken: true,
    title: 'cancelled 后 session 恢复 idle 且可继续对话',
    doc: '打断终态后 session 回到 idle，可继续提交消息并 completed。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'O4 恢复' } });
      t.state.o4 = created.data?.id;
      const { queryId } = await startTurn(t, created.data.id, '请写一篇 6000 字以上的长文，题目是《地球的气候系统》，分章详细输出，不要停。');
      let interrupted = false;
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const snap = await t.call('GET', `/v1/sessions/${created.data.id}`);
        if (snap.data?.session?.status === 'in_progress') {
          const ir = await t.call('POST', `/v1/sessions/${created.data.id}/events`, {
            body: { uuid: uuid(), events: [{ type: 'user.interrupt' }] },
          });
          t.attach('interrupt', ir);
          interrupted = ir.httpStatus === 202;
          break;
        }
        if (snap.data?.session?.status === 'idle') break;
        await sleep(700);
      }
      const cancelled = await t.waitMessage(created.data.id, queryId, { maxMs: 60_000 });
      t.attach('cancelled-message', cancelled.evidence);
      t.check('打断后消息 cancelled', cancelled.status === 'cancelled', 'cancelled', String(cancelled.status));
      const idle = await t.waitIdle(created.data.id, { maxMs: 60_000 });
      t.check('session 恢复 idle', idle.status === 'idle', 'idle', String(idle.status));
      const again = await t.call('POST', `/v1/sessions/${created.data.id}/events`, {
        body: { uuid: uuid(), events: [{ type: 'user.message', contents: [{ type: 'text', text: '现在只回复两个字：在的' }] }] },
      });
      const nextId = again.data?.messages?.[0]?.id;
      const next = await t.waitMessage(created.data.id, nextId, { maxMs: 120_000 });
      t.attach('next-message', next.evidence);
      t.check('cancelled 后可继续对话并 completed', interrupted && next.status === 'completed', 'completed', String(next.status));
      await t.waitIdle(created.data.id, { maxMs: 60_000 });
    },
    async cleanup(t) { if (t.state.o4) await t.call('DELETE', `/v1/sessions/${t.state.o4}`); },
  },
  {
    id: 'O5', group: '协议观察', api: 'token 有效期/refresh', needToken: true,
    title: 'token 有效期与 refresh 链路实测',
    doc: 'user_access_token 有效期较短（实测约 1 小时量级）；refresh_token 可换新 token。',
    tokenSource: 'file',
    async run(t) {
      const file = join(REPO_ROOT, '.tokens', 'token.json');
      if (!existsSync(file)) t.block('token 来自环境变量 DOUBBAO_USER_TOKEN，本地无 refresh_token，无法实测刷新链路');
      const record = JSON.parse(readFileSync(file, 'utf8'));
      const ttlMs = Number(record.expires_at || 0) - Date.now();
      t.check('读取到 expires_in', Number(record.expires_in) > 0, '正数秒', String(record.expires_in));
      t.attach('token-meta', { note: 'access_token 已脱敏', expires_in: record.expires_in, scope: record.scope, remainingSeconds: Math.round(ttlMs / 1000) });
      if (!record.refresh_token) t.block('token 文件缺少 refresh_token');
      if (!process.env.OAUTH_CLIENT_ID || !process.env.OAUTH_CLIENT_SECRET) {
        t.block(`声明有效期 ${record.expires_in}s（约 ${Math.round(Number(record.expires_in) / 60)} 分钟）；刷新实测需 OAUTH_CLIENT_ID/SECRET，当前未注入`);
      }
      // 主动刷新（refresh_token 轮转），成功后回写 token 文件并用新 token 验证。
      const resp = await fetch('https://accounts.feishu.cn/oauth/v3/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t.runtime.env === 'ppe' ? PPE_HEADERS : {}) },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: record.refresh_token,
          client_id: process.env.OAUTH_CLIENT_ID,
          client_secret: process.env.OAUTH_CLIENT_SECRET,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await resp.json().catch(() => null);
      t.attach('refresh-response', { httpStatus: resp.status, code: payload?.code ?? null, msg: payload?.error_description || payload?.msg || '', hasAccessToken: Boolean(payload?.access_token) });
      t.check('刷新接口 200 且返回 access_token', resp.ok && Boolean(payload?.access_token), '200 + access_token', `${resp.status} / ${payload?.code ?? payload?.error ?? ''}`);
      if (resp.ok && payload?.access_token) {
        const now = Date.now();
        writeFileSync(file, JSON.stringify({
          access_token: payload.access_token,
          refresh_token: payload.refresh_token || record.refresh_token,
          expires_at: now + Number(payload.expires_in || 7200) * 1000,
          expires_in: Number(payload.expires_in || 7200),
          scope: payload.scope || record.scope || '',
          token_type: payload.token_type || 'Bearer',
          saved_at: now,
        }, null, 2), { mode: 0o600 });
        const verify = await t.call('GET', '/v1/sessions', { query: { page_size: 1 } });
        t.attach('verify-new-token', verify);
        t.check('新 access_token 可调用业务接口', verify.httpStatus === 200, 200, `${verify.httpStatus} / ${verify.code}`);
      }
      return `声明有效期 ${record.expires_in}s；剩余 ${Math.round(ttlMs / 1000)}s`;
    },
  },
  {
    id: 'O6', group: '协议观察', api: 'PPE/线上差异', needToken: false,
    title: 'PPE 与线上同用例差异',
    doc: '破坏性与边界用例只在 PPE 执行；线上差异需另行受控验证。',
    async run(t) {
      if (t.runtime.env === 'ppe') {
        t.check('当前运行环境', true, 'ppe（破坏性/边界用例仅在此环境）', 'ppe');
        t.attach('note', { note: '线上（open.doubao.com）未运行破坏性用例；如需对比请设置 DOUBBAO_ENV=online 并仅跑非破坏性用例。' });
      } else {
        t.check('当前运行环境', true, 'online（本次套件默认跳过破坏性用例）', 'online');
      }
      return `env=${t.runtime.env}；差异对比留待真机双环境受控运行`;
    },
  },
];
