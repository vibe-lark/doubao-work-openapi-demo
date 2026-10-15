// 独立 Node 版对话 Playground：
//   · MessageStream 用浏览器原生 EventSource 建立「浏览器 → Node → 豆包」持久 SSE 管道，边收边渲染；
//   · 浏览器断线自动重连并由浏览器原生携带 Last-Event-ID，上游按 seq 补发；
//   · messagesRetrieve 每 1.8 秒兜底校准终态与落库 item；
//   · 会话级 Stream 文档标注[暂缓]，只做一次有界真实探测并记录 HTTP 与响应。
import { useEffect, useRef, useState } from 'react';
import { uuid } from '@/lib/id';
import { Ban, ChevronDown, History, Radio, RefreshCw, Send } from 'lucide-react';
import {
  eventsCreate, failText, isOk, messagesList, messagesRetrieve, openMessageStream, sessionStreamProbe, sessionsList,
} from '@api/doubao';
import type { Evidence } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, ErrorBox, EvidencePanel, errText, StatusTag } from './common';
import { toast } from 'sonner';
import { Conversation, RawFrames, type ChatEntry, type StreamFrame } from './ChatParts';
import { isTerminal, mergeFrames, mergeRetrieve, retrieveSnapshot, type TrackingMode } from '@/lib/playground-message';

function records(e: Evidence | null, key: string) {
  const p = ((e?.data || {}) as Record<string, unknown>);
  const v = p[key] || p.items;
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}
function deepId(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const o = value as Record<string, unknown>;
  for (const k of ['message_id', 'messageId', 'id']) if (typeof o[k] === 'string') return String(o[k]);
  for (const k of ['query', 'message', 'data', 'event']) {
    const found = deepId(o[k]);
    if (found) return found;
  }
  return '';
}
// events.create 返回 { messages:[{ id, role:'user', … }] }：取用户 query 消息 id 作为续取锚点。
function queryIdOf(value: unknown): string {
  const list = (value && typeof value === 'object' ? (value as Record<string, unknown>).messages : null);
  if (Array.isArray(list)) {
    const rows = list.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object');
    const user = rows.find((m) => m.role === 'user') ?? rows[0];
    if (user && typeof user.id === 'string') return user.id;
  }
  return deepId(value);
}
// 上游在流内用 BaseResp 返回参数错误（例如 message_id 未指向 query 消息）。
function baseRespError(parsed?: Record<string, unknown>) {
  const base = parsed?.BaseResp as Record<string, unknown> | undefined;
  if (!base || !base.StatusCode) return '';
  return `${String(base.StatusMessage || '流请求被拒绝')}（${String(base.StatusCode)}）`;
}
function toStreamFrame(f: { event: string; data: string; id?: string }, index: number): StreamFrame {
  let parsed: Record<string, unknown> | undefined;
  try {
    const value = JSON.parse(f.data);
    if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
  } catch { /* 非 JSON 帧 */ }
  const tail = f.id ? Number(f.id.split(':').at(-1)) : NaN;
  const seq = Number.isFinite(Number(parsed?.seq)) ? Number(parsed?.seq) : Number.isFinite(tail) ? tail : index;
  return { event: f.event, data: f.data, id: f.id, at: new Date().toISOString(), seq, parsed };
}
function frameIsTerminal(f: StreamFrame) {
  const name = (f.event || String(f.parsed?.type || '')).toLowerCase();
  const status = String(f.parsed?.status || f.parsed?.state || '').toLowerCase();
  return name.includes('message.completed') || name.includes('message.failed') || name.includes('message.cancelled')
    || (isTerminal(status) && name.startsWith('message.'));
}
function withTrackingMode(current: ChatEntry[], id: string, trackingMode: TrackingMode) {
  return current.map((entry) => (entry.id === `assistant-${id}` && !isTerminal(entry.status || '') ? { ...entry, trackingMode } : entry));
}

