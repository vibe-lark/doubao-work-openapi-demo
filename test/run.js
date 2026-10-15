#!/usr/bin/env node
// 豆包工作 Open API · 全量测试 runner（零依赖）。
//
// 用法：
//   node test/run.js                  # 全量
//   node test/run.js S2 S3 B1 B2      # 只跑指定用例
//   node test/run.js --group 鉴权      # 按组过滤（模糊匹配）
//   DOUBBAO_USER_TOKEN=u-xxx node test/run.js
//   DOUBBAO_ENV=ppe|online node test/run.js
//   RUN_LARGE_FILES=1 node test/run.js B26
//
// 结论：PASS / FAIL / MISMATCH / SKIPPED / BLOCKED。
// 无 token：业务用例 SKIPPED（不计失败），无 token 边界 B1/B2 真实执行。

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, collectStream, loadRuntimeConfig, uploadFile, waitForIdle, waitForMessageTerminal, sleep } from './http.js';
import { BUSINESS_CASES } from './cases-business.js';
import { BOUNDARY_CASES } from './cases-boundary.js';
import { OBSERVATION_CASES } from './cases-observation.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..');
const REPORTS_DIR = join(REPO_ROOT, 'reports');
const COVERAGE_DOC = join(REPO_ROOT, 'docs', 'API_COVERAGE.md');

const ALL_CASES = [...BUSINESS_CASES, ...BOUNDARY_CASES, ...OBSERVATION_CASES];

// ---------------- 参数解析 ----------------
const args = process.argv.slice(2);
const groups = [];
const ids = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--group') { groups.push(args[++i]); }
  else if (args[i] === '--env') { process.env.DOUBBAO_ENV = args[++i]; }
  else if (!args[i].startsWith('--')) ids.push(args[i].toUpperCase());
}

const selected = ALL_CASES.filter((c) => {
  if (ids.length && !ids.includes(c.id.toUpperCase())) return false;
  if (groups.length && !groups.some((g) => c.group.includes(g) || c.id.toLowerCase().includes(g.toLowerCase()))) return false;
  return true;
});

// ---------------- 脱敏 ----------------
const runtime = loadRuntimeConfig();
const SECRET_LITERALS = [runtime.token, process.env.OAUTH_CLIENT_SECRET, process.env.OAUTH_CLIENT_ID].filter(Boolean);
const SECRET_PATTERNS = [
  /u-[A-Za-z0-9_-]{20,}/g,
  /t-g104[A-Za-z0-9_-]{10,}/g,
  /cli_[A-Za-z0-9]{12,}/g,
  /Bearer\s+[A-Za-z0-9._-]{12,}/g,
];
function scrubString(s) {
  let out = String(s);
  for (const literal of SECRET_LITERALS) if (literal) out = out.split(literal).join('••••••••');
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => (/^Bearer/.test(m) ? 'Bearer ••••••••' : '••••••••'));
  return out;
}
function deepScrub(value) {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map(deepScrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [
      /authorization|secret|token|cookie/i.test(k) && typeof v === 'string' ? '••••••••' : k,
      /authorization|secret|token|cookie/i.test(k) && typeof v === 'string' ? '••••••••' : deepScrub(v),
    ]));
  }
  return value;
}

// ---------------- 用例执行 ----------------
function pad(s, n) { return String(s).padEnd(n); }

