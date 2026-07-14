---
name: deploy-worker
description: Deploy a Cloudflare Worker from the workspace using wrangler. Includes pre-flight checks for bindings, secrets, and wrangler.jsonc validity.
triggers: ["deploy", "cloudflare worker", "wrangler", "publish worker"]
version: 1
success_count: 0
fail_count: 0
created_at: 2026-07-13T22:00:00Z
updated_at: 2026-07-13T22:00:00Z
---

# Deploy Cloudflare Worker

## Steps

1. Run `npx wrangler types env.d.ts --include-runtime false` to ensure types are current.
2. Run `npx wrangler deploy --dry-run` to validate configuration without deploying.
3. Check for any missing bindings in the output (look for MISSING next to binding names).
4. If bindings are missing, add them to `wrangler.jsonc` before proceeding.
5. Run `npx wrangler deploy` to deploy to production.
6. Verify the deployment by checking the output URL in a browser or with `curl`.

## Common Issues

- If you see `MISSING` for a binding, the secret or binding is not configured. Run `npx wrangler secret put <NAME>`.
- If the deploy fails with a compatibility_date error, update it to today's date in wrangler.jsonc.
- If TypeScript errors block the build, run `npx tsc --noEmit` to see all errors first.