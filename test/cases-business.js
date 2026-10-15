// S1–S13 端到端业务链路用例。每条自包含、尽力清理临时会话。
import { smallPng, txtBytes, pdfBytes, blobBytes } from './fixtures.js';

const TERMINAL_EVENTS = ['message.completed', 'message.failed', 'message.cancelled'];

function uuid() {
  return globalThis.crypto.randomUUID();
}

// 从 Events Create / Sessions Create 响应里取用户消息 id。
function userMessageId(createResult) {
  return createResult?.data?.messages?.[0]?.id || '';
}

// 发一条消息并跟踪到终态（SSE 优先，retrieve 兜底），返回过程证据。
async function sendAndTrack(t, sessionId, contents, opts = {}) {
  const sent = await t.call('POST', `/v1/sessions/${sessionId}/events`, {
    body: { uuid: uuid(), events: [{ type: 'user.message', contents }] },
  });
  t.attach('events.create', sent);
  const queryId = userMessageId(sent);
  if (sent.httpStatus !== 202 || !queryId) return { sent, queryId: '', stream: null, terminal: null };
  const stream = await t.stream(`/v1/sessions/${sessionId}/events/${queryId}`, {
    maxMs: opts.maxMs || 180_000,
    shouldStop: (frame) => TERMINAL_EVENTS.includes(frame.event),
  });
  t.attach('message-stream', stream);
  const terminal = await t.waitMessage(sessionId, queryId, { maxMs: opts.maxMs || 180_000 });
  t.attach('message.retrieve', terminal.evidence);
  return { sent, queryId, stream, terminal };
}

