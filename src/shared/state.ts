/**
 * Shared agent-state contract. Imported by both the server (source of truth)
 * and the client (reads via useAgent's synced `state`). Keep it serializable.
 */

export const WORKERS_AI_MODELS = [
  { id: "@cf/moonshotai/kimi-k2.7-code", label: "Kimi K2.7 Code (default)" },
  { id: "@cf/meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { id: "@cf/qwen/qwq-32b", label: "Qwen QwQ 32B" },
  {
    id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    label: "DeepSeek R1 Distill 32B",
  },
] as const;

export type WorkersAiModelId = (typeof WORKERS_AI_MODELS)[number]["id"];

export const DEFAULT_MODEL: WorkersAiModelId = "@cf/moonshotai/kimi-k2.7-code";

/** Whether the curator may auto-propose skills, and how tools are approved. */
export type ApprovalMode = "always" | "destructive-only" | "never";

export interface HolstonSettings {
  model: WorkersAiModelId;
  /** Curator proposes skills after complex turns (staged for approval). */
  autoSkills: boolean;
  /** Baseline tool-approval policy applied by risk tier. */
  approvalMode: ApprovalMode;
  /** Per-tool overrides that win over approvalMode ("always" | "never"). */
  toolApprovals: Record<string, "always" | "never">;
  /** IANA timezone for reminders and wall-clock schedules (e.g. America/New_York). */
  timezone: string;
  /** Extra instruction appended to the system prompt (user-editable persona). */
  customInstructions: string;
  /** Record browser automation sessions (rrweb) for later replay. */
  browserRecording: boolean;
  /** Max AI turns per UTC day before turns are blocked (runaway backstop). */
  dailyCallLimit: number;
}

export const DEFAULT_TIMEZONE = "America/New_York";

/** Default daily AI-turn ceiling. Bounds so the Settings input can't disable or absurdly raise it. */
export const DEFAULT_DAILY_CALL_LIMIT = 500;
export const MIN_DAILY_CALL_LIMIT = 10;
export const MAX_DAILY_CALL_LIMIT = 100_000;

export const DEFAULT_SETTINGS: HolstonSettings = {
  model: DEFAULT_MODEL,
  autoSkills: true,
  approvalMode: "destructive-only",
  toolApprovals: {},
  timezone: DEFAULT_TIMEZONE,
  customInstructions: "",
  browserRecording: false,
  dailyCallLimit: DEFAULT_DAILY_CALL_LIMIT,
};

/** Common IANA timezones offered in the Settings UI. */
export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

/** Validate an IANA timezone using the Intl API (avoids a hardcoded allowlist). */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A Web Push subscription (PushSubscription.toJSON() shape). */
export interface PushSubscriptionRecord {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

/** Live view of a scheduled reminder/task (mirrors agent schedules). */
export interface ReminderView {
  id: string;
  message: string;
  /** Human-readable schedule description. */
  when: string;
  /** Next execution as epoch ms (null for pure intervals with no next time). */
  nextRun: number | null;
  kind: "scheduled" | "delayed" | "cron" | "interval";
  recurring: boolean;
}

/** Live view of an MCP server connection. */
export interface McpServerView {
  id: string;
  name: string;
  url: string;
  state:
    | "ready"
    | "authenticating"
    | "connecting"
    | "connected"
    | "discovering"
    | "failed";
  authUrl: string | null;
  error: string | null;
  toolCount: number;
}

/** A row from the immutable action-receipts ledger (fetched on demand). */
export interface ReceiptView {
  id: string;
  action: string;
  idempotencyKey: string | null;
  input: unknown;
  output: unknown;
  actor: string;
  createdAt: string;
}

/** Today's AI-call budget snapshot (mirrors UsageSnapshot; synced to clients). */
export interface UsageView {
  day: string;
  calls: number;
  limit: number;
  remaining: number;
  exceeded: boolean;
}

/** A saved, reusable Codemode snippet (fetched on demand). */
export interface SnippetView {
  name: string;
  description: string;
  code: string;
  savedAt: number;
  connectors: string[];
}

/** A Codemode execution audit row (fetched on demand). */
export interface ExecutionView {
  id: string;
  code: string;
  status: string;
  result: unknown;
  error?: string;
  steps: number;
  createdAt: number;
}

/** One tab of an active browser Live View. */
export interface BrowserLiveViewTargetView {
  url: string;
  pageUrl?: string;
  title?: string;
}

/** Live View state for the agent's shared browser session. */
export interface BrowserLiveViewResult {
  active: boolean;
  sessionId?: string;
  expiresInMs?: number;
  targets: BrowserLiveViewTargetView[];
  error?: string;
}

/** An rrweb recording of a finished browser session, ready for replay. */
export interface BrowserRecordingResult {
  ok: boolean;
  sessionId?: string;
  durationMs?: number;
  events?: Record<string, unknown[]>;
  error?: string;
}

export interface HolstonState {
  settings: HolstonSettings;
  reminders: ReminderView[];
  mcpServers: McpServerView[];
  pushSubscriptions: PushSubscriptionRecord[];
  /** Count of receipts written, so the UI can badge the Receipts tab. */
  receiptCount: number;
  /** Today's AI usage vs. the daily ceiling. */
  usage: UsageView | null;
  /** Count of error+critical health events, so the UI can badge System Health. */
  healthAlerts: number;
  /** Bumped whenever the agent wants clients to refetch derived data. */
  revision: number;
}

export const INITIAL_STATE: HolstonState = {
  settings: DEFAULT_SETTINGS,
  reminders: [],
  mcpServers: [],
  pushSubscriptions: [],
  receiptCount: 0,
  usage: null,
  healthAlerts: 0,
  revision: 0,
};

export function isValidModel(id: string): id is WorkersAiModelId {
  return WORKERS_AI_MODELS.some((m) => m.id === id);
}

export function isApprovalMode(v: string): v is ApprovalMode {
  return v === "always" || v === "destructive-only" || v === "never";
}
