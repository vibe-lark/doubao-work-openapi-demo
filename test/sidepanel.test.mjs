import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const ts = require("typescript");
const compile = (name) =>
  ts.transpileModule(
    readFileSync(new URL(`../web/src/${name}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
const api = await import(
  `data:text/javascript;base64,${Buffer.from(compile("api.ts")).toString("base64")}`
);

test("a previous completed reply cannot complete the current task", () => {
  const messages = [
    {
      id: "old",
      role: "assistant",
      reply_id: "previous-query",
      status: "completed",
    },
    {
      id: "new",
      role: "assistant",
      reply_id: "current-query",
      status: "in_progress",
    },
  ];
  assert.equal(api.isTerminal(api.replyFor(messages, "current-query")), false);
  assert.equal(api.replyFor(messages, "not-yet-returned"), undefined);
});

test("observed production thinking-block payload is presented as progress, not JSON", () => {
  const message = {
    status: "in_progress",
    items: [
      {
        type: "text",
        text: JSON.stringify([
          {
            block_id: "observed-thinking-block",
            block_type: 10040,
            content_v2: '{"thinking_block":{"streaming_title":"正在思考"}}',
          },
        ]),
      },
    ],
  };
  assert.equal(api.messageText(message), "豆包正在思考…");
  assert.equal(api.messageText({ ...message, status: "completed" }), "");
  assert.equal(
    api.messageText({ items: [{ type: "text", text: "[1,2,3]" }] }),
    "[1,2,3]",
  );
});

test("terminal reply shows answer text without internal reasoning items", () => {
  const message = {
    status: "completed",
    items: [
      { type: "reasoning", summary: [{ text: "internal summary" }] },
      { type: "text", text: "预算尚未明确。" },
    ],
  };
  assert.equal(api.messageText(message), "预算尚未明确。");
  assert.equal(api.isTerminal(message), true);
});

test("HTTP 200 at the BFF does not hide upstream rejection", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          httpStatus: 400,
          code: 99991668,
          msg: "Invalid access token",
        }),
      );
    await assert.rejects(api.proxy("/api/sessions"), /99991668/);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          httpStatus: 0,
          code: "NETWORK_ERROR",
          msg: "timeout",
        }),
      );
    await assert.rejects(api.proxy("/api/sessions"), /NETWORK_ERROR/);
  } finally {
    globalThis.fetch = original;
  }
});

test("sending preserves the chosen context and idempotency uuid", async () => {
  const original = globalThis.fetch;
  const body = {
    uuid: "stable-request-id",
    events: [
      {
        type: "user.message",
        contents: [{ type: "text", text: "只分析这条已选择的记录" }],
      },
    ],
  };
  try {
    globalThis.fetch = async (path, init) => {
      assert.equal(path, "/api/sessions/existing/events");
      assert.deepEqual(JSON.parse(init.body), body);
      return new Response(
        JSON.stringify({
          httpStatus: 202,
          code: 0,
          data: { messages: [{ id: "query", role: "user" }] },
        }),
      );
    };
    assert.equal(
      (await api.proxy("/api/sessions/existing/events", body)).messages[0].id,
      "query",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("observed Markdown table renders within an overflow container and HTML stays inert", async () => {
  const folder = mkdtempSync(
    fileURLToPath(
      new URL("../web/node_modules/.sidepanel-test-", import.meta.url),
    ),
  );
  try {
    const path = join(folder, "ResponseText.mjs");
    writeFileSync(path, compile("ResponseText.tsx"));
    const { default: ResponseText } = await import(pathToFileURL(path));
    const { createElement } = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const html = renderToStaticMarkup(
      createElement(ResponseText, {
        text: "## BANT\n| 维度 | 判定 |\n|---|---|\n| **预算** | 未确认 |\n<script>alert(1)</script>",
      }),
    );
    assert.match(html, /class="response-table"/);
    assert.match(html, /<table>/);
    assert.match(html, /<strong>预算<\/strong>/);
    assert.ok(!html.includes("<script>"));
    assert.match(html, /&lt;script&gt;/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
