import { action, type Action } from "@cloudflare/think";
import { z } from "zod";
import { shouldApprove } from "./core/tool-policy";
import type { ReceiptStore } from "./receipts";
import type { ApprovalMode } from "./shared/state";

/**
 * Server actions compiled into model tools, following the Boring Stack write
 * path: Zod validate → idempotency key → authority gate → execute → receipt.
 *
 * Think Actions provide validate/idempotency/authorization/execute natively;
 * the immutable receipt is written by us at the end of each execute.
 */
export interface ActionDeps {
  receipts: ReceiptStore;
  /** Owner actor label for receipts (the agent instance / user). */
  actor: string;
  /** Send a proactive multi-channel notification (push + broadcast + email). */
  notify: (title: string, body: string, opts?: { url?: string }) => Promise<void>;
  /** Persist a durable memory fact into the session's writable memory block. */
  saveMemory: (fact: string) => Promise<void>;
  /** Create a reminder from natural language; returns a human summary. */
  createReminder: (request: string) => Promise<string>;
  /** Delete an approved skill by name; returns whether it existed. */
  deleteSkill: (name: string) => Promise<boolean>;
  /** Current approval mode, so "always" forces approval on every action. */
  approvalMode: ApprovalMode;
  /** Per-tool approval overrides. */
  toolApprovals?: Record<string, "always" | "never">;
}

const skillNameSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "lowercase, alphanumeric, hyphens only");

export function createActions(deps: ActionDeps): Record<string, Action> {
  // Approval decision comes from the shared tool-policy (src/core/tool-policy),
  // keyed by the action's own name — one source of truth across every gate.
  const gate = (name: string): boolean =>
    shouldApprove(name, deps.approvalMode, deps.toolApprovals);

  const receipt = (name: string, key: string | null, input: unknown, output: unknown) =>
    deps.receipts.write({
      action: name,
      idempotencyKey: key,
      input,
      output,
      actor: deps.actor,
    });

  return {
    send_message: action({
      description:
        "Send the user a proactive message across their channels (push, email, in-app). " +
        "Use for reminders, alerts, or answers when the user is away.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(2000),
        ref: z
          .string()
          .max(120)
          .optional()
          .describe("Stable id to avoid sending the same message twice"),
      }),
      // Only dedupe when the model supplies an explicit ref. Deduping on title
      // would silently swallow unrelated messages that share a title.
      idempotencyKey: ({ input }) =>
        input.ref ? `send:${input.ref}` : `send:${crypto.randomUUID()}`,
      permissions: ["notify:send"],
      approvalRisk: "low",
      approval: gate("send_message"),
      execute: async ({ title, body, ref }) => {
        await deps.notify(title, body);
        const output = { delivered: true, at: new Date().toISOString() };
        receipt("send_message", ref ?? title, { title, body }, output);
        return output;
      },
    }),

    set_reminder: action({
      description:
        "Schedule a reminder for the user from a natural-language time " +
        "(e.g. 'tomorrow at 3pm', 'every weekday at 9am').",
      inputSchema: z.object({
        request: z
          .string()
          .min(3)
          .max(300)
          .describe("What to be reminded of and when, in plain language"),
      }),
      // Same exact request = same reminder; a retry after a stall shouldn't
      // create a duplicate schedule.
      idempotencyKey: ({ input }) => `reminder:${input.request}`,
      permissions: ["reminder:write"],
      approvalRisk: "low",
      approval: gate("set_reminder"),
      execute: async ({ request }) => {
        const summary = await deps.createReminder(request);
        const output = { scheduled: summary };
        receipt("set_reminder", `reminder:${request}`, { request }, output);
        return output;
      },
    }),

    save_memory: action({
      description:
        "Remember a durable fact about the user (preferences, context, " +
        "ongoing projects) so it persists across conversations.",
      inputSchema: z.object({
        fact: z.string().min(3).max(500).describe("A concise fact to remember"),
      }),
      // Remembering the same fact twice is a no-op.
      idempotencyKey: ({ input }) => `memory:${input.fact}`,
      permissions: ["memory:write"],
      approvalRisk: "low",
      approval: gate("save_memory"),
      execute: async ({ fact }) => {
        await deps.saveMemory(fact);
        const output = { remembered: fact };
        receipt("save_memory", `memory:${fact}`, { fact }, output);
        return output;
      },
    }),

    remove_skill: action({
      description:
        "Permanently delete an approved skill by name. Destructive — the " +
        "skill and its embedding are removed.",
      inputSchema: z.object({ name: skillNameSchema }),
      idempotencyKey: ({ input }) => `remove-skill:${input.name}`,
      permissions: ["skill:write"],
      approvalRisk: "medium",
      approval: gate("remove_skill"),
      execute: async ({ name }) => {
        const existed = await deps.deleteSkill(name);
        const output = { removed: existed, name };
        receipt("remove_skill", name, { name }, output);
        return output;
      },
    }),
  };
}
