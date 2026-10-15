// The unified collapse point for backend actions (api/lambda/*.ts): success returns + failure envelope
// + zod validation.
//
// ⚠️ Naming: this file is NOT an "action route" — it exports no Api(Get/Post(...)) and only exports
// plain functions. bff-core(3.5.0) only registers functions "exported with Api() operator Trigger
// metadata" as routes; plain functions/constants/types are all skipped, regardless of file name (the
// existing boardlib.ts / ticketlib.ts / seed.ts coexist exactly this way). The underscore prefix is
// safe: the build glob **/*.[tj]sx? still compiles it and does not exclude it, and the only reserved
// underscore special name is '_app' (the BFF app-level middleware file) — anything not named '_app' is
// not treated specially. Other backend action files import it by relative path:
// import { ok, fail, parse } from './_kit'.
//
// Tightly coupled with the contract "never swallow errors / never catch-then-return fallback fake data":
// the only correct path for an error is to throw (the real reason goes into the envelope), not to return
// a blob of empty/default values that disguises a "broken dependency" as success.
import { z } from 'zod';

export type Fail = Error & { status: number };

// fail — throw an error carrying an HTTP status (never: code after the call site is unreachable, so the
// type narrowing holds naturally). The first argument is the HTTP status code: 400 invalid input /
// 403 forbidden / 404 not found / 409 conflict / 500 internal error.
// Why HTTP status and not a home-grown business code: the platform's error pipeline speaks exactly this —
//   handler throw(e.status) → the platform server middleware returns { error: e.message } + that HTTP code
//   → the frontend @anygen/client normalizer restores it into Error(e.message) (with .status attached).
// The real message flows through the envelope the whole way; what the frontend catches is the plain-
// language sentence the backend threw.
export function fail(status: number, message: string): never {
  const e = new Error(message) as Fail;
  e.status = status;
  throw e;
}

// ok — the symmetric anchor for a success return. Equivalent to `return data` (the platform automatically
// JSON-serializes the return value into the response body); it exists only to make the handler's
// success/failure paths read symmetrically and to give the return value a typed landing spot. It does no
// wrapping — the frontend receives data itself (useAppData's fetcher gets it directly, no .data unwrap).
export function ok<T>(data: T): T {
  return data;
}

// parse — turn a zod validation failure into fail(400, the specific reason).
// For action input, prefer the Data(schema) / Query(schema) operators (the platform validates before the
// handler and auto-returns 400 on failure); parse is only for cases the operators can't cover:
// conditional/union validation, or manually reusing an @shared/schema schema to validate some non-input data.
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    const path = first && first.path.length ? ` (${first.path.join('.')})` : '';
    fail(400, `Invalid parameter${path}: ${(first && first.message) || 'validation failed'}`);
  }
  return r.data;
}
