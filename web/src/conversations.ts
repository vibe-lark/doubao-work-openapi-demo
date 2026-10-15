import { messageText, replyFor, type Message } from "./api";

export type Turn = {
  id: string;
  question: string;
  wireText: string;
  context: boolean;
  source: "live" | "example";
  answer: string;
  status: string;
  sessionId?: string;
  queryId?: string;
  replyId?: string;
};
export type Conversation = {
  id: string;
  title: string;
  turns: Turn[];
  sessionId?: string;
  loaded: boolean;
  updatedAt: number;
};
export type Workspace = {
  version: 2;
  activeId: string;
  conversations: Conversation[];
};
export function updateConversation(
  workspace: Workspace,
  id: string,
  patch: Partial<Conversation>,
): Workspace {
  if (!workspace.conversations.some((c) => c.id === id)) return workspace;
  const duplicate = (chat: Conversation) =>
    Boolean(
      patch.sessionId && chat.id !== id && chat.sessionId === patch.sessionId,
    );
  // A list refresh can see a newly created cloud session before its POST returns.
  // Keep the local request (and its UUID), removing only the duplicate list entry.
  return {
    ...workspace,
    activeId: workspace.conversations.some(
      (c) => c.id === workspace.activeId && duplicate(c),
    )
      ? id
      : workspace.activeId,
    conversations: workspace.conversations
      .filter((c) => !duplicate(c))
      .map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}
export const pendingTurn = (turns: Turn[]) =>
  turns.findLast(
    (t) =>
      t.source === "live" &&
      !["completed", "failed", "cancelled"].includes(t.status),
  );
export function blankConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    turns: [],
    loaded: true,
    updatedAt: Date.now(),
  };
}
export function restoreWorkspace(value: unknown): Workspace {
  if (
    value &&
    typeof value === "object" &&
    "version" in value &&
    value.version === 2 &&
    "conversations" in value &&
    Array.isArray(value.conversations)
  ) {
    const workspace = value as Workspace;
    const conversations = workspace.conversations.filter(
      (c) => c && typeof c.id === "string" && Array.isArray(c.turns),
    );
    if (conversations.length)
      return {
        version: 2,
        conversations,
        activeId: conversations.some((c) => c.id === workspace.activeId)
          ? workspace.activeId
          : conversations[0].id,
      };
  }
  // Preserve earlier single-conversation histories, grouped by their cloud session.
  const conversations: Conversation[] = [];
  if (Array.isArray(value))
    for (const turn of value as Turn[]) {
      if (!turn || turn.source !== "live" || typeof turn.question !== "string")
        continue;
      let chat = conversations.find((c) => c.sessionId === turn.sessionId);
      if (!chat) {
        chat = {
          ...blankConversation(),
          title: turn.question.slice(0, 32),
          sessionId: turn.sessionId,
        };
        conversations.push(chat);
      }
      chat.turns.push(turn);
    }
  if (!conversations.length) conversations.push(blankConversation());
  return { version: 2, activeId: conversations.at(-1)!.id, conversations };
}
export function turnsFromMessages(
  messages: Message[],
  sessionId: string,
): Turn[] {
  return messages
    .filter((m) => m.role === "user")
    .map((query) => {
      const reply = replyFor(messages, query.id);
      const question = messageText(query);
      return {
        id: `history-${query.id}`,
        question,
        wireText: question,
        context: false,
        source: "live",
        answer: reply ? messageText(reply) : "",
        status: reply?.status || "in_progress",
        sessionId,
        queryId: query.id,
        replyId: reply?.id,
      };
    });
}
export function mergeRemote(
  conversations: Conversation[],
  sessions: Array<{ id: string; name: string; updated_at?: string }>,
): Conversation[] {
  const seen = new Set(conversations.map((c) => c.sessionId));
  const added = sessions
    .filter((s) => /^Playground(?: · | 对话$)/.test(s.name) && !seen.has(s.id))
    .map((s) => ({
      id: `remote-${s.id}`,
      sessionId: s.id,
      title: s.name.replace(/^Playground · /, ""),
      turns: [],
      loaded: false,
      updatedAt: Date.parse(s.updated_at || "") || 0,
    }));
  return [...conversations, ...added];
}