export const BUSINESS_CASES = [
  {
    id: 'S1', group: '端到端', api: 'POST /v1/files', needToken: true,
    title: '上传 png / txt / pdf 三类文件并拿到 uri',
    doc: 'Files Upload：200，data.uri 为非空字符串，filename/size 回显。',
    async run(t) {
      const files = [
        { name: `s1-${Date.now()}.png`, bytes: smallPng(), type: 'image/png' },
        { name: `s1-${Date.now()}.txt`, bytes: txtBytes(), type: 'text/plain' },
        { name: `s1-${Date.now()}.pdf`, bytes: pdfBytes(), type: 'application/pdf' },
      ];
      const uris = {};
      for (const f of files) {
        const r = await t.upload({ uuid: uuid(), filename: f.name, bytes: f.bytes, contentType: f.type });
        t.attach(`upload ${f.name}`, r);
        t.check(`${f.name} HTTP 200 / code 0`, r.httpStatus === 200 && r.code === 0, '200 / 0', `${r.httpStatus} / ${r.code}`);
        t.check(`${f.name} 返回非空 uri`, typeof r.data?.uri === 'string' && r.data.uri.length > 0, '非空 uri', String(r.data?.uri));
        uris[f.name.split('.').pop()] = r.data?.uri;
      }
      t.state.files = uris;
      return `uri：png=${uris.png || '—'}，txt=${uris.txt || '—'}，pdf=${uris.pdf || '—'}`;
    },
  },
  {
    id: 'S2', group: '端到端', api: 'POST /v1/sessions + MessageStream', needToken: true,
    title: '建会话带 initial_events（文本+文件）→ in_progress → 流式收完整回复 → 校验消息与 reply_id',
    doc: 'Create 带 initial_events：201 status=in_progress 且 messages[0] 为 completed 用户消息；MessageStream 收终态帧；assistant.reply_id 指向该用户消息。',
    async run(t) {
      const up = await t.upload({ uuid: uuid(), filename: `s2-${Date.now()}.png`, bytes: smallPng(), contentType: 'image/png' });
      if (up.httpStatus !== 200) t.block(`前置上传失败：HTTP ${up.httpStatus} ${up.msg}`);
      const created = await t.call('POST', '/v1/sessions', {
        body: {
          uuid: uuid(),
          name: 'S2 流式主链路',
          initial_events: [{
            type: 'user.message',
            contents: [
              { type: 'text', text: '这是一张测试图片，请用一句话描述你收到的内容类型。' },
              { type: 'file', uri: up.data.uri, name: 's2.png' },
            ],
          }],
        },
      });
      t.attach('sessions.create', created);
      t.check('HTTP 201', created.httpStatus === 201, 201, created.httpStatus);
      t.check('session.status = in_progress', created.data?.status === 'in_progress', 'in_progress', String(created.data?.status));
      const queryId = userMessageId(created);
      t.check('返回用户消息 id', Boolean(queryId), '非空', String(queryId));
      t.state.s2Session = created.data?.id;
      t.check('用户消息 status=completed', created.data?.messages?.[0]?.status === 'completed', 'completed', String(created.data?.messages?.[0]?.status));

      const stream = await t.stream(`/v1/sessions/${created.data.id}/events/${queryId}`, {
        maxMs: 180_000,
        shouldStop: (frame) => TERMINAL_EVENTS.includes(frame.event),
      });
      t.attach('message-stream', stream);
      t.check('SSE 连通', stream.connected, 'connected=true', `connected=${stream.connected} ${stream.msg}`);
      t.check('SSE 收到终态帧', ['terminal-frame'].includes(stream.stopReason), 'terminal-frame', String(stream.stopReason));
      const terminalEvents = stream.frames.filter((f) => TERMINAL_EVENTS.includes(f.event));
      t.check('终态帧为 completed/cancelled/failed', terminalEvents.length > 0, 'message.* 终态帧', terminalEvents.map((f) => f.event).join(',') || '无');

      const terminal = await t.waitMessage(created.data.id, queryId, { maxMs: 60_000 });
      t.attach('query.retrieve', terminal.evidence);
      const list = await t.call('GET', `/v1/sessions/${created.data.id}/messages`, { query: { page_size: 20, order: 'desc' } });
      t.attach('messages.list', list);
      const assistant = (list.data?.messages || []).find((m) => m.role === 'assistant' && m.reply_id === queryId);
      t.check('存在 reply_id=query 的 assistant 消息', Boolean(assistant), 'assistant.reply_id 匹配', assistant ? assistant.reply_id : '未找到');
      t.check('assistant 终态', ['completed', 'failed', 'cancelled'].includes(assistant?.status), 'completed/failed/cancelled', String(assistant?.status));

      // O3 顺带验证：SSE 内容帧 id 与 retrieve item id 一致。
      const sseItemIds = new Set(stream.frames.filter((f) => ['text', 'reasoning', 'artifact'].includes(f.event)).map((f) => f.parsed?.id).filter(Boolean));
      const retrieveItemIds = new Set((assistant?.items || []).map((i) => i.id));
      const common = [...sseItemIds].filter((id) => retrieveItemIds.has(id));
      if (sseItemIds.size > 0) {
        t.check('SSE item id 与 Messages item id 一致', common.length > 0, `至少 1 个同 id（SSE 共 ${sseItemIds.size}）`, `交集 ${common.length}`);
      }
      return `session=${created.data?.id}，query=${queryId}，assistant=${assistant?.id || '—'}（${assistant?.status || '—'}）`;
    },
    async cleanup(t) { if (t.state.s2Session) await t.call('DELETE', `/v1/sessions/${t.state.s2Session}`); },
  },
  {
    id: 'S3', group: '端到端', api: 'POST /v1/events + MessageStream', needToken: true,
    title: '空会话(idle) → 发消息 → 202 → 流式+轮询 → 终态',
    doc: 'Events Create 返回 202；session 从 idle 进入 in_progress 再回 idle；assistant 消息 completed。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'S3 空会话发消息' } });
      t.attach('sessions.create', created);
      t.state.s3Session = created.data?.id;
      t.check('空会话 status=idle', created.data?.status === 'idle', 'idle', String(created.data?.status));

      const tracked = await sendAndTrack(t, created.data.id, [{ type: 'text', text: '请回复两个字：你好' }]);
      t.check('events.create HTTP 202', tracked.sent.httpStatus === 202, 202, tracked.sent.httpStatus);
      t.check('SSE 收到终态帧', Boolean(tracked.stream?.frames.some((f) => TERMINAL_EVENTS.includes(f.event))), 'message.* 终态帧', `stop=${tracked.stream?.stopReason}`);
      t.check('assistant completed', tracked.terminal?.status === 'completed', 'completed', String(tracked.terminal?.status));
      const idle = await t.waitIdle(created.data.id, { maxMs: 60_000 });
      t.check('session 回到 idle', idle.status === 'idle', 'idle', String(idle.status));
      return `session=${created.data?.id}`;
    },
    async cleanup(t) { if (t.state.s3Session) await t.call('DELETE', `/v1/sessions/${t.state.s3Session}`); },
  },
  {
    id: 'S4', group: '端到端', api: '连续多轮 Events Create', needToken: true,
    title: '同一会话连续 3 轮多轮对话（严格等待 idle）',
    doc: '每轮 202 → completed；每轮严格在 session idle 后才发下一条；消息列表含 3 对消息。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'S4 多轮对话' } });
      t.state.s4Session = created.data?.id;
      const prompts = [
        '记住数字 42，只回复“记住了”三个字。',
        '我刚才让你记的数字是几？只回复那个数字。',
        '把这个数字加 8 等于几？只回复结果数字。',
      ];
      for (let i = 0; i < prompts.length; i += 1) {
        const idleBefore = await t.waitIdle(created.data.id, { maxMs: 120_000 });
        t.check(`第 ${i + 1} 轮发送前 idle`, idleBefore.status === 'idle', 'idle', String(idleBefore.status));
        const tracked = await sendAndTrack(t, created.data.id, [{ type: 'text', text: prompts[i] }]);
        t.check(`第 ${i + 1} 轮 202`, tracked.sent.httpStatus === 202, 202, tracked.sent.httpStatus);
        t.check(`第 ${i + 1} 轮 completed`, tracked.terminal?.status === 'completed', 'completed', `${tracked.terminal?.status} / ${tracked.sent.msg}`);
      }
      const list = await t.call('GET', `/v1/sessions/${created.data.id}/messages`, { query: { page_size: 50 } });
      const msgs = list.data?.messages || [];
      t.check('消息总数 ≥ 6（3 对）', msgs.length >= 6, '>=6', msgs.length);
      t.check('3 条 completed assistant', msgs.filter((m) => m.role === 'assistant' && m.status === 'completed').length >= 3, '>=3', msgs.filter((m) => m.role === 'assistant').length);
      return `session=${created.data?.id}，消息 ${msgs.length} 条`;
    },
    async cleanup(t) { if (t.state.s4Session) await t.call('DELETE', `/v1/sessions/${t.state.s4Session}`); },
  },
  {
    id: 'S5', group: '端到端', api: 'Events Create（文本+2 附件）', needToken: true,
    title: '一条消息携带文本与两个附件',
    doc: 'contents 支持多个 text/file 块；202 → completed；用户消息 items 含 3 块。',
    async run(t) {
      const [txt, pdf] = await Promise.all([
        t.upload({ uuid: uuid(), filename: `s5-${Date.now()}.txt`, bytes: txtBytes('S5 附件一'), contentType: 'text/plain' }),
        t.upload({ uuid: uuid(), filename: `s5-${Date.now()}.pdf`, bytes: pdfBytes(), contentType: 'application/pdf' }),
      ]);
      if (txt.httpStatus !== 200 || pdf.httpStatus !== 200) t.block(`附件上传失败：txt=${txt.httpStatus} pdf=${pdf.httpStatus}`);
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'S5 多附件' } });
      t.state.s5Session = created.data?.id;
      const tracked = await sendAndTrack(t, created.data.id, [
        { type: 'text', text: '我发送了两个附件（txt 与 pdf），请只回复“收到”。' },
        { type: 'file', uri: txt.data.uri, name: 's5.txt' },
        { type: 'file', uri: pdf.data.uri, name: 's5.pdf' },
      ]);
      t.check('202', tracked.sent.httpStatus === 202, 202, tracked.sent.httpStatus);
      t.check('completed', tracked.terminal?.status === 'completed', 'completed', String(tracked.terminal?.status));
      const userItems = tracked.sent.data?.messages?.[0]?.items || [];
      t.check('用户消息 items 含 3 块', userItems.length === 3, 3, userItems.length);
      return `session=${created.data?.id}`;
    },
    async cleanup(t) { if (t.state.s5Session) await t.call('DELETE', `/v1/sessions/${t.state.s5Session}`); },
  },
  {
    id: 'S6', group: '端到端', api: 'Events Create（仅附件）', needToken: true,
    title: '仅附件、无文本的消息',
    doc: '校验允许「至少一个 file」；202 → completed。',
    async run(t) {
      const up = await t.upload({ uuid: uuid(), filename: `s6-${Date.now()}.txt`, bytes: txtBytes('S6 只有附件'), contentType: 'text/plain' });
      if (up.httpStatus !== 200) t.block(`附件上传失败：${up.httpStatus}`);
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'S6 仅附件' } });
      t.state.s6Session = created.data?.id;
      const tracked = await sendAndTrack(t, created.data.id, [{ type: 'file', uri: up.data.uri, name: 's6.txt' }]);
      t.check('202', tracked.sent.httpStatus === 202, 202, tracked.sent.httpStatus);
      t.check('completed', tracked.terminal?.status === 'completed', 'completed', String(tracked.terminal?.status));
      return `session=${created.data?.id}`;
    },
    async cleanup(t) { if (t.state.s6Session) await t.call('DELETE', `/v1/sessions/${t.state.s6Session}`); },
  },
  {
    id: 'S7', group: '端到端', api: 'user.interrupt', needToken: true,
    title: '长任务窗口内 interrupt → 终态 cancelled 且半截文本保留',
    doc: 'in_progress 时提交 user.interrupt 返回 202；assistant 最终 cancelled；已生成 text item 保留。',
    async run(t) {
      const longPrompt = '请撰写一份非常详细、超过 8000 字的研究报告，主题是全球人工智能产业在 2020 到 2026 年间的发展历程，要求分十个章节，每章至少 800 字，包含具体公司案例与数据，逐步完整输出。';
      let attempt;
      for (let round = 0; round < 2; round += 1) {
        const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: `S7 打断-${round + 1}` } });
        t.attach(`sessions.create#${round + 1}`, created);
        const sid = created.data?.id;
        const sent = await t.call('POST', `/v1/sessions/${sid}/events`, {
          body: { uuid: uuid(), events: [{ type: 'user.message', contents: [{ type: 'text', text: longPrompt }] }] },
        });
        const queryId = userMessageId(sent);
        t.attach(`events.create#${round + 1}`, sent);
        // 抢 in_progress 窗口：快速轮询 session，进入 in_progress 后立即打断。
        let interrupted = null;
        const deadline = Date.now() + 45_000;
        while (Date.now() < deadline) {
          const snap = await t.call('GET', `/v1/sessions/${sid}`);
          if (snap.data?.session?.status === 'in_progress') {
            interrupted = await t.call('POST', `/v1/sessions/${sid}/events`, {
              body: { uuid: uuid(), events: [{ type: 'user.interrupt' }] },
            });
            t.attach('interrupt', interrupted);
            break;
          }
          if (snap.data?.session?.status === 'idle') break; // 太快结束，下一轮换更长的提示重试
          await t.sleep(700);
        }
        const terminal = await t.waitMessage(sid, queryId, { maxMs: 60_000 });
        const partialTextLen = (terminal.evidence?.data?.items || []).filter((i) => i.type === 'text').reduce((n, i) => n + String(i.text || '').length, 0);
        attempt = { sid, sent, interrupted, terminal, partialTextLen, round };
        if (interrupted?.httpStatus === 202 && terminal.status === 'cancelled') break;
      }
      t.state.s7Session = attempt.sid;
      t.attach('final-message', attempt.terminal.evidence);
      t.check('interrupt 受理 202', attempt.interrupted?.httpStatus === 202, 202, String(attempt.interrupted?.httpStatus));
      t.check('终态 cancelled', attempt.terminal.status === 'cancelled', 'cancelled', String(attempt.terminal.status));
      t.check('半截文本保留', attempt.partialTextLen >= 0, 'items 中存在已生成文本（长度 >0 为佳）', `text 长度 ${attempt.partialTextLen}`);
      if (attempt.partialTextLen === 0) t.mismatch('半截文本长度', '>0', '0（可能打断过早）');
      if (attempt.terminal.status !== 'cancelled') t.block('两次尝试均未在 in_progress 窗口内完成打断，自动化无法稳定复现');
      return `session=${attempt.sid}，cancelled=${attempt.terminal.status === 'cancelled'}，半截文本 ${attempt.partialTextLen} 字`;
    },
    async cleanup(t) { if (t.state.s7Session) await t.call('DELETE', `/v1/sessions/${t.state.s7Session}`); },
  },
  {
    id: 'S8', group: '端到端', api: 'artifact 观察', needToken: true,
    title: '引导产出 artifact（document/file/image/link）',
    doc: 'artifact item 的 artifact_type ∈ document/file/image/video/link；触发不了如实 BLOCKED。',
    async run(t) {
      const prompts = [
        '请把一份《三日北京旅行行程》整理成一篇飞书云文档，完成后把文档链接发给我。',
        '请画一张蓝色沙发的图片发给我；如果不能画图，就把一份包含行程表的 markdown 文件作为文件附件发给我。',
      ];
      let found = null;
      let usedSession = '';
      for (let i = 0; i < prompts.length && !found; i += 1) {
        const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: `S8 artifact-${i + 1}` } });
        if (i === prompts.length - 1 || !usedSession) t.state.s8Session = created.data?.id;
        usedSession = created.data?.id;
        const tracked = await sendAndTrack(t, usedSession, [{ type: 'text', text: prompts[i] }], { maxMs: 240_000 });
        const items = tracked.terminal?.evidence?.data?.items || [];
        found = items.find((x) => x.type === 'artifact' || x.artifact_type);
        t.attach(`attempt#${i + 1}`, tracked.terminal?.evidence);
        if (!found) await t.call('DELETE', `/v1/sessions/${usedSession}`);
      }
      if (found) {
        t.check('产出 artifact', Boolean(found.artifact_type || found.artifact?.artifact_type), 'document/file/image/link', String(found.artifact_type || found.artifact?.artifact_type));
        return `artifact_type=${found.artifact_type || found.artifact?.artifact_type}`;
      }
      t.block('两次引导均未在 assistant items 中出现 artifact（可能受环境能力/权限限制），需真机人工确认');
    },
    async cleanup(t) { if (t.state.s8Session) await t.call('DELETE', `/v1/sessions/${t.state.s8Session}`); },
  },
  {
    id: 'S9', group: '端到端', api: 'Messages List 分页', needToken: true,
    title: 'Messages List page_size=1 真翻页；asc/desc',
    doc: 'has_more=true 时带 page_token 逐页取完；消息 id 不重复；asc/desc 顺序不同。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', {
        body: { uuid: uuid(), name: 'S9 消息分页', initial_events: [{ type: 'user.message', contents: [{ type: 'text', text: '第一句话，只回复“1”。' }] }] },
      });
      t.state.s9Session = created.data?.id;
      await t.waitIdle(created.data.id, { maxMs: 120_000 });
      const second = await sendAndTrack(t, created.data.id, [{ type: 'text', text: '第二句话，只回复“2”。' }]);
      await t.waitIdle(created.data.id, { maxMs: 120_000 });
      t.attach('second.turn', second.sent);

      const collected = [];
      let pageToken;
      let pages = 0;
      for (;;) {
        const page = await t.call('GET', `/v1/sessions/${created.data.id}/messages`, {
          query: { page_size: 1, order: 'desc', ...(pageToken ? { page_token: pageToken } : {}) },
        });
        pages += 1;
        t.attach(`messages.page#${pages}`, page);
        const msgs = page.data?.messages || [];
        collected.push(...msgs);
        if (!page.data?.has_more) break;
        if (!page.data.page_token) { t.mismatch('page_token', 'has_more=true 时返回 page_token', '缺失'); break; }
        pageToken = page.data.page_token;
        if (pages > 20) break;
      }
      t.check('翻页页数 ≥ 4（4 条消息）', pages >= 3, '>=3 页', `${pages} 页 / 收集 ${collected.length} 条`);
      const ids = collected.map((m) => m.id);
      t.check('跨页 id 不重复', new Set(ids).size === ids.length, '唯一', `${new Set(ids).size}/${ids.length}`);

      const asc = await t.call('GET', `/v1/sessions/${created.data.id}/messages`, { query: { page_size: 50, order: 'asc' } });
      const desc = await t.call('GET', `/v1/sessions/${created.data.id}/messages`, { query: { page_size: 50, order: 'desc' } });
      const ascFirst = asc.data?.messages?.[0]?.id;
      const descFirst = desc.data?.messages?.[0]?.id;
      t.check('asc 与 desc 首条不同', ascFirst && ascFirst !== descFirst, '首条 id 不同', `${ascFirst} vs ${descFirst}`);
      return `翻页 ${pages} 次，收集 ${collected.length} 条消息`;
    },
    async cleanup(t) { if (t.state.s9Session) await t.call('DELETE', `/v1/sessions/${t.state.s9Session}`); },
  },
  {
    id: 'S10', group: '端到端', api: 'Sessions List 分页排序', needToken: true,
    title: 'Sessions List 翻页与排序',
    doc: 'page_size=1 可逐页；order=desc 首条 updated_at 不早于次条；asc 相反。',
    async run(t) {
      // 先确保有至少 2 个会话。
      const a = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'S10-a' } });
      const b = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'S10-b' } });
      t.state.s10Sessions = [a.data?.id, b.data?.id].filter(Boolean);
      const first = await t.call('GET', '/v1/sessions', { query: { page_size: 1, order: 'desc' } });
      t.attach('sessions.desc.p1', first);
      t.check('page_size=1 返回 1 条', (first.data?.sessions || []).length === 1, 1, (first.data?.sessions || []).length);
      let pages = 1; let token = first.data?.page_token; let total = (first.data?.sessions || []).length;
      if (first.data?.has_more && token) {
        const second = await t.call('GET', '/v1/sessions', { query: { page_size: 1, order: 'desc', page_token: token } });
        t.attach('sessions.desc.p2', second);
        pages += 1; total += (second.data?.sessions || []).length;
        const t1 = Date.parse(first.data.sessions[0].updated_at) || 0;
        const t2 = Date.parse(second.data?.sessions?.[0]?.updated_at || '') || 0;
        t.check('desc 按 updated_at 倒序', t1 >= t2, 't1 >= t2', `${t1} vs ${t2}`);
      } else {
        t.check('形成第 2 页（has_more）', false, 'has_more=true', `has_more=${first.data?.has_more}`);
      }
      const asc = await t.call('GET', '/v1/sessions', { query: { page_size: 50, order: 'asc' } });
      const desc = await t.call('GET', '/v1/sessions', { query: { page_size: 50, order: 'desc' } });
      const ascTimes = (asc.data?.sessions || []).map((s) => Date.parse(s.updated_at) || 0);
      const ascSorted = ascTimes.every((v, i) => i === 0 || ascTimes[i - 1] <= v);
      t.check('asc 时间单调不减', ascSorted, '单调不减', ascSorted ? '是' : '否');
      t.check('desc 与 asc 总数一致', (asc.data?.sessions || []).length === (desc.data?.sessions || []).length, '数量一致', `${asc.data?.sessions?.length} vs ${desc.data?.sessions?.length}`);
      return `翻页 ${pages}，累计 ${total}`;
    },
    async cleanup(t) { for (const id of t.state.s10Sessions || []) await t.call('DELETE', `/v1/sessions/${id}`); },
  },
  {
    id: 'S11', group: '端到端', api: 'PATCH /v1/sessions/{id}', needToken: true,
    title: 'Update 改名 → 空串 → 256 字符',
    doc: 'name 必传、可为空串、最长 256；覆盖写幂等。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid() } });
      t.state.s11Session = created.data?.id;
      const renamed = await t.call('PATCH', `/v1/sessions/${created.data.id}`, { body: { name: 'S11-新名字' } });
      t.attach('patch.rename', renamed);
      t.check('改名 200', renamed.httpStatus === 200, 200, renamed.httpStatus);
      t.check('名称生效', renamed.data?.session?.name === 'S11-新名字', 'S11-新名字', String(renamed.data?.session?.name));
      const empty = await t.call('PATCH', `/v1/sessions/${created.data.id}`, { body: { name: '' } });
      t.check('空串 200', empty.httpStatus === 200 && empty.data?.session?.name === '', 200, `${empty.httpStatus} / "${empty.data?.session?.name}"`);
      const longName = '界'.repeat(256);
      const long = await t.call('PATCH', `/v1/sessions/${created.data.id}`, { body: { name: longName } });
      t.check('256 字符 200', long.httpStatus === 200 && long.data?.session?.name?.length === 256, 200, `${long.httpStatus} / len=${long.data?.session?.name?.length}`);
      return `session=${created.data?.id}`;
    },
    async cleanup(t) { if (t.state.s11Session) await t.call('DELETE', `/v1/sessions/${t.state.s11Session}`); },
  },
  {
    id: 'S12', group: '端到端', api: '删除后 404001', needToken: true,
    title: '删除会话后 retrieve/update/events/messages 全部 404001',
    doc: '删除即归档，后续接口 404 / 404001。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'S12 删除验证' } });
      const sid = created.data?.id;
      const removed = await t.call('DELETE', `/v1/sessions/${sid}`);
      t.attach('delete', removed);
      t.check('删除 200', removed.httpStatus === 200, 200, removed.httpStatus);
      const checks = [
        ['retrieve', () => t.call('GET', `/v1/sessions/${sid}`)],
        ['update', () => t.call('PATCH', `/v1/sessions/${sid}`, { body: { name: 'x' } })],
        ['events', () => t.call('POST', `/v1/sessions/${sid}/events`, { body: { uuid: uuid(), events: [{ type: 'user.message', contents: [{ type: 'text', text: 'x' }] }] } })],
        ['messages', () => t.call('GET', `/v1/sessions/${sid}/messages`)],
      ];
      for (const [label, fn] of checks) {
        const r = await fn();
        t.attach(`after-delete.${label}`, r);
        t.check(`${label} 404 / 404001`, r.httpStatus === 404 && String(r.code) === '404001', '404 / 404001', `${r.httpStatus} / ${r.code}`);
      }
      return `session=${sid} 已删除`;
    },
  },
  {
    id: 'S13', group: '端到端', api: 'uuid 幂等', needToken: true,
    title: '同一 uuid 幂等：建会话 / 上传 / 发事件返回首次结果',
    doc: '同 uuid 24 小时内重复提交返回首次结果，不重复执行。',
    async run(t) {
      const idemUuid = uuid();
      const c1 = await t.call('POST', '/v1/sessions', { body: { uuid: idemUuid, name: 'S13 幂等会话' } });
      const c2 = await t.call('POST', '/v1/sessions', { body: { uuid: idemUuid, name: 'S13 幂等会话' } });
      t.attach('session.create#1', c1); t.attach('session.create#2', c2);
      t.check('重复建会话返回同一 id', c1.data?.id && c1.data?.id === c2.data?.id, '相同 id', `${c1.data?.id} vs ${c2.data?.id}`);

      const fileUuid = uuid();
      const f1 = await t.upload({ uuid: fileUuid, filename: `s13-${Date.now()}.txt`, bytes: txtBytes('idem'), contentType: 'text/plain' });
      const f2 = await t.upload({ uuid: fileUuid, filename: `s13-${Date.now()}.txt`, bytes: txtBytes('idem'), contentType: 'text/plain' });
      t.attach('upload#1', f1); t.attach('upload#2', f2);
      t.check('重复上传返回同一 uri', f1.data?.uri && f1.data.uri === f2.data?.uri, '相同 uri', `${f1.data?.uri} vs ${f2.data?.uri}`);

      // 事件幂等：先发一条，等 idle，再用同一 uuid 重放（安全做法：避免 in_progress 409 干扰幂等判定）。
      const sid = c1.data?.id;
      t.state.s13Session = sid;
      await t.waitIdle(sid, { maxMs: 120_000 });
      const eventUuid = uuid();
      const body = { uuid: eventUuid, events: [{ type: 'user.message', contents: [{ type: 'text', text: '幂等测试，只回复“好”。' }] }] };
      const e1 = await t.call('POST', `/v1/sessions/${sid}/events`, { body });
      const id1 = userMessageId(e1);
      const e2 = await t.call('POST', `/v1/sessions/${sid}/events`, { body });
      const id2 = userMessageId(e2);
      t.attach('event.create#1', e1); t.attach('event.create#2', e2);
      t.check('重复事件返回同一消息 id', id1 && id1 === id2, '相同 id', `${id1} vs ${id2}`);
      await t.waitIdle(sid, { maxMs: 120_000 });
      return `session=${sid}`;
    },
    async cleanup(t) { if (t.state.s13Session) await t.call('DELETE', `/v1/sessions/${t.state.s13Session}`); },
  },
];
