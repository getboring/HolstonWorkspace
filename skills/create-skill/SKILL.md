---
name: create-skill
description: Create a new self-improving skill from a complex task. Extract the procedure, triggers, and instructions into a reusable SKILL.md.
triggers: ["create skill", "save skill", "extract skill", "remember procedure"]
version: 1
success_count: 0
fail_count: 0
created_at: 2026-07-13T22:00:00Z
updated_at: 2026-07-13T22:00:00Z
---

# Create a Skill from Experience

## When to Create a Skill

- You used 5+ tool calls to solve a problem
- The task is likely to recur (deployment, debugging, data processing)
- The solution involved a non-obvious sequence of steps

## How to Create

1. Identify the core procedure from the session transcript.
2. Write a concise name (kebab-case, 2-64 chars).
3. Write a one-sentence description (10-200 chars).
4. List 1-10 trigger phrases that indicate when this skill applies.
5. Write the body as step-by-step instructions someone could follow.
6. Call the `skill_create` tool with these fields.
7. The system stores it in R2 and embeds it in Vectorize for future retrieval.

## Good Skill Names

- `deploy-worker` (not "how to deploy" or "DeploymentProcedure")
- `debug-d1-query` (not "debug d1" or "database-debugging-helper")
- `setup-telegram-webhook` (not "telegram setup" or "TelegramBotConfiguration")