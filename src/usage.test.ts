import { describe, expect, it } from "vitest";
import type { AgentSql } from "./receipts";
import { UsageMeter } from "./usage";

/** In-memory emulator of the ai_usage table's tagged-template SQL. */
function fakeSql(): AgentSql {
  const byDay = new Map<string, number>();
  const sql: AgentSql["sql"] = (
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim().toUpperCase();
    if (q.startsWith("CREATE")) return [] as never;
    if (q.startsWith("SELECT CALLS")) {
      const day = values[0] as string;
      return [{ calls: byDay.get(day) ?? 0 }] as never;
    }
    if (q.startsWith("INSERT INTO AI_USAGE")) {
      const day = values[0] as string;
      const n = values[1] as number;
      byDay.set(day, (byDay.get(day) ?? 0) + n);
      return [] as never;
    }
    return [] as never;
  };
  return { sql };
}

describe("UsageMeter", () => {
  it("starts at zero and allows spending", () => {
    const m = new UsageMeter(fakeSql(), 5);
    const s = m.snapshot();
    expect(s.calls).toBe(0);
    expect(s.remaining).toBe(5);
    expect(s.exceeded).toBe(false);
    expect(m.canSpend()).toBe(true);
  });

  it("increments and reports remaining", () => {
    const m = new UsageMeter(fakeSql(), 3);
    m.record();
    m.record();
    const s = m.snapshot();
    expect(s.calls).toBe(2);
    expect(s.remaining).toBe(1);
  });

  it("blocks spending once the daily limit is reached", () => {
    const m = new UsageMeter(fakeSql(), 2);
    m.record();
    m.record();
    expect(m.canSpend()).toBe(false);
    expect(m.snapshot().exceeded).toBe(true);
  });

  it("resolves the limit from a live getter (settable ceiling)", () => {
    let limit = 2;
    const m = new UsageMeter(fakeSql(), () => limit);
    m.record();
    m.record();
    expect(m.canSpend()).toBe(false); // at the ceiling
    limit = 10; // raise it in "Settings"
    expect(m.canSpend()).toBe(true); // no rebuild needed
    expect(m.snapshot().limit).toBe(10);
  });
});
