import {
  Think,
  skills,
  type ChatResponseResult,
  type ThinkScheduledTasks,
  type TurnConfig,
  type TurnContext,
} from "@cloudflare/think";
import {
  ThinkMessengerStateAgent,
  type ThinkMessengers,
} from "@cloudflare/think/messengers";
import telegramMessenger from "@cloudflare/think/messengers/telegram";
import { getAgentByName, routeAgentEmail, routeAgentRequest } from "agents";
import {
  createSecureReplyEmailResolver,
  isAutoReplyEmail,
  type AgentEmail,
} from "agents/email";
import bundledSkills from "agents:skills";
import PostalMime from "postal-mime";
import { createWorkersAI } from "workers-ai-provider";
import { agentNameFromEmail, verifyAccessJWT, type AuthUser } from "./auth";
import { curatorHook, nudgerHook, retrieverHook } from "./skills/hooks";
import { SkillStore } from "./skills/store";
import { createSkillTools } from "./skills/tools";

export { ThinkMessengerStateAgent };

const DEFAULT_AGENT = "default";
const AGENT_CLASS = "HolstonAgent";
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export class HolstonAgent extends Think<Env> {
  chatRecovery = true;
  // MCP tools are merged into the tool set once connections are ready; wait
  // (default 10s cap) so the first turn after a wake doesn't miss them.
  waitForMcpConnections = true;

  #skillStore?: SkillStore;

  override async onStart() {
    if (this.env.MCP_SERVER_URL) {
      try {
        // addMcpServer is idempotent for a matching name+url: registration and
        // OAuth tokens persist in SQLite and reconnect on every wake, so this
        // never accumulates duplicates (unlike raw this.mcp.connect()).
        await this.addMcpServer("holston-mcp", this.env.MCP_SERVER_URL);
      } catch (err) {
        console.error("[holston] MCP server registration failed:", err);
      }
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
    return createSkillTools(this.skillStore(), this);
  }

  override getSkills() {
    return [
      bundledSkills,
      skills.r2(this.env.SKILLS_BUCKET, { prefix: "skills/" }),
    ];
  }

  override getMessengers(): ThinkMessengers {
    if (!this.env.TELEGRAM_BOT_TOKEN) {
      return {};
    }
    if (!this.env.TELEGRAM_WEBHOOK_SECRET_TOKEN) {
      console.warn(
        "[holston] TELEGRAM_WEBHOOK_SECRET_TOKEN missing — Telegram disabled (webhook mode requires a secret token)",
      );
      return {};
    }

    return {
      telegram: telegramMessenger({
        token: this.env.TELEGRAM_BOT_TOKEN,
        userName: this.env.TELEGRAM_BOT_USERNAME ?? "holston_bot",
        secretToken: this.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
        conversation: "self",
        respondTo: ["direct-message", "mention"],
      }),
    };
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

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig | void> {
    const system = await retrieverHook(this.skillStore(), ctx);
    if (system) {
      return { system };
    }
  }

  override async onChatResponse(result: ChatResponseResult) {
    nudgerHook(this, result);
    await curatorHook(this.skillStore(), this.env.AI, result);
  }

  /**
   * Incoming email, delivered by routeAgentEmail after the resolver has
   * authorized the sender. The Message-ID keys idempotency so redelivery
   * of the same email never produces a duplicate turn.
   */
  async onEmail(email: AgentEmail) {
    const parsed = await PostalMime.parse(await email.getRaw());
    if (isAutoReplyEmail(parsed.headers)) {
      console.log(`[holston] Ignoring auto-reply from ${email.from}`);
      return;
    }

    const subject = parsed.subject ?? "(no subject)";
    const body = (parsed.text ?? stripHtml(parsed.html) ?? "").trim();

    await this.submitMessages(
      [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [
            {
              type: "text",
              text: `[Email from ${email.from}]\nSubject: ${subject}\n\n${body}`,
            },
          ],
        },
      ],
      {
        idempotencyKey: parsed.messageId ?? undefined,
        metadata: { source: "email", from: email.from, subject },
      },
    );
  }

  private skillStore(): SkillStore {
    this.#skillStore ??= new SkillStore(
      this.env.SKILLS_BUCKET,
      this.env.SKILLS_INDEX,
      this.env.AI,
    );
    return this.#skillStore;
  }
}

function accessConfigured(env: Env): boolean {
  return Boolean(env.TEAM_DOMAIN && env.POLICY_AUD);
}

/**
 * Defense-in-depth behind Cloudflare Access: verify the JWT Access injects.
 * When Access is not configured (local dev), requests pass with no user and
 * everything binds to the shared "default" instance.
 */
async function authorize(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser | null } | Response> {
  if (!accessConfigured(env)) {
    return { user: null };
  }
  const user = await verifyAccessJWT(request, env);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  return { user };
}

function instanceForUser(user: AuthUser | null): string {
  return user ? agentNameFromEmail(user.email) : DEFAULT_AGENT;
}

