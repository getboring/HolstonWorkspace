import { describe, expect, it } from "vitest";
import {
  localWallClockToUtc,
  shiftCronToUtc,
  tzOffsetMinutes,
} from "./time";

const NY = "America/New_York";

describe("localWallClockToUtc", () => {
  it("converts summer (EDT, UTC-4): 3pm ET -> 19:00 UTC", () => {
    const d = localWallClockToUtc("2026-07-15T15:00:00", NY);
    expect(d?.toISOString()).toBe("2026-07-15T19:00:00.000Z");
  });

  it("converts winter (EST, UTC-5): 3pm ET -> 20:00 UTC", () => {
    const d = localWallClockToUtc("2026-01-15T15:00:00", NY);
    expect(d?.toISOString()).toBe("2026-01-15T20:00:00.000Z");
  });

  it("handles the spring-forward day (2026-03-08): 9am ET -> 13:00 UTC (EDT)", () => {
    const d = localWallClockToUtc("2026-03-08T09:00:00", NY);
    expect(d?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("handles the fall-back day (2026-11-01): 9am ET -> 14:00 UTC (EST)", () => {
    const d = localWallClockToUtc("2026-11-01T09:00:00", NY);
    expect(d?.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("resolves UTC input unchanged", () => {
    const d = localWallClockToUtc("2026-07-15T15:00:00", "UTC");
    expect(d?.toISOString()).toBe("2026-07-15T15:00:00.000Z");
  });

  it("accepts space-separated and second-less forms", () => {
    expect(localWallClockToUtc("2026-07-15 15:00", NY)?.toISOString()).toBe(
      "2026-07-15T19:00:00.000Z",
    );
  });

  it("returns null on unparseable input", () => {
    expect(localWallClockToUtc("tomorrow at 3", NY)).toBeNull();
    expect(localWallClockToUtc("", NY)).toBeNull();
  });
});

describe("shiftCronToUtc", () => {
  it("shifts a simple-hour cron by the summer EDT offset (9am ET -> 13:00 UTC)", () => {
    // In July NY is EDT (UTC-4): 9 + 4 = 13.
    expect(shiftCronToUtc("0 9 * * 1-5", NY)).toBe("0 13 * * 1-5");
  });

  it("wraps hours past 24", () => {
    // 22 + 4 = 26 -> 2
    expect(shiftCronToUtc("0 22 * * *", NY)).toBe("0 2 * * *");
  });

  it("leaves non-simple hour fields unchanged (wildcard/step/range/list)", () => {
    expect(shiftCronToUtc("*/15 * * * *", NY)).toBe("*/15 * * * *");
    expect(shiftCronToUtc("0 9-17 * * *", NY)).toBe("0 9-17 * * *");
    expect(shiftCronToUtc("0 8,12 * * *", NY)).toBe("0 8,12 * * *");
  });

  it("returns null for malformed cron", () => {
    expect(shiftCronToUtc("garbage", NY)).toBeNull();
    expect(shiftCronToUtc("0 9 * *", NY)).toBeNull(); // 4 fields
  });
});

describe("tzOffsetMinutes", () => {
  it("reports NY as 240 minutes behind in summer, 300 in winter", () => {
    expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"), NY)).toBe(240);
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), NY)).toBe(300);
  });

  it("reports UTC as 0", () => {
    expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "UTC")).toBe(0);
  });
});
