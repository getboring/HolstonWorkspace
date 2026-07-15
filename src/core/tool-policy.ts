import type { ApprovalMode } from "../shared/state";

/**
 * One risk model for EVERY tool the agent can call — built-in workspace tools,
 * code execution, browser, MCP tools, actions, and skill writes. This is the
 * single source of truth the three gate call sites (beforeToolCall, the actions
 * `approval` field, and the skill tools' `needsApproval`) all consult, so the
 * security model is consistent instead of reimplemented per surface.
 *
 * Risk tiers, lowest to highest blast radius:
 * - read:        inspects state, no side effects (read/list/find/grep, list/search tools)
 * - write:       mutates agent-local state (write/edit workspace files, save_memory)
 * - destructive: irreversible or runs arbitrary code (delete, bash, execute, skill deletes)
 * - external:    reaches outside the agent (browser, MCP tools, sending messages/email)
 */
export type ToolRisk = "read" | "write" | "destructive" | "external";

/** Explicit risk for the tools we own or know statically. */
const KNOWN_RISK: Record<string, ToolRisk> = {
  // Built-in Think workspace tools
  read: "read",
  list: "read",
  find: "read",
  grep: "read",
  write: "write",
  edit: "write",
  delete: "destructive",
  bash: "destructive",
  // Code execution runs arbitrary model-generated code (can shell out).
  execute: "destructive",
  // Read-only web fetch is allowlisted + GET-only, but still leaves the agent.
  fetch_url: "external",
  // Skill lifecycle tools
  skill_create: "write",
  skill_patch: "write",
  skill_load: "read",
  skill_list: "read",
  skill_search: "read",
  // Actions (also declared in actions.ts; kept in sync here for the gate)
  send_message: "external",
  set_reminder: "write",
  save_memory: "write",
  remove_skill: "destructive",
  // Session context tools
  set_context: "write",
  load_context: "read",
  unload_context: "read",
  search_context: "read",
};

/**
 * Classify any tool by name. Unknown tools default to the highest sensible tier
 * for their surface: `browser_*` and MCP-prefixed tools reach external state, so
 * they're `external`; anything else unknown is treated as `write` (safer than
 * assuming read-only).
 */
export function riskFor(toolName: string): ToolRisk {
  const known = KNOWN_RISK[toolName];
  if (known) return known;
  if (toolName.startsWith("browser_") || toolName.startsWith("cdp_")) {
    return "external";
  }
  // MCP tools are namespaced by the SDK (e.g. `tool_<server>_<name>`); a server
  // the user just connected is untrusted, so default it to external.
  if (toolName.startsWith("tool_") || toolName.startsWith("mcp_")) {
    return "external";
  }
  return "write";
}

/**
 * The approval decision for a risk tier under the current mode + optional
 * per-tool override. Returns true when the call must be approved by the user.
 *
 * - always:          approve every write/destructive/external (read never gated)
 * - destructive-only: approve destructive + external; allow read + write
 * - never:           approve nothing
 * A per-tool override ("always" | "never") wins over the mode.
 */
export function shouldApprove(
  toolName: string,
  mode: ApprovalMode,
  overrides?: Record<string, "always" | "never">,
): boolean {
  const override = overrides?.[toolName];
  if (override === "always") return true;
  if (override === "never") return false;

  const risk = riskFor(toolName);
  if (mode === "never") return false;
  if (risk === "read") return false;
  if (mode === "always") return true;
  // destructive-only: gate the genuinely risky tiers, allow plain writes.
  return risk === "destructive" || risk === "external";
}
