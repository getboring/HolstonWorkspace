# Holston Workspace — Capability Audit & Gap Plan (2026-07-14)

Full audit of the Agents SDK / Think surface vs. what Holston implements, after the
7-fix hardening PR and the native-buildout PR (both merged + live). Ordered by impact.

## Legend
✅ implemented · ⚠️ implemented but broken/partial · ❌ not implemented

## What we have (✅)
- `Think<Env, HolstonState>` with `initialState` + `validateStateChange` (client state rejected)
- `getModel` / `getSystemPrompt` / `getTools` / `getSkills` / `getMessengers` / `getScheduledTasks`
- `beforeTurn` (skill retriever) + `onChatResponse` (nudger + curator, staged approval)
- `chatRecovery = true`, `waitForMcpConnections = true`
- Client MCP manager (connect/disconnect/refresh, OAuth handoff, live tool counts)
- Reminders (NL parse → `this.schedule` → `runReminder` fan-out) + list/cancel
- Web Push (VAPID) subscribe/unsubscribe/send + service worker
- Synced settings (model, autoSkills, approvalMode*, customInstructions)
- Email INBOUND (`routeAgentEmail` + allowlist + HMAC replies + postal-mime)
- Full Kumo UI, per-user Access isolation, observability enabled

---

## GAPS (prioritized)

### P0 — correctness bugs (settings that lie)

1. **`approvalMode` is a dead setting.** State stores `always | destructive-only | never`
   and the UI drives it, but nothing reads it — `beforeToolCall` is not overridden, so
   the mode never changes behavior. The only approval gate is the hardcoded
   `needsApproval: async () => true` on `skill_create`/`skill_patch`. A user setting
   "never ask" still gets asked; "always ask" does nothing for workspace tools.
   **Fix:** override `beforeToolCall` to consult `state.settings.approvalMode` + a
   destructive-tool set (bash/write/edit/delete). ~30 lines.

2. **Reminder timezone is UTC-only.** `createReminder` tells the model the time is UTC
   and parses to a UTC ISO string, but `getDefaultTimezone()` is unset and the user has
   no timezone. "Tomorrow at 3pm" becomes 3pm **UTC**, not the user's 3pm — off by 4-5h
   for ET. Scheduled tasks hardcode `America/New_York` inline, so the app already assumes
   ET. **Fix:** add `timezone` to settings (default America/New_York), set
   `getDefaultTimezone()` from it, and resolve reminder times in that zone. ~40 lines.

### P1 — high-impact missing native features

3. **Agent can't send email or proactively message.** `onEmail` ingests mail but never
   replies; `notifyUser` only pushes + broadcasts. The SDK has `replyToEmail`/`sendEmail`
   (with HMAC signing for reply routing). Wire an outbound path so reminders/digests and
   email replies actually reach the user's inbox. Needs the `send_email` binding.

4. **No `getActions()` write-path.** The Boring Stack write path (Zod → idempotency key →
   authority gate → execute → receipt) maps exactly onto Think Actions
   (idempotency + approvals + authorization, compiled into tools with immutable receipts).
   Today skills/tools throw and have ad-hoc approval. Actions would give every gated
   action a receipt — a real differentiator vs. OpenClaw/Hermes.

5. **No `fetchTools`.** Think ships an opt-in, allowlisted, read-only HTTP fetch tool
   (`fetch_url` + per-binding `fetch_<name>`) with a `tool:fetch` audit event. Holston
   claims "research" in its system prompt but has no web-read capability unless an MCP
   server provides one. Low effort, high utility.

6. **No context/session memory (`configureSession`).** Long conversations aren't compacted
   (no `contextOverflow` config either — a long chat will hard-fail on context overflow),
   and there are no persistent context blocks (durable per-user memory the model reads/writes)
   or FTS5 cross-session search. This is the difference between a chatbot and an assistant
   that remembers you.

### P2 — robustness & polish

7. **No `contextOverflow` config.** Without it, a long turn that overflows the model
   context throws instead of compact-and-retrying. One-line-ish config with `reactive`.

8. **No `chatStreamStallTimeoutMs`.** A stalled Workers AI stream hangs the turn with no
   watchdog. Set a sane default (e.g. 30s) so stuck streams abort into recovery.

9. **No sub-agents (`agentTool`/`subAgent`).** Multi-step delegated work (e.g. a research
   sub-agent) isn't possible. Larger effort; only if the product wants parallel task fan-out.

10. **Push/reminder delivery has no email/Telegram fan-out.** `runReminder` pushes + broadcasts
    but doesn't use Telegram or email even when configured. Unify a `notifyUser` that hits all
    configured channels (ties to #3).

### P3 — hygiene

11. **Stale skill docs.** `home-automation` says `this.mcp.connect(url)` and `debug-agent`
    says `this.mcp.getConnections()` — both pre-date the move to idempotent `addMcpServer`
    and the client MCP manager. Update the two bundled SKILL.md files.

12. **`getSkillScriptRunner` unused.** Skills are instructions-only; enabling the script
    runner would let skills ship executable helpers. Optional.

---

## Execution order (most impactful first)
1. P0-1 approvalMode gate + P0-2 timezone (correctness — settings must not lie)
2. P1-5 fetchTools + P1-3 outbound email/notify fan-out (unlock real "research" + reach)
3. P2-7 contextOverflow + P2-8 stall timeout (don't fall over on long/stuck turns)
4. P1-6 configureSession memory (persistent context blocks + compaction)
5. P1-4 getActions write-path (receipts — the Boring Stack differentiator)
6. P3-11 stale skills (fast cleanup, bundle with any commit)
