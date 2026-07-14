---
name: nexus-os-review-2026-07
description: Read-only code review findings for nexus-os (EdgeOS), 2026-07-14 — no-auth agent endpoints, dead chat wiring, missing experimental compat flag
metadata:
  type: project
---

Reviewed ~/CodyML/projects/nexus-os (EdgeOS, browser OS on CF, @cloudflare/think + agents + Kumo + MCP) 2026-07-14. Last real commit 2026-05-12 (bfeab82a).

**Key facts (verify before reuse — code moves fast):**
- Deps at review time: `agents` 0.11.6 (latest 0.17.4), `@cloudflare/think` 0.2.2 (latest 0.13.0 — Think is explicitly experimental/pre-1.0, expect breaking changes across minors), `ai` 6.0.159 (latest 7.0.27, major behind).
- `wrangler.jsonc` has `compatibility_flags: ["nodejs_compat"]` only — missing `"experimental"` flag that Think's own docs say is required. Worth re-checking whether this specific Think version still enforces it before flagging as broken in a future pass.
- `/agents/*` and `/parties/*` DO endpoints have NO authentication — anyone can drive any user's desktop DO by guessing/brute-forcing the ULID-based agent name in the URL. Only `/mcp` has bearer auth. This is the most severe finding (P0 security).
- Client (`src/hooks/use-nexus.ts`) does NOT use the Agents SDK React client (`useAgent`/`agents/react`). Instead hand-rolls raw `fetch()` POST to `/agents/{name}/call/{method}` plus a manual `WebSocket` with 3s reconnect loop. Works, but bypasses SDK hibernation/reconnect/state-sync guarantees and is exactly the anti-pattern the Agents SDK skill warns against (fetch instead of RPC stub, though this is client-side not server DO-to-DO).
- `src/hooks/use-chat.ts` (`useNexusChat`) is a **fully stubbed no-op** — messages always `[]`, `sendMessage` does nothing. The entire AIPanel/ChatApp UI (streaming, tool-call badges, approve/deny) renders against dead data. This is self-documented in the project's own `docs/CLOUDFLARE_NATIVE_PLAN.md` as P0 "Wire AI chat to DO agent."
- No write path (Zod → idempotency → authority → execute → receipt) anywhere — also self-documented as pending P0 in project CLAUDE.md/plan doc.
- Good things actually done right: `packages`-style `Result<T>` in `src/lib/result.ts` (matches Boring convention exactly), ULIDs via ulidx everywhere (no `crypto.randomUUID()` misuse), timing-safe MCP bearer comparison in `src/security.ts`, Zod path/glob schemas blocking `..` traversal and null bytes, CircuitBreaker with `toJSON`/`fromJSON` for DO hibernation survival, biome-clean/tab-indent throughout.
- Grade given: C+ (solid vertical slice, honest self-documented gaps, but ships with an open write-path DO and a UI wired to nothing — that combo is not production-safe as-is).

See [[cf-do-audit-2026-07-decisions]] for related DO fleet decisions across other BoringWorks projects that same week.