export function PlaygroundPage({ initialUri, onUriUsed }: { initialUri: string; onUriUsed: () => void }) {
  const [sessionId, setSessionId] = useState('');
  const [messageId, setMessageId] = useState('');
  const [text, setText] = useState('');
  const [uris, setUris] = useState<string[]>(initialUri ? [initialUri] : []);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [streamState, setStreamState] = useState<'idle' | 'open' | 'retry'>('idle');
  const [sessionsEv, setSessionsEv] = useState<Evidence | null>(null);
  const [historyEv, setHistoryEv] = useState<Evidence | null>(null);
  const [last, setLast] = useState<Evidence | null>(null);
  const [frames, setFrames] = useState<StreamFrame[]>([]);
  const [lastEventId, setLastEventId] = useState('');
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const epochRef = useRef(0);
  const sourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const [activeQuery, setActiveQuery] = useState('');

  useEffect(() => {
    if (initialUri) {
      setUris((u) => (u.includes(initialUri) ? u : [...u, initialUri]));
      onUriUsed();
    }
  }, [initialUri]);

  function teardownStream() {
    if (sourceRef.current) { try { sourceRef.current.close(); } catch { /* ignore */ } sourceRef.current = null; }
    if (pollTimerRef.current !== null) { window.clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }
  useEffect(() => () => { epochRef.current += 1; teardownStream(); }, []);
  useEffect(() => {
    epochRef.current += 1;
    teardownStream();
    setActiveQuery('');
    setFrames([]); setLastEventId(''); setEntries([]); setStreamState('idle'); setError('');
  }, [sessionId]);

  async function loadSessions() {
    setBusy('sessions');
    try {
      const r = await sessionsList({ data: { query: { page_size: 20, order: 'desc' } } });
      setSessionsEv(r);
      if (!isOk(r)) { setError(failText(r, '会话列表读取失败')); setLast(r); }
    } catch (e) {
      setError(errText(e));
      toast.error('会话加载失败，请重试', { duration: 8000 });
    } finally { setBusy(''); }
  }
  useEffect(() => { void loadSessions(); }, []);

  // 跟踪一条回复：持久 EventSource + 1.8s retrieve 轮询兜底。
  function track(queryId: string) {
    const run = ++epochRef.current;
    teardownStream();
    setActiveQuery(queryId);
    setStreamState('open');
    setError('');
    setEntries((old) => withTrackingMode(old, queryId, 'waiting'));
    let frameIndex = 0;
    let terminalSeen = false;

    const finish = async () => {
      if (terminalSeen) return;
      terminalSeen = true;
      teardownStream();
      if (run === epochRef.current) { setStreamState('idle'); setActiveQuery(''); }
      try {
        const r = await messagesRetrieve({ data: { sessionId, messageId: queryId } });
        if (run === epochRef.current) {
          setLast(r);
          setEntries((old) => mergeRetrieve(old, queryId, r).entries);
        }
      } catch { /* 终态校准失败不掩盖已收帧 */ }
    };

    const poll = async () => {
      if (run !== epochRef.current || terminalSeen) return;
      try {
        const r = await messagesRetrieve({ data: { sessionId, messageId: queryId } });
        if (run !== epochRef.current) return;
        setLast(r);
        if (r.httpStatus >= 400 || r.httpStatus === 0) return;
        const snapshot = retrieveSnapshot(r);
        setEntries((old) => withTrackingMode(mergeRetrieve(old, queryId, r).entries, queryId, 'poll'));
        if (isTerminal(snapshot.status)) void finish();
      } catch {
        setEntries((old) => withTrackingMode(old, queryId, 'poll'));
      }
    };
    void poll();
    pollTimerRef.current = window.setInterval(() => void poll(), 1800);

    const source = openMessageStream(sessionId, queryId, {
      onOpen: () => { if (run === epochRef.current) setStreamState('open'); },
      onFrame: (f) => {
        if (run !== epochRef.current || terminalSeen) return;
        const frame = toStreamFrame(f, frameIndex++);
        const rejected = baseRespError(frame.parsed);
        if (rejected) {
          // 流被上游拒绝：关闭 EventSource 防止无限重连，继续靠 retrieve 轮询兜底。
          if (sourceRef.current) { sourceRef.current.close(); sourceRef.current = null; }
          setFrames((old) => [...old, frame]);
          setStreamState('retry');
          setError(`MessageStream 被拒绝：${rejected}`);
          return;
        }
        setEntries((old) => withTrackingMode(old, queryId, 'stream'));
        setFrames((old) => {
          const key = `${frame.id || ''}|${frame.seq}|${frame.event}`;
          if (old.some((x) => `${x.id || ''}|${x.seq}|${x.event}` === key)) return old;
          return [...old, frame];
        });
        if (frame.id) setLastEventId(frame.id);
        setEntries((old) => mergeFrames(old, queryId, [frame]).entries);
        if (frameIsTerminal(frame)) void finish();
      },
      onError: () => {
        // EventSource 会自动重连（原生携带 Last-Event-ID）；readyState=CLOSED 时彻底失败，靠轮询兜底。
        if (run !== epochRef.current) return;
        if (source.readyState === EventSource.CLOSED && !terminalSeen) {
          setStreamState('retry');
          toast.info('SSE 连接关闭，使用轮询继续跟踪', { duration: 6000 });
        } else {
          setStreamState('retry');
        }
      },
    });
    sourceRef.current = source;
  }

  async function send() {
    const contents: Record<string, unknown>[] = [];
    if (text.trim()) contents.push({ type: 'text', text: text.trim() });
    uris.forEach((uri) => contents.push({ type: 'file', uri }));
    if (!sessionId) { setError('请先选择会话。'); return; }
    if (!contents.length) { setError('至少输入一段非空白文本或添加一个已上传文件 uri。'); return; }
    setBusy('send'); setError('');
    try {
      const sent = text.trim();
      const r = await eventsCreate({ data: { sessionId, body: { uuid: uuid(), events: [{ type: 'user.message', contents }] } } });
      setLast(r);
      if (!isOk(r)) throw new Error(failText(r, '发送失败'));
      const id = queryIdOf(r.data);
      if (!id) throw new Error('响应中未找到 query 用户消息 id，无法开始续取');
      setMessageId(id);
      setEntries((old) => [
        ...old,
        { id: `user-${id}`, role: 'user', text: sent || `发送了 ${uris.length} 个附件` },
        { id: `assistant-${id}`, role: 'assistant', parts: [], status: 'in_progress' },
      ]);
      setText('');
      toast.success('已发送，持久 SSE 实时接收');
      track(id);
    } catch (e) {
      setError(errText(e));
      toast.error('发送失败，输入内容已保留', { duration: 10000 });
    } finally { setBusy(''); }
  }

  async function interrupt() {
    if (!sessionId) return;
    setBusy('interrupt');
    try {
      // user.interrupt 作用于会话当前生成；上游不接受 message_id（携带会返回 3440001 param is invalid）。
      const body: Record<string, unknown> = { uuid: uuid(), events: [{ type: 'user.interrupt' }] };
      const r = await eventsCreate({ data: { sessionId, body } });
      setLast(r);
      if (!isOk(r)) throw new Error(failText(r, '停止请求未受理'));
      toast.success('停止请求已受理，继续跟踪至 cancelled');
      if (messageId && !activeQuery) track(messageId);
    } catch (e) {
      setError(errText(e));
    } finally { setBusy(''); }
  }

  async function probe() {
    if (!sessionId) return;
    setBusy('probe');
    try {
      const r = await sessionStreamProbe({ data: { sessionId, limitMs: 5000 } });
      setLast(r);
      toast.info(`会话级 Stream 探测：${r.httpStatus ? `HTTP ${r.httpStatus}` : '未送达'}${r.msg ? ` · ${r.msg.slice(0, 60)}` : ''}`, { duration: 6000 });
    }
    catch (e) { setError(errText(e)); }
    finally { setBusy(''); }
  }

  async function history() {
    if (!sessionId) return;
    setBusy('history');
    try {
      const r = await messagesList({ data: { sessionId, query: { page_size: 50 } } });
      setHistoryEv(r);
      if (!isOk(r)) { setLast(r); setError(failText(r, '消息历史读取失败')); }
    }
    catch (e) { setError(errText(e)); }
    finally { setBusy(''); }
  }

  const sessions = records(sessionsEv, 'sessions');
  const messages = records(historyEv, 'messages');

  return <div className="page-stack">
    <header className="page-title">
      <div>
        <span className="eyebrow"><Radio />持久 SSE · 边收边渲染</span>
        <h1>对话 Playground</h1>
        <p>浏览器原生 EventSource 建立持久流，断线由浏览器自动携带 Last-Event-ID 重连；messages.retrieve 每 1.8 秒兜底校准。</p>
      </div>
      <Button variant="outline" onClick={loadSessions} disabled={!!busy}><RefreshCw />刷新会话</Button>
    </header>
    {error && <ErrorBox message={error} />}
    <div className="play-grid">
      <aside className="panel session-rail">
        <h2>会话</h2>
        <Label htmlFor="play-session">会话 ID <span className="required">*</span></Label>
        <Input id="play-session" value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="选择或粘贴 session_id" />
        <div className="mini-list">
          {sessions.map((s, i) => (
            <button className={sessionId === String(s.id) ? 'selected' : ''} key={String(s.id || i)} onClick={() => setSessionId(String(s.id || ''))}>
              <span><b>{String(s.name || '未命名')}</b><code>{String(s.id || '')}</code></span>
              <StatusTag tone="info">{String(s.status || '未知')}</StatusTag>
            </button>
          ))}
        </div>
      </aside>

      <section className="panel conversation">
        <div className="conversation-head">
          <div>
            <h2>消息</h2>
            <span className="live-note">
              <span style={{ background: streamState === 'open' ? 'var(--success)' : streamState === 'retry' ? 'var(--warning)' : 'var(--muted-text)' }} />
              {streamState === 'open' ? 'SSE 持久连接已建立' : streamState === 'retry' ? 'SSE 重连中 / 轮询兜底' : '空闲'}
            </span>
          </div>
          {activeQuery && <Button className="danger-outline" variant="outline" onClick={interrupt} disabled={busy === 'interrupt'}><Ban />{busy === 'interrupt' ? '停止中…' : '停止生成'}</Button>}
        </div>
        <Conversation entries={entries} />
        <RawFrames frames={frames} lastEventId={lastEventId} />
        <div className="composer">
          <Label htmlFor="chat-text">消息文本</Label>
          <Textarea id="chat-text" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send(); }}
            placeholder="输入消息，Ctrl/⌘ + Enter 发送" />
          {uris.length > 0 && <div className="uri-list">{uris.map((u) => <code key={u}>{u}</code>)}</div>}
          <div className="composer-actions">
            <button className="text-button" onClick={() => setAdvanced(!advanced)}><ChevronDown className={advanced ? 'rotate-180' : ''} />高级选项</button>
            <Button className="primary-action" disabled={!sessionId || !!busy} onClick={() => void send()}><Send />{busy === 'send' ? '发送中…' : '发送消息'}</Button>
          </div>
          {advanced && (
            <div className="advanced-row">
              <div>
                <Label htmlFor="message-id">query 消息 id（续取）</Label>
                <Input id="message-id" value={messageId} onChange={(e) => setMessageId(e.target.value)} />
              </div>
              <Button variant="outline" disabled={!sessionId || !messageId || !!busy} onClick={() => track(messageId)}>从此回复续取</Button>
              <Button className="danger-outline" variant="outline" disabled={!sessionId || !!busy} onClick={interrupt}><Ban />停止会话当前生成</Button>
            </div>
          )}
        </div>
      </section>

      <aside className="panel history-panel">
        <div className="section-head">
          <h2><History />消息历史</h2>
          <Button variant="ghost" onClick={history} disabled={!sessionId || !!busy}>{busy === 'history' ? '读取中…' : '读取'}</Button>
        </div>
        {messages.length
          ? <div className="history-list">{messages.map((m, i) => (
            <details key={i}><summary>{String(m.role || m.type || '消息')} · {String(m.status || '')}</summary><pre>{JSON.stringify(m, null, 2)}</pre></details>
          ))}</div>
          : <EmptyState title="历史待读取" description="历史始终来自 Messages List 真实请求。" />}
        <div className="host-limit">
          <b>持久流</b>
          <p>独立 Node 版通过 EventSource 直连本机服务的 SSE 代理，浏览器断开时服务端立即 abort 上游，无 8 秒窗口限制。</p>
        </div>
      </aside>
    </div>

    <section className="panel">
      <div className="section-head">
        <div>
          <h2>会话级 Stream 探测</h2>
          <p>文档标注「暂缓」，只记录真实 HTTP 与响应（有界 5 秒读取）。</p>
        </div>
        <Button variant="outline" onClick={probe} disabled={!sessionId || !!busy}>探测一次</Button>
      </div>
    </section>
    <EvidencePanel evidence={last} />
  </div>;
}
