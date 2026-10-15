// @api/boundary shim：由独立 Node 服务端执行真实边界探测（token 不出服务端）。
import type { BoundaryResult } from '@shared/schema';

export async function boundaryLab(input?: { data?: { caseId?: string } }): Promise<{ ok: boolean; results: BoundaryResult[]; markdown: string }> {
  const caseId = input?.data?.caseId;
  const response = await fetch('/api/boundary/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(caseId ? { caseId } : {}),
  } as RequestInit);
  const text = await response.text();
  let payload: Record<string, any> | null = null;
  try { payload = JSON.parse(text); } catch { /* 非 JSON */ }
  if (!payload || !response.ok || !Array.isArray(payload.results)) {
    throw new Error(payload?.error?.message || payload?.msg || `边界探测失败（HTTP ${response.status}）`);
  }
  return { ok: Boolean(payload.ok), results: payload.results, markdown: String(payload.markdown || '') };
}
