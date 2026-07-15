import { generateObject } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { DEFAULT_MODEL } from "../shared/state";

export const emailTriageSchema = z.object({
  classification: z
    .enum(["actionable", "notification", "spam"])
    .describe(
      "actionable = needs a reply; notification = FYI only; spam = junk",
    ),
  shouldReply: z
    .boolean()
    .describe("Whether a reply is warranted (false for notifications/spam)"),
  summary: z.string().max(200).describe("One-line summary of the email"),
});

export interface EmailTriage {
  classification: "actionable" | "notification" | "spam";
  shouldReply: boolean;
  summary: string;
}

/**
 * Lightweight AI triage before spending a full turn on an email: drop spam,
 * and only reply when the email actually asks for something.
 */
export async function classifyEmail(
  ai: Ai,
  subject: string,
  body: string,
): Promise<EmailTriage> {
  const model = createWorkersAI({ binding: ai })(DEFAULT_MODEL);
  const { object } = await generateObject({
    model,
    schema: emailTriageSchema,
    system:
      "Triage an inbound email. Classify it and decide whether a reply is warranted. " +
      "Notifications, receipts, and automated alerts are 'notification' with shouldReply false. " +
      "Unsolicited marketing or scams are 'spam'. Genuine questions/requests are 'actionable'.",
    prompt: `Subject: ${subject}\n\n${body.slice(0, 2000)}`,
  });
  return object;
}

/** Extract the text of the most recent assistant message (for email replies). */
export function lastAssistantText(
  messages: Array<{
    role: string;
    parts?: Array<{ type: string; text?: string }>;
  }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant") continue;
    const text = (m.parts ?? [])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    return text || undefined;
  }
  return undefined;
}

/** Strip HTML to plain text for email bodies that lack a text/plain part. */
export function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
