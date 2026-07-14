import { withCircuitBreaker } from "../core/circuit-breaker";

export interface SkillRecord {
  name: string;
  description: string;
  triggers: string[];
  body: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  successCount: number;
  failCount: number;
}

export interface SkillDraft {
  name: string;
  description: string;
  triggers: string[];
  body: string;
}

export interface SkillSearchResult {
  name: string;
  description: string;
  score: number;
}

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

// Approved skills are visible to the agent (getSkills r2 source reads this
// prefix) and indexed in Vectorize. Pending skills are curator proposals
// awaiting human approval — never embedded, never surfaced to the model.
const APPROVED_PREFIX = "skills/";
const PENDING_PREFIX = "skills-pending/";

export class SkillStore {
  constructor(
    private r2: R2Bucket,
    private vectorize: VectorizeIndex,
    private ai: Ai,
  ) {}

  async create(skill: SkillDraft): Promise<SkillRecord> {
    const now = new Date().toISOString();
    const record: SkillRecord = {
      ...skill,
      createdAt: now,
      updatedAt: now,
      version: 1,
      successCount: 0,
      failCount: 0,
    };

    await this.writeSkill(record);
    await this.embedSkill(record);
    return record;
  }

  async patch(
    name: string,
    updates: Partial<Pick<SkillRecord, "description" | "triggers" | "body">>,
  ): Promise<SkillRecord | null> {
    const existing = await this.get(name);
    if (!existing) return null;

    const updated: SkillRecord = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    await this.writeSkill(updated);
    await this.embedSkill(updated);
    return updated;
  }

  async get(name: string): Promise<SkillRecord | null> {
    return this.read(`${APPROVED_PREFIX}${name}/SKILL.md`);
  }

  async list(): Promise<SkillRecord[]> {
    return this.listPrefix(APPROVED_PREFIX);
  }

  async delete(name: string): Promise<void> {
    await this.r2.delete(`${APPROVED_PREFIX}${name}/SKILL.md`);
    await this.vectorize.deleteByIds([this.skillId(name)]);
  }

  /**
   * Stage a curator-proposed skill for human approval. Overwrites any prior
   * pending draft with the same name; never touches the approved skill.
   */
  async stagePending(skill: SkillDraft): Promise<SkillRecord> {
    const now = new Date().toISOString();
    const record: SkillRecord = {
      ...skill,
      createdAt: now,
      updatedAt: now,
      version: 1,
      successCount: 0,
      failCount: 0,
    };
    await this.r2.put(
      `${PENDING_PREFIX}${record.name}/SKILL.md`,
      toSkillMd(record),
    );
    return record;
  }

  async getPending(name: string): Promise<SkillRecord | null> {
    return this.read(`${PENDING_PREFIX}${name}/SKILL.md`);
  }

  async listPending(): Promise<SkillRecord[]> {
    return this.listPrefix(PENDING_PREFIX);
  }

  /**
   * Promote a pending draft: creates the approved skill (or bumps the existing
   * one), embeds it for retrieval, then removes the draft.
   */
  async approvePending(name: string): Promise<SkillRecord | null> {
    const pending = await this.getPending(name);
    if (!pending) return null;

    const existing = await this.get(name);
    const approved = existing
      ? await this.patch(name, {
          description: pending.description,
          triggers: pending.triggers,
          body: pending.body,
        })
      : await this.create({
          name: pending.name,
          description: pending.description,
          triggers: pending.triggers,
          body: pending.body,
        });

    await this.r2.delete(`${PENDING_PREFIX}${name}/SKILL.md`);
    return approved;
  }

  async rejectPending(name: string): Promise<void> {
    await this.r2.delete(`${PENDING_PREFIX}${name}/SKILL.md`);
  }

  async search(query: string, limit = 3): Promise<SkillSearchResult[]> {
    // Circuit-break the Workers-AI embedding + Vectorize query: after repeated
    // failures, skip straight to the empty fallback instead of eating the full
    // latency on every skill retrieval during a brownout.
    return withCircuitBreaker(
      "skill-search",
      () => this.searchUncached(query, limit),
      [],
    );
  }

  private async searchUncached(
    query: string,
    limit: number,
  ): Promise<SkillSearchResult[]> {
    const embedding = await this.getEmbedding(query);

    const results = await this.vectorize.query(embedding, {
      topK: limit,
      returnMetadata: true,
    });

    return results.matches
      .filter((m) => m.metadata)
      .map((m) => ({
        name: (m.metadata!.name as string) ?? "unknown",
        description: (m.metadata!.description as string) ?? "",
        score: m.score,
      }));
  }

  private async read(key: string): Promise<SkillRecord | null> {
    const obj = await this.r2.get(key);
    if (!obj) return null;
    const text = await obj.text();
    return parseSkillMd(text);
  }

  private async listPrefix(prefix: string): Promise<SkillRecord[]> {
    const skills: SkillRecord[] = [];
    let cursor: string | undefined;
    do {
      const listed = await this.r2.list({ prefix, cursor });
      for (const item of listed.objects) {
        if (!item.key.endsWith("SKILL.md")) continue;
        const parsed = await this.read(item.key);
        if (parsed) skills.push(parsed);
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    return skills;
  }

  private async writeSkill(skill: SkillRecord): Promise<void> {
    const content = toSkillMd(skill);
    await this.r2.put(`${APPROVED_PREFIX}${skill.name}/SKILL.md`, content);
  }

  private async embedSkill(skill: SkillRecord): Promise<void> {
    const text = `${skill.name}: ${skill.description}\nTriggers: ${skill.triggers.join(", ")}`;
    try {
      const embedding = await this.getEmbedding(text);
      await this.vectorize.upsert([
        {
          id: this.skillId(skill.name),
          values: embedding,
          metadata: {
            name: skill.name,
            description: skill.description,
            version: skill.version,
          },
        },
      ]);
    } catch (err) {
      console.error(`[skills] Failed to embed skill ${skill.name}:`, err);
    }
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const response = (await this.ai.run(EMBEDDING_MODEL, {
      text: [text],
    })) as { shape: number[]; data: number[][] };
    if (!response.data || !response.data[0]) {
      throw new Error("Embedding response empty");
    }
    return response.data[0];
  }

  private skillId(name: string): string {
    return `skill-${name}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  }
}

function toSkillMd(skill: SkillRecord): string {
  return [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `triggers: ${JSON.stringify(skill.triggers)}`,
    `version: ${skill.version}`,
    `success_count: ${skill.successCount}`,
    `fail_count: ${skill.failCount}`,
    `created_at: ${skill.createdAt}`,
    `updated_at: ${skill.updatedAt}`,
    "---",
    "",
    skill.body,
  ].join("\n");
}

function parseSkillMd(text: string): SkillRecord | null {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1] ?? "";
  const body = (fmMatch[2] ?? "").trim();

  const get = (key: string): string => {
    const match = frontmatter.match(
      new RegExp(`^${key}:\\s*(.*)$`, "m"),
    );
    return match?.[1]?.trim() ?? "";
  };

  const triggersRaw = get("triggers");
  let triggers: string[] = [];
  try {
    triggers = JSON.parse(triggersRaw);
  } catch {
    triggers = triggersRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return {
    name: get("name"),
    description: get("description"),
    triggers,
    body,
    version: parseInt(get("version") || "1", 10),
    successCount: parseInt(get("success_count") || "0", 10),
    failCount: parseInt(get("fail_count") || "0", 10),
    createdAt: get("created_at") || new Date().toISOString(),
    updatedAt: get("updated_at") || new Date().toISOString(),
  };
}
