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
src/server.ts          HolstonAgent (Think) + Worker fetch/email handler
src/auth.ts            Cloudflare Access JWT verification
src/skills/store.ts    R2 + Vectorize skill CRUD with embeddings
src/skills/hooks.ts    beforeTurn (retriever) + onChatResponse (nudger + curator)
src/skills/tools.ts    skill_create, skill_patch, skill_load, skill_list, skill_search
src/app.tsx            React app (chat, skills, settings tabs, dark mode, voice)
src/components/        ChatView, SessionList, SkillsPanel, SettingsPanel, ToolApproval, ErrorBoundary, PoweredBy
skills/                Bundled SKILL.md files (agents:skills bundling)
```

## Key Decisions

- **Think over AIChatAgent**: Think has skills, messengers, workspace tools, scheduled tasks, and lifecycle hooks built in.
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

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | public | Health check |
| GET | `/` | Access JWT | Web dashboard (React app, `run_worker_first`) |
| GET | `/setup/info` | Access JWT | Agent instance name + auth status |
| POST | `/setup/telegram-webhook` | Access JWT | Register Telegram webhook |
| GET | `/api/skills` | Access JWT | Approved + pending skills |
| POST | `/api/skills/pending/:name/approve` | Access JWT | Approve curator proposal |
| POST | `/api/skills/pending/:name/reject` | Access JWT | Reject curator proposal |
| WS | `/agents/holston-agent/:id` | Access JWT, `:id` bound to user | WebSocket chat (Think) |
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