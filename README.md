# Holston Workspace

> Cloud-native AI agent harness on Cloudflare Agents SDK (Think).

**Live:** https://holston-workspace.codyboring.workers.dev
**Repo:** https://github.com/getboring/HolstonWorkspace

## What It Does

- **Agent loop** via Think + Workers AI (model chosen live from Settings, zero API keys)
- **Self-improving skills** (LLM curator proposes skills after complex turns → staged for your approval → vector retrieval)
- **Client-managed MCP** (add/remove/authenticate MCP servers from the UI, live tool counts and OAuth handoff — no more single hardcoded env var)
- **Reminders & recurring tasks** (natural-language scheduling: "every weekday at 9am"; fires across push, Telegram, email, and the chat)
- **Web Push** (VAPID; reach the user with reminders and proactive messages even when the tab is closed)
- **Actions with receipts** (gated server actions — send_message, set_reminder, save_memory, remove_skill — following the write-path: validate → idempotency → authorize → execute → immutable receipt; every one auditable in the Receipts tab)
- **Persistent memory** (durable facts the model remembers across conversations via a writable context block, plus non-destructive compaction and FTS5 history search)
- **Synced settings** (model, auto-skills, tool-approval mode, timezone, custom instructions — stored on the agent, drive every turn)
- **Multi-platform messaging** (Telegram, Email in + out, WebSocket chat)
- **Scheduled tasks** (declarative cron DSL: daily digest, weekly skill review)
- **Workspace tools** (bash, read, write, edit, grep, find, list, delete)
- **Voice input** (STT dictation via @cloudflare/voice)
- **Reasoning traces** (collapsible on assistant messages)
- **Cloudflare Access** (JWT auth at edge, per-user agent isolation, state read-only from clients)
- **Kumo UI** (Cloudflare's design system — accessible, themed, light/dark)
- **Tool approval** (Kumo dialog for gated operations)
- **Error boundary** (graceful error handling)

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
src/server.ts          HolstonAgent (Think) with synced state + @callable RPC + Worker fetch/email
src/shared/state.ts    HolstonState contract shared by server + client (settings, reminders, MCP, push)
src/push.ts            Web Push (VAPID) send helper, dead-subscription pruning
src/auth.ts            Cloudflare Access JWT verification
src/skills/store.ts    R2 + Vectorize skill CRUD (approved/) + curator staging (pending/)
src/skills/hooks.ts    beforeTurn (retriever) + onChatResponse (nudger + curator)
src/skills/tools.ts    skill_create, skill_patch, skill_load, skill_list, skill_search
src/app.tsx            React app shell (Kumo Tabs, Toasty, typed agent stub)
src/lib/push.ts        Client-side push subscribe (service worker + VAPID)
src/components/        ChatView, TasksPanel, McpPanel, SkillsPanel, SettingsPanel, ToolApproval, SessionList (all Kumo)
public/sw.js           Push service worker
skills/                Bundled SKILL.md files (agents:skills)
```

## @callable RPC (client ↔ agent over WebSocket)

The UI drives the agent through typed RPC (`agent.stub.*`), not env vars or local state:

| Method | Purpose |
|--------|---------|
| `updateSettings(patch)` | Model, auto-skills, approval mode, custom instructions (synced state) |
| `connectMcpServer(name, url)` / `disconnectMcpServer(id)` / `refreshMcpServers()` | Manage MCP servers; OAuth returns an `authUrl` |
| `createReminder(text)` / `listReminders()` / `cancelReminder(id)` | Natural-language scheduling |
| `getVapidPublicKey()` / `subscribePush(sub)` / `unsubscribePush(endpoint)` | Web Push subscription |
| `listReceipts(limit)` | Immutable action-receipt ledger (Receipts tab) |
| `getMemory()` | The durable `memory` context block (Memory card) |

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | public | Health check |
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

### MCP Server

An optional startup default; users add more from the **MCP** tab in the UI.

```bash
npx wrangler secret put MCP_SERVER_URL   # https://your-mcp-server.com/mcp
```

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
in Cloudflare Email Routing to let the agent send/reply to email.

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