/** The agent instance that owns Telegram and scheduled-messenger traffic. */
function ownerInstance(env: Env): string {
  return env.OWNER_EMAIL ? agentNameFromEmail(env.OWNER_EMAIL) : DEFAULT_AGENT;
}

function allowedEmailSenders(env: Env): Set<string> {
  const senders = new Set<string>();
  for (const entry of (env.ALLOWED_EMAIL_SENDERS ?? "").split(",")) {
    const email = entry.trim().toLowerCase();
    if (email) senders.add(email);
  }
  if (env.OWNER_EMAIL) senders.add(env.OWNER_EMAIL.trim().toLowerCase());
  return senders;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        agent: "holston-workspace",
        timestamp: new Date().toISOString(),
      });
    }

    // Every agent route (WebSocket chat, voice, HTTP RPC) requires the Access
    // JWT, and the URL's instance name must match the authenticated user's own
    // instance — user A can never open user B's agent.
    const guardAgentRoute = async (
      req: Request,
      lobby: { name: string },
    ): Promise<Response | undefined> => {
      const auth = await authorize(req, env);
      if (auth instanceof Response) return auth;
      if (lobby.name !== instanceForUser(auth.user)) {
        return new Response("Forbidden", { status: 403 });
      }
      return undefined;
    };

    const agentResponse = await routeAgentRequest(request, env, {
      onBeforeConnect: guardAgentRoute,
      onBeforeRequest: guardAgentRoute,
    });
    if (agentResponse) {
      return agentResponse;
    }

    // Messenger webhooks (e.g. Telegram) are handled inside the root Think
    // agent's onRequest — forward them to the owner's instance. Authenticity
    // is enforced by the messenger's own verifyWebhook (Telegram secret token).
    if (url.pathname.startsWith("/messengers/") && request.method === "POST") {
      const agent = await getAgentByName(env.HolstonAgent, ownerInstance(env));
      return agent.fetch(request);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/setup/telegram-webhook"
    ) {
      const auth = await authorize(request, env);
      if (auth instanceof Response) return auth;
      return setupTelegramWebhook(request, env);
    }

    if (request.method === "GET" && url.pathname === "/setup/info") {
      const auth = await authorize(request, env);
      if (auth instanceof Response) return auth;
      return Response.json({
        agentName: instanceForUser(auth.user),
        webhookPath: "/messengers/telegram/webhook",
        authenticated: !!auth.user,
        user: auth.user?.email ?? null,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/skills") {
      const auth = await authorize(request, env);
      if (auth instanceof Response) return auth;
      const store = new SkillStore(env.SKILLS_BUCKET, env.SKILLS_INDEX, env.AI);
      const [approved, pending] = await Promise.all([
        store.list(),
        store.listPending(),
      ]);
      return Response.json({ skills: approved, pending });
    }

    const pendingAction = url.pathname.match(
      /^\/api\/skills\/pending\/([^/]+)\/(approve|reject)$/,
    );
    if (request.method === "POST" && pendingAction) {
      const auth = await authorize(request, env);
      if (auth instanceof Response) return auth;
      const name = decodeURIComponent(pendingAction[1] ?? "");
      if (!SKILL_NAME_PATTERN.test(name)) {
        return Response.json({ error: "Invalid skill name" }, { status: 400 });
      }
      const store = new SkillStore(env.SKILLS_BUCKET, env.SKILLS_INDEX, env.AI);
      if (pendingAction[2] === "approve") {
        const approved = await store.approvePending(name);
        if (!approved) {
          return Response.json(
            { error: `No pending skill "${name}"` },
            { status: 404 },
          );
        }
        return Response.json({ ok: true, skill: approved });
      }
      await store.rejectPending(name);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const auth = await authorize(request, env);
      if (auth instanceof Response) return auth;
      return env.ASSETS.fetch(request);
    }

    if (url.pathname.startsWith("/assets/")) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },

  async email(message: ForwardableEmailMessage, env: Env) {
    await routeAgentEmail(message, env, {
      resolver: async (email, env) => {
        // Replies to signed outbound mail route back via HMAC verification.
        if (env.EMAIL_SIGNING_SECRET) {
          const secureResolver = createSecureReplyEmailResolver<Env>(
            env.EMAIL_SIGNING_SECRET,
            {
              onInvalidSignature: (rejected, reason) => {
                console.warn(
                  `[holston] Email reply signature rejected from ${rejected.from}: ${reason}`,
                );
              },
            },
          );
          const replyRouting = await secureResolver(email, env);
          if (replyRouting) return replyRouting;
        }

        // Fresh inbound mail: only allowlisted senders, each routed to their
        // own instance (the same instance their Access web session uses).
        const from = email.from.trim().toLowerCase();
        if (!allowedEmailSenders(env).has(from)) {
          return null;
        }
        return { agentName: AGENT_CLASS, agentId: agentNameFromEmail(from) };
      },
      onNoRoute: (email) => {
        console.warn(
          `[holston] Rejecting email from unauthorized sender: ${email.from}`,
        );
        email.setReject("Sender not authorized");
      },
    });
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

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
