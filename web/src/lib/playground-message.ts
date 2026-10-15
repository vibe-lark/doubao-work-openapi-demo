export type StreamFrame = {
  event: string;
  data: string;
  id?: string;
  at: string;
  seq: number;
  parsed?: Record<string, unknown>;
};

export type Part = {
  id: string;
  kind: 'text' | 'reasoning' | 'artifact';
  text: string;
  segments?: string[];
  artifact?: Record<string, unknown>;
  seq: number;
  complete: boolean;
};

export type TrackingMode = 'waiting' | 'generating' | 'stream' | 'poll';
export type ChatEntry = {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  parts?: Part[];
  status?: string;
  reason?: string;
  trackingMode?: TrackingMode;
};

type EvidenceLike = { data?: unknown };
type MessageSnapshot = { status: string; reason: string; parts: Part[] };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown) { return typeof value === 'string' ? value : ''; }
function sequence(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function nested(value: Record<string, unknown>) {
  for (const key of ['data', 'item', 'content', 'payload']) {
    const child = object(value[key]);
    if (child) return child;
  }
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (typeof item === 'string') return item ? [item] : [];
    const row = object(item);
    if (!row) return [];
    const text = string(row.text ?? row.content ?? row.summary);
    return text ? [text] : [];
  });
}
function content(value: Record<string, unknown>) {
  for (const key of ['text', 'delta', 'value']) {
    const found = string(value[key]);
    if (found) return found;
  }
  if (typeof value.content === 'string') return value.content;
  const child = nested(value);
  return child === value ? '' : content(child);
}
function itemIdentity(value: Record<string, unknown>, fallback: string) {
  const child = nested(value);
  return string(value.item_id ?? value.itemId ?? child.item_id ?? child.itemId ?? (child === value ? undefined : child.id) ?? value.id) || fallback;
}
function kindOf(value: Record<string, unknown>, hint = ''): Part['kind'] {
  const child = nested(value);
  const name = string(value.type ?? value.item_type ?? value.content_type ?? child.type ?? child.item_type ?? hint).toLowerCase();
  if (name.includes('reasoning')) return 'reasoning';
  if (name.includes('artifact') || value.artifact_type || child.artifact_type) return 'artifact';
  return 'text';
}
function reasoningSegments(value: Record<string, unknown>) {
  const child = nested(value);
  const direct = strings(value.summary);
  if (direct.length) return direct;
  const childSummary = strings(child.summary);
  if (childSummary.length) return childSummary;
  const text = content(value);
  return text ? [text] : [];
}
function artifactData(value: Record<string, unknown>) {
  const child = nested(value);
  const artifact = object(value.artifact) ?? object(child.artifact) ?? child;
  return { ...value, ...artifact };
}
function normalizeItem(value: Record<string, unknown>, index: number, fallbackId: string): Part {
  const kind = kindOf(value);
  const id = itemIdentity(value, fallbackId);
  const seq = sequence(value.seq ?? nested(value).seq, index);
  if (kind === 'artifact') return { id, kind, text: '', artifact: artifactData(value), seq, complete: true };
  const segments = kind === 'reasoning' ? reasoningSegments(value) : undefined;
  const text = kind === 'reasoning' ? (segments?.join('\n\n') ?? '') : content(value);
  return { id, kind, text, ...(segments ? { segments } : {}), seq, complete: true };
}
function messageObject(value: EvidenceLike) {
  const root = object(value.data) ?? {};
  return object(root.message) ?? root;
}
function normalizeStatus(value: unknown) {
  const status = string(value).toLowerCase();
  return status === 'canceled' ? 'cancelled' : status;
}
export function isTerminal(status: string) {
  return ['completed', 'failed', 'cancelled', 'idle'].some(value => status.toLowerCase().includes(value));
}
export function retrieveSnapshot(value: EvidenceLike): MessageSnapshot {
  const message = messageObject(value);
  const rawItems = Array.isArray(message.items) ? message.items : [];
  const parts = rawItems.flatMap((item, index) => {
    const row = object(item);
    return row ? [normalizeItem(row, index, `retrieve-${index}`)] : [];
  }).sort(compareParts);
  return {
    status: normalizeStatus(message.status ?? message.state ?? message.type),
    reason: string(message.reason ?? message.error ?? message.message),
    parts,
  };
}
function compareParts(a: Part, b: Part) { return a.seq - b.seq || a.id.localeCompare(b.id); }
function upsertAssistant(current: ChatEntry[], messageId: string, update: (entry: ChatEntry) => ChatEntry) {
  const entries = [...current];
  let index = entries.findIndex(entry => entry.id === `assistant-${messageId}`);
  if (index < 0) {
    entries.push({ id: `assistant-${messageId}`, role: 'assistant', parts: [], status: 'in_progress', trackingMode: 'waiting' });
    index = entries.length - 1;
  }
  entries[index] = update(entries[index]);
  return entries;
}
function mergeCompleteParts(existing: Part[], incoming: Part[]) {
  const map = new Map(existing.map(part => [part.id, { ...part }]));
  for (const part of incoming) map.set(part.id, { ...part, complete: true });
  return Array.from(map.values()).sort(compareParts);
}
function statusAfter(current: string | undefined, incoming: string) {
  if (!incoming) return current;
  if (current && isTerminal(current) && !isTerminal(incoming)) return current;
  return incoming;
}
export function mergeRetrieve(current: ChatEntry[], messageId: string, value: EvidenceLike) {
  const snapshot = retrieveSnapshot(value);
  return {
    status: snapshot.status,
    entries: upsertAssistant(current, messageId, entry => ({
      ...entry,
      parts: mergeCompleteParts(entry.parts ?? [], snapshot.parts),
      status: statusAfter(entry.status, snapshot.status),
      reason: snapshot.reason || entry.reason,
      trackingMode: snapshot.status === 'in_progress' && !entry.trackingMode ? 'generating' : entry.trackingMode,
    })),
  };
}

