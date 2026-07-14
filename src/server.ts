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
import {
  callable,
  getAgentByName,
  routeAgentEmail,
  routeAgentRequest,
  type Schedule,
} from "agents";
import {
  createSecureReplyEmailResolver,
  isAutoReplyEmail,
  type AgentEmail,
} from "agents/email";
import { getSchedulePrompt, scheduleSchema } from "agents/schedule";
import bundledSkills from "agents:skills";
import { generateObject } from "ai";
import PostalMime from "postal-mime";
import { createWorkersAI } from "workers-ai-provider";
import { agentNameFromEmail, verifyAccessJWT, type AuthUser } from "./auth";
import { sendPush } from "./push";
import {
  DEFAULT_MODEL,
  INITIAL_STATE,
  isApprovalMode,
  isValidModel,
  type HolstonSettings,
  type HolstonState,
  type McpServerView,
  type PushSubscriptionRecord,
  type ReminderView,
} from "./shared/state";
import { curatorHook, nudgerHook, retrieverHook } from "./skills/hooks";
import { SkillStore } from "./skills/store";
import { createSkillTools } from "./skills/tools";

export { ThinkMessengerStateAgent };

const DEFAULT_AGENT = "default";
const AGENT_CLASS = "HolstonAgent";
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REMINDER_CALLBACK = "runReminder";

export class HolstonAgent extends Think<Env, HolstonState> {
  chatRecovery = true;
  waitForMcpConnections = true;
  initialState: HolstonState = INITIAL_STATE;

  #skillStore?: SkillStore;

  override async onStart() {
    if (this.env.MCP_SERVER_URL) {
      try {
        await this.addMcpServer("holston-mcp", this.env.MCP_SERVER_URL);
      } catch (err) {
        console.error("[holston] MCP server registration failed:", err);
      }
    }
    // Reconcile the synced view of MCP servers + reminders on every wake.
    await this.syncMcpState();
    await this.syncReminders();
  }

  /** Reject client-pushed state; all mutations go through @callable methods. */
  override validateStateChange(_next: HolstonState, source: unknown) {
    if (source !== "server") {
      throw new Error("State is read-only from clients; use RPC methods.");
    }
  }

  override getModel() {
    const model = this.state?.settings.model ?? DEFAULT_MODEL;
    return createWorkersAI({ binding: this.env.AI })(model);
  }

