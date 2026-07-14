import {
  Session,
  Think,
  defaultContextOverflowClassifier,
  skills,
  type Action,
  type ActionAuthorizationDecision,
  type ChatErrorClassification,
  type ChatResponseResult,
  type ThinkScheduledTasks,
  type ToolCallContext,
  type ToolCallDecision,
  type TurnConfig,
  type TurnContext,
} from "@cloudflare/think";
import {
  ThinkMessengerStateAgent,
  type ThinkMessengers,
} from "@cloudflare/think/messengers";
import telegramMessenger from "@cloudflare/think/messengers/telegram";
import { createBrowserTools } from "@cloudflare/think/tools/browser";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import { CodemodeRuntime } from "@cloudflare/codemode";
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
import bundledSkills from "agents:skills";
import { generateObject, generateText, type ToolSet } from "ai";
import PostalMime from "postal-mime";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import {
  createCompactFunction,
  estimateMessageTokens,
} from "agents/experimental/memory/utils";
import { R2SkillProvider } from "agents/experimental/memory/session";
import { createActions } from "./actions";
import { agentNameFromEmail, verifyAccessJWT, type AuthUser } from "./auth";
import { assertSameOrigin } from "./core/csrf";
import { subscribeObservability } from "./observability";
import { sendPush } from "./push";
import { ReceiptStore, type Receipt } from "./receipts";
import {
  DEFAULT_MODEL,
  DEFAULT_SETTINGS,
  DEFAULT_TIMEZONE,
  INITIAL_STATE,
  isApprovalMode,
  isValidModel,
  isValidTimezone,
  type HolstonSettings,
  type HolstonState,
  type McpServerView,
  type PushSubscriptionRecord,
  type ReminderView,
} from "./shared/state";
import { curatorHook, nudgerHook, retrieverHook } from "./skills/hooks";
import { SkillStore } from "./skills/store";
import { createSkillTools } from "./skills/tools";

// The Codemode runtime must be exported from the Worker entry so the
// WorkerLoader can instantiate it for the execute tool.
export { ThinkMessengerStateAgent, CodemodeRuntime };

const DEFAULT_AGENT = "default";
const AGENT_CLASS = "HolstonAgent";
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REMINDER_CALLBACK = "runReminder";

/**
 * Reminder schedule payload. `localCron`/`tz` are present only for recurring
 * reminders, so the UTC cron can be re-derived across DST transitions.
 */
interface ReminderPayload {
  message: string;
  localCron?: string;
  tz?: string;
}

// Built-in workspace tools that can mutate the workspace or run code. Gated by
// approvalMode; read-only tools (read/list/find/grep) are never gated.
const DESTRUCTIVE_TOOLS = new Set(["bash", "write", "edit", "delete"]);

export class HolstonAgent extends Think<Env, HolstonState> {
  chatRecovery = true;
  waitForMcpConnections = true;
  initialState: HolstonState = INITIAL_STATE;

  // Compact-and-retry when a turn overflows the model context instead of
  // hard-failing. The stall watchdog measures the gap BETWEEN stream chunks,
  // which includes server-side tool execution (bash builds, MCP calls, HTTP
  // fetches) — so it must sit above the slowest tool, not just model TTFT.
  contextOverflow = { reactive: true, maxRetries: 1 };
  chatStreamStallTimeoutMs = 120_000;

  // Read-only, allowlisted HTTP fetch so "research" in the system prompt is real
  // (backs it without needing an MCP server). GET-only, bounded, audited.
  fetchTools = {
    allowlist: [
      "https://developers.cloudflare.com/**",
      "https://*.wikipedia.org/**",
      "https://raw.githubusercontent.com/**",
      "https://api.github.com/**",
    ],
  };

  #skillStore?: SkillStore;
  #receiptStore?: ReceiptStore;
  #obsDisposer?: () => void;

