import { z } from 'zod';

export const environmentSchema = z.enum(['ppe', 'online']);
export type Environment = z.infer<typeof environmentSchema>;

export const oauthPrivateSchema = z.object({
  client_id: z.string().trim().min(1).describe('飞书 OAuth client_id'),
  client_secret: z.string().trim().min(1).describe('飞书 OAuth client_secret'),
  redirect_uri: z.string().url().default('http://127.0.0.1:4110/api/auth/feishu/callback').describe('OAuth 回调地址'),
});
export const exchangeCodeSchema = z.object({
  codeOrUrl: z.string().trim().min(1).max(8192).describe('裸 code 或完整回调 URL'),
});
export const environmentInputSchema = z.object({ environment: environmentSchema });

export const sessionCreateSchema = z.object({ body: z.unknown().optional() });
export const sessionIdSchema = z.object({ sessionId: z.string().trim().min(1) });
export const sessionUpdateSchema = sessionIdSchema.extend({ body: z.unknown() });
export const sessionListSchema = z.object({ query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional() });
export const eventCreateSchema = sessionIdSchema.extend({ body: z.unknown() });
export const messageListSchema = sessionIdSchema.extend({ query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional() });
export const messageRetrieveSchema = sessionIdSchema.extend({ messageId: z.string().trim().min(1) });
export const streamSchema = messageRetrieveSchema.extend({
  query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  lastEventId: z.string().optional(),
  limitMs: z.coerce.number().int().min(500).max(8000).default(5000),
});
export const sessionStreamProbeSchema = sessionIdSchema.extend({ limitMs: z.coerce.number().int().min(500).max(8000).default(5000) });
export const uploadInputSchema = z.object({
  uuid: z.string().min(1), filename: z.string().min(1).max(512), contentType: z.string().min(1),
  base64: z.string().min(1).describe('文件 base64 内容'),
});
export const boundaryRunSchema = z.object({ caseId: z.enum(['a','b','c','d','e','f','g','h','i','j','k']).optional() });

export type ProxyRequest = { method: string; url: string; headers: Record<string, string>; body?: unknown };
export type ProxyResult = {
  httpStatus: number;
  code: string | number | null;
  msg: string;
  data: unknown;
  durationMs: number;
  request: ProxyRequest;
  limitedRead?: boolean;
  frames?: string[];
};
export type BoundaryVerdict = 'pass' | 'mismatch' | 'undetermined';
export type BoundaryResult = { id: string; title: string; verdict: BoundaryVerdict; expected: string; actual: string; evidence?: ProxyResult; cleanup?: string };

// Compatibility types retained for existing inspector components.
export type Evidence = ProxyResult;
export const operationSchema = z.enum(['sessions.create','sessions.retrieve','sessions.update','sessions.delete','sessions.list','events.create','events.stream','message.stream','messages.list','messages.retrieve','files.upload']);
export type Operation = z.infer<typeof operationSchema>;
export const invokeInputSchema = z.object({ operation: operationSchema, sessionId: z.string().optional(), messageId: z.string().optional(), query: z.record(z.union([z.string(),z.number(),z.boolean()])).optional(), body: z.unknown().optional(), lastEventId: z.string().optional() });
export const manualCodeSchema = z.object({ value: z.string().trim().min(1).max(8192) });
export const boundaryCaseSchema = z.object({ id: z.string(), title: z.string(), group: z.string() });
export type BoundaryCase = z.infer<typeof boundaryCaseSchema>;
