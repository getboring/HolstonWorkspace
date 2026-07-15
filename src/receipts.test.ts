import { beforeEach, describe, expect, it } from "vitest";
import { ReceiptStore, type AgentSql } from "./receipts";

/**
 * Minimal in-memory emulator of the `this.sql` tagged template, just smart
 * enough to exercise ReceiptStore: CREATE (no-op), INSERT OR IGNORE against the
 * (action, idempotency_key) unique constraint, COUNT, and SELECT ... ORDER BY.
 */
function fakeSql(): AgentSql {
  const rows: Record<string, string | number | null>[] = [];

  const sql: AgentSql["sql"] = (
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim().toUpperCase();

    if (q.startsWith("CREATE")) return [] as never;

    if (q.startsWith("INSERT OR IGNORE INTO ACTION_RECEIPTS")) {
      const [id, action, key, input, output, actor, createdAt] = values;
      // Enforce UNIQUE(action, idempotency_key) where key is not null.
      if (key != null) {
        const dup = rows.some(
          (r) => r.action === action && r.idempotency_key === key,
        );
        if (dup) return [] as never;
      }
      rows.push({
        id: id as string,
        action: action as string,
        idempotency_key: (key ?? null) as string | null,
        input_json: input as string,
        output_json: output as string,
        actor: actor as string,
        created_at: createdAt as string,
      });
      return [] as never;
    }

    if (q.includes("COUNT(*)") && q.includes("IDEMPOTENCY_KEY =")) {
      const key = values[0];
      const n = rows.filter((r) => r.idempotency_key === key).length;
      return [{ n }] as never;
    }
    if (q.includes("COUNT(*)")) {
      return [{ n: rows.length }] as never;
    }

    if (q.startsWith("SELECT")) {
      const sorted = [...rows].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      );
      return sorted as never;
    }
    return [] as never;
  };

  return { sql };
}

describe("ReceiptStore", () => {
  let store: ReceiptStore;
  beforeEach(() => {
    store = new ReceiptStore(fakeSql());
  });

  it("writes and lists a receipt", () => {
    store.write({ action: "save_memory", idempotencyKey: "m:1", input: { fact: "x" }, output: { ok: true }, actor: "u" });
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.action).toBe("save_memory");
    expect(list[0]?.input).toEqual({ fact: "x" });
  });

  it("dedupes on (action, idempotency_key) — same key writes once", () => {
    store.write({ action: "save_memory", idempotencyKey: "m:dup", input: { a: 1 }, output: null, actor: "u" });
    store.write({ action: "save_memory", idempotencyKey: "m:dup", input: { a: 2 }, output: null, actor: "u" });
    expect(store.count()).toBe(1);
  });

  it("does NOT dedupe the same key across different actions", () => {
    store.write({ action: "a", idempotencyKey: "k", input: null, output: null, actor: "u" });
    store.write({ action: "b", idempotencyKey: "k", input: null, output: null, actor: "u" });
    expect(store.count()).toBe(2);
  });

  it("treats NULL idempotency keys as distinct (each inserts)", () => {
    store.write({ action: "send_message", idempotencyKey: null, input: null, output: null, actor: "u" });
    store.write({ action: "send_message", idempotencyKey: null, input: null, output: null, actor: "u" });
    expect(store.count()).toBe(2);
  });

  it("hasKey reflects whether a keyed receipt exists", () => {
    expect(store.hasKey("r:1")).toBe(false);
    store.write({ action: "run_reminder", idempotencyKey: "r:1", input: null, output: null, actor: "u" });
    expect(store.hasKey("r:1")).toBe(true);
  });
});
