# Holston Workspace -- Agent Conventions

## Project Overview

Holston Workspace is a cloud-native AI agent harness built on the Cloudflare Agents SDK (Think).
It extends `Think<Env>` to provide a Hermes-like experience with self-improving skills, multi-platform messaging, workspace tools, scheduling, and voice.

## Tech Stack

- **Harness**: `@cloudflare/think` (extends `Think<Env>`)
- **Runtime**: Cloudflare Workers + Durable Objects (SQLite-backed)
- **Model**: Workers AI (kimi-k2.7-code, zero API keys)
- **Messaging**: Telegram (native Think messenger) + Email (CF Email Routing)
- **UI**: `@cloudflare/kumo` (40+ components) + `streamdown` (markdown)
- **Skills**: `agents:skills` (bundled) + R2 (runtime) + Vectorize (search)
- **Auth**: Cloudflare Access (JWT at edge, zero code)

## Architecture

```
server.ts     -> HolstonAgent (Think) + Worker fetch/email handler
skills/       -> Self-improving skills system (the only custom code)
  store.ts    -> R2 CRUD + Vectorize embedding
  hooks.ts    -> beforeTurn (retriever), onChatResponse (nudger), afterToolCall (curator)
  tools.ts    -> skill_create, skill_patch, skill_load, skill_list, skill_search
components/   -> Kumo UI composition (chat, sessions, skills, settings, approval)
skills/       -> Bundled SKILL.md files (agents:skills bundling)
```

## Key Decisions

- **Think over AIChatAgent**: Think has skills, messengers, workspace tools, scheduled tasks, and lifecycle hooks built in. AIChatAgent is stable but would require handrolling all of those.
- **R2 + Vectorize for skills**: Skills are SKILL.md files in R2. Embeddings in Vectorize enable semantic retrieval. No external vector DB needed.
- **Self-improving loop**: `onChatResponse` counts tool calls. If >= 5, nudge the agent to create a skill. `beforeTurn` injects relevant skills via vector search.
- **Cloudflare Access**: Zero auth code. JWT verified at edge. User email from JWT is the agent ID for per-user isolation.

## Scripts

```bash
npm run dev      # Start Vite dev server
npm run build    # Build for production
npm run deploy   # Build + wrangler deploy
npm run typecheck # TypeScript check
npm run types    # Generate wrangler types
```

## Environment Variables

See `.env.example`. Set via `npx wrangler secret put <NAME>`:

- `TELEGRAM_BOT_TOKEN` - Telegram bot token from @BotFather
- `TELEGRAM_BOT_USERNAME` - Bot username (e.g. "holston_bot")
- `TELEGRAM_WEBHOOK_SECRET_TOKEN` - Secret token for webhook verification

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