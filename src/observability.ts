import { subscribe } from "agents/observability";
import type { EventSeverity } from "./events";

/** A normalized observability event handed to the sink for persistence/notify. */
export interface ObservedEvent {
  severity: EventSeverity;
  source: string;
  kind: string;
  message: string;
  detail: unknown;
  /** True for failures the operator should be actively notified about. */
  notify: boolean;
}

export type EventSink = (event: ObservedEvent) => void;

/**
 * Subscribe to the SDK's diagnostics channels and surface the events that
 * matter for an autonomous agent — scheduled-task/reminder failures, chat
 * recovery exhaustion, stalled streams, and MCP connection problems. Without
 * this, those failures are silent (the CF `observability` flag only captures
 * console output + platform metrics, not these structured events).
 *
 * Every surfaced event is both logged to the console AND passed to `sink`, so
 * the agent can persist it to its System Health log and notify on the critical
 * ones. The sink is wrapped so a persistence failure never breaks the channel.
 *
 * Returns a disposer that removes every subscription. Call once per isolate.
 */
export function subscribeObservability(sink?: EventSink): () => void {
  const emit = (event: ObservedEvent) => {
    const tag = `[obs] ${event.kind}`;
    if (event.severity === "warning") console.warn(tag, JSON.stringify(event.detail));
    else console.error(tag, JSON.stringify(event.detail));
    if (sink) {
      try {
        sink(event);
      } catch (err) {
        console.error("[obs] sink failed", err);
      }
    }
  };

  const disposers = [
    // Scheduled tasks + reminders: the daily digest / weekly skill review /
    // reminders all run here. A silent failure at 8am is invisible otherwise.
    subscribe("schedule", (event) => {
      if (event.type === "schedule:error") {
        emit({
          severity: "critical",
          source: "schedule",
          kind: event.type,
          message: "A scheduled task failed to run.",
          detail: event.payload,
          notify: true,
        });
      } else if (event.type === "schedule:duplicate_warning") {
        emit({
          severity: "warning",
          source: "schedule",
          kind: event.type,
          message: "Duplicate schedule detected.",
          detail: event.payload,
          notify: false,
        });
      }
    }),
    // Chat turns: recovery exhaustion/failure means a durable turn gave up; a
    // stalled stream means the model went quiet past the watchdog.
    subscribe("chat", (event) => {
      if (
        event.type === "chat:recovery:exhausted" ||
        event.type === "chat:recovery:failed"
      ) {
        emit({
          severity: "critical",
          source: "chat",
          kind: event.type,
          message: "A durable chat turn gave up after exhausting recovery.",
          detail: event.payload,
          notify: true,
        });
      } else if (event.type === "chat:stream:stalled") {
        emit({
          severity: "error",
          source: "chat",
          kind: event.type,
          message: "A chat stream stalled past the watchdog.",
          detail: event.payload,
          notify: false,
        });
      }
    }),
    // Durable fibers: a failed/interrupted fiber is dropped background work.
    subscribe("fiber", (event) => {
      if (event.type.endsWith(":failed") || event.type.endsWith(":interrupted")) {
        emit({
          severity: "error",
          source: "fiber",
          kind: event.type,
          message: "Background work (durable fiber) did not complete.",
          detail: event.payload,
          notify: false,
        });
      }
    }),
    // MCP: the failure detail is in the payload, not the event type — a server
    // that fails to connect leaves tools missing silently.
    subscribe("mcp", (event) => {
      const err = (event.payload as { error?: string } | undefined)?.error;
      if (err) {
        emit({
          severity: "error",
          source: "mcp",
          kind: event.type,
          message: "An MCP server reported an error.",
          detail: event.payload,
          notify: false,
        });
      }
    }),
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
}