function eventName(frame: StreamFrame) { const named = string(frame.event); return named && named !== 'message' ? named : string(frame.parsed?.type ?? frame.parsed?.event) || 'message'; }
function mergeDelta(map: Map<string, Part>, part: Part, delta: boolean) {
  const old = map.get(part.id);
  if (!delta || !old) { map.set(part.id, part); return; }
  if (old.complete) return;
  const segments = part.kind === 'reasoning' ? [...(old.segments ?? (old.text ? [old.text] : [])), ...(part.segments ?? (part.text ? [part.text] : []))] : undefined;
  map.set(part.id, { ...old, kind: part.kind, text: `${old.text}${part.text}`, ...(segments ? { segments } : {}), seq: Math.min(old.seq, part.seq) });
}
export function mergeFrames(current: ChatEntry[], messageId: string, incoming: StreamFrame[]) {
  let terminalStatus = '';
  const entries = upsertAssistant(current, messageId, entry => {
    let status = entry.status;
    let reason = entry.reason;
    const map = new Map((entry.parts ?? []).map(part => [part.id, { ...part }]));
    for (const frame of [...incoming].sort((a, b) => a.seq - b.seq)) {
      const row = frame.parsed ?? {};
      const name = eventName(frame).toLowerCase();
      if (name.includes('message.in_progress')) status = statusAfter(status, 'in_progress');
      if (name.includes('message.completed') || name.includes('session.idle')) status = statusAfter(status, 'completed');
      if (name.includes('message.failed')) { status = statusAfter(status, 'failed'); reason = string(row.reason ?? row.error ?? row.message) || '未知原因'; }
      if (name.includes('message.cancel')) status = statusAfter(status, 'cancelled');
      const frameStatus = normalizeStatus(row.status ?? row.state);
      if (frameStatus) status = statusAfter(status, frameStatus);
      if (isTerminal(status ?? '')) terminalStatus = status ?? '';
      if (name.includes('error')) {
        reason = string(row.message ?? row.error) || frame.data;
        map.set(`error-${frame.seq}`, { id: `error-${frame.seq}`, kind: 'text', text: `> **流事件错误：** ${reason}`, seq: frame.seq, complete: true });
      }
      if (name.includes('subagent.created') || name.includes('subagent.closed')) {
        const label = name.includes('created') ? '子任务已创建' : '子任务已结束';
        map.set(`subagent-${frame.seq}`, { id: `subagent-${frame.seq}`, kind: 'text', text: `_${label}${row.id ? ` · ${string(row.id)}` : ''}_`, seq: frame.seq, complete: true });
      }
      const itemType = string(row.type ?? row.item_type ?? nested(row).type ?? nested(row).item_type).toLowerCase();
      if (!name.includes('text') && !name.includes('reasoning') && !name.includes('artifact') && !['text','reasoning','artifact'].some(kind => itemType.includes(kind))) continue;
      const id = itemIdentity(row, `${eventName(frame)}-${frame.seq}`);
      const part = normalizeItem(row, frame.seq, id);
      const delta = name.includes('delta') || name.includes('start');
      mergeDelta(map, { ...part, complete: !delta }, delta);
    }
    return { ...entry, parts: Array.from(map.values()).sort(compareParts), status, reason };
  });
  return { entries, terminalStatus };
}
