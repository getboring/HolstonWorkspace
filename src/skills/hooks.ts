import type { SkillStore } from "./store";

interface TurnContext {
  messages: unknown[];
}

interface ChatResponseResult {
  toolCalls?: Array<{ toolName: string; input?: unknown }>;
  text?: string;
  finishReason?: string;
  usage?: unknown;
}

export async function retrieverHook(
  store: SkillStore,
  ctx: TurnContext,
  basePrompt: string,
): Promise<{ systemPrompt?: string } | void> {
  const messages = ctx.messages ?? [];
  const lastMessage = messages[messages.length - 1] as
    | { role: string; parts?: Array<{ type: string; text?: string }> }
    | undefined;
  if (!lastMessage?.parts) return;

  const userText = lastMessage.parts
    ?.filter((p) => p.type === "text")
    .map((p) => p.text)
    .join(" ");
  if (!userText || userText.length < 15) return;

  const results = await store.search(userText, 3);

  if (results.length === 0) return;

  const skillList = results
    .map(
      (r) =>
        `- ${r.name}: ${r.description} (relevance: ${(r.score * 100).toFixed(0)}%)`,
    )
    .join("\n");

  return {
    systemPrompt: `${basePrompt}\n\nRelevant skills available (use skill_load to load full instructions):\n${skillList}`,
  };
}

const nudgeThreshold = 5;
const nudgeFlag = "_skillNudged";

export async function nudgerHook(
  _store: SkillStore,
  agent: { sql?: SqlStorage },
  result: ChatResponseResult,
): Promise<void> {
  const toolCalls = result.toolCalls ?? [];
  if (toolCalls.length < nudgeThreshold) return;

  const flagged = (agent as unknown as Record<string, unknown>)[nudgeFlag];
  if (flagged) return;

  (agent as unknown as Record<string, unknown>)[nudgeFlag] = true;

  const toolNames = toolCalls.map((t) => t.toolName).join(", ");
  console.log(
    `[skills] Nudge triggered: ${toolCalls.length} tool calls (${toolNames})`,
  );

  if (agent.sql) {
    try {
      agent.sql.exec(
        `CREATE TABLE IF NOT EXISTS skill_nudges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tool_count INTEGER,
          tool_names TEXT,
          created_at TEXT
        )`,
      );

      agent.sql.exec(
        `INSERT INTO skill_nudges (tool_count, tool_names, created_at) VALUES (?, ?, ?)`,
        toolCalls.length,
        toolNames,
        new Date().toISOString(),
      );
    } catch (err) {
      console.error("[skills] Failed to log nudge:", err);
    }
  }
}

export {};