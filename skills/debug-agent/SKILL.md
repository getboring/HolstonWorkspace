---
name: debug-agent
description: Debug a Cloudflare Agent that is not responding. Check DO state, WebSocket connections, alarm scheduling, and MCP server health.
triggers: ["debug agent", "agent not responding", "agent stuck", "troubleshoot agent"]
version: 1
success_count: 0
fail_count: 0
created_at: 2026-07-13T22:00:00Z
updated_at: 2026-07-13T22:00:00Z
---

# Debug a Cloudflare Agent

## Order of Investigation

1. **Check DO state**: Is the agent object alive? Use `npx wrangler tail` to see real-time logs.
2. **Check WebSocket**: Is the client connected? Look for `onConnect` / `onClose` logs.
3. **Check alarms**: Are scheduled tasks firing? Look for `alarm()` in logs.
4. **Check MCP**: Is the MCP server reachable? `this.getMcpServers()` returns server state + tools; the MCP tab shows live status.
5. **Check model**: Is Workers AI returning errors? Check for `AiError` in logs.
6. **Check state**: Is SQLite healthy? `this.sql` queries should return without error.

## Common Failures

- **Agent evicted**: Hibernation failed due to active setTimeout/fetch. Check for non-hibernation-safe code.
- **MCP timeout**: `waitForMcpConnections` default is 10s. Increase if MCP server is slow.
- **Context overflow**: Session compaction triggered. Check `maxPersistedMessages` setting.
- **Alarm not firing**: DO alarm must be set via `this.schedule()`. Direct `ctx.storage.setAlarm()` bypasses the SDK.

## Recovery

- Deployed mid-turn? Think's fiber recovery system handles this via `onFiberRecovered()`.
- WebSocket dropped? `useAgentChat` auto-reconnects. Stream resumes from last chunk.
- State corrupted? Check `cf_agents_state` and `cf_agents_schedules` tables in DO SQLite.