import { subscribe } from "agents/observability";

/**
 * Subscribe to the SDK's diagnostics channels and surface the events that
 * matter for an autonomous agent — scheduled-task/reminder failures, chat
 * recovery exhaustion, stalled streams, and MCP connection problems. Without
 * this, those failures are silent (the CF `observability` flag only captures
 * console output + platform metrics, not these structured events).
 *
 * Returns a disposer that removes every subscription. Call once per isolate.
 */
export function subscribeObservability(): () => void {
  const disposers = [
    // Scheduled tasks + reminders: the daily digest / weekly skill review /
    // reminders all run here. A silent failure at 8am is invisible otherwise.
    subscribe("schedule", (event) => {
      if (event.type === "schedule:error") {
        console.error("[obs] schedule:error", JSON.stringify(event.payload));
      } else if (event.type === "schedule:duplicate_warning") {
        console.warn("[obs] schedule:duplicate_warning", JSON.stringify(event.payload));
      }
    }),
    // Chat turns: recovery exhaustion/failure means a durable turn gave up; a
    // stalled stream means the model went quiet past the watchdog.
    subscribe("chat", (event) => {
      if (
        event.type === "chat:recovery:exhausted" ||
        event.type === "chat:recovery:failed" ||
        event.type === "chat:stream:stalled"
      ) {
        console.error(`[obs] ${event.type}`, JSON.stringify(event.payload));
      }
    }),
    // Durable fibers: a failed/interrupted fiber is dropped background work.
    subscribe("fiber", (event) => {
      if (event.type.endsWith(":failed") || event.type.endsWith(":interrupted")) {
        console.error(`[obs] ${event.type}`, JSON.stringify(event.payload));
      }
    }),
    // MCP: the failure detail is in the payload, not the event type — a server
    // that fails to connect leaves tools missing silently.
    subscribe("mcp", (event) => {
      const err = (event.payload as { error?: string } | undefined)?.error;
      if (err) {
        console.error(`[obs] ${event.type}`, JSON.stringify(event.payload));
      }
    }),
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
}
