import type { Schedule } from "agents";
import { z } from "zod";
import type { ReminderView } from "../shared/state";

/**
 * Reminder schedule payload. `localCron`/`tz` are present only for recurring
 * reminders, so the UTC cron can be re-derived across DST transitions.
 */
export interface ReminderPayload {
  message: string;
  localCron?: string;
  tz?: string;
}

// All fields required (not optional) so small models can't skip the time —
// the failure mode was `{message, kind:"once"}` with datetime omitted. For the
// branch that doesn't apply, the model emits the empty-string sentinel.
export const reminderParseSchema = z.object({
  message: z
    .string()
    .describe("What to be reminded about, imperative, no time words"),
  kind: z
    .enum(["once", "recurring"])
    .describe("once = single time, recurring = repeats"),
  datetime: z
    .string()
    .describe(
      'When kind is "once": LOCAL wall-clock timestamp "YYYY-MM-DDTHH:MM:SS" with NO timezone suffix, e.g. "2026-07-15T15:00:00". When kind is "recurring": empty string "".',
    ),
  cron: z
    .string()
    .describe(
      'When kind is "recurring": 5-field LOCAL cron expression, e.g. "0 9 * * 1-5". When kind is "once": empty string "".',
    ),
});

/** Format a Date as a readable local time string in the given IANA zone. */
export function formatLocal(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

/**
 * The offset (minutes) of `timeZone` from UTC at instant `date`.
 * Positive means the zone is behind UTC (e.g. America/New_York = 240/300).
 */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const local = new Date(date.toLocaleString("en-US", { timeZone }));
  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((utc.getTime() - local.getTime()) / 60000);
}

/**
 * Interpret "YYYY-MM-DDTHH:MM:SS" as wall-clock time in `timeZone` and return
 * the real UTC instant. Returns null if unparseable.
 *
 * The offset must be evaluated at the RESULT instant, not the provisional
 * guess — near a DST boundary those differ by the DST delta. We converge in
 * two passes (a single correction is wrong exactly when the guess and result
 * straddle the transition).
 */
export function localWallClockToUtc(
  local: string,
  timeZone: string,
): Date | null {
  const m = local
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (!y || !mo || !d || !h || !mi) return null;

  const target = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  // First correction using the offset at the provisional instant...
  let result = target + tzOffsetMinutes(new Date(target), timeZone) * 60000;
  // ...then re-evaluate at the corrected instant and adjust if the offset
  // changed (a DST boundary lies between the two).
  const refined = target + tzOffsetMinutes(new Date(result), timeZone) * 60000;
  if (refined !== result) result = refined;

  const date = new Date(result);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Shift a local 5-field cron expression's hour into UTC by the zone's current
 * offset (whole-hour zones only; DST shifts by ≤1h are acceptable for reminders).
 * Returns null if the expression isn't a standard 5-field cron.
 */
export function shiftCronToUtc(cron: string, timeZone: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (
    hour === "*" ||
    hour.includes(",") ||
    hour.includes("/") ||
    hour.includes("-")
  ) {
    // Non-simple hour field: leave as-is (best effort).
    return cron.trim();
  }
  const h = Number(hour);
  if (!Number.isInteger(h)) return null;
  const offsetHours = tzOffsetMinutes(new Date(), timeZone) / 60;
  const utcHour = (((h + offsetHours) % 24) + 24) % 24;
  return `${min} ${Math.round(utcHour)} ${dom} ${mon} ${dow}`;
}

export function toReminderView(
  schedule: Schedule<ReminderPayload>,
  timeZone: string,
): ReminderView {
  const message = schedule.payload?.message ?? "(reminder)";
  const recurring = schedule.type === "cron" || schedule.type === "interval";
  const nextRun = "time" in schedule ? schedule.time * 1000 : null;
  let when: string;
  switch (schedule.type) {
    case "cron":
      when = `cron: ${schedule.cron}`;
      break;
    case "interval":
      when = `every ${schedule.intervalSeconds}s`;
      break;
    default:
      // Render in the user's timezone, not the server/browser zone, so the
      // displayed time matches what the user asked for.
      when = nextRun
        ? new Intl.DateTimeFormat("en-US", {
            timeZone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(nextRun))
        : "scheduled";
  }
  return {
    id: schedule.id,
    message,
    when,
    nextRun,
    kind: schedule.type,
    recurring,
  };
}
