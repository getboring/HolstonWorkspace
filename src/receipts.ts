/**
 * Immutable action receipts (the Boring Stack write-path's final step:
 * every gated action writes an append-only audit row). Stored in the agent's
 * own Durable Object SQLite via `this.sql` — no external DB needed.
 */

export interface Receipt {
  id: string;
  action: string;
  idempotencyKey: string | null;
  input: unknown;
  output: unknown;
  actor: string;
  createdAt: string;
}

/** Structural slice of Agent#sql so this stays decoupled from the agent class. */
export interface AgentSql {
  sql<T = Record<string, string | number | boolean | null>>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ): T[];
}

export class ReceiptStore {
  constructor(private agent: AgentSql) {
    // Insert-only table — receipts are never updated or deleted.
    this.agent.sql`CREATE TABLE IF NOT EXISTS action_receipts (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      idempotency_key TEXT,
      input_json TEXT,
      output_json TEXT,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`;
    // Enforce one receipt per (action, idempotency_key). SQLite treats NULLs as
    // distinct, so unkeyed actions still each insert a row.
    this.agent.sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_key
      ON action_receipts (action, idempotency_key)
      WHERE idempotency_key IS NOT NULL`;
    // Index the newest-first read path (list()) so it doesn't full-scan as the
    // ledger grows.
    this.agent.sql`CREATE INDEX IF NOT EXISTS idx_receipts_created
      ON action_receipts (created_at DESC)`;
  }

  /** Whether a receipt already exists for this idempotency key. */
  hasKey(idempotencyKey: string): boolean {
    const rows = this.agent.sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM action_receipts
      WHERE idempotency_key = ${idempotencyKey}`;
    return (rows[0]?.n ?? 0) > 0;
  }

  /**
   * Write an immutable receipt. Deduped by (action, idempotency_key) via the
   * unique index — a repeat with the same key is a no-op (returns the existing
   * row's identity is not needed; the caller's data is returned for logging).
   */
  write(receipt: Omit<Receipt, "id" | "createdAt"> & { id?: string }): Receipt {
    const row: Receipt = {
      id: receipt.id ?? crypto.randomUUID(),
      action: receipt.action,
      idempotencyKey: receipt.idempotencyKey,
      input: receipt.input,
      output: receipt.output,
      actor: receipt.actor,
      createdAt: new Date().toISOString(),
    };
    this.agent.sql`
      INSERT OR IGNORE INTO action_receipts
        (id, action, idempotency_key, input_json, output_json, actor, created_at)
      VALUES (
        ${row.id},
        ${row.action},
        ${row.idempotencyKey},
        ${JSON.stringify(row.input ?? null)},
        ${JSON.stringify(row.output ?? null)},
        ${row.actor},
        ${row.createdAt}
      )`;
    return row;
  }

  /** Total receipts written (table guaranteed to exist via the constructor). */
  count(): number {
    const rows = this.agent.sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM action_receipts`;
    return rows[0]?.n ?? 0;
  }

  /** Most-recent receipts first, capped. */
  list(limit = 100): Receipt[] {
    const rows = this.agent.sql<{
      id: string;
      action: string;
      idempotency_key: string | null;
      input_json: string | null;
      output_json: string | null;
      actor: string;
      created_at: string;
    }>`
      SELECT id, action, idempotency_key, input_json, output_json, actor, created_at
      FROM action_receipts
      ORDER BY created_at DESC
      LIMIT ${Math.min(Math.max(limit, 1), 500)}`;

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      idempotencyKey: r.idempotency_key,
      input: safeParse(r.input_json),
      output: safeParse(r.output_json),
      actor: r.actor,
      createdAt: r.created_at,
    }));
  }
}

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