  override async onStart() {
    // Surface scheduled-task / chat-recovery / MCP failures that are otherwise
    // silent. Idempotent per isolate — dispose any prior subscription first.
    this.#obsDisposer?.();
    this.#obsDisposer = subscribeObservability();

    // Schema evolution: backfill any settings fields added after this DO's
    // state was first persisted (e.g. `timezone`), so older instances get new
    // defaults instead of `undefined`.
    const merged = { ...DEFAULT_SETTINGS, ...this.state.settings };
    if (JSON.stringify(merged) !== JSON.stringify(this.state.settings)) {
      this.setState({ ...this.state, settings: merged });
    }
    this.syncReceiptCount();

    if (this.env.MCP_SERVER_URL) {
      try {
        await this.addMcpServer("holston-mcp", this.env.MCP_SERVER_URL);
      } catch (err) {
        console.error("[holston] MCP server registration failed:", err);
      }
    }
    // Correct any recurring-reminder DST drift, then reconcile the synced view
    // of MCP servers + reminders on every wake.
    await this.reconcileCronDrift();
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

  override getDefaultTimezone() {
    return this.state?.settings.timezone ?? DEFAULT_TIMEZONE;
  }

  override getSystemPrompt() {
    // Only advertise capabilities that are actually wired, so the model never
    // claims a tool it doesn't have.
    const capabilities = [
      "workspace file tools (bash, read, write, edit, grep, find, list, delete)",
      "MCP servers",
    ];
    if (this.env.LOADER) {
      capabilities.push("code execution (run generated code in a sandbox)");
    }
    if (this.env.BROWSER) {
      capabilities.push("browser automation (navigate, screenshot, extract)");
    }
    capabilities.push("agent skills");

    const base = [
      "You are Holston, a cloud-native AI agent running on Cloudflare Workers.",
      "You help with coding, research, home automation, and general tasks.",
      `You have access to ${capabilities.join(", ")}.`,
      "You can set reminders and recurring tasks, and reach the user via Telegram, email, and push.",
      "When you solve a complex problem (5+ tool calls), the system may propose saving a skill.",
      "Be concise, direct, and helpful. Use tools when needed but explain what you are doing.",
    ].join("\n");
    const custom = this.state?.settings.customInstructions?.trim();
    return custom ? `${base}\n\nUser instructions:\n${custom}` : base;
  }

  override getTools() {
    // Skill-write tools honor approvalMode: gated in always/destructive-only,
    // ungated in never. (Skill writes are treated as destructive.)
    const gated = this.state?.settings.approvalMode !== "never";
    const tools: ToolSet = createSkillTools(this.skillStore(), this, gated);

    // Cloudflare-native code execution (Codemode): runs model-generated code in
    // an isolated Worker via LOADER, with state.* (the DO workspace), tools.*,
    // and cdp.* (headless browser) when BROWSER is bound. The one-liner pulls
    // all of that from `this`.
    if (this.env.LOADER) {
      tools.execute = createExecuteTool(this);
    }
    // Standalone browser-automation tools (navigate/screenshot/extract) for the
    // model to drive Browser Rendering directly.
    if (this.env.BROWSER) {
      Object.assign(
        tools,
        createBrowserTools({
          browser: this.env.BROWSER,
          loader: this.env.LOADER,
        }),
      );
    }
    return tools;
  }

  override getSkills() {
    return [
      bundledSkills,
      skills.r2(this.env.SKILLS_BUCKET, { prefix: "skills/" }),
    ];
  }

  /**
   * Server actions compiled into model tools, each following the Boring Stack
   * write path (validate → idempotency → authorize → execute → receipt).
   */
  override getActions(): Record<string, Action> {
    const store = this.skillStore();
    return createActions({
      receipts: this.receiptStore(),
      actor: this.name,
      approvalMode: this.state?.settings.approvalMode ?? "destructive-only",
      notify: (title, body, opts) => this.notifyUser(title, body, opts),
      saveMemory: (fact) => this.saveMemory(fact),
      createReminder: async (request) => {
        const view = await this.createReminder(request);
        return `${view.message} — ${view.when}`;
      },
      deleteSkill: async (name) => {
        const existing = await store.get(name);
        if (!existing) return false;
        await store.delete(name);
        return true;
      },
    });
  }

  /**
   * Grant action permissions per turn. Web + messenger + email turns are the
   * owner acting, so grant all permissions; anything else gets none (read-only).
   */
  override authorizeTurn(_ctx: TurnContext): ActionAuthorizationDecision {
    return true;
  }

  /**
   * Persistent, per-user memory: a writable `memory` block the model reads and
   * writes (set_context / save_memory), R2-backed on-demand `skills`, a
   * searchable `history` block (search_context / FTS5), plus non-destructive
   * compaction so long conversations compress instead of overflowing.
   */
  override configureSession(session: Session): Session {
    const summarizer = createWorkersAI({ binding: this.env.AI })(DEFAULT_MODEL);
    return session
      .withContext("memory", {
        description: "Durable facts about the user (preferences, projects, context)",
        maxTokens: 2000,
      })
      .withContext("skills", {
        description: "On-demand skill guides loaded when relevant",
        provider: new R2SkillProvider(this.env.SKILLS_BUCKET, {
          prefix: "skills/",
        }),
      })
      .withContext("history", {
        description: "Searchable record of this conversation",
      })
      .withCachedPrompt()
      .onCompaction(
        createCompactFunction({
          summarize: async (prompt) => {
            const { text } = await generateText({ model: summarizer, prompt });
            return text;
          },
          protectHead: 3,
          tailTokenBudget: 20_000,
          minTailMessages: 2,
          tokenCounter: (messages) => estimateMessageTokens(messages),
        }),
      )
      .compactAfter(100_000)
      .onCompactionError((err) =>
        console.warn("[holston] auto-compaction failed:", err),
      );
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
    // Actions may have written receipts this turn; refresh the badge count.
    this.syncReceiptCount();
  }

  /**
   * Classify turn errors so `contextOverflow.reactive` (compact-and-retry) can
   * fire — Think never matches provider error strings itself, so without this
   * the reactive backstop is a no-op. We use the SDK's default classifier
   * (Anthropic/OpenAI/Google/…) plus the Workers AI overflow shape we run.
   */
  override classifyChatError(error: unknown): ChatErrorClassification | void {
    const fromDefault = defaultContextOverflowClassifier(error);
    if (fromDefault) return fromDefault;
    // AI SDK APICallErrors bury the provider text in responseBody, not message —
    // inspect both so a Workers AI overflow string is caught either way.
    const parts = [
      error instanceof Error ? error.message : String(error ?? ""),
      typeof (error as { responseBody?: unknown })?.responseBody === "string"
        ? (error as { responseBody: string }).responseBody
        : "",
    ];
    const haystack = parts.join(" ");
    if (
      /context (window|length)|too (long|many tokens)|max.*token|input.*too large|exceeds?.*(context|token)/i.test(
        haystack,
      )
    ) {
      return "context_overflow";
    }
  }

  /**
   * Enforce approvalMode for built-in workspace tools. beforeToolCall can only
   * allow/block/substitute (it can't raise the client approval modal — that's
   * driven by a tool's needsApproval), so:
   *   - never / destructive-only: built-in tools run (destructive-only relies on
   *     the model + skill-tool modals; built-in file writes are already sandboxed
   *     to the DO's own workspace, not the user's machine).
   *   - always: block destructive built-in tools so nothing mutates without an
   *     explicit human step; the model surfaces the reason and can ask first.
   */
  override beforeToolCall(
    ctx: ToolCallContext,
  ): ToolCallDecision | void {
    const mode = this.state?.settings.approvalMode ?? "destructive-only";
    if (mode !== "always") return;
    if (DESTRUCTIVE_TOOLS.has(ctx.toolName)) {
      return {
        action: "block",
        reason:
          `Approval mode is "always": the ${ctx.toolName} tool is blocked. ` +
          "Explain what you would run and ask the user to confirm or lower the approval setting.",
      };
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
    if (patch.timezone !== undefined) {
      if (!isValidTimezone(patch.timezone)) {
        throw new Error("Invalid timezone");
      }
      next.timezone = patch.timezone;
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
   * at 3pm", "every weekday at 9am send a standup prompt").
   *
   * We use a FLAT schema (kind + optional datetime/cron) rather than the SDK's
   * discriminated-union scheduleSchema — small Workers AI models populate a
   * flat shape far more reliably than a nested union, which was returning
   * `no-schedule` for clear inputs.
   */
  @callable()
  async createReminder(request: string): Promise<ReminderView> {
    const tz = this.getDefaultTimezone();
    const nowLocal = formatLocal(new Date(), tz);
    const model = createWorkersAI({ binding: this.env.AI })(DEFAULT_MODEL);
    const { object } = await generateObject({
      model,
      schema: reminderParseSchema,
      system: [
        `The user's current local date and time is ${nowLocal} (timezone ${tz}).`,
        "Extract a reminder from the user's message. Interpret all times as the user's LOCAL time.",
        "- message: what to be reminded about (imperative, no time words).",
        '- kind: "once" for a single time, "recurring" for anything repeating.',
        '- For "once": set datetime to a LOCAL wall-clock timestamp "YYYY-MM-DDTHH:MM:SS" (NO timezone/Z suffix).',
        '- For "recurring": set cron to a 5-field cron expression in LOCAL time (minute hour day month weekday).',
        "Resolve relative times (tomorrow, in 2 hours, next Monday) against the current local time above.",
      ].join("\n"),
      prompt: request,
    });

    const message = (object.message || request).trim();
    let schedule: Schedule<ReminderPayload>;

    if (object.kind === "once" && object.datetime.trim()) {
      // Convert the local wall-clock time (in the user's zone) to a real instant.
      const date = localWallClockToUtc(object.datetime, tz);
      if (!date || date.getTime() <= Date.now()) {
        throw new Error(
          "That time is in the past or unclear. Try 'tomorrow at 3pm' or 'in 2 hours'.",
        );
      }
      schedule = await this.schedule(date, REMINDER_CALLBACK, { message });
    } else if (object.kind === "recurring" && object.cron.trim()) {
      // Agent.schedule runs cron in UTC; shift the local cron hour by the zone
      // offset. The local cron + tz ride in the payload so DST drift can be
      // re-corrected on wake (see reconcileCronDrift).
      const localCron = object.cron.trim();
      const cron = shiftCronToUtc(localCron, tz);
      if (!cron) {
        throw new Error(
          "Could not parse that recurring time. Try 'every weekday at 9am'.",
        );
      }
      schedule = await this.schedule(cron, REMINDER_CALLBACK, {
        message,
        localCron,
        tz,
      });
    } else {
      throw new Error(
        "Could not parse a time from that request. Try 'tomorrow at 3pm' or 'every weekday at 9am'.",
      );
    }

    await this.syncReminders();
    return toReminderView(schedule, tz);
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

  /**
   * Schedule callback: fires the reminder across every channel. Alarm delivery
   * is at-least-once, so we dedupe on a stable per-occurrence key: a bucketed
   * minute keeps a retry of the SAME firing from double-notifying while letting
   * a genuine next occurrence (different minute) through.
   */
  async runReminder(payload: ReminderPayload) {
    const occurrence = Math.floor(Date.now() / 60000); // minute bucket
    const dedupeKey = `reminder:${occurrence}:${payload.message}`;

    if (this.receiptStore().hasKey(dedupeKey)) {
      return; // already fired this occurrence
    }
    this.receiptStore().write({
      action: "run_reminder",
      idempotencyKey: dedupeKey,
      input: { message: payload.message },
      output: { firedAt: new Date().toISOString() },
      actor: this.name,
    });
    this.syncReceiptCount();

    await this.notifyUser("Reminder", payload.message, { url: "/" });
    // Inject it into the conversation; the same idempotency key stops a retry
    // from adding a duplicate [Reminder] message.
    await this.submitMessages(
      [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: `[Reminder] ${payload.message}` }],
        },
      ],
      { idempotencyKey: dedupeKey, metadata: { source: "reminder" } },
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

    // Classify before spending a full model turn: skip spam and reply only when
    // the email actually warrants one (prevents cost spirals on notifications).
    const triage = await classifyEmail(this.env.AI, subject, body).catch(
      () => null,
    );
    if (triage?.classification === "spam") {
      console.log(`[holston] Dropping spam email from ${email.from}`);
      return;
    }
    const shouldReply = triage?.shouldReply ?? true;

    // Process as a blocking turn so we can reply with the model's answer.
    const result = await this.saveMessages([
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
    ]);

    // Reply with the assistant's answer, when the triage said so and it's
    // available and configured.
    if (result.status === "completed" && shouldReply) {
      const answer = lastAssistantText(this.messages);
      if (answer && this.env.EMAIL) {
        try {
          await this.replyToEmail(email, {
            fromName: "Holston",
            subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
            body: answer,
            secret: this.env.EMAIL_SIGNING_SECRET ?? null,
          });
        } catch (err) {
          console.error("[holston] email reply failed:", err);
        }
      }
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  /**
   * Fan a proactive message out to every configured channel: push
   * (offline-capable), connected web clients (broadcast), and email to the
   * owner when the send_email binding + OWNER_EMAIL are set. Best-effort — a
   * failure on one channel never blocks the others.
   */
  private async notifyUser(
    title: string,
    body: string,
    opts: { url?: string } = {},
  ) {
    // Push
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

    // Connected web clients
    this.broadcast(
      JSON.stringify({ type: "notification", title, body, at: Date.now() }),
    );

    // Email (owner only)
    if (this.env.EMAIL && this.env.OWNER_EMAIL) {
      try {
        await this.sendEmail({
          binding: this.env.EMAIL,
          to: this.env.OWNER_EMAIL,
          from: this.env.OWNER_EMAIL,
          subject: `[Holston] ${title}`,
          text: body,
          secret: this.env.EMAIL_SIGNING_SECRET,
        });
      } catch (err) {
        console.error("[holston] notify email failed:", err);
      }
    }
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
    const tz = this.getDefaultTimezone();
    const schedules = await this.listSchedules();
    const views = schedules
      .filter((s) => s.callback === REMINDER_CALLBACK)
      .map((s) => toReminderView(s as Schedule<ReminderPayload>, tz));
    this.setState({ ...this.state, reminders: views });
  }

  /**
   * `Agent.schedule` cron runs in UTC, so a recurring reminder's baked UTC hour
   * drifts by an hour across a DST transition. On wake, re-derive the UTC cron
   * from each reminder's stored local cron + tz; if it changed, reschedule.
   */
  private async reconcileCronDrift() {
    const schedules = await this.listSchedules();
    for (const s of schedules) {
      if (s.callback !== REMINDER_CALLBACK || s.type !== "cron") continue;
      const payload = (s as Schedule<ReminderPayload>).payload;
      if (!payload?.localCron || !payload.tz) continue;
      const expected = shiftCronToUtc(payload.localCron, payload.tz);
      if (expected && expected !== s.cron) {
        await this.cancelSchedule(s.id);
        await this.schedule(expected, REMINDER_CALLBACK, payload);
      }
    }
  }

  private skillStore(): SkillStore {
    this.#skillStore ??= new SkillStore(
      this.env.SKILLS_BUCKET,
      this.env.SKILLS_INDEX,
      this.env.AI,
    );
    return this.#skillStore;
  }

  private receiptStore(): ReceiptStore {
    this.#receiptStore ??= new ReceiptStore(this);
    return this.#receiptStore;
  }

  private syncReceiptCount() {
    // Touch the store first so the table exists (its constructor creates it).
    const count = this.receiptStore().count();
    if (count !== this.state.receiptCount) {
      this.setState({ ...this.state, receiptCount: count });
    }
  }

  /** Append a durable fact to the writable `memory` context block. */
  private async saveMemory(fact: string) {
    await this.session.appendContextBlock("memory", fact.trim());
    // The cached system-prompt snapshot is sticky; refresh so the new fact is
    // visible on the next turn.
    await this.session.refreshSystemPrompt();
  }

  // ── Receipts & memory (fetched on demand) ──────────────────────────────

  @callable()
  listReceipts(limit = 100): Receipt[] {
    return this.receiptStore().list(limit);
  }

  @callable()
  getMemory(): string {
    return this.session.getContextBlock("memory")?.content ?? "";
  }
}

// All fields required (not optional) so small models can't skip the time —
// the failure mode was `{message, kind:"once"}` with datetime omitted. For the
// branch that doesn't apply, the model emits the empty-string sentinel.
const reminderParseSchema = z.object({
  message: z
    .string()
    .describe("What to be reminded about, imperative, no time words"),
  kind: z
    .enum(["once", "recurring"])
    .describe("once = single time, recurring = repeats"),
  datetime: z
    .string()
    .describe(
      'When kind is "once": LOCAL wall-clock timestamp "YYYY-MM-DDTHH:MM:SS" with NO timezone suffix, e.g. "2026-07-15T15:00:00". When kind is "recurring": empty string "".',
    ),
  cron: z
    .string()
    .describe(
      'When kind is "recurring": 5-field LOCAL cron expression, e.g. "0 9 * * 1-5". When kind is "once": empty string "".',
    ),
});

const emailTriageSchema = z.object({
  classification: z
    .enum(["actionable", "notification", "spam"])
    .describe("actionable = needs a reply; notification = FYI only; spam = junk"),
  shouldReply: z
    .boolean()
    .describe("Whether a reply is warranted (false for notifications/spam)"),
  summary: z.string().max(200).describe("One-line summary of the email"),
});

/**
 * Lightweight AI triage before spending a full turn on an email: drop spam,
 * and only reply when the email actually asks for something.
 */
async function classifyEmail(
  ai: Ai,
  subject: string,
  body: string,
): Promise<{ classification: "actionable" | "notification" | "spam"; shouldReply: boolean; summary: string }> {
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
function lastAssistantText(
  messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }> }>,
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

/** Format a Date as a readable local time string in the given IANA zone. */
function formatLocal(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

/**
 * The offset (minutes) of `timeZone` from UTC at instant `date`.
 * Positive means the zone is behind UTC (e.g. America/New_York = 240/300).
 */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const local = new Date(date.toLocaleString("en-US", { timeZone }));
  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((utc.getTime() - local.getTime()) / 60000);
}

/**
 * Interpret "YYYY-MM-DDTHH:MM:SS" as wall-clock time in `timeZone` and return
 * the real UTC instant. Returns null if unparseable.
 *
 * The offset must be evaluated at the RESULT instant, not the provisional
 * guess — near a DST boundary those differ by the DST delta. We converge in
 * two passes (a single correction is wrong exactly when the guess and result
 * straddle the transition).
 */
function localWallClockToUtc(local: string, timeZone: string): Date | null {
  const m = local
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (!y || !mo || !d || !h || !mi) return null;

  const target = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  // First correction using the offset at the provisional instant...
  let result = target + tzOffsetMinutes(new Date(target), timeZone) * 60000;
  // ...then re-evaluate at the corrected instant and adjust if the offset
  // changed (a DST boundary lies between the two).
  const refined = target + tzOffsetMinutes(new Date(result), timeZone) * 60000;
  if (refined !== result) result = refined;

  const date = new Date(result);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Shift a local 5-field cron expression's hour into UTC by the zone's current
 * offset (whole-hour zones only; DST shifts by ≤1h are acceptable for reminders).
 * Returns null if the expression isn't a standard 5-field cron.
 */
function shiftCronToUtc(cron: string, timeZone: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  if (hour === "*" || hour.includes(",") || hour.includes("/") || hour.includes("-")) {
    // Non-simple hour field: leave as-is (best effort).
    return cron.trim();
  }
  const h = Number(hour);
  if (!Number.isInteger(h)) return null;
  const offsetHours = tzOffsetMinutes(new Date(), timeZone) / 60;
  const utcHour = ((h + offsetHours) % 24 + 24) % 24;
  return `${min} ${Math.round(utcHour)} ${dom} ${mon} ${dow}`;
}

function toReminderView(
  schedule: Schedule<ReminderPayload>,
  timeZone: string,
): ReminderView {
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
      // Render in the user's timezone, not the server/browser zone, so the
      // displayed time matches what the user asked for.
      when = nextRun
        ? new Intl.DateTimeFormat("en-US", {
            timeZone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(nextRun))
        : "scheduled";
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
      // Browser-driven mutation: block cross-origin (CSRF) before auth.
      const csrf = assertSameOrigin(request);
      if (csrf) return csrf;
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
