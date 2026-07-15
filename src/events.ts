/**
 * Persistent agent event log. The SDK's diagnostics channels (schedule, chat,
 * fiber, mcp) surface failures that would otherwise be silent, but console
 * output vanishes on refresh and isn't visible in-app. This store lands those
 * events in the agent's own Durable Object SQLite so the operator can see a
 * durable System Health history — what failed, when, and how often.
 *
 * Append-only with a bounded retention window (pruned by count) so a chatty
 * failure loop can't grow the DO storage without limit.
 */

import type { AgentSql } from "./receipts";

export type EventSeverity = "info" | "warning" | "error" | "critical";

export interface AgentEvent {
  id: string;
  severity: EventSeverity;
  /** Diagnostics channel or subsystem, e.g. "schedule", "chat", "mcp". */
  source: string;
  /** Event type, e.g. "schedule:error", "chat:recovery:exhausted". */
  kind: string;
  message: string;
  detail: unknown;
  createdAt: string;
}

/** How many events to retain. Oldest beyond this are pruned on write. */
export const EVENT_RETENTION = 500;

export interface EventPage {
  events: AgentEvent[];
  /** Opaque cursor for the next page, or null when the last page is reached. */
  nextCursor: string | null;
}

export class EventLog {
  constructor(private agent: AgentSql) {
    this.agent.sql`CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL,
      seq INTEGER NOT NULL
    )`;
    // Read path is newest-first with a stable tiebreaker (seq) so cursor
    // pagination can't skip or repeat rows sharing a millisecond timestamp.
    this.agent.sql`CREATE INDEX IF NOT EXISTS idx_events_seq
      ON agent_events (seq DESC)`;
    this.agent.sql`CREATE INDEX IF NOT EXISTS idx_events_severity
      ON agent_events (severity, seq DESC)`;
  }

  /** Monotonic sequence for stable ordering (created_at alone can collide). */
  private nextSeq(): number {
    const rows = this.agent.sql<{ m: number | null }>`
      SELECT MAX(seq) AS m FROM agent_events`;
    return (rows[0]?.m ?? 0) + 1;
  }

  /** Append an event and prune anything beyond the retention window. */
  record(
    event: Omit<AgentEvent, "id" | "createdAt"> & { id?: string; createdAt?: string },
  ): AgentEvent {
    const row: AgentEvent = {
      id: event.id ?? crypto.randomUUID(),
      severity: event.severity,
      source: event.source,
      kind: event.kind,
      message: event.message,
      detail: event.detail ?? null,
      createdAt: event.createdAt ?? new Date().toISOString(),
    };
    const seq = this.nextSeq();
    this.agent.sql`
      INSERT INTO agent_events
        (id, severity, source, kind, message, detail_json, created_at, seq)
      VALUES (
        ${row.id}, ${row.severity}, ${row.source}, ${row.kind},
        ${row.message}, ${JSON.stringify(row.detail ?? null)},
        ${row.createdAt}, ${seq}
      )`;
    // Bounded retention: delete everything older than the newest N by seq.
    this.agent.sql`
      DELETE FROM agent_events
      WHERE seq <= ${seq - EVENT_RETENTION}`;
    return row;
  }

  /** Count of retained events, optionally filtered by minimum severity set. */
  count(severities?: EventSeverity[]): number {
    if (severities && severities.length) {
      const set = severities.join(",");
      const rows = this.agent.sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM agent_events
        WHERE instr(${set}, severity) > 0`;
      return rows[0]?.n ?? 0;
    }
    const rows = this.agent.sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM agent_events`;
    return rows[0]?.n ?? 0;
  }

  /**
   * Newest-first page. `cursor` is the `seq` of the last row from the prior
   * page; pass null/undefined for the first page. `severities` filters to a set
   * (empty/omitted = all). Returns up to `limit` rows plus the next cursor.
   */
  page(opts?: {
    limit?: number;
    cursor?: string | null;
    severities?: EventSeverity[];
  }): EventPage {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const beforeSeq = opts?.cursor ? Number.parseInt(opts.cursor, 10) : Number.MAX_SAFE_INTEGER;
    const filter = opts?.severities?.length ? opts.severities.join(",") : null;

    // Fetch one extra row to know whether another page exists.
    const rows = filter
      ? this.agent.sql<EventRow>`
          SELECT id, severity, source, kind, message, detail_json, created_at, seq
          FROM agent_events
          WHERE seq < ${beforeSeq} AND instr(${filter}, severity) > 0
          ORDER BY seq DESC
          LIMIT ${limit + 1}`
      : this.agent.sql<EventRow>`
          SELECT id, severity, source, kind, message, detail_json, created_at, seq
          FROM agent_events
          WHERE seq < ${beforeSeq}
          ORDER BY seq DESC
          LIMIT ${limit + 1}`;

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(pageRows[pageRows.length - 1]?.seq) : null;

    return {
      events: pageRows.map(toEvent),
      nextCursor,
    };
  }

  /** All retained events, newest-first, for export. */
  all(): AgentEvent[] {
    const rows = this.agent.sql<EventRow>`
      SELECT id, severity, source, kind, message, detail_json, created_at, seq
      FROM agent_events
      ORDER BY seq DESC`;
    return rows.map(toEvent);
  }
}

interface EventRow {
  id: string;
  severity: string;
  source: string;
  kind: string;
  message: string;
  detail_json: string | null;
  created_at: string;
  seq: number;
}

function toEvent(r: EventRow): AgentEvent {
  return {
    id: r.id,
    severity: r.severity as EventSeverity,
    source: r.source,
    kind: r.kind,
    message: r.message,
    detail: safeParse(r.detail_json),
    createdAt: r.created_at,
  };
}

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
