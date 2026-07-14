import type { SkillStore } from "./store";
import { generateObject } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

interface TurnContext {
  messages: unknown[];
}

interface ChatResponseResult {
  toolCalls?: Array<{ toolName: string; input?: unknown }>;
  text?: string;
  finishReason?: string;
  usage?: { totalTokens?: number; promptTokens?: number; completionTokens?: number };
}

interface SessionLike {
  id?: string;
  messages?: unknown[];
}

const nudgeThreshold = 5;
const nudgeFlag = "_skillNudged";

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

  let results;
  try {
    results = await store.search(userText, 3);
  } catch {
    return;
  }

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

const skillExtractionSchema = z.object({
  shouldCreate: z.boolean().describe("Whether a skill should be created from this interaction"),
  name: z.string().describe("Kebab-case skill name, 2-64 chars, lowercase").optional(),
  description: z.string().describe("One sentence describing what the skill does").optional(),
  triggers: z.array(z.string()).describe("Phrases that indicate when to use this skill").optional(),
  body: z.string().describe("Step-by-step instructions in markdown").optional(),
});

export async function curatorHook(
  store: SkillStore,
  ai: Ai,
  result: ChatResponseResult,
  session: SessionLike | undefined,
): Promise<void> {
  const toolCalls = result.toolCalls ?? [];
  if (toolCalls.length < nudgeThreshold) return;

  const usage = result.usage;
  if (usage?.totalTokens && usage.totalTokens > 100000) {
    console.log("[skills] Skipping curator: token budget exceeded");
    return;
  }

  const toolSequence = toolCalls
    .map((t) => `- ${t.toolName}(${JSON.stringify(t.input ?? {}).slice(0, 200)})`)
    .join("\n");

  const responseText = result.text ?? "(no text response)";

  const prompt = `Analyze this agent interaction and determine if a reusable skill should be created.

The agent used ${toolCalls.length} tool calls:
${toolSequence}

The agent's final response was:
${responseText.slice(0, 1000)}

A skill should be created if:
1. The task involved 5+ tool calls
2. The procedure is likely to recur
3. The steps are non-obvious

If creating a skill, provide:
- name: kebab-case, 2-64 chars, lowercase (e.g. "deploy-cloudflare-worker")
- description: one sentence (10-200 chars)
- triggers: 1-10 phrases that indicate when this skill applies
- body: step-by-step instructions in markdown that someone could follow`;

  try {
    const model = createWorkersAI({ binding: ai })("@cf/moonshotai/kimi-k2.7-code");
    const { object } = await generateObject({
      model,
      schema: skillExtractionSchema,
      prompt,
    });

    if (!object.shouldCreate || !object.name || !object.description || !object.body) {
      console.log("[skills] Curator decided not to create a skill");
      return;
    }

    const existing = await store.get(object.name);
    if (existing) {
      const updated = await store.patch(object.name, {
        description: object.description,
        triggers: object.triggers ?? existing.triggers,
        body: object.body,
      });
      console.log(`[skills] Curator updated existing skill: ${updated?.name} (v${updated?.version})`);
    } else {
      const created = await store.create({
        name: object.name,
        description: object.description,
        triggers: object.triggers ?? [],
        body: object.body,
      });
      console.log(`[skills] Curator created new skill: ${created.name}`);
    }

    (session as unknown as Record<string, unknown>)?.[nudgeFlag] !== undefined;
  } catch (err) {
    console.error("[skills] Curator failed:", err);
  }
}

export {};