# Holston Workspace -- Agent Conventions

## Project Overview

Holston Workspace is a cloud-native AI agent harness built on the Cloudflare Agents SDK (Think).
It extends `Think<Env>` to provide a Hermes-like experience with self-improving skills, multi-platform messaging, workspace tools, scheduling, voice input, and reasoning traces.

## Tech Stack

- **Harness**: `@cloudflare/think` (extends `Think<Env>`)
- **Runtime**: Cloudflare Workers + Durable Objects (SQLite-backed)
- **Model**: Workers AI (kimi-k2.7-code, zero API keys)
- **Messaging**: Telegram (native Think messenger) + Email (CF Email Routing) + WebSocket chat
- **UI**: CSS + `streamdown` (markdown) + `@cloudflare/voice/react` (voice input)
- **Skills**: `agents:skills` (bundled) + R2 (runtime) + Vectorize (search)
- **Auth**: Cloudflare Access (JWT at edge, zero code)
- **MCP**: Client connects on startup via `MCP_SERVER_URL`

## Architecture

```
src/server.ts          HolstonAgent (Think, HolstonState) + @callable RPC + Worker fetch/email
src/shared/state.ts    HolstonState contract (settings/reminders/mcpServers/pushSubscriptions), shared server+client
src/push.ts            Web Push (VAPID) send + dead-endpoint pruning
src/auth.ts            Cloudflare Access JWT verification
src/skills/store.ts    R2 + Vectorize skill CRUD (approved/) + curator staging (pending/)
src/skills/hooks.ts    beforeTurn (retriever) + onChatResponse (nudger + curator)
src/skills/tools.ts    skill_create, skill_patch, skill_load, skill_list, skill_search
src/app.tsx            React shell (Kumo Tabs + Toasty), typed agent stub useAgent<HolstonAgent, HolstonState>
src/lib/push.ts        Client push subscribe (service worker + VAPID key)
src/components/        ChatView, TasksPanel, McpPanel, SkillsPanel, SettingsPanel, ToolApproval, SessionList (Kumo)
public/sw.js           Push service worker
skills/                Bundled SKILL.md files (agents:skills bundling)
```

## Key Decisions

