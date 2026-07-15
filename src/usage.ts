import type { AgentSql } from "./receipts";

/**
 * Per-agent AI usage meter. Counts model calls per UTC day in the DO's own
 * SQLite (same pattern as the receipt ledger — insert/increment, no new infra),
 * so a runaway agent (an email-reply loop, a compromised MCP server hammering
 * retrieval) hits a daily ceiling instead of draining the account's Workers AI
 * budget with no backstop.
 */
export interface UsageSnapshot {
  day: string; // YYYY-MM-DD (UTC)
  calls: number;
  limit: number;
  remaining: number;
  exceeded: boolean;
}

/** Default daily model-call ceiling per agent. Generous for one owner, a real backstop against loops. */
export const DEFAULT_DAILY_CALL_LIMIT = 500;

export class UsageMeter {
  /**
   * `dailyLimit` may be a number or a function resolving the current limit —
   * the meter is cached on the agent, so a function lets the ceiling track a
   * live setting without rebuilding the meter.
   */
  constructor(
    private agent: AgentSql,
    private dailyLimit: number | (() => number) = DEFAULT_DAILY_CALL_LIMIT,
  ) {
    this.agent.sql`CREATE TABLE IF NOT EXISTS ai_usage (
      day TEXT PRIMARY KEY,
      calls INTEGER NOT NULL DEFAULT 0
    )`;
  }

  private limit(): number {
    return typeof this.dailyLimit === "function"
      ? this.dailyLimit()
      : this.dailyLimit;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Current day's usage snapshot. */
  snapshot(): UsageSnapshot {
    const day = this.today();
    const limit = this.limit();
    const rows = this.agent.sql<{ calls: number }>`
      SELECT calls FROM ai_usage WHERE day = ${day}`;
    const calls = rows[0]?.calls ?? 0;
    return {
      day,
      calls,
      limit,
      remaining: Math.max(0, limit - calls),
      exceeded: calls >= limit,
    };
  }

  /** Whether another model call is allowed today. */
  canSpend(): boolean {
    return !this.snapshot().exceeded;
  }

  /** Record one model call against today's budget. Returns the new snapshot. */
  record(n = 1): UsageSnapshot {
    const day = this.today();
    this.agent.sql`
      INSERT INTO ai_usage (day, calls) VALUES (${day}, ${n})
      ON CONFLICT(day) DO UPDATE SET calls = calls + ${n}`;
    return this.snapshot();
  }
}
