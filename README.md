# Holston Workspace

> Cloud-native AI agent harness on Cloudflare Agents SDK (Think).

**Live:** https://holston-workspace.codyboring.workers.dev
**Repo:** https://github.com/getboring/HolstonWorkspace

## What It Does

- **Agent loop** via Think + Workers AI (kimi-k2.7-code, zero API keys)
- **Self-improving skills** (auto-create from experience via LLM curator, vector retrieval, in-flight patching)
- **Multi-platform messaging** (Telegram, Email, WebSocket chat)
- **Scheduled tasks** (declarative cron DSL: daily digest, weekly skill review)
- **Workspace tools** (bash, read, write, edit, grep, find, list, delete)
- **MCP client** (connects to MCP servers on startup, auto-discovers tools)
- **Voice input** (STT dictation via @cloudflare/voice)
- **Reasoning traces** (show/hide toggle on assistant messages)
- **Cloudflare Access** (JWT auth at edge, per-user agent isolation)
- **Dark mode** (toggle with localStorage persistence)
- **Tool approval** (modal for destructive operations)
- **Tool output display** (running, done, rejected states in chat)
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
src/server.ts          HolstonAgent (Think) + Worker fetch/email handler
src/auth.ts            Cloudflare Access JWT verification
src/skills/store.ts    R2 + Vectorize skill CRUD with embeddings
src/skills/hooks.ts    beforeTurn (retriever) + onChatResponse (nudger + curator)
src/skills/tools.ts    skill_create, skill_patch, skill_load, skill_list, skill_search
src/app.tsx            React app (chat, skills, settings, dark mode, voice)
src/components/        ChatView, SessionList, SkillsPanel, SettingsPanel, ToolApproval, ErrorBoundary
skills/                Bundled SKILL.md files (agents:skills)
```

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

```bash
npx wrangler secret put MCP_SERVER_URL   # https://your-mcp-server.com/sse
```

### CI/CD

GitHub Actions deploys on push to `main`. Set these repo secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Skills

Skills auto-create when the agent solves complex tasks (5+ tool calls).
The curator hook uses `generateObject` with Workers AI to extract a structured skill from the session transcript.
Stored in R2, embedded in Vectorize for semantic retrieval.

Seed skills: `deploy-worker`, `create-skill`, `debug-agent`, `home-automation`

## License

MIT