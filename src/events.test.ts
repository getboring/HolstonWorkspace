import { beforeEach, describe, expect, it } from "vitest";
import { EVENT_RETENTION, EventLog } from "./events";
import type { AgentSql } from "./receipts";

/**
 * In-memory emulator of the tagged-template SQL the EventLog issues. It models
 * the specific query shapes: CREATE (no-op), MAX(seq), INSERT, DELETE ...
 * WHERE seq <= ?, COUNT (with/without severity filter), and the paged/all
 * SELECTs with `seq < ?`, optional `instr(?, severity)` filter, ORDER BY seq
 * DESC, and LIMIT.
 */
function fakeSql(): AgentSql {
  interface Row {
    id: string;
    severity: string;
    source: string;
    kind: string;
    message: string;
    detail_json: string | null;
    created_at: string;
    seq: number;
  }
  const rows: Row[] = [];

  const sql: AgentSql["sql"] = (
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ) => {
    const raw = strings.join("?");
    const q = raw.replace(/\s+/g, " ").trim().toUpperCase();

    if (q.startsWith("CREATE")) return [] as never;

    if (q.startsWith("SELECT MAX(SEQ)")) {
      const m = rows.length ? Math.max(...rows.map((r) => r.seq)) : null;
      return [{ m }] as never;
    }

    if (q.startsWith("INSERT INTO AGENT_EVENTS")) {
      const [id, severity, source, kind, message, detail, createdAt, seq] =
        values;
      rows.push({
        id: id as string,
        severity: severity as string,
        source: source as string,
        kind: kind as string,
        message: message as string,
        detail_json: detail as string,
        created_at: createdAt as string,
        seq: seq as number,
      });
      return [] as never;
    }

    if (q.startsWith("DELETE FROM AGENT_EVENTS")) {
      const threshold = values[0] as number;
      for (let i = rows.length - 1; i >= 0; i--) {
        if ((rows[i]?.seq ?? Infinity) <= threshold) rows.splice(i, 1);
      }
      return [] as never;
    }

    if (q.includes("COUNT(*)")) {
      if (q.includes("INSTR(")) {
        const set = values[0] as string;
        const n = rows.filter((r) => set.includes(r.severity)).length;
        return [{ n }] as never;
      }
      return [{ n: rows.length }] as never;
    }

    // SELECT rows. Determine cursor (seq <) and optional severity filter.
    if (q.startsWith("SELECT ID")) {
      let filtered = [...rows];
      // Positional values order: [beforeSeq] then optionally [filter] and [limit+1].
      // Reconstruct which are present by inspecting the query text.
      const hasSeqCursor = q.includes("SEQ <");
      const hasFilter = q.includes("INSTR(");
      const hasLimit = q.includes("LIMIT");
      let vi = 0;
      let beforeSeq = Number.MAX_SAFE_INTEGER;
      if (hasSeqCursor) beforeSeq = values[vi++] as number;
      let filterSet: string | null = null;
      if (hasFilter) filterSet = values[vi++] as string;
      const limit = hasLimit ? (values[vi++] as number) : Infinity;

      filtered = filtered.filter((r) => r.seq < beforeSeq);
      if (filterSet) filtered = filtered.filter((r) => filterSet.includes(r.severity));
      filtered.sort((a, b) => b.seq - a.seq);
      return filtered.slice(0, limit) as never;
    }

    return [] as never;
  };

  return { sql };
}

describe("EventLog", () => {
  let log: EventLog;
  beforeEach(() => {
    log = new EventLog(fakeSql());
  });

  const rec = (over: Partial<Parameters<EventLog["record"]>[0]> = {}) =>
    log.record({
      severity: "error",
      source: "schedule",
      kind: "schedule:error",
      message: "boom",
      detail: { a: 1 },
      ...over,
    });

  it("records and reads back an event", () => {
    const e = rec();
    expect(e.id).toBeTruthy();
    expect(e.createdAt).toBeTruthy();
    const page = log.page();
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.message).toBe("boom");
    expect(page.events[0]?.detail).toEqual({ a: 1 });
  });

  it("returns events newest-first by seq", () => {
    rec({ message: "first" });
    rec({ message: "second" });
    rec({ message: "third" });
    const page = log.page();
    expect(page.events.map((e) => e.message)).toEqual(["third", "second", "first"]);
  });

  it("counts by severity set", () => {
    rec({ severity: "error" });
    rec({ severity: "critical" });
    rec({ severity: "warning" });
    rec({ severity: "info" });
    expect(log.count()).toBe(4);
    expect(log.count(["error", "critical"])).toBe(2);
    expect(log.count(["warning"])).toBe(1);
  });

  it("paginates via cursor without repeating or skipping", () => {
    for (let i = 0; i < 5; i++) rec({ message: `e${i}` });
    const p1 = log.page({ limit: 2 });
    expect(p1.events.map((e) => e.message)).toEqual(["e4", "e3"]);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = log.page({ limit: 2, cursor: p1.nextCursor });
    expect(p2.events.map((e) => e.message)).toEqual(["e2", "e1"]);

    const p3 = log.page({ limit: 2, cursor: p2.nextCursor });
    expect(p3.events.map((e) => e.message)).toEqual(["e0"]);
    expect(p3.nextCursor).toBeNull();
  });

  it("filters a page by severity", () => {
    rec({ severity: "info", message: "i" });
    rec({ severity: "critical", message: "c" });
    rec({ severity: "info", message: "i2" });
    const page = log.page({ severities: ["critical"] });
    expect(page.events.map((e) => e.message)).toEqual(["c"]);
  });

  it("prunes beyond the retention window", () => {
    for (let i = 0; i < EVENT_RETENTION + 10; i++) rec({ message: `e${i}` });
    expect(log.count()).toBe(EVENT_RETENTION);
    // The oldest events are gone; the newest survive.
    const all = log.all();
    expect(all[0]?.message).toBe(`e${EVENT_RETENTION + 9}`);
  });

  it("exports all retained events newest-first", () => {
    rec({ message: "a" });
    rec({ message: "b" });
    const all = log.all();
    expect(all.map((e) => e.message)).toEqual(["b", "a"]);
  });
});
