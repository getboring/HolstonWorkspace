# Holston Workspace

Cloud-native AI agent harness on Cloudflare Agents SDK (Think).

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## Features

- **Agent loop** via Think (streaming, tools, MCP, workspace bash)
- **Self-improving skills** (auto-create from experience, semantic retrieval, in-flight patching)
- **Multi-platform messaging** (Telegram, Email, WebSocket chat)
- **Scheduled tasks** (declarative cron DSL)
- **Voice input** (Workers AI STT)
- **Kumo UI** (40+ components, auto dark mode)
- **Cloudflare Access** (zero-code auth at edge)

## Setup

### 1. Telegram Bot

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get the bot token
3. Set secrets:
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_BOT_USERNAME
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET_TOKEN
   ```
4. After deploy, set up the webhook:
   ```bash
   curl -X POST https://your-worker.your-subdomain.workers.dev/setup/telegram-webhook
   ```

### 2. Email Routing

1. Configure Cloudflare Email Routing to forward to your Worker
2. The `email()` handler in `server.ts` receives and processes emails

### 3. Cloudflare Access

1. Create an Access Application in the Cloudflare dashboard
2. Protect the Worker domain
3. The agent reads the `cf-access-jwt-assertion` header for user identity

### 4. Skills

Skills are auto-created when the agent solves complex tasks (5+ tool calls).
They are stored in R2 and embedded in Vectorize for semantic retrieval.

Seed skills are bundled in `skills/` directory:
- `deploy-worker` - Deploy a Cloudflare Worker
- `create-skill` - Create a new skill from experience
- `debug-agent` - Debug a Cloudflare Agent
- `home-automation` - Control Home Assistant devices via MCP

## Architecture

See [AGENTS.md](./AGENTS.md) for full architecture and conventions.