import { beforeEach, describe, expect, it } from "vitest";
import { SkillStore } from "./store";

/**
 * Minimal in-memory R2 + Vectorize + AI fakes — just enough to exercise
 * recordOutcome (get → put), which is the count-only feedback writer. The skill
 * is stored as SKILL.md frontmatter, so we round-trip through the real
 * parse/serialize path.
 */
function fakeDeps() {
  const objects = new Map<string, string>();
  const r2 = {
    async get(key: string) {
      const v = objects.get(key);
      return v == null ? null : { text: async () => v };
    },
    async put(key: string, value: string) {
      objects.set(key, value);
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async list() {
      return { objects: [], truncated: false, cursor: undefined };
    },
  };
  const vectorize = {
    async upsert() {},
    async deleteByIds() {},
    async query() {
      return { matches: [] };
    },
  };
  const ai = {
    async run() {
      return { shape: [1, 3], data: [[0, 0, 0]] };
    },
  };
  return {
    objects,
    store: new SkillStore(r2 as never, vectorize as never, ai as never),
  };
}

describe("SkillStore.recordOutcome", () => {
  let deps: ReturnType<typeof fakeDeps>;
  beforeEach(() => {
    deps = fakeDeps();
  });

  async function seed() {
    // create() also embeds (fake AI/vectorize no-op), leaving a SKILL.md in R2.
    await deps.store.create({
      name: "deploy-worker",
      description: "Deploy a Cloudflare Worker from the workspace.",
      triggers: ["deploy"],
      body: "Run wrangler deploy.",
    });
  }

  it("increments successCount on a good outcome", async () => {
    await seed();
    await deps.store.recordOutcome("deploy-worker", true);
    await deps.store.recordOutcome("deploy-worker", true);
    const s = await deps.store.get("deploy-worker");
    expect(s?.successCount).toBe(2);
    expect(s?.failCount).toBe(0);
  });

  it("increments failCount on a bad outcome", async () => {
    await seed();
    await deps.store.recordOutcome("deploy-worker", false);
    const s = await deps.store.get("deploy-worker");
    expect(s?.successCount).toBe(0);
    expect(s?.failCount).toBe(1);
  });

  it("does not bump the version (content unchanged)", async () => {
    await seed();
    const before = await deps.store.get("deploy-worker");
    await deps.store.recordOutcome("deploy-worker", true);
    const after = await deps.store.get("deploy-worker");
    expect(after?.version).toBe(before?.version);
  });

  it("is a no-op for a missing skill", async () => {
    await expect(deps.store.recordOutcome("ghost", true)).resolves.toBeUndefined();
  });
});