- **Think over AIChatAgent**: Think has skills, messengers, workspace tools, scheduled tasks, and lifecycle hooks built in.
- **Synced state, not env/local**: `HolstonAgent extends Think<Env, HolstonState>` with `initialState`. Settings (model, autoSkills, approvalMode, timezone, customInstructions), reminders, MCP server views, and push subscriptions all live in state and sync to clients. `validateStateChange` rejects any client-pushed state (`source !== "server"`) — the UI mutates only through `@callable` RPC. `getModel()`/`getSystemPrompt()`/`getDefaultTimezone()`/`beforeTurn()` read from `this.state.settings`, so settings actually drive each turn.
- **approvalMode is enforced** via `beforeToolCall`: "always" blocks destructive built-in tools (bash/write/edit/delete) with a reason; "never" ungates skill-write tools' `needsApproval`; "destructive-only" (default) keeps skill writes gated. beforeToolCall can only allow/block/substitute — it cannot raise the client modal, so the modal path is the tools' own `needsApproval`.
- **Timezone**: reminders parse against the user's `settings.timezone` (default America/New_York), not UTC. The model returns LOCAL wall-clock time; `localWallClockToUtc`/`shiftCronToUtc` convert to the real instant/cron (Agent.schedule runs cron in UTC). `getDefaultTimezone()` also drives Think wall-clock scheduled tasks.
- **fetchTools**: `fetchTools = { allowlist: [...] }` gives the model a read-only, GET-only, allowlisted `fetch_url` tool (CF docs, Wikipedia, raw.githubusercontent, api.github) — backs the "research" claim without an MCP server. Emits `tool:fetch` observability.
- **contextOverflow + stall watchdog**: `contextOverflow = { reactive: true }` compacts-and-retries on context overflow instead of hard-failing; `chatStreamStallTimeoutMs = 45_000` aborts a stalled stream into recovery.
- **Notify fan-out**: `notifyUser` (used by reminders) hits push + web broadcast + owner email (when the `send_email` binding + OWNER_EMAIL are set). `onEmail` now processes inbound mail as a blocking turn and `replyToEmail`s the model's answer (HMAC-signed when EMAIL_SIGNING_SECRET is set).
- **@callable RPC for everything user-driven**: MCP connect/disconnect/refresh, reminder create/list/cancel, settings patch, push subscribe/unsubscribe. Client uses the typed stub via `useAgent<HolstonAgent, HolstonState>` → `agent.stub.method()` (untyped overload leaves `stub.*` possibly-undefined).
- **Client-managed MCP**: `connectMcpServer` calls `this.addMcpServer(name, url)`; an `authenticating` result returns `authUrl` for the UI to open. `syncMcpState()` (on `onStart` + after each mutation) mirrors `getMcpServers()` into state so the panel shows live states + tool counts.
- **Reminders**: `createReminder` parses NL with `generateObject` + `scheduleSchema`/`getSchedulePrompt`, then `this.schedule(...)` with callback `runReminder`. `runReminder` fans out via `notifyUser` (push + broadcast) AND injects a `[Reminder]` turn via `submitMessages`. `syncReminders()` filters `listSchedules()` by callback name into state.
- **Push**: VAPID via `web-push`. `subscribePush`/`unsubscribePush` store `PushSubscription.toJSON()` in state; `sendPush` prunes 404/410 endpoints. `notifyUser` also `broadcast`s a `{type:"notification"}` message the client turns into a Kumo toast. Service worker at `public/sw.js`.
- **Kumo UI**: Cloudflare's design system. `styles.css` = `@source` (scan Kumo dist) + `@import "@cloudflare/kumo/styles/tailwind"` + `@import "tailwindcss"` (order matters). Gotchas: `Surface` has no `variant` (className only); `Text` has no `className` (use `truncate`/`bold` props or wrap in a div); `Input`/`Select`/`Switch` use `aria-label` for hidden labels, not `hideLabel`; `Empty`/`Banner` `icon` want a rendered element (`<Icon />`), `Button` `icon` takes the component; `mono`/`mono-secondary` Text variants fix their own size.
- **R2 + Vectorize for skills**: Skills are SKILL.md files in R2. Embeddings in Vectorize enable semantic retrieval. No external vector DB needed.
- **Self-improving loop**: `onChatResponse` counts tool UIParts on `result.message` (ChatResponseResult has no `toolCalls` field). If >= 5, nudge logs to the agent's SQLite (6h cooldown, survives hibernation). Curator uses `generateObject` to extract a skill and STAGES it to `skills-pending/` in R2 — human approves in the Skills panel before it is embedded in Vectorize. `beforeTurn` vector-searches approved skills and returns `TurnConfig.system` (not `systemPrompt`) built from `ctx.system`.
- **Cloudflare Access**: JWT verified in-Worker as defense-in-depth (`run_worker_first` makes the gate actually run before assets). Agent routes are guarded via `routeAgentRequest`'s `onBeforeConnect`/`onBeforeRequest`; the instance name in the URL must equal `agentNameFromEmail(user.email)`.
- **Voice input**: `useVoiceInput` from `@cloudflare/voice/react` provides STT dictation into the chat input; connects to the same per-user instance.
- **MCP client**: `onStart` registers `MCP_SERVER_URL` via idempotent `this.addMcpServer()` (registration persists in SQLite and reconnects on wake — never use raw `this.mcp.connect()` here). `waitForMcpConnections = true` so the first turn sees MCP tools.
- **Email**: `routeAgentEmail` with a sender-allowlist resolver (plus `createSecureReplyEmailResolver` when `EMAIL_SIGNING_SECRET` is set); `onEmail` parses MIME with postal-mime, skips auto-replies, and submits via `submitMessages` with the Message-ID as idempotency key.
- **Messenger webhooks**: `/messengers/*` POSTs are forwarded to the owner instance (`OWNER_EMAIL`) via `getAgentByName().fetch()` — Think matches the path inside its `onRequest`.

## Scripts

```bash
npm run start       # Start Vite dev server
npm run build       # Build for production
npm run deploy      # Build + wrangler deploy
npm run typecheck   # TypeScript check
npm run types       # Generate wrangler types
```

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