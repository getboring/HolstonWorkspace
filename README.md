# Holston Workspace

> Cloud-native AI agent harness on Cloudflare Agents SDK (Think).

**Live:** https://holston-workspace.codyboring.workers.dev
**Repo:** https://github.com/getboring/HolstonWorkspace

## What It Does

- **Agent loop** via Think + Workers AI (model chosen live from Settings, zero API keys)
- **Code execution** (Cloudflare Codemode — the model runs generated code in an isolated Worker via a `LOADER` binding, with the workspace, tools, and browser available; every run is on a durable audit trail, and a working run can be promoted to a **reusable named snippet** the model re-runs by name — executable skills)
- **Browser automation** (Cloudflare Browser Rendering — navigate, screenshot, extract, scrape, via a `BROWSER` binding; an active session can be watched through a live **Live View** URL, and sessions can be recorded as replayable rrweb captures — all surfaced in the Lab tab)
- **Workspace tools** (bash, read, write, edit, grep, find, list, delete — Think's built-in virtual filesystem over the DO's SQLite)
- **Read-only web fetch** (allowlisted `fetch_url`: CF docs, Wikipedia, raw.githubusercontent, api.github)
- **Self-improving skills** (LLM curator proposes skills after complex turns → staged for your approval → vector retrieval; success/fail counters now update from real turn outcomes so ranking learns, and you can author/edit/delete skills directly in the UI)
- **Client-managed MCP** (add/remove/authenticate MCP servers from the UI, live tool counts and OAuth handoff — no more single hardcoded env var)
- **Holston as an MCP server** (publishes its own capabilities as tools at a bearer-gated `/mcp` — reminders, memory, history search, receipts, health — so Claude, a CLI, or another agent can drive the owner's Holston over MCP; the tools operate on the owner's real agent instance, not a stub)
- **Reminders & recurring tasks** (natural-language scheduling in your timezone: "every weekday at 9am"; fires across push, owner email, and the open chat; DST drift self-corrects on wake. Telegram is an interactive messenger channel, not part of reminder fan-out)
- **Web Push** (VAPID; reach the user with reminders and proactive messages even when the tab is closed)
- **Actions with receipts** (gated server actions — send_message, set_reminder, save_memory, remove_skill — following the Boring Stack write-path: validate → idempotency → authorize → execute → immutable receipt; the Receipts tab paginates the ledger and exports it as NDJSON)
- **Unified tool-approval policy** (one risk registry classifies every tool — read / write / destructive / external — so `beforeToolCall`, action gates, and the Settings UI all agree; a baseline mode _plus_ per-tool always/never overrides, so code execution, browser, and MCP tools are gated in "always" mode instead of silently bypassing it)
- **AI budget metering** (per-DO daily call ceiling in SQLite; the turn is blocked when the budget is spent, and the Settings panel shows a live usage meter)
- **System Health log** (scheduled-task, chat-recovery, background-work, and MCP failures land in a durable `agent_events` table instead of a console that vanishes; filterable/paginated Health tab, NDJSON export, and critical failures also notify you)
- **Persistent memory** (durable facts the model remembers across conversations via a writable context block — editable/correctable from the Memory card — plus non-destructive compaction and full-text history search in the sidebar)
- **Synced settings** (model, auto-skills, tool-approval mode + per-tool overrides, timezone, custom instructions — stored on the agent, drive every turn; every write surfaces failure instead of silently no-op'ing)
- **Multi-platform messaging** (Telegram, Email in + out with AI triage, WebSocket chat)
- **Scheduled tasks** (declarative cron DSL: daily digest, weekly skill review)
- **Voice input** (STT dictation via @cloudflare/voice)
- **Resilience** (circuit breaker on external calls, context-overflow compact-and-retry, stall watchdog, rate-limit classification, diagnostics subscriptions persisted to the health log)
- **Cloudflare Access** (JWT auth at edge, per-user agent isolation, state read-only from clients, CSRF guard on browser mutations)
- **Onboarding** (a fresh chat shows clickable starter prompts that each exercise a real capability, so a first-run user discovers what Holston can do)
- **Kumo UI** (Cloudflare's design system — accessible, themed, light/dark; Chat, Tasks, MCP, Skills, Lab, Receipts, Health, Settings tabs)
- **Tool approval** (Kumo dialog for gated operations; `approvalMode` enforced via `beforeToolCall`)
- **Reasoning traces + error boundary** (collapsible reasoning; graceful error handling)

## Quick Start

```bash
npm install --legacy-peer-deps
npm run start       # Local dev server
npm run build       # Production build
npm run deploy      # Build + wrangler deploy
npm run typecheck   # TypeScript check
```

## Architecture

```
src/server.ts          HolstonAgent (Think): synced state, @callable RPC, getTools (code-exec +
                       browser + skills), getActions, configureSession, classifyChatError,
                       beforeToolCall gate, onEmail (triage + reply), Worker fetch/email handler
src/actions.ts         Think action() tools (send_message, set_reminder, save_memory, remove_skill)
src/receipts.ts        Immutable append-only receipt ledger in DO SQLite (UNIQUE + read index, keyset pagination, NDJSON export)
src/events.ts          Persistent System Health log (agent_events SQLite: severity/source/kind, cursor pagination, bounded retention, export)
src/mcp.ts             Holston published AS an MCP server (McpServer + createMcpHandler at /mcp; tools drive the owner instance via a DO stub)
src/lib/bearer.ts      Pure bearer-token gate for the /mcp endpoint (unit-tested)
src/usage.ts           UsageMeter — per-DO daily AI-call budget in SQLite
src/observability.ts   diagnostics_channel subscriptions (schedule / chat / fiber / mcp) → event sink (persist + notify on critical)
src/shared/state.ts    HolstonState contract shared by server + client
src/core/tool-policy.ts  Unified tool risk registry + shouldApprove (single source of truth for gating)
src/core/circuit-breaker.ts  withCircuitBreaker / withTimeout for external calls
src/core/csrf.ts       assertSameOrigin (CSRF guard for browser mutations)
src/push.ts            Web Push (VAPID) send helper, dead-subscription pruning
src/auth.ts            Cloudflare Access JWT verification
src/skills/store.ts    R2 + Vectorize skill CRUD (approved/) + curator staging (pending/), circuit-broken search
src/skills/hooks.ts    beforeTurn (retriever) + onChatResponse (nudger + curator)
src/skills/tools.ts    skill_create, skill_patch, skill_load, skill_list, skill_search
src/app.tsx            React app shell (Kumo Tabs, Toasty, typed agent stub)
src/lib/push.ts        Client-side push subscribe (service worker + VAPID)
src/lib/download.ts    Client NDJSON download helper (receipts + health export)
src/lib/tools.ts       GATED_TOOLS list for the Settings per-tool override UI
src/components/        ChatView, TasksPanel, McpPanel, SkillsPanel, LabPanel (snippets/executions/
                       Live View), SettingsPanel, ReceiptsPanel, HealthPanel, MemoryCard,
                       ToolApproval, SessionList (all Kumo)
public/sw.js           Push service worker
skills/                Bundled SKILL.md files (agents:skills)
docs/plans/            Historical capability audit + build plans (stamped; see STATUS headers)
```

## @callable RPC (client ↔ agent over WebSocket)

The UI drives the agent through typed RPC (`agent.stub.*`), not env vars or local state:

| Method | Purpose |
|--------|---------|
| `updateSettings(patch)` | Model, auto-skills, approval mode + per-tool overrides, timezone, custom instructions (synced state) |
| `connectMcpServer(name, url)` / `disconnectMcpServer(id)` / `refreshMcpServers()` / `listMcpTools()` | Manage MCP servers (OAuth returns an `authUrl`) and list each server's tool names |
| `createReminder(text)` / `listReminders()` / `cancelReminder(id)` | Natural-language scheduling (in the user's timezone) |
| `getVapidPublicKey()` / `subscribePush(sub)` / `unsubscribePush(endpoint)` | Web Push subscription |
| `listReceipts(limit)` / `listReceiptsPage({limit,cursor})` / `exportReceipts()` | Immutable action-receipt ledger — capped list, keyset page, NDJSON export (Receipts tab) |
| `listEvents({limit,cursor,severities})` / `exportEvents()` | System Health event log — paginated, severity-filtered, NDJSON export (Health tab) |
| `listSnippets()` / `saveSnippet(name,execId,desc)` / `deleteSnippet(name)` | Codemode snippets — promote a working execution to a reusable named snippet (Lab tab); saves are receipted |
| `listExecutions(limit)` / `listPendingActions(execId)` / `rollbackExecution(execId)` | Codemode audit trail, what a paused run awaits, and rollback (approve/reject use Think's built-ins) |
| `browserLiveView()` / `browserRecording(sessionId)` | Live View URLs for an active browser session; downloadable rrweb recording of a finished one (Lab tab) |
| `saveSkill({name,description,triggers,body})` / `deleteSkillByName(name)` | Author/edit or delete an approved skill directly (Skills tab), reusing the store + embedding |
| `getUsage()` | Today's AI-call budget snapshot (Settings meter) |
| `searchHistory(query,limit)` | Full-text search over conversation history (sidebar) |
| `getMemory()` / `setMemory(content)` | Read / replace the durable `memory` context block (editable Memory card) |

Actions the model can call (compiled into tools via `getActions()`): `send_message`, `set_reminder`, `save_memory`, `remove_skill` — each gated by `approvalMode`, idempotency-keyed, and receipted. Code execution (`execute`) and browser tools (`browser_*`) are added when the `LOADER` / `BROWSER` bindings are present.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | public | Health check |
| POST/GET | `/mcp` | `MCP_ACCESS_KEY` bearer | Holston's own MCP server (Streamable HTTP); tools drive the owner's agent instance |
| GET | `/` | Access JWT | Web dashboard (React app, `run_worker_first`) |
| GET | `/setup/info` | Access JWT | Agent instance name + auth status |
| POST | `/setup/telegram-webhook` | Access JWT | Register Telegram webhook |
| GET | `/api/skills` | Access JWT | Approved + pending skills |
| POST | `/api/skills/pending/:name/approve` | Access JWT | Approve a curator proposal |
| POST | `/api/skills/pending/:name/reject` | Access JWT | Reject a curator proposal |
| WS | `/agents/holston-agent/:id` | Access JWT, `:id` bound to user | WebSocket chat (Think) |
| POST | `/messengers/telegram/webhook` | Telegram secret token | Telegram webhook (forwarded to owner instance) |
| Email | `email()` handler | Sender allowlist + HMAC replies | CF Email Routing → `routeAgentEmail` |

When Cloudflare Access is not configured (`TEAM_DOMAIN`/`POLICY_AUD` unset, e.g. local dev), auth is open and everything binds to the `default` instance. Each authenticated user gets their own agent instance derived from their email; Telegram and inbound email converge on the same instance via `OWNER_EMAIL` / `ALLOWED_EMAIL_SENDERS`.

## Setup

### Telegram Bot

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Set secrets:
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_BOT_USERNAME
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET_TOKEN
   ```
3. Register webhook:
   ```bash
   curl -X POST https://holston-workspace.codyboring.workers.dev/setup/telegram-webhook
   ```

### Cloudflare Access

1. Dashboard > Workers & Pages > holston-workspace > Settings > Domains & Routes
2. Enable Cloudflare Access
3. Set secrets:
   ```bash
   npx wrangler secret put TEAM_DOMAIN    # https://your-team.cloudflareaccess.com
   npx wrangler secret put POLICY_AUD     # Your AUD tag
   ```

### Email Routing

1. Dashboard > Email > Routing > Routes
2. Forward to Worker: `holston-workspace`

### MCP Server (client — connecting to others)

An optional startup default; users add more from the **MCP** tab in the UI.

```bash
npx wrangler secret put MCP_SERVER_URL   # https://your-mcp-server.com/mcp
```

### MCP Server (server — exposing Holston)

Holston also *publishes* an MCP server at `/mcp` (Streamable HTTP) so another
agent can drive it. The endpoint is closed unless a bearer key is set; the tools
operate on the owner's real agent instance (`OWNER_EMAIL`).

```bash
npx wrangler secret put MCP_ACCESS_KEY   # a long random bearer token
```

Connect from any MCP client with the URL `https://<worker>/mcp` and header
`Authorization: Bearer <MCP_ACCESS_KEY>`. Tools: `list_reminders`,
`create_reminder`, `cancel_reminder`, `get_memory`, `save_memory`,
`search_history`, `list_receipts`, `system_health`. Writes go through the same
idempotency/receipt path as the dashboard.

### Push Notifications

```bash
npx web-push generate-vapid-keys         # generate a key pair
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT    # mailto:you@example.com
```

Users enable push from the **Tasks** tab. Without VAPID keys, reminders still
fire in-app and via Telegram/email — only browser push is disabled.

### Outbound Email (optional)

Uncomment the `send_email` binding in `wrangler.jsonc` and set a verified sender
in Cloudflare Email Routing to let the agent send/reply to email. Inbound email is
AI-triaged (spam dropped, notifications not replied to) before a turn runs.

### Code Execution + Browser Automation

Both are wired via bindings in `wrangler.jsonc` (no secrets needed):

- **`worker_loaders` → `LOADER`** enables Codemode: the `execute` tool runs the
  model's generated code in an isolated Worker (with the workspace, tools, and
  browser available). Present by default.
- **`browser` → `BROWSER`** enables the `browser_*` tools (navigate/screenshot/
  extract/scrape). Requires **Browser Rendering** enabled on your Cloudflare
  account. If it's not enabled, remove the `browser` binding — code execution
  still works without it.

Both tools respect `approvalMode`; the system prompt only advertises a capability
when its binding is present.

**Codemode snippets** — the `execute` tool is wired via `createExecuteRuntime`, so
its durable runtime (execution audit trail + reusable snippets) is reachable from
callables. A successful run can be promoted to a named snippet in the Lab tab;
saves are receipted. **Live View + recording** — set the browser session to
recording in Settings to capture rrweb replays. Live View works from the binding
alone; *replaying* a recording hits the Cloudflare REST API, so it needs two
owner secrets:

```bash
npx wrangler secret put CF_ACCOUNT_ID   # 94bdc287cd4e0622b68f9e18e406ae66
npx wrangler secret put CF_API_TOKEN    # a token with Browser Rendering read access
```

### CI/CD

GitHub Actions deploys on push to `main`. Set these repo secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Skills

Skills are proposed automatically when the agent solves complex tasks (5+ tool calls).
The curator hook uses `generateObject` with Workers AI to extract a structured skill from the turn,
then **stages it as a pending draft** (`skills-pending/` in R2). Approve or reject proposals in the
Skills panel — only approved skills are embedded in Vectorize and surfaced to the agent.
In-chat `skill_create`/`skill_patch` tool calls require approval via the tool-approval modal.

Seed skills: `deploy-worker`, `create-skill`, `debug-agent`, `home-automation`

## License

MIT