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
  /** Governs the tool-approval gate surfaced to the user. */
  approvalMode: ApprovalMode;
  /** Extra instruction appended to the system prompt (user-editable persona). */
  customInstructions: string;
}

export const DEFAULT_SETTINGS: HolstonSettings = {
  model: DEFAULT_MODEL,
  autoSkills: true,
  approvalMode: "destructive-only",
  customInstructions: "",
};

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

export interface HolstonState {
  settings: HolstonSettings;
  reminders: ReminderView[];
  mcpServers: McpServerView[];
  pushSubscriptions: PushSubscriptionRecord[];
  /** Bumped whenever the agent wants clients to refetch derived data. */
  revision: number;
}

export const INITIAL_STATE: HolstonState = {
  settings: DEFAULT_SETTINGS,
  reminders: [],
  mcpServers: [],
  pushSubscriptions: [],
  revision: 0,
};

export function isValidModel(id: string): id is WorkersAiModelId {
  return WORKERS_AI_MODELS.some((m) => m.id === id);
}

export function isApprovalMode(v: string): v is ApprovalMode {
  return v === "always" || v === "destructive-only" || v === "never";
}
