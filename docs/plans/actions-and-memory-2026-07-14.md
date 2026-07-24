# Plan: Think Actions (receipts write-path) + Session Memory (2026-07-14)

> **STATUS: HISTORICAL (as of v0.7.0).** Delivered. Live surface is README / AGENTS.md.
> Leftovers explicitly **dropped**:
> - `promote_skill` action — approve/reject already exists via HTTP/`@callable` Skills panel; not duplicated as an action.
> - `soul` context block — identity lives in system prompt + `customInstructions`; no separate session block.
> Memory UI shipped as **editable** (plan said read-only).

Executes the two deferred audit items against `@cloudflare/think` 0.13.0.
Researched against the live 2026 docs (actions.md, sessions.md) and the
installed type surface. Delivered as one reviewed PR → merge → deploy.

## Part A — Actions with the Boring Stack write-path

**Boring Stack contract:** `Zod validate → idempotency key → authority gate → execute → receipt`.
Think Actions natively provide the first four; the **receipt is the durable,
immutable audit row we write ourselves** into the DO's SQLite via `this.sql`.

Mapping:
| Boring Stack step | Think Actions mechanism |
|---|---|
| Zod validate | `action({ inputSchema })` |
| idempotency key | `idempotencyKey: ({input}) => ...` (durable ledger replays settled result) |
| authority gate | `permissions` + `authorizeAction`/`authorizeTurn` |
| execute | `execute(input, ctx)` |
| **receipt** | **we write an immutable row in `action_receipts` (DO SQLite) inside execute** |

### Actions to ship (real, useful, gated)
1. `send_message` — send a proactive message to the user across channels
   (push + email + broadcast via existing `notifyUser`). idempotencyKey =
   caller-supplied `ref`. approvalRisk "low". permission `notify:send`.
2. `set_reminder` — the model can schedule reminders itself (reuses the NL
   parser path, or takes structured input). permission `reminder:write`.
3. `save_memory` — persist a durable fact about the user (writes a context
   block; see Part B). permission `memory:write`.
4. `remove_skill` / `promote_skill` — gated skill lifecycle. approvalRisk
   "medium", approval-gated. permission `skill:write`.

Every action's `execute` writes an `action_receipts` row:
`{ id, action, idempotency_key, input_json, output_json, actor, created_at }`
— immutable (insert-only), queryable via a `@callable listReceipts()` +
a **Receipts** tab in the UI.

### Authorization model
- `authorizeTurn(ctx)`: grant permissions by turn trigger/source. Web + owner
  email → full grant. Unknown/unauthenticated → read-only (no write perms).
- Ties into the existing `approvalMode` setting: "always" forces `approval:true`
  on every action; "destructive-only" gates medium/high risk; "never" ungates.

## Part B — Session memory (persistent context + compaction + search)

Think owns `this.session`; override `configureSession(session)` and return the
builder chain. Persistent, per-user memory the model reads AND writes.

### Context blocks
- `soul` (read-only): the system prompt identity + custom instructions.
- `memory` (writable, ~2000 tokens): durable facts about the user. The model
  gets a `set_context` tool; `save_memory` action also writes here.
- `skills` (R2SkillProvider on SKILLS_BUCKET, prefix `skills/`): on-demand skill
  docs — replaces the ad-hoc `getSkills()` r2 source with the native provider so
  the model can `load_context`/`unload_context`. (Keep bundled skills too.)
- `history` (searchable via SessionManager `withSearchableHistory` OR an
  AgentSearchProvider block): FTS5 search over the conversation, exposed as
  `search_context` to the model — "what did we decide about X last week".

### Compaction
- `createCompactFunction({ summarize })` using Workers AI (kimi) for the
  summary; `protectHead: 3`, `tailTokenBudget: 20000`, `minTailMessages: 2`,
  `tokenCounter: estimateMessageTokens`.
- `.compactAfter(100_000)` — auto-compact at 100K tokens so long chats compress
  instead of hitting the reactive contextOverflow backstop.
- `.onCompactionError(log)`.

### Gotchas to respect (from docs)
- Snapshot freezing is sticky — writing a context block does NOT refresh the
  cached system prompt; call `refreshSystemPrompt()` if we mutate mid-turn.
- All session methods are async.
- Skill state survives hibernation by scanning history — init cost scales with
  length (mitigated by compaction).
- FTS5 operators (OR/NOT/NEAR) are literal terms, not operators.

## UI
- **Receipts** tab: table of `action_receipts` (action, actor, time, in/out).
- **Memory** surface: show the `memory` context block content (read-only view;
  the model + save_memory write it). Optionally a manual "forget" control.

## Verify
tsc + build clean; browser-drive: ask the model to remember a fact → confirm it
lands in the Memory view; trigger a gated action → confirm approval + a receipt
row; search history. Then merge + deploy live + verify in prod.

## Sequence (most impactful first)
1. Receipts store + `action_receipts` table + `listReceipts` @callable
2. `getActions()` with 4 actions + authorizeTurn + approvalMode tie-in
3. `configureSession` context blocks + compaction + search
4. Receipts tab + Memory view (Kumo)
5. Docs (README/AGENTS.md), typecheck, build, browser test, PR, deploy