  override getSystemPrompt() {
    const base = [
      "You are Holston, a cloud-native AI agent running on Cloudflare Workers.",
      "You help with coding, research, home automation, and general tasks.",
      "You have access to workspace file tools (bash, read, write, edit, grep, find, list, delete),",
      "MCP servers, browser automation, code execution, and agent skills.",
      "You can set reminders and recurring tasks, and reach the user via Telegram, email, and push.",
      "When you solve a complex problem (5+ tool calls), the system may propose saving a skill.",
      "Be concise, direct, and helpful. Use tools when needed but explain what you are doing.",
    ].join("\n");
    const custom = this.state?.settings.customInstructions?.trim();
    return custom ? `${base}\n\nUser instructions:\n${custom}` : base;
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
    if (!this.env.TELEGRAM_BOT_TOKEN) return {};
    if (!this.env.TELEGRAM_WEBHOOK_SECRET_TOKEN) {
      console.warn(
        "[holston] TELEGRAM_WEBHOOK_SECRET_TOKEN missing — Telegram disabled",
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
    if (this.state?.settings.autoSkills === false) return;
    const system = await retrieverHook(this.skillStore(), ctx);
    if (system) return { system };
  }

  override async onChatResponse(result: ChatResponseResult) {
    nudgerHook(this, result);
    if (this.state?.settings.autoSkills !== false) {
      await curatorHook(this.skillStore(), this.env.AI, result);
    }
  }

  // ── Settings (synced state) ────────────────────────────────────────────

  @callable()
  async updateSettings(
    patch: Partial<HolstonSettings>,
  ): Promise<HolstonSettings> {
    const current = this.state.settings;
    const next: HolstonSettings = { ...current };

    if (patch.model !== undefined) {
      if (!isValidModel(patch.model)) throw new Error("Unknown model");
      next.model = patch.model;
    }
    if (patch.autoSkills !== undefined) next.autoSkills = !!patch.autoSkills;
    if (patch.approvalMode !== undefined) {
      if (!isApprovalMode(patch.approvalMode)) {
        throw new Error("Invalid approval mode");
      }
      next.approvalMode = patch.approvalMode;
    }
    if (patch.customInstructions !== undefined) {
      next.customInstructions = String(patch.customInstructions).slice(0, 4000);
    }

    this.setState({ ...this.state, settings: next });
    return next;
  }

  // ── MCP server management ──────────────────────────────────────────────

  @callable()
  async connectMcpServer(
    name: string,
    url: string,
  ): Promise<{ id: string; state: string; authUrl?: string }> {
    if (!/^https?:\/\//.test(url)) throw new Error("MCP URL must be http(s)");
    const result = await this.addMcpServer(name.slice(0, 64), url);
    await this.syncMcpState();
    return "authUrl" in result
      ? { id: result.id, state: result.state, authUrl: result.authUrl }
      : { id: result.id, state: result.state };
  }

  @callable()
  async disconnectMcpServer(id: string): Promise<{ ok: boolean }> {
    await this.removeMcpServer(id);
    await this.syncMcpState();
    return { ok: true };
  }

  @callable()
  async refreshMcpServers(): Promise<McpServerView[]> {
    await this.syncMcpState();
    return this.state.mcpServers;
  }

  // ── Reminders / scheduling ─────────────────────────────────────────────

  /**
   * Create a reminder from natural language ("remind me to call mom tomorrow
   * at 3pm", "every weekday at 9am send a standup prompt"). Parsed with the
   * SDK's schedule schema, then registered as a durable schedule.
   */
  @callable()
  async createReminder(request: string): Promise<ReminderView> {
    const model = createWorkersAI({ binding: this.env.AI })(DEFAULT_MODEL);
    const { object } = await generateObject({
      model,
      schema: scheduleSchema,
      system: getSchedulePrompt({ date: new Date() }),
      prompt: request,
    });

    const message = object.description || request;
    const when = object.when;
    let schedule: Schedule<{ message: string }>;

    if (when.type === "scheduled" && when.date) {
      schedule = await this.schedule(new Date(when.date), REMINDER_CALLBACK, {
        message,
      });
    } else if (when.type === "delayed" && when.delayInSeconds) {
      schedule = await this.schedule(when.delayInSeconds, REMINDER_CALLBACK, {
        message,
      });
    } else if (when.type === "cron" && when.cron) {
      schedule = await this.schedule(when.cron, REMINDER_CALLBACK, { message });
    } else {
      throw new Error(
        "Could not parse a time from that request. Try 'tomorrow at 3pm' or 'every weekday at 9am'.",
      );
    }

    await this.syncReminders();
    return toReminderView(schedule);
  }

  @callable()
  async listReminders(): Promise<ReminderView[]> {
    await this.syncReminders();
    return this.state.reminders;
  }

  @callable()
  async cancelReminder(id: string): Promise<{ ok: boolean }> {
    const ok = await this.cancelSchedule(id);
    await this.syncReminders();
    return { ok };
  }

  /** Schedule callback: fires the reminder across every channel we have. */
  async runReminder(payload: { message: string }) {
    await this.notifyUser("Reminder", payload.message, { url: "/" });
    // Also inject it into the conversation so the model can act on it.
    await this.submitMessages(
      [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: `[Reminder] ${payload.message}` }],
        },
      ],
      { metadata: { source: "reminder" } },
    );
    await this.syncReminders();
  }

  // ── Push notifications ─────────────────────────────────────────────────

  @callable()
  getVapidPublicKey(): string | null {
    return this.env.VAPID_PUBLIC_KEY ?? null;
  }