async function runCase(def) {
  const checks = [];
  const evidence = [];
  let blockedReason = '';
  let entered = false;
  const state = {};

  const t = {
    runtime,
    state,
    sleep,
    call: (method, path, opts = {}) => call(method, path, { runtime, ...opts }),
    upload: (opts) => uploadFile({ runtime, ...opts }),
    stream: (path, opts = {}) => collectStream(path, { runtime, ...opts }),
    waitIdle: (sid, opts) => waitForIdle(sid, runtime, opts),
    waitMessage: (sid, mid, opts) => waitForMessageTerminal(sid, mid, runtime, opts),
    check(name, ok, expected, actual) {
      checks.push({ name, ok: Boolean(ok), severity: 'fail', expected: stringify(expected), actual: stringify(actual) });
    },
    mismatch(name, expected, actual) {
      checks.push({ name, ok: false, severity: 'mismatch', expected: stringify(expected), actual: stringify(actual) });
    },
    block(reason) { blockedReason = String(reason); },
    attach(label, data) { evidence.push({ label, at: new Date().toISOString(), data: deepScrub(data) }); },
  };

  let verdict;
  let summary = '';
  const started = Date.now();
  try {
    if (typeof def.skip === 'function') {
      const reason = def.skip();
      if (reason) return finish(def, 'SKIPPED', reason, checks, evidence, 0);
    }
    if (def.needToken && !runtime.token) {
      return finish(def, 'SKIPPED', '未注入 DOUBBAO_USER_TOKEN 且 .tokens/ 无 token 文件', checks, evidence, 0);
    }
    entered = true;
    summary = await def.run(t) || '';
    if (blockedReason) verdict = 'BLOCKED';
    else if (checks.some((c) => c.severity === 'mismatch' && !c.ok)) verdict = 'MISMATCH';
    else if (checks.some((c) => !c.ok)) verdict = 'FAIL';
    else verdict = 'PASS';
  } catch (error) {
    verdict = 'FAIL';
    summary = `用例抛异常：${error instanceof Error ? error.stack || error.message : String(error)}`;
  } finally {
    if (entered && def.cleanup) {
      try { await def.cleanup(t); } catch (error) { evidence.push({ label: 'cleanup-error', at: new Date().toISOString(), data: { error: String(error) } }); }
    }
  }
  return finish(def, verdict, summary, checks, evidence, Date.now() - started);
}

function stringify(v) {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function finish(def, verdict, summary, checks, evidence, durationMs) {
  return {
    id: def.id, group: def.group, title: def.title, api: def.api, doc: def.doc,
    verdict, summary: scrubString(summary), checks, evidence,
    durationMs, at: new Date().toISOString(),
  };
}

const CASE_TIMEOUT_MS = Number(process.env.CASE_TIMEOUT_MS || 8 * 60_000);
async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ __timeout: true }), ms); });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timer);
  return result;
}

// ---------------- 报告 ----------------
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function buildMarkdown(results) {
  const counts = countByVerdict(results);
  const lines = [
    `# 豆包工作 Open API 测试报告（${runtime.env}）`,
    '',
    `- 运行时间：${new Date().toISOString()}`,
    `- 环境：${runtime.env}（${runtime.env === 'ppe' ? 'https://open.feishu.cn/open-apis/agent + PPE 头' : 'https://open.doubao.com/open-apis/agent'}）`,
    `- token：${runtime.token ? '已注入（证据中已脱敏）' : '未注入（业务用例 SKIPPED，B1/B2 真实执行）'}`,
    `- 结论统计：PASS ${counts.PASS} · FAIL ${counts.FAIL} · MISMATCH ${counts.MISMATCH} · BLOCKED ${counts.BLOCKED} · SKIPPED ${counts.SKIPPED}`,
    '',
    '## 汇总',
    '',
    '| 用例 | 组 | 标题 | 结论 | 耗时 | 摘要 |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.group} | ${r.title.replaceAll('|', '\\|')} | ${r.verdict} | ${r.durationMs}ms | ${String(r.summary).replaceAll('|', '\\|').slice(0, 200)} |`);
  }
  lines.push('', '## 明细', '');
  for (const r of results) {
    lines.push(`### ${r.id} · ${r.title} — ${r.verdict}`);
    lines.push('');
    lines.push(`- 接口：\`${r.api}\``);
    lines.push(`- 文档预期：${r.doc}`);
    if (r.summary) lines.push(`- 摘要：${r.summary}`);
    lines.push(`- 耗时：${r.durationMs}ms`);
    if (r.checks.length) {
      lines.push('', '| 检查项 | 期望 | 实际 | 结果 |', '|---|---|---|---|');
      for (const c of r.checks) {
        const ok = c.ok ? '✅' : (c.severity === 'mismatch' ? '⚠️ MISMATCH' : '❌ FAIL');
        lines.push(`| ${c.name.replaceAll('|', '\\|')} | ${String(c.expected).replaceAll('|', '\\|')} | ${String(c.actual).replaceAll('|', '\\|')} | ${ok} |`);
      }
    }
    if (r.evidence.length) {
      lines.push('', '<details><summary>脱敏证据</summary>', '');
      for (const e of r.evidence) {
        lines.push(`**${e.label}**（${e.at}）`);
        lines.push('', '```json');
        lines.push(JSON.stringify(e.data, null, 2).slice(0, 12_000));
        lines.push('```');
      }
      lines.push('', '</details>');
    }
    lines.push('');
  }
  return lines.join('\n');
}

