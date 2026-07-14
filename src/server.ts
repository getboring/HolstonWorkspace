import { Think, skills, type ThinkScheduledTasks, type TurnConfig } from "@cloudflare/think";
import {
  normalizeMessengers,
  ThinkMessengerStateAgent,
  type ThinkMessengers,
} from "@cloudflare/think/messengers";
import telegramMessenger from "@cloudflare/think/messengers/telegram";
import { getAgentByName, routeAgentRequest } from "agents";
import bundledSkills from "agents:skills";
import { createWorkersAI } from "workers-ai-provider";
import { createSkillTools } from "./skills/tools";
import { retrieverHook, nudgerHook, curatorHook } from "./skills/hooks";
import { SkillStore } from "./skills/store";
import { verifyAccessJWT, agentNameFromEmail } from "./auth";

export { ThinkMessengerStateAgent };

const DEFAULT_AGENT = "default";

export class HolstonAgent extends Think<Env> {
  chatRecovery = true;

  override onStart() {
    if (this.env.MCP_SERVER_URL) {
      this.mcp.connect(this.env.MCP_SERVER_URL).catch((err: unknown) =>
        console.error("[holston] MCP connect failed:", err)
      );
    }
  }

  override getModel() {
    return createWorkersAI({ binding: this.env.AI })(
      "@cf/moonshotai/kimi-k2.7-code",
    );
  }

  override getSystemPrompt() {
    return [
      "You are Holston, a cloud-native AI agent running on Cloudflare Workers.",
      "You help with coding, research, home automation, and general tasks.",
      "You have access to workspace file tools (bash, read, write, edit, grep, find, list, delete),",
      "MCP servers, browser automation, code execution, and agent skills.",
      "When you solve a complex problem (5+ tool calls), the system may suggest saving a skill.",
      "Be concise, direct, and helpful. Use tools when needed but explain what you are doing.",
    ].join("\n");
  }

  override getTools() {
    const store = new SkillStore(
      this.env.SKILLS_BUCKET,
      this.env.SKILLS_INDEX,
      this.env.AI,
    );
    return createSkillTools(store, this);
  }

  override getSkills() {
    return [
      bundledSkills,
      skills.r2(this.env.SKILLS_BUCKET, { prefix: "skills/" }),
    ];
  }

  override getMessengers() {
    if (!this.env.TELEGRAM_BOT_TOKEN) {
      return normalizeMessengers({}) as unknown as ThinkMessengers;
    }

    return normalizeMessengers({
      telegram: telegramMessenger({
        token: this.env.TELEGRAM_BOT_TOKEN,
        userName: this.env.TELEGRAM_BOT_USERNAME ?? "holston_bot",
        secretToken: this.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
        conversation: "self",
        respondTo: ["direct-message", "mention"],
      }),
    }) as unknown as ThinkMessengers;
  }

  override getScheduledTasks(): ThinkScheduledTasks {
    return {
      dailyDigest: {
        schedule: "every day at 08:00 in America/New_York",
        prompt:
          "Summarize yesterday's activity and send me a brief digest via Telegram.",
      },
      weeklySkillReview: {
        schedule: "every week on sunday at 22:00 in America/New_York",
        prompt:
          "Review all skills created or modified this week. Suggest improvements or consolidations.",
      },
    };
  }

  override async beforeTurn(
    ctx: Parameters<Think<Env>["beforeTurn"]>[0],
  ): Promise<void | TurnConfig> {
    const store = this.skillStore();
    const result = await retrieverHook(store, ctx, this.getSystemPrompt());
    if (result && typeof result === "object" && "systemPrompt" in result) {
      return { systemPrompt: result.systemPrompt } as TurnConfig;
    }
  }

  override async onChatResponse(
    result: Parameters<Think<Env>["onChatResponse"]>[0],
  ) {
    const store = this.skillStore();
    await nudgerHook(store, this as unknown as { sql?: SqlStorage }, result as never);
    await curatorHook(store, this.env.AI, result as never, this.session as never);
  }

  private skillStore(): SkillStore {
    return new SkillStore(
      this.env.SKILLS_BUCKET,
      this.env.SKILLS_INDEX,
      this.env.AI,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        agent: "holston-workspace",
        version: "0.2.0",
        timestamp: new Date().toISOString(),
        auth: env.TEAM_DOMAIN ? "cf-access" : "none",
        telegram: env.TELEGRAM_BOT_TOKEN ? "configured" : "not-configured",
        skills: "enabled",
      });
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/setup/telegram-webhook"
    ) {
      return setupTelegramWebhook(request, env);
    }

    if (request.method === "GET" && url.pathname === "/setup/info") {
      const user = await verifyAccessJWT(request, env);
      return Response.json({
        agentName: user ? agentNameFromEmail(user.email) : DEFAULT_AGENT,
        webhookPath: "/messengers/telegram/webhook",
        authenticated: !!user,
        user: user?.email ?? null,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/skills") {
      const store = new SkillStore(env.SKILLS_BUCKET, env.SKILLS_INDEX, env.AI);
      const all = await store.list();
      return Response.json({ skills: all }, { headers: { "access-control-allow-origin": "*" } });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const user = await verifyAccessJWT(request, env);
      if (env.TEAM_DOMAIN && !user) {
        return new Response("Unauthorized", { status: 403 });
      }
      return env.ASSETS.fetch(request);
    }

    if (url.pathname.startsWith("/assets/")) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },

  async email(message: ForwardableEmailMessage, env: Env) {
    const agentName = agentNameFromEmail(message.from);
    const agent = await getAgentByName(env.HolstonAgent as never, agentName);
    const subject = message.headers.get("subject") ?? "(no subject)";
    const rawEmail = await new Response(message.raw).text();
    const bodyText = extractEmailBody(rawEmail);

    (agent as never as { submitMessages: (opts: never) => Promise<unknown> }).submitMessages({
      messages: [
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: `[Email from ${message.from}]\nSubject: ${subject}\n\n${bodyText}`,
            },
          ],
        },
      ],
      metadata: {
        source: "email",
        from: message.from,
        subject,
      },
    } as never);
  },
} satisfies ExportedHandler<Env>;

async function setupTelegramWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return Response.json(
      { error: "TELEGRAM_BOT_TOKEN not set" },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const webhookUrl = `${url.origin}/messengers/telegram/webhook`;
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      body: JSON.stringify({
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
        url: webhookUrl,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );

  const result = await response.json();
  return Response.json(
    { ok: response.ok, result, webhookUrl },
    { status: response.ok ? 200 : 502 },
  );
}

function extractEmailBody(raw: string): string {
  const bodyMatch = raw.match(/\r?\n\r?\n([\s\S]*)$/);
  if (!bodyMatch) return raw;
  const body = bodyMatch[1] ?? "";
  if (body.includes("Content-Transfer-Encoding: quoted-printable")) {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
  }
  return body.trim();
}