  @callable()
  async subscribePush(
    subscription: PushSubscriptionRecord,
  ): Promise<{ ok: boolean }> {
    if (!subscription?.endpoint) throw new Error("Invalid subscription");
    const exists = this.state.pushSubscriptions.some(
      (s) => s.endpoint === subscription.endpoint,
    );
    if (!exists) {
      this.setState({
        ...this.state,
        pushSubscriptions: [...this.state.pushSubscriptions, subscription],
      });
    }
    return { ok: true };
  }

  @callable()
  async unsubscribePush(endpoint: string): Promise<{ ok: boolean }> {
    this.setState({
      ...this.state,
      pushSubscriptions: this.state.pushSubscriptions.filter(
        (s) => s.endpoint !== endpoint,
      ),
    });
    return { ok: true };
  }

  // ── Email ──────────────────────────────────────────────────────────────

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

  // ── Internal helpers ───────────────────────────────────────────────────

  /**
   * Fan a proactive message out to every channel: push (offline-capable),
   * connected web clients (broadcast), and email if an owner address is set.
   */
  private async notifyUser(
    title: string,
    body: string,
    opts: { url?: string } = {},
  ) {
    const { deadEndpoints } = await sendPush(
      this.env,
      this.state.pushSubscriptions,
      { title, body, url: opts.url, tag: "holston" },
    );
    if (deadEndpoints.length > 0) {
      this.setState({
        ...this.state,
        pushSubscriptions: this.state.pushSubscriptions.filter(
          (s) => !deadEndpoints.includes(s.endpoint),
        ),
      });
    }
    this.broadcast(
      JSON.stringify({ type: "notification", title, body, at: Date.now() }),
    );
  }

  private async syncMcpState() {
    const mcp = this.getMcpServers();
    const views: McpServerView[] = Object.entries(mcp.servers).map(
      ([id, server]) => ({
        id,
        name: server.name,
        url: server.server_url,
        state: server.state,
        authUrl: server.auth_url,
        error: server.error,
        toolCount: mcp.tools.filter((t) => t.serverId === id).length,
      }),
    );
    this.setState({ ...this.state, mcpServers: views });
  }

  private async syncReminders() {
    const schedules = await this.listSchedules();
    const views = schedules
      .filter((s) => s.callback === REMINDER_CALLBACK)
      .map((s) => toReminderView(s as Schedule<{ message: string }>));
    this.setState({ ...this.state, reminders: views });
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

function toReminderView(schedule: Schedule<{ message: string }>): ReminderView {
  const message = schedule.payload?.message ?? "(reminder)";
  const recurring = schedule.type === "cron" || schedule.type === "interval";
  const nextRun = "time" in schedule ? schedule.time * 1000 : null;
  let when: string;
  switch (schedule.type) {
    case "cron":
      when = `cron: ${schedule.cron}`;
      break;
    case "interval":
      when = `every ${schedule.intervalSeconds}s`;
      break;
    default:
      when = nextRun ? new Date(nextRun).toLocaleString() : "scheduled";
  }
  return { id: schedule.id, message, when, nextRun, kind: schedule.type, recurring };
}

// ── Worker fetch/email handlers ──────────────────────────────────────────

function accessConfigured(env: Env): boolean {
  return Boolean(env.TEAM_DOMAIN && env.POLICY_AUD);
}

async function authorize(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser | null } | Response> {
  if (!accessConfigured(env)) return { user: null };
  const user = await verifyAccessJWT(request, env);
  if (!user) return new Response("Unauthorized", { status: 401 });
  return { user };
}

function instanceForUser(user: AuthUser | null): string {
  return user ? agentNameFromEmail(user.email) : DEFAULT_AGENT;
}

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
    if (agentResponse) return agentResponse;

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

    if (url.pathname.startsWith("/assets/") || url.pathname === "/sw.js") {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },

  async email(message: ForwardableEmailMessage, env: Env) {
    await routeAgentEmail(message, env, {
      resolver: async (email, env) => {
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
        const from = email.from.trim().toLowerCase();
        if (!allowedEmailSenders(env).has(from)) return null;
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
    return Response.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 400 });
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
