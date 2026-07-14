import { tool } from "ai";
import { z } from "zod";
import type { Think } from "@cloudflare/think";
import type { SkillStore } from "./store";

const skillNameSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "Must be lowercase, alphanumeric, hyphens only");

const skillCreateSchema = z.object({
  name: skillNameSchema,
  description: z.string().min(10).max(200),
  triggers: z.array(z.string()).min(1).max(10),
  body: z.string().min(20).max(8000),
});

const skillPatchSchema = z.object({
  name: skillNameSchema,
  description: z.string().min(10).max(200).optional(),
  triggers: z.array(z.string()).min(1).max(10).optional(),
  body: z.string().min(20).max(8000).optional(),
});

const skillLoadSchema = z.object({
  name: skillNameSchema,
});

export function createSkillTools(
  store: SkillStore,
  _agent: Think<Env>,
  gated = true,
) {
  // Skill writes are gated (client approval modal) unless approvalMode is "never".
  const needsApproval = async () => gated;
  return {
    skill_create: tool({
      description:
        "Create a reusable skill from a successful task. Use after solving a complex problem (5+ tool calls). " +
        "The skill should capture the procedure so it can be reused next time.",
      inputSchema: skillCreateSchema,
      needsApproval,
      execute: async (input) => {
        const existing = await store.get(input.name);
        if (existing) {
          return {
            success: false,
            error: `Skill "${input.name}" already exists. Use skill_patch to update it.`,
          };
        }

        const record = await store.create(input);
        console.log(`[skills] Created skill: ${record.name}`);

        return {
          success: true,
          message: `Skill "${record.name}" created and stored. It will be suggested for similar tasks in the future.`,
        };
      },
    }),

    skill_patch: tool({
      description:
        "Update an existing skill. Use when a loaded skill is wrong or incomplete. " +
        "Only the fields you provide will be updated; the rest stay unchanged.",
      inputSchema: skillPatchSchema,
      needsApproval,
      execute: async (input) => {
        const updated = await store.patch(input.name, {
          description: input.description,
          triggers: input.triggers,
          body: input.body,
        });

        if (!updated) {
          return {
            success: false,
            error: `Skill "${input.name}" not found.`,
          };
        }

        console.log(
          `[skills] Patched skill: ${updated.name} (v${updated.version})`,
        );
        return {
          success: true,
          message: `Skill "${updated.name}" updated to version ${updated.version}.`,
        };
      },
    }),

    skill_load: tool({
      description:
        "Load the full instructions for a skill by name. Use after the system suggests a relevant skill.",
      inputSchema: skillLoadSchema,
      execute: async (input) => {
        const skill = await store.get(input.name);
        if (!skill) {
          return {
            success: false,
            error: `Skill "${input.name}" not found.`,
          };
        }

        return {
          success: true,
          name: skill.name,
          description: skill.description,
          triggers: skill.triggers,
          body: skill.body,
          version: skill.version,
          successRate:
            skill.successCount + skill.failCount > 0
              ? `${Math.round(
                  (skill.successCount / (skill.successCount + skill.failCount)) *
                    100,
                )}%`
              : "new",
        };
      },
    }),

    skill_list: tool({
      description: "List all available skills.",
      inputSchema: z.object({}),
      execute: async () => {
        const all = await store.list();
        return {
          success: true,
          count: all.length,
          skills: all.map((s) => ({
            name: s.name,
            description: s.description,
            version: s.version,
            successCount: s.successCount,
          })),
        };
      },
    }),

    skill_search: tool({
      description: "Search for skills by semantic similarity to a query.",
      inputSchema: z.object({
        query: z.string().min(3).max(200),
      }),
      execute: async (input) => {
        const results = await store.search(input.query, 5);
        return {
          success: true,
          results,
        };
      },
    }),
  };
}