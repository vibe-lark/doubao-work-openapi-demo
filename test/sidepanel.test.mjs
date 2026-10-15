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

const conversations = await import(
  `data:text/javascript;base64,${Buffer.from(compile("conversations.ts").replace('"./api"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(compile("api.ts")).toString("base64")}`))).toString("base64")}`
);
const business = await import(
  `data:text/javascript;base64,${Buffer.from(compile("business.ts")).toString("base64")}`
);

test("upgrading single-chat history keeps pending UUIDs and separates cloud sessions", () => {
  const legacy = [
    {
      id: "request-a",
      question: "A",
      source: "live",
      status: "in_progress",
      sessionId: "cloud-a",
      queryId: "query-a",
    },
    {
      id: "request-b",
      question: "B",
      source: "live",
      status: "submitting",
      sessionId: "cloud-b",
    },
    { id: "example", question: "fake", source: "example", status: "completed" },
  ];
  const restored = conversations.restoreWorkspace(legacy);
  assert.equal(restored.conversations.length, 2);
  assert.equal(restored.conversations[0].turns[0].queryId, "query-a");
  assert.equal(restored.conversations[1].turns[0].id, "request-b");
  assert.deepEqual(
    conversations.restoreWorkspace(JSON.parse(JSON.stringify(restored))),
    restored,
  );
});

test("the full cloud list includes personal and business chats without overwriting pending work", () => {
  const local = [
    {
      id: "local-a",
      sessionId: "cloud-a",
      title: "A",
      turns: [{ id: "pending" }],
      loaded: true,
    },
  ];
  const cloud = [
    { id: "cloud-a", name: "Playground · A" },
    { id: "cloud-b", name: "Playground · B" },
    { id: "crm", name: "系统集成 · 检查记录" },
    { id: "personal", name: "个人对话" },
  ];
  const merged = conversations.mergeRemote(local, cloud);
  assert.equal(merged.length, 4);
  assert.equal(merged[0], local[0]);
  assert.equal(merged[1].loaded, false);
  assert.equal(conversations.mergeRemote(merged, cloud).length, 4);
  assert.ok(merged.some((c) => c.sessionId === "personal"));
  assert.ok(merged.some((c) => c.sessionId === "crm"));
});

test("history pairs each user message with its own reply even when assistant replies are interleaved", () => {
  const restored = conversations.turnsFromMessages(
    [
      { id: "q1", role: "user", items: [{ type: "text", text: "first" }] },
      { id: "q2", role: "user", items: [{ type: "text", text: "second" }] },
      {
        id: "a2",
        role: "assistant",
        reply_id: "q2",
        status: "in_progress",
        items: [{ type: "text", text: "answer two" }],
      },
      {
        id: "a1",
        role: "assistant",
        reply_id: "q1",
        status: "completed",
        items: [{ type: "text", text: "answer one" }],
      },
    ],
    "session",
  );
  assert.equal(restored[0].answer, "answer one");
  assert.equal(restored[1].answer, "answer two");
  assert.equal(conversations.pendingTurn(restored).queryId, "q2");
  assert.ok(restored.every((t) => t.sessionId === "session"));
});

test("business actions include only their intended context and preserve uncertain facts", () => {
  const contexts = business.actions.map((action) =>
    JSON.parse(
      business
        .buildTask(action)
        .split("<business_context>\n")[1]
        .split("\n</business_context>")[0],
    ),
  );
  assert.ok(
    contexts.every(
      (c) =>
        c.opportunity.customer === "云舟科技" &&
        c.followup.text === business.record,
    ),
  );
  assert.equal(contexts[0].nextVisit, undefined);
  assert.equal(contexts[0].expectedClose, undefined);
  assert.deepEqual(contexts[1].nextVisit, business.visit);
  assert.equal(contexts[2].nextVisit, undefined);
  assert.match(contexts[2].expectedClose, /客户未确认/);
  assert.equal(new Set(business.actions.map(business.buildTask)).size, 3);
});

test("a list refresh racing a create response keeps one conversation and the original request", () => {
  const workspace = {
    version: 2,
    activeId: "remote",
    conversations: [
      {
        id: "local",
        title: "local request",
        turns: [{ id: "stable-uuid" }],
        loaded: true,
      },
      {
        id: "remote",
        title: "cloud stub",
        sessionId: "new-cloud",
        turns: [],
        loaded: false,
      },
    ],
  };
  const next = conversations.updateConversation(workspace, "local", {
    sessionId: "new-cloud",
  });
  assert.equal(next.conversations.length, 1);
  assert.equal(next.activeId, "local");
  assert.equal(next.conversations[0].turns[0].id, "stable-uuid");
  // A late history response for the removed stub must not remove the real chat.
  assert.equal(
    conversations.updateConversation(next, "remote", {
      sessionId: "new-cloud",
      turns: [],
    }),
    next,
  );
});
