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
- **Self-improving loop**: `onChatResponse` counts tool calls. If >= 5, nudge logs to SQLite. Curator uses `generateObject` to extract a skill from the transcript and stores it in R2 + Vectorize. `beforeTurn` vector-searches skills and injects relevant ones into the system prompt.
- **Cloudflare Access**: Zero auth code. JWT verified at edge. User email from JWT is the agent ID for per-user isolation.
- **Voice input**: `useVoiceInput` from `@cloudflare/voice/react` provides STT dictation into the chat input.
- **MCP client**: `onStart` connects to `MCP_SERVER_URL` if configured. Tools auto-discovered via `this.mcp.getAITools()`.

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

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (agent status, config) |
| GET | `/` | Web dashboard (React app) |
| GET | `/setup/info` | Agent info + auth status |
| POST | `/setup/telegram-webhook` | Register Telegram webhook |
| GET | `/api/skills` | List all skills from R2 (CORS enabled) |
| WS | `/agents/HolstonAgent/:id` | WebSocket chat (Think) |
| POST | `/messengers/telegram/webhook` | Telegram webhook receiver |
| Email | `email()` handler | CF Email Routing -> agent |

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