function countByVerdict(results) {
  const counts = { PASS: 0, FAIL: 0, MISMATCH: 0, BLOCKED: 0, SKIPPED: 0 };
  for (const r of results) counts[r.verdict] += 1;
  return counts;
}

function updateCoverageDoc(results) {
  if (!existsSync(COVERAGE_DOC)) return false;
  const counts = countByVerdict(results);
  const markerStart = '<!-- AUTO:RESULTS:START -->';
  const markerEnd = '<!-- AUTO:RESULTS:END -->';
  const rows = results.map((r) => `| ${r.id} | ${r.api.replaceAll('|', '\\|')} | ${r.verdict} | ${r.summary.replaceAll('|', '\\|').slice(0, 160)} |`).join('\n');
  const block = [
    markerStart,
    `最近一次自动运行：${new Date().toISOString()} · 环境 ${runtime.env}`,
    '',
    `PASS ${counts.PASS} · FAIL ${counts.FAIL} · MISMATCH ${counts.MISMATCH} · BLOCKED ${counts.BLOCKED} · SKIPPED ${counts.SKIPPED}`,
    '',
    '| 用例 | 接口 | 结论 | 摘要 |',
    '|---|---|---|---|',
    rows,
    markerEnd,
  ].join('\n');
  let doc = readFileSync(COVERAGE_DOC, 'utf8');
  if (doc.includes(markerStart) && doc.includes(markerEnd)) {
    doc = doc.replace(new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`), block);
  } else {
    doc += `\n\n## 最近一次运行结果（自动更新）\n\n${block}\n`;
  }
  writeFileSync(COVERAGE_DOC, doc);
  return true;
}

// ---------------- 主流程 ----------------
console.log('══════════════════════════════════════════════════════');
console.log(` 豆包工作 Open API 全量测试 · env=${runtime.env} · token=${runtime.token ? '已注入' : '无'}`);
console.log(` 用例 ${selected.length}/${ALL_CASES.length}（node ${process.version}）`);
console.log('══════════════════════════════════════════════════════');

const results = [];
for (const def of selected) {
  process.stdout.write(`${pad(def.id, 4)} ${pad(def.group, 8)} ${def.title.slice(0, 46)} … `);
  const result = await withTimeout(runCase(def), CASE_TIMEOUT_MS);
  if (result && result.__timeout) {
    results.push(finish(def, 'FAIL', `用例超过 ${CASE_TIMEOUT_MS / 1000}s 被强制结束`, [], [], CASE_TIMEOUT_MS));
    console.log('TIMEOUT');
    continue;
  }
  results.push(result);
  console.log(`${result.verdict} (${result.durationMs}ms)${result.verdict === 'MISMATCH' || result.verdict === 'BLOCKED' ? ` — ${result.summary.slice(0, 80)}` : ''}`);
}

const counts = countByVerdict(results);
console.log('──────────────────────────────────────────────────────');
console.log(` PASS ${counts.PASS}  FAIL ${counts.FAIL}  MISMATCH ${counts.MISMATCH}  BLOCKED ${counts.BLOCKED}  SKIPPED ${counts.SKIPPED}`);

mkdirSync(REPORTS_DIR, { recursive: true });
const stamp = timestamp();
const jsonPath = join(REPORTS_DIR, `${stamp}-${runtime.env}.json`);
const mdPath = join(REPORTS_DIR, `${stamp}-${runtime.env}.md`);
writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(), env: runtime.env, node: process.version,
  tokenInjected: Boolean(runtime.token), counts, results: deepScrub(results),
}, null, 2));
writeFileSync(mdPath, buildMarkdown(results));
updateCoverageDoc(results);
console.log(` 报告：${mdPath}`);
console.log(`      ：${jsonPath}`);
console.log(' 已同步：docs/API_COVERAGE.md');

// FAIL（明确与文档/预期相反的执行失败）返回非 0；MISMATCH 是待平台确认项，不阻断。
process.exit(counts.FAIL > 0 ? 1 : 0);
