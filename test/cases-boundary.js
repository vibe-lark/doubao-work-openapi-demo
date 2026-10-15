// 边界矩阵 B1–B28：鉴权、参数校验、分页、不存在资源、并发、文件、暂缓接口。
// 无 token 时仅 B1/B2 真实执行；其余需要登录的用例标记 SKIPPED（不计失败）。
import { blobBytes, emptyBytes, txtBytes } from './fixtures.js';

const uuid = () => globalThis.crypto.randomUUID();
const NOT_FOUND_ID = `not-found-${Date.now()}`;

export const BOUNDARY_CASES = [
  {
    id: 'B1', group: '鉴权', api: 'GET /v1/sessions', needToken: false,
    title: '无 token 调用业务接口',
    doc: '文档错误码表：HTTP 401 / 401001。真实网关码以实测为准（已知曾返回 99991668/99991661）。',
    async run(t) {
      const r = await t.call('GET', '/v1/sessions', { query: { page_size: 1 }, authOverride: null });
      t.attach('no-token', r);
      t.check('返回 401 类 HTTP', r.httpStatus === 401 || r.httpStatus === 400 || r.httpStatus === 403, '401/403/400', String(r.httpStatus));
      if (String(r.code) === '401001') t.check('业务 code=401001', true, '401001', String(r.code));
      else t.mismatch('业务 code 与文档不符', '401001', String(r.code) ? `${r.code}（${r.msg.slice(0, 120)}）` : `非 JSON（HTTP ${r.httpStatus}）`);
      return `HTTP ${r.httpStatus} / code ${r.code} / ${r.msg.slice(0, 100)}`;
    },
  },
  {
    id: 'B2', group: '鉴权', api: 'GET /v1/sessions', needToken: false,
    title: '伪造 token 调用业务接口',
    doc: '文档：HTTP 401 / 401001；真实网关码以实测为准。',
    async run(t) {
      const r = await t.call('GET', '/v1/sessions', { query: { page_size: 1 }, authOverride: 'Bearer forged-token-for-boundary-test' });
      t.attach('forged-token', r);
      t.check('返回 401 类 HTTP', r.httpStatus === 401 || r.httpStatus === 400 || r.httpStatus === 403, '401/403/400', String(r.httpStatus));
      if (String(r.code) === '401001') t.check('业务 code=401001', true, '401001', String(r.code));
      else t.mismatch('业务 code 与文档不符', '401001', String(r.code) ? `${r.code}（${r.msg.slice(0, 120)}）` : `非 JSON（HTTP ${r.httpStatus}）`);
      return `HTTP ${r.httpStatus} / code ${r.code} / ${r.msg.slice(0, 100)}`;
    },
  },
  {
    id: 'B3', group: '会话创建', api: 'POST /v1/sessions', needToken: true,
    title: '创建会话缺 uuid',
    doc: 'uuid 必填，缺失返回 400 / 400001。',
    async run(t) {
      const r = await t.call('POST', '/v1/sessions', { body: { name: 'B3 无 uuid' } });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B4', group: '会话创建', api: 'POST /v1/sessions', needToken: true,
    title: 'initial_events 两条',
    doc: 'initial_events 最多一条，多条 400 / 400001。',
    async run(t) {
      const r = await t.call('POST', '/v1/sessions', {
        body: {
          uuid: uuid(),
          initial_events: [
            { type: 'user.message', contents: [{ type: 'text', text: '第一条' }] },
            { type: 'user.message', contents: [{ type: 'text', text: '第二条' }] },
          ],
        },
      });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B5', group: '会话创建', api: 'POST /v1/sessions', needToken: true,
    title: 'initial_events 放 interrupt',
    doc: '首条事件只能是 user.message，user.interrupt 返回 400 / 400001。',
    async run(t) {
      const r = await t.call('POST', '/v1/sessions', {
        body: { uuid: uuid(), initial_events: [{ type: 'user.interrupt' }] },
      });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B6', group: '事件参数', api: 'POST /v1/events', needToken: true,
    title: 'contents 空数组',
    doc: 'contents 必填且不能为空数组，400 / 400001。',
    async run(t) {
      const r = await t.call('POST', `/v1/sessions/${NOT_FOUND_ID}/events`, {
        body: { uuid: uuid(), events: [{ type: 'user.message', contents: [] }] },
      });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B7', group: '事件参数', api: 'POST /v1/events', needToken: true,
    title: '纯空白文本',
    doc: '至少一段非空白文本或一个 file，纯空白 400 / 400001。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'B7' } });
      t.state.b7 = created.data?.id;
      const r = await t.call('POST', `/v1/sessions/${created.data?.id || NOT_FOUND_ID}/events`, {
        body: { uuid: uuid(), events: [{ type: 'user.message', contents: [{ type: 'text', text: '   \n\t  ' }] }] },
      });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
    async cleanup(t) { if (t.state.b7) await t.call('DELETE', `/v1/sessions/${t.state.b7}`); },
  },
  {
    id: 'B8', group: '事件参数', api: 'POST /v1/events', needToken: true,
    title: 'file 块缺 uri',
    doc: 'file 必须带 uri，缺失 400 / 400001。',
    async run(t) {
      const r = await t.call('POST', `/v1/sessions/${NOT_FOUND_ID}/events`, {
        body: { uuid: uuid(), events: [{ type: 'user.message', contents: [{ type: 'file', name: 'x.png' }] }] },
      });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B9', group: '事件参数', api: 'POST /v1/events', needToken: true,
    title: 'user.message 携带 message_id',
    doc: 'user.message 不接受 message_id，400 / 400001。',
    async run(t) {
      const r = await t.call('POST', `/v1/sessions/${NOT_FOUND_ID}/events`, {
        body: { uuid: uuid(), events: [{ type: 'user.message', message_id: '7442600000000000099', contents: [{ type: 'text', text: 'x' }] }] },
      });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B10', group: '事件参数', api: 'POST /v1/events', needToken: true,
    title: 'user.interrupt 携带 contents',
    doc: 'interrupt 不能带 contents，400 / 400001。',
    async run(t) {
      const r = await t.call('POST', `/v1/sessions/${NOT_FOUND_ID}/events`, {
        body: { uuid: uuid(), events: [{ type: 'user.interrupt', contents: [] }] },
      });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B11', group: '更新边界', api: 'PATCH /v1/sessions/{id}', needToken: true,
    title: 'PATCH 缺 name',
    doc: 'name 必须显式传入，缺失 400 / 400001。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid() } });
      t.state.b11 = created.data?.id;
      const r = await t.call('PATCH', `/v1/sessions/${created.data?.id || NOT_FOUND_ID}`, { body: {} });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
    async cleanup(t) { if (t.state.b11) await t.call('DELETE', `/v1/sessions/${t.state.b11}`); },
  },
  {
    id: 'B12', group: '更新边界', api: 'PATCH /v1/sessions/{id}', needToken: true,
    title: 'PATCH name 257 字符',
    doc: 'name 最长 256，257 字符 400 / 400001。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid() } });
      t.state.b12 = created.data?.id;
      const r = await t.call('PATCH', `/v1/sessions/${created.data?.id || NOT_FOUND_ID}`, { body: { name: '界'.repeat(257) } });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
    async cleanup(t) { if (t.state.b12) await t.call('DELETE', `/v1/sessions/${t.state.b12}`); },
  },
  {
    id: 'B13', group: '分页', api: 'GET /v1/sessions', needToken: true,
    title: 'page_size=0',
    doc: 'page_size 范围 1–100，0 返回 400 / 400001。',
    async run(t) {
      const r = await t.call('GET', '/v1/sessions', { query: { page_size: 0 } });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B14', group: '分页', api: 'GET /v1/sessions', needToken: true,
    title: 'page_size=101',
    doc: 'page_size 上限 100，101 返回 400 / 400001。',
    async run(t) {
      const r = await t.call('GET', '/v1/sessions', { query: { page_size: 101 } });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B15', group: '分页', api: 'GET /v1/sessions', needToken: true,
    title: 'page_size 非数字',
    doc: '非数字返回 400 / 400001。',
    async run(t) {
      const r = await t.call('GET', '/v1/sessions?page_size=abc', {});
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B16', group: '分页', api: 'GET /v1/sessions', needToken: true,
    title: 'page_size=1 成功',
    doc: '下界 1 合法，200 且返回至多 1 条。',
    async run(t) {
      const r = await t.call('GET', '/v1/sessions', { query: { page_size: 1 } });
      t.attach('body', r);
      t.check('200', r.httpStatus === 200, 200, r.httpStatus);
      t.check('返回 <=1 条', (r.data?.sessions || []).length <= 1, '<=1', (r.data?.sessions || []).length);
    },
  },
  {
    id: 'B17', group: '分页', api: 'GET /v1/sessions', needToken: true,
    title: 'page_size=100 成功',
    doc: '上界 100 合法，200。',
    async run(t) {
      const r = await t.call('GET', '/v1/sessions', { query: { page_size: 100 } });
      t.attach('body', r);
      t.check('200', r.httpStatus === 200, 200, r.httpStatus);
      t.check('返回 <=100 条', (r.data?.sessions || []).length <= 100, '<=100', (r.data?.sessions || []).length);
    },
  },
  {
    id: 'B18', group: '分页', api: 'page_token + order', needToken: true,
    title: '翻页带 page_token 却改 order',
    doc: 'page_token 隐含排序，翻页时 order 必须一致，否则 400 / 400001。',
    async run(t) {
      const first = await t.call('GET', '/v1/sessions', { query: { page_size: 1, order: 'desc' } });
      t.attach('first', first);
      if (!first.data?.has_more || !first.data?.page_token) {
        t.block('当前会话数不足以形成第 2 页，无法验证 order 一致性（可先创建更多会话后重跑）');
        return;
      }
      const r = await t.call('GET', '/v1/sessions', { query: { page_size: 1, order: 'asc', page_token: first.data.page_token } });
      t.attach('changed-order', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B19', group: '分页', api: 'page_token 非法', needToken: true,
    title: '非法 page_token',
    doc: 'page_token 非法或过期返回 400 / 400001。',
    async run(t) {
      const r = await t.call('GET', '/v1/sessions', { query: { page_size: 1, page_token: '%%%not-a-valid-token%%%' } });
      t.attach('body', r);
      t.check('400 / 400001', r.httpStatus === 400 && String(r.code) === '400001', '400 / 400001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B20', group: '不存在', api: 'GET /v1/sessions/{id}', needToken: true,
    title: '不存在的 session',
    doc: '404 / 404001。',
    async run(t) {
      const r = await t.call('GET', `/v1/sessions/${NOT_FOUND_ID}`);
      t.attach('body', r);
      t.check('404 / 404001', r.httpStatus === 404 && String(r.code) === '404001', '404 / 404001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B21', group: '不存在', api: 'GET .../messages/{id}', needToken: true,
    title: '不存在的 message',
    doc: '文档预期 404；记录实际业务 code。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid() } });
      t.state.b21 = created.data?.id;
      const r = await t.call('GET', `/v1/sessions/${created.data?.id || NOT_FOUND_ID}/messages/7442600000000000099`);
      t.attach('body', r);
      t.check('HTTP 404', r.httpStatus === 404, 404, r.httpStatus);
      if (String(r.code) === '404001') t.check('业务 code=404001', true, '404001', String(r.code));
      else t.mismatch('业务 code', '404001（文档示例）', String(r.code) || '(无 code)');
    },
    async cleanup(t) { if (t.state.b21) await t.call('DELETE', `/v1/sessions/${t.state.b21}`); },
  },
  {
    id: 'B22', group: '并发', api: 'in_progress 连发两条', needToken: true,
    title: 'in_progress 连发两条 user.message',
    doc: '第二条期望 409 / 409001。依赖真实生成窗口，抢不到窗口标 BLOCKED。',
    async run(t) {
      const prompt = '请写一篇非常长的文章，至少 6000 字，题目是《论水循环》，分八章详细展开，不要省略。';
      let caught = null;
      let sid = '';
      for (let attempt = 0; attempt < 3 && !caught; attempt += 1) {
        const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: `B22-${attempt + 1}` } });
        sid = created.data?.id;
        const first = await t.call('POST', `/v1/sessions/${sid}/events`, {
          body: { uuid: uuid(), events: [{ type: 'user.message', contents: [{ type: 'text', text: prompt }] }] },
        });
        // 立刻连发第二条（不等待）。
        const second = await t.call('POST', `/v1/sessions/${sid}/events`, {
          body: { uuid: uuid(), events: [{ type: 'user.message', contents: [{ type: 'text', text: '再说一句' }] }] },
        });
        t.attach(`first#${attempt + 1}`, first);
        t.attach(`second#${attempt + 1}`, second);
        if (second.httpStatus === 409 || String(second.code) === '409001') caught = second;
        await t.waitIdle(sid, { maxMs: 180_000 });
      }
      t.state.b22 = sid;
      if (caught) {
        t.check('第二条 409 / 409001', caught.httpStatus === 409 && String(caught.code) === '409001', '409 / 409001', `${caught.httpStatus} / ${caught.code}`);
      } else {
        t.block('三次尝试均未在 in_progress 窗口内抢到并发（第二条被受理或会话已 idle），需更长任务/人工复现');
      }
    },
    async cleanup(t) { if (t.state.b22) await t.call('DELETE', `/v1/sessions/${t.state.b22}`); },
  },
  {
    id: 'B23', group: '文件', api: 'POST /v1/files（空文件）', needToken: true,
    title: '空文件上传',
    doc: '不允许空文件，400 / 400004。',
    async run(t) {
      const r = await t.upload({ uuid: uuid(), filename: `empty-${Date.now()}.txt`, bytes: emptyBytes(), contentType: 'text/plain' });
      t.attach('body', r);
      t.check('400 / 400004', r.httpStatus === 400 && String(r.code) === '400004', '400 / 400004', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B24', group: '文件', api: 'POST /v1/files（坏扩展名）', needToken: true,
    title: '不支持的扩展名',
    doc: '扩展名白名单外返回 400 / 400002。',
    async run(t) {
      const r = await t.upload({ uuid: uuid(), filename: `bad-${Date.now()}.exe`, bytes: txtBytes('not executable'), contentType: 'application/octet-stream' });
      t.attach('body', r);
      t.check('400 / 400002', r.httpStatus === 400 && String(r.code) === '400002', '400 / 400002', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B25', group: '文件', api: 'POST /v1/files（>20MB 图片）', needToken: true,
    title: '21MB 伪图片超过图片上限',
    doc: '图片不超过 20MB，超限 413 / 413001。大文件本地即时生成（约 21MB 上行）。',
    async run(t) {
      // 保留 PNG 魔数头，尾部用伪随机字节填充到 21MB。
      const head = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
      const tail = blobBytes(21 * 1024 * 1024 - head.length);
      const bytes = Buffer.concat([head, tail]);
      const r = await t.upload({ uuid: uuid(), filename: `huge-${Date.now()}.png`, bytes, contentType: 'image/png', timeoutMs: 180_000 });
      t.attach('body', { ...r, request: { ...r.request, body: { ...r.request.body, size: bytes.length } } });
      t.check('413 / 413001', r.httpStatus === 413 && String(r.code) === '413001', '413 / 413001', `${r.httpStatus} / ${r.code} / ${r.msg.slice(0, 100)}`);
      if (r.httpStatus !== 413 && r.httpStatus > 0) t.mismatch('超限文件响应', '413 / 413001', `${r.httpStatus} / ${r.code}`);
    },
  },
  {
    id: 'B26', group: '文件', api: 'POST /v1/files（>100MB 文件）', needToken: true,
    title: '101MB 伪文件超过普通文件上限（需显式开启）',
    doc: '其它文件不超过 100MB，超限 413 / 413001。默认跳过（101MB 上行成本），RUN_LARGE_FILES=1 时执行。',
    skip() { return process.env.RUN_LARGE_FILES === '1' ? '' : '设置 RUN_LARGE_FILES=1 以执行 101MB 上传用例（默认跳过以节省带宽）'; },
    async run(t) {
      const bytes = blobBytes(101 * 1024 * 1024);
      const r = await t.upload({ uuid: uuid(), filename: `huge-${Date.now()}.txt`, bytes, contentType: 'text/plain', timeoutMs: 600_000 });
      t.attach('body', { ...r, request: { ...r.request, body: { multipart: true, size: bytes.length } } });
      t.check('413 / 413001', r.httpStatus === 413 && String(r.code) === '413001', '413 / 413001', `${r.httpStatus} / ${r.code} / ${r.msg.slice(0, 100)}`);
    },
  },
  {
    id: 'B27', group: '暂缓接口', api: 'GET /v1/sessions/{id}/events', needToken: true,
    title: '会话级 Stream 真实探测（文档标[暂缓]）',
    doc: '不预设结果，记录真实 HTTP 状态、content-type 与前若干帧。',
    async run(t) {
      const created = await t.call('POST', '/v1/sessions', { body: { uuid: uuid(), name: 'B27 stream probe' } });
      t.state.b27 = created.data?.id;
      const r = await t.stream(`/v1/sessions/${created.data.id}/events`, { maxMs: 4000, shouldStop: false });
      t.attach('session-stream', r);
      t.check('获得明确 HTTP 响应', r.httpStatus > 0, 'HTTP 状态 > 0', String(r.httpStatus));
      if (r.connected) {
        t.check('content-type 为 event-stream', true, 'text/event-stream', `帧 ${r.frames.length} 个，stop=${r.stopReason}`);
      } else {
        t.mismatch('暂缓接口真实行为', '200 text/event-stream（若已开放）', `HTTP ${r.httpStatus} / ${r.code} / ${r.msg.slice(0, 120)}`);
      }
      return `HTTP ${r.httpStatus}，connected=${r.connected}，帧 ${r.frames.length}`;
    },
    async cleanup(t) { if (t.state.b27) await t.call('DELETE', `/v1/sessions/${t.state.b27}`); },
  },
  {
    id: 'B28', group: '限流', api: '429001', needToken: false,
    title: '429 限流（受控不运行）',
    doc: '文档定义 429 / 429001；按安全约束不主动压测，仅记录文档边界。自然触发时在真机运行中登记。',
    skip: () => '受控不运行：429001 仅记录文档定义，不进行任何压测',
    async run() { /* 不发请求 */ },
  },
];
