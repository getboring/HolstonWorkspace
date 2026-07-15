import type {
  ChatResponseResult,
  TurnContext,
} from "@cloudflare/think";
import {
  generateObject,
  getToolName,
  isToolUIPart,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import type { SkillStore } from "./store";

const NUDGE_TOOL_THRESHOLD = 5;
const NUDGE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Structural slice of Agent#sql so hooks stay decoupled from the agent class. */
export interface AgentSql {
  sql<T = Record<string, string | number | boolean | null>>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ): T[];
}

/**
 * beforeTurn: vector-search approved skills against the user's message and
 * return an augmented system prompt (TurnConfig.system) when any match.
 */
export async function retrieverHook(
  store: SkillStore,
  ctx: TurnContext,
): Promise<string | undefined> {
  const userText = lastUserText(ctx.messages);
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

  return `${ctx.system}\n\nRelevant skills available (use skill_load to load full instructions):\n${skillList}`;
}

/**
 * onChatResponse: when a turn used enough tools to be skill-worthy, log a
 * nudge. State lives in the agent's SQLite so it survives hibernation; a
 * cooldown keeps back-to-back complex turns from spamming.
 */
export function nudgerHook(agent: AgentSql, result: ChatResponseResult): void {
  const toolCalls = extractToolCalls(result.message);
  if (toolCalls.length < NUDGE_TOOL_THRESHOLD) return;

  try {
    agent.sql`CREATE TABLE IF NOT EXISTS skill_nudges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_count INTEGER,
      tool_names TEXT,
      created_at TEXT
    )`;

    const cutoff = new Date(Date.now() - NUDGE_COOLDOWN_MS).toISOString();
    const recent = agent.sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM skill_nudges WHERE created_at > ${cutoff}
    `;
    if ((recent[0]?.n ?? 0) > 0) return;

    const toolNames = toolCalls.map((t) => t.toolName).join(", ");
    agent.sql`
      INSERT INTO skill_nudges (tool_count, tool_names, created_at)
      VALUES (${toolCalls.length}, ${toolNames}, ${new Date().toISOString()})
    `;
    console.log(
      `[skills] Nudge logged: ${toolCalls.length} tool calls (${toolNames})`,
    );
  } catch (err) {
    console.error("[skills] Failed to log nudge:", err);
  }
}

/**
 * onChatResponse: record success/fail for every skill the turn actually loaded
 * (via `skill_load`), so the retriever's ranking learns from real outcomes
 * instead of sitting at a permanent 0/0. A completed turn counts as success for
 * each loaded skill; a failed/errored turn counts as a failure. Best-effort —
 * a store write failure must never break the response.
 */
export async function outcomeHook(
  store: SkillStore,
  result: ChatResponseResult,
): Promise<void> {
  const loaded = loadedSkillNames(result.message);
  if (loaded.size === 0) return;
  const ok = result.status === "completed";
  for (const name of loaded) {
    try {
      await store.recordOutcome(name, ok);
    } catch (err) {
      console.error(`[skills] Failed to record outcome for ${name}:`, err);
    }
  }
}

/** Skill names loaded via `skill_load` in this turn (deduped). */
function loadedSkillNames(message: UIMessage): Set<string> {
  const names = new Set<string>();
  for (const call of extractToolCalls(message)) {
    if (call.toolName !== "skill_load") continue;
    const name = (call.input as { name?: unknown } | undefined)?.name;
    if (typeof name === "string" && name) names.add(name);
  }
  return names;
}

const skillExtractionSchema = z.object({
  shouldCreate: z
    .boolean()
    .describe("Whether a skill should be created from this interaction"),
  name: z
    .string()
    .describe("Kebab-case skill name, 2-64 chars, lowercase")
    .optional(),
  description: z
    .string()
    .describe("One sentence describing what the skill does")
    .optional(),
  triggers: z
    .array(z.string())
    .describe("Phrases that indicate when to use this skill")
    .optional(),
  body: z
    .string()
    .describe("Step-by-step instructions in markdown")
    .optional(),
});

/**
 * onChatResponse: extract a reusable skill from a complex turn. Proposals are
 * STAGED as pending drafts — a human approves them in the Skills panel before
 * they become retrievable. The curator never writes to the approved store
 * directly (the same approval bar the skill_create tool enforces in-chat).
 */
export async function curatorHook(
  store: SkillStore,
  ai: Ai,
  result: ChatResponseResult,
): Promise<void> {
  if (result.status !== "completed") return;

  const toolCalls = extractToolCalls(result.message);
  if (toolCalls.length < NUDGE_TOOL_THRESHOLD) return;

  const toolSequence = toolCalls
    .map(
      (t) => `- ${t.toolName}(${JSON.stringify(t.input ?? {}).slice(0, 200)})`,
    )
    .join("\n");
  const responseText = extractText(result.message) || "(no text response)";

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
    const model = createWorkersAI({ binding: ai })(
      "@cf/moonshotai/kimi-k2.7-code",
    );
    const { object } = await generateObject({
      model,
      schema: skillExtractionSchema,
      prompt,
    });

    if (
      !object.shouldCreate ||
      !object.name ||
      !object.description ||
      !object.body
    ) {
      console.log("[skills] Curator decided not to create a skill");
      return;
    }

    if (!SKILL_NAME_PATTERN.test(object.name)) {
      console.warn(`[skills] Curator produced invalid skill name: ${object.name}`);
      return;
    }

    const staged = await store.stagePending({
      name: object.name,
      description: object.description,
      triggers: object.triggers ?? [],
      body: object.body,
    });
    console.log(
      `[skills] Curator staged pending skill "${staged.name}" — approve it in the Skills panel`,
    );
  } catch (err) {
    console.error("[skills] Curator failed:", err);
  }
}

interface ToolCallSummary {
  toolName: string;
  input: unknown;
}

function extractToolCalls(message: UIMessage): ToolCallSummary[] {
  const calls: ToolCallSummary[] = [];
  for (const part of message.parts ?? []) {
    // isToolUIPart covers both static tool parts and dynamic (MCP) tool parts.
    if (isToolUIPart(part)) {
      calls.push({ toolName: getToolName(part), input: part.input });
    }
  }
  return calls;
}

function extractText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function lastUserText(messages: ModelMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ");
  }
  return undefined;
}
