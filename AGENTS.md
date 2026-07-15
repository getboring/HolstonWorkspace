# Holston Workspace -- Agent Conventions

## Project Overview

Holston Workspace is a cloud-native AI agent harness built on the Cloudflare Agents SDK (Think).
It extends `Think<Env, HolstonState>` to provide a Hermes-like agent: code execution (Codemode),
browser automation, workspace tools, self-improving skills, gated actions with an immutable receipt
ledger, persistent memory, multi-platform messaging, scheduling, and voice — all Cloudflare-native.

## Tech Stack

- **Harness**: `@cloudflare/think` 0.13.0 (extends `Think<Env, HolstonState>`) on `agents` 0.17.4
- **Runtime**: Cloudflare Workers + Durable Objects (SQLite-backed, hibernation-safe)
- **Model**: Workers AI (kimi-k2.7-code default, zero API keys; chosen live from Settings)
- **Code execution**: Codemode (`@cloudflare/codemode`) via `LOADER` WorkerLoader binding
- **Browser**: Cloudflare Browser Rendering via `BROWSER` binding (`createBrowserTools`)
- **Messaging**: Telegram (native Think messenger) + Email in/out (CF Email Routing, AI-triaged) + WebSocket chat
- **UI**: `@cloudflare/kumo` (Cloudflare's design system) + `streamdown` (markdown) + `@cloudflare/voice/react`
- **Skills**: `agents:skills` (bundled) + R2 (runtime) + Vectorize (search)
- **Memory**: Think Session context blocks (writable `memory`, R2 `skills`, searchable `history` FTS5) + compaction
- **Auth**: Cloudflare Access (JWT at edge) + in-Worker verification + CSRF guard
- **MCP**: Client-managed from the UI (`@callable`); `MCP_SERVER_URL` is an optional startup default

## Architecture

```
src/server.ts          HolstonAgent (Think, HolstonState): getTools (execute + browser + skills),
                       getActions, configureSession, classifyChatError, beforeToolCall gate,
                       @callable RPC, onEmail (triage + reply), Worker fetch/email handler
src/actions.ts         Think action() tools (send_message, set_reminder, save_memory, remove_skill)
src/receipts.ts        Immutable append-only receipt ledger in DO SQLite (UNIQUE + read index, keyset page, NDJSON export)
src/events.ts          System Health log (agent_events SQLite: severity/source/kind, seq-ordered cursor pagination, bounded retention, export)
src/usage.ts           UsageMeter — per-DO daily AI-call budget (ai_usage SQLite, canSpend/record/snapshot)
src/observability.ts   diagnostics_channel subscriptions (schedule / chat / fiber / mcp) → typed event sink (persist + notify on critical)
src/shared/state.ts    HolstonState contract, shared server+client
src/core/result.ts     Result<T> / ok / fail / statusFor (never-throw convention)
src/core/tool-policy.ts  ToolRisk registry + riskFor + shouldApprove — single source of truth for gating
src/core/circuit-breaker.ts  withCircuitBreaker / withTimeout for external calls
src/core/csrf.ts       assertSameOrigin (CSRF guard)
src/push.ts            Web Push (VAPID) send + dead-endpoint pruning
src/auth.ts            Cloudflare Access JWT verification
src/skills/store.ts    R2 + Vectorize skill CRUD (approved/) + curator staging (pending/), circuit-broken search
src/skills/hooks.ts    beforeTurn (retriever) + onChatResponse (nudger + curator)
src/skills/tools.ts    skill_create, skill_patch, skill_load, skill_list, skill_search
src/app.tsx            React shell (Kumo Tabs + Toasty), typed agent stub useAgent<HolstonAgent, HolstonState>
src/lib/push.ts        Client push subscribe (service worker + VAPID key)
src/lib/download.ts    Client NDJSON download helper (receipts + health export)
src/lib/tools.ts       GATED_TOOLS list for the Settings per-tool override UI
src/components/        ChatView (+ starters + tool-output renderer), TasksPanel, McpPanel, SkillsPanel,
                       LabPanel (Codemode snippets/executions + browser Live View/recording),
                       SettingsPanel, ReceiptsPanel, HealthPanel, MemoryCard, ToolApproval, SessionList (Kumo)
public/sw.js           Push service worker
skills/                Bundled SKILL.md files (agents:skills bundling)
docs/plans/            Capability audit + build plans
```

## Key Decisions

- **Think over AIChatAgent**: Think has skills, messengers, workspace tools, scheduled tasks, and lifecycle hooks built in.
- **Synced state, not env/local**: `HolstonAgent extends Think<Env, HolstonState>` with `initialState`. Settings (model, autoSkills, approvalMode, timezone, customInstructions), reminders, MCP server views, and push subscriptions all live in state and sync to clients. `validateStateChange` rejects any client-pushed state (`source !== "server"`) — the UI mutates only through `@callable` RPC. `getModel()`/`getSystemPrompt()`/`getDefaultTimezone()`/`beforeTurn()` read from `this.state.settings`, so settings actually drive each turn.
- **Unified tool-approval policy (`src/core/tool-policy.ts`)**: one risk registry is the single source of truth. `KNOWN_RISK` maps named tools to read/write/destructive/external; `riskFor()` infers the rest (`browser_*`/`cdp_*`/`tool_*`/`mcp_*` → external, `execute` → destructive, unknown → write — fail-safe, never read). `shouldApprove(tool, mode, overrides)` combines the baseline mode with per-tool overrides (`always`/`never` win over the mode). ALL three gates consult it: `beforeToolCall` (built-in + code-exec + browser + MCP tools), the action `gate()` in actions.ts, and the Settings override UI. This closed the original hole — under "always", `execute`/`browser_*`/`mcp_*` previously bypassed approval entirely because beforeToolCall only checked bash/write/edit/delete by name. `beforeToolCall` can only allow/block/substitute (no client modal), so the modal path remains the tools' own `needsApproval`; the gate blocks with a reason when a tool should approve but can't raise the modal. Covered by `src/core/tool-policy.test.ts`.
- **AI budget metering (`src/usage.ts`)**: `UsageMeter` keeps a per-DO daily call counter in an `ai_usage` SQLite table (default `DEFAULT_DAILY_CALL_LIMIT` 500). `beforeTurn` throws when `!canSpend()` (blocks the turn), `onChatResponse` `record()`s a call, and `syncUsage()` mirrors the snapshot into state for the Settings meter. `classifyChatError` also detects 429/rate_limit so provider throttling is surfaced, not swallowed. Covered by `src/usage.test.ts`.
- **Timezone**: reminders parse against the user's `settings.timezone` (default America/New_York), not UTC. The model returns LOCAL wall-clock time; `localWallClockToUtc`/`shiftCronToUtc` convert to the real instant/cron (Agent.schedule runs cron in UTC). `getDefaultTimezone()` also drives Think wall-clock scheduled tasks.
- **fetchTools**: `fetchTools = { allowlist: [...] }` gives the model a read-only, GET-only, allowlisted `fetch_url` tool (CF docs, Wikipedia, raw.githubusercontent, api.github) — backs the "research" claim without an MCP server. Emits `tool:fetch` observability.
- **Code execution + browser (Cloudflare-native)**: `getTools()` builds the execute tool with `createExecuteRuntime(this, { session: { mode: "dynamic", recording } })` (NOT the `createExecuteTool` one-liner) — the runtime form returns `{ runtime, connectors, tool }` and assigns `this.codemode`, so callables can reach snippets + the execution audit trail, and we grab the `BrowserConnector` out of `connectors` for Live View. Codemode runs model code in an isolated Worker via the `LOADER` binding; exposes `state.*` = DO workspace, `tools.*`, `cdp.*` = browser. `createBrowserTools({browser, loader})` adds the standalone browser tools when `BROWSER` is bound. `CodemodeRuntime` is exported from the Worker entry so the loader can instantiate it. Governed by the same `approvalMode`/`beforeToolCall` gate. `getSystemPrompt()` advertises a capability only when its binding is present (no claiming tools it lacks). NOTE: `codemode` is DECLARED (`declare codemode?`) on our class — it already exists on the Think base, so re-declaring the value errors (TS2612).
- **Codemode snippets → executable skills (SDK audit rec #2)**: `saveSnippet(name, executionId, desc)` promotes a working `execute` run's code to a durable named snippet the model re-runs via `codemode.run` — receipted (`save_snippet`, key `snippet:<name>`, name must pass `SKILL_NAME_PATTERN`). `listSnippets`/`deleteSnippet`/`listExecutions` back the Lab tab (executions = the audit trail, save-as-snippet inline on completed/applied runs). These are executable skills, distinct from the prose skills in the Skills tab. Reachable only because we switched to `createExecuteRuntime`.
- **Browser Live View + recording (SDK audit rec #3)**: `browserLiveView()` calls `this.#browserConnector.liveView()` → per-tab interactive URLs (valid ~5 min) so a human can watch/take over a running browser session (needs `reuse`/`dynamic` mode — we use `dynamic`). `browserRecording(sessionId)` fetches the rrweb replay via `getBrowserRecording({ accountId, apiToken, sessionId })` from `agents/browser` — this hits the CF REST API (the Worker binding can't read recordings), so it needs owner secrets `CF_ACCOUNT_ID` + `CF_API_TOKEN` (Browser Rendering read). Recording is opt-in per `settings.browserRecording` (Settings switch), read at `getTools()` time so it takes effect next turn. Both degrade cleanly when unconfigured.
- **contextOverflow needs classifyChatError**: `contextOverflow = { reactive: true, maxRetries: 1 }` only fires if `classifyChatError` returns `"context_overflow"` — Think never matches provider error strings itself. We override it to delegate to `defaultContextOverflowClassifier` plus a Workers-AI fallback that checks both `error.message` and `APICallError.responseBody`. `chatStreamStallTimeoutMs = 120_000` (the watchdog measures the inter-chunk gap INCLUDING server-side tool execution — bash/MCP/fetch/exec — so it must sit above the slowest tool, not just model TTFT).
- **Observability → persistent System Health (`src/observability.ts` + `src/events.ts`)**: `subscribeObservability(sink)` `subscribe()`s to the `schedule`/`chat`/`fiber`/`mcp` diagnostics channels, classifies each failure (info/warning/error/critical), logs it to console AND hands a normalized `ObservedEvent` to the sink. The sink (wired in `onStart`) `record()`s it into the `EventLog` (`agent_events` DO SQLite — append-only, monotonic `seq` for stable ordering, bounded retention `EVENT_RETENTION` 500 pruned on write, keyset cursor pagination, NDJSON export) and, for `notify:true` events (schedule:error, chat:recovery:*), fires `notifyUser`. `syncHealth()` badges the error+critical count into state (Health tab). Operational catch-sites that were console-only (MCP registration, email reply, notify email) now also go through `logEvent()`. The CF `observability` flag only captures console + platform metrics, so without this the failures were invisible on refresh. Note: MCP failure detail is in `event.payload.error`, not the event type. Covered by `src/events.test.ts`.
- **Onboarding + reachable capabilities**: the ChatView empty state renders clickable `STARTERS` (reminder/memory/code-exec/web-read) so first-run users discover real tools. ChatView's tool-output renderer shows `browser_*` screenshots as images and long `execute` output behind a show-more toggle (was a 600-char JSON truncation). The MemoryCard is editable (`setMemory` replaces), McpPanel lists each server's tool NAMES (`listMcpTools`), and the SessionList sidebar is a full-text history search (`searchHistory`) — all capabilities that existed server-side but had no UI.
- **Resilience (sentinel building blocks)**: `src/core/circuit-breaker.ts` wraps `SkillStore.search` (Workers-AI embed + Vectorize) so a brownout opens the circuit and returns the empty fallback instead of eating latency each call. `src/core/result.ts` is the canonical `Result<T>`/`ok`/`fail`/`statusFor` (the never-throw convention). `src/core/csrf.ts` `assertSameOrigin` guards the browser skills approve/reject POST endpoints (NOT the Telegram webhook — it has no Origin).
- **Notify fan-out**: `notifyUser` (used by reminders) hits push + web broadcast + owner email (when the `send_email` binding + OWNER_EMAIL are set). `onEmail` now processes inbound mail as a blocking turn and `replyToEmail`s the model's answer (HMAC-signed when EMAIL_SIGNING_SECRET is set).
- **Actions with receipts (Boring Stack write-path)**: `getActions()` returns `action()` tools (`send_message`, `set_reminder`, `save_memory`, `remove_skill`) that follow validate → idempotency → authorize → execute → **receipt**. Think provides the first four natively (Zod `inputSchema`, `idempotencyKey` ledger, `permissions` + `authorizeTurn`, `execute`); the immutable receipt is ours — `ReceiptStore` (src/receipts.ts) writes an insert-only `action_receipts` row in the DO's SQLite. `approvalMode` ties in: "always" forces `approval:true` on every action, "destructive-only" gates medium/high risk, "never" ungates. Receipts are read via `@callable listReceipts()` / `listReceiptsPage({limit,cursor})` (keyset pagination on `(created_at DESC, id DESC)` — UUIDs aren't time-ordered so `id` is the unique tiebreaker) and exported via `exportReceipts()` → NDJSON; the Receipts tab paginates (load-more) with a download button. `syncReceiptCount()` badges it (goes through `receiptStore()` so the table exists before COUNT). Covered by `src/receipts.test.ts`.
- **Session memory (`configureSession`)**: returns Think's `this.session` with context blocks — writable `memory` (durable user facts; model writes via `set_context` / the `save_memory` action, read via `@callable getMemory()` + the Memory card), R2-backed `skills` (`R2SkillProvider`, on-demand `load_context`), and a searchable `history` block (`search_context` / FTS5). Compaction via `createCompactFunction` (kimi summarizer) + `.compactAfter(100_000)` so long chats compress before hitting the reactive overflow backstop. Gotcha respected: `appendContextBlock` then `refreshSystemPrompt()` (cached prompt is sticky).
- **@callable RPC for everything user-driven**: MCP connect/disconnect/refresh, reminder create/list/cancel, settings patch, push subscribe/unsubscribe. Client uses the typed stub via `useAgent<HolstonAgent, HolstonState>` → `agent.stub.method()` (untyped overload leaves `stub.*` possibly-undefined).
- **Client-managed MCP**: `connectMcpServer` calls `this.addMcpServer(name, url)`; an `authenticating` result returns `authUrl` for the UI to open. `syncMcpState()` (on `onStart` + after each mutation) mirrors `getMcpServers()` into state so the panel shows live states + tool counts.
- **Reminders**: `createReminder` parses NL with `generateObject` against a FLAT required-field schema (`{message, kind, datetime, cron}` — the SDK's discriminated-union `scheduleSchema` returned `no-schedule` on small models, and optional fields got dropped). The model returns LOCAL wall-clock; `localWallClockToUtc` (two-pass, DST-correct) / `shiftCronToUtc` convert to the real UTC instant/cron. `runReminder` is idempotent (minute-bucket dedupe via the receipt store + `submitMessages` idempotencyKey) so at-least-once alarm redelivery can't double-fire. Recurring reminders carry `localCron`+`tz` in the payload; `reconcileCronDrift` (onStart) re-derives the UTC cron so DST drift self-corrects. `toReminderView` formats in the user's timezone (not the browser's).
- **Email triage**: `onEmail` runs `classifyEmail` (a lean `generateObject` → actionable/notification/spam + shouldReply) BEFORE the expensive `saveMessages` turn — drops spam and skips replying to notifications to prevent cost spirals. Then `saveMessages` (blocking turn) + `replyToEmail` with the model's answer when `shouldReply`.
- **Push**: VAPID via `web-push`. `subscribePush`/`unsubscribePush` store `PushSubscription.toJSON()` in state; `sendPush` prunes 404/410 endpoints. `notifyUser` also `broadcast`s a `{type:"notification"}` message the client turns into a Kumo toast. Service worker at `public/sw.js`.
- **Kumo UI**: Cloudflare's design system. `styles.css` = `@source` (scan Kumo dist) + `@import "@cloudflare/kumo/styles/tailwind"` + `@import "tailwindcss"` (order matters). Gotchas: `Surface` has no `variant` (className only); `Text` has no `className` (use `truncate`/`bold` props or wrap in a div); `Input`/`Select`/`Switch` use `aria-label` for hidden labels, not `hideLabel`; `Empty`/`Banner` `icon` want a rendered element (`<Icon />`), `Button` `icon` takes the component; `mono`/`mono-secondary` Text variants fix their own size. `Input` has NO icon/prefix/suffix affix props (only `label`/`labelTooltip`) — put a clear button as a sibling, not inside.
- **R2 + Vectorize for skills**: Skills are SKILL.md files in R2. Embeddings in Vectorize enable semantic retrieval. No external vector DB needed.
- **Self-improving loop**: `onChatResponse` counts tool UIParts on `result.message` (ChatResponseResult has no `toolCalls` field). If >= 5, nudge logs to the agent's SQLite (6h cooldown, survives hibernation). Curator uses `generateObject` to extract a skill and STAGES it to `skills-pending/` in R2 — human approves in the Skills panel before it is embedded in Vectorize. `beforeTurn` vector-searches approved skills and returns `TurnConfig.system` (not `systemPrompt`) built from `ctx.system`.
- **Cloudflare Access**: JWT verified in-Worker as defense-in-depth (`run_worker_first` makes the gate actually run before assets). Agent routes are guarded via `routeAgentRequest`'s `onBeforeConnect`/`onBeforeRequest`; the instance name in the URL must equal `agentNameFromEmail(user.email)`.
- **Voice input**: `useVoiceInput` from `@cloudflare/voice/react` provides STT dictation into the chat input; connects to the same per-user instance.
- **MCP client**: `onStart` registers `MCP_SERVER_URL` via idempotent `this.addMcpServer()` (registration persists in SQLite and reconnects on wake — never use raw `this.mcp.connect()` here). `waitForMcpConnections = true` so the first turn sees MCP tools.
- **Email routing**: `routeAgentEmail` with a sender-allowlist resolver (plus `createSecureReplyEmailResolver` when `EMAIL_SIGNING_SECRET` is set); `onEmail` parses MIME with postal-mime and skips auto-replies. (Triage + reply flow is above.)
- **Messenger webhooks**: `/messengers/*` POSTs are forwarded to the owner instance (`OWNER_EMAIL`) via `getAgentByName().fetch()` — Think matches the path inside its `onRequest`.
- **What Think already provides (don't re-wire)**: workspace file tools (read/write/edit/list/find/grep/delete) + `bash` are auto-included every turn (`workspaceBash` default true) over the DO's SQLite filesystem — `getTools()` only ADDS to them. `chatRecovery = true` is a class field (per SDK warning, NOT set in onStart). Scheduled prompt tasks funnel through recoverable `submitMessages`.

## Scripts

```bash
npm run start       # Start Vite dev server
npm run build       # Build for production
npm run deploy      # Build + wrangler deploy
npm run typecheck   # TypeScript check
npm run test        # Vitest (pure-logic unit tests)
npm run types       # Generate wrangler types
```

## Testing

Vitest (`vitest.config.ts`, node environment) covers the pure logic that was extracted out of the DO-bound `server.ts` so it can be unit-tested without a Worker runtime: `auth`, `lib/time` (DST/cron math), `core/csrf`, `core/circuit-breaker`, `core/tool-policy`, `receipts` (incl. keyset pagination + export), `usage`, and `events` (System Health log). SQLite-backed stores (`ReceiptStore`, `EventLog`, `UsageMeter`) are exercised through a small in-memory emulator of the `this.sql` tagged template — each test file builds a `fakeSql()` that matches the specific query shapes. CI (`.github/workflows/ci.yml`) runs typecheck + test + build on every push/PR; `deploy.yml` runs the test step before deploying.

## Environment Variables

See `.env.example`. Set via `npx wrangler secret put <NAME>`:

- `TELEGRAM_BOT_TOKEN` - Telegram bot token from @BotFather
- `TELEGRAM_BOT_USERNAME` - Bot username (e.g. "holston_bot")
- `TELEGRAM_WEBHOOK_SECRET_TOKEN` - Secret token for webhook verification
- `TEAM_DOMAIN` - Cloudflare Access team domain (e.g. https://your-team.cloudflareaccess.com)
- `POLICY_AUD` - Cloudflare Access application AUD tag
- `MCP_SERVER_URL` - MCP server URL for tool integration (optional)
- `OWNER_EMAIL` - Owner's email; binds Telegram/scheduled traffic to their instance (wrangler.jsonc var)
- `ALLOWED_EMAIL_SENDERS` - Comma-separated inbound email allowlist; OWNER_EMAIL always allowed (wrangler.jsonc var)
- `EMAIL_SIGNING_SECRET` - HMAC secret for secure email reply routing (optional secret)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` - Web Push keys (optional; `npx web-push generate-vapid-keys`)
- `EMAIL` (binding) - Optional `send_email` binding in wrangler.jsonc for agent outbound email
- `CF_ACCOUNT_ID` / `CF_API_TOKEN` - Optional secrets for replaying browser session recordings via the CF REST API (Live View works without them; only `browserRecording` playback needs them). Token needs Browser Rendering read access.

Bindings in `wrangler.jsonc` (not secrets): `AI`, `ASSETS`, `HolstonAgent` (DO), `SKILLS_BUCKET` (R2),
`SKILLS_INDEX` (Vectorize), `LOADER` (WorkerLoader — code execution, required for the `execute` tool),
`BROWSER` (Browser Rendering — browser tools; remove if Browser Rendering isn't enabled on the account).

## Endpoints

HTTP/WS endpoints below; user actions (settings, MCP, reminders, push) go through `@callable` RPC over the chat WebSocket, not HTTP.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | public | Health check |
| GET | `/` | Access JWT | Web dashboard (React app, `run_worker_first`) |
| GET | `/setup/info` | Access JWT | Agent instance name + auth status |
| POST | `/setup/telegram-webhook` | Access JWT | Register Telegram webhook |
| GET | `/api/skills` | Access JWT | Approved + pending skills |
| POST | `/api/skills/pending/:name/approve` | Access JWT | Approve curator proposal |
| POST | `/api/skills/pending/:name/reject` | Access JWT | Reject curator proposal |
| WS | `/agents/holston-agent/:id` | Access JWT, `:id` bound to user | WebSocket chat + `@callable` RPC (Think) |
| POST | `/messengers/telegram/webhook` | Telegram secret token | Telegram webhook -> owner instance |
| Email | `email()` handler | Sender allowlist + HMAC replies | `routeAgentEmail` -> per-sender instance |

## Skills Format

Skills are `SKILL.md` files with YAML frontmatter:

```yaml
---
name: deploy-worker
description: Deploy a Cloudflare Worker from the workspace.
triggers: ["deploy", "cloudflare worker", "wrangler"]
version: 1
success_count: 0
fail_count: 0
---

# Instructions body (markdown)
```

## Safety Rules

- Money as integer cents. Never floating point.
- Never expose secrets in logs or tool outputs.
- Tool approval required for destructive operations (`needsApproval: async () => true`).
- `@cloudflare/think` is experimental. Pin versions in package.json.