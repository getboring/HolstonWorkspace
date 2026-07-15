import { describe, expect, it } from "vitest";
import { agentNameFromEmail } from "./auth";

// agentNameFromEmail is THE per-user isolation boundary: two different emails
// must never map to the same agent instance name (that would leak one user's
// agent to another). These tests guard that invariant.
describe("agentNameFromEmail", () => {
  it("normalizes a plain email deterministically", () => {
    expect(agentNameFromEmail("Cody@Example.com")).toBe("cody-example-com");
  });

  it("is idempotent (same input -> same output)", () => {
    const a = agentNameFromEmail("user@holston.works");
    const b = agentNameFromEmail("user@holston.works");
    expect(a).toBe(b);
  });

  it("lowercases so case variants collapse to the same instance", () => {
    expect(agentNameFromEmail("USER@X.COM")).toBe(agentNameFromEmail("user@x.com"));
  });

  it("does NOT collide two genuinely different emails", () => {
    const seen = new Map<string, string>();
    const emails = [
      "alice@example.com",
      "bob@example.com",
      "alice@example.org",
      "alice.smith@example.com",
      "alice+tag@example.com",
      "a@b.co",
      "a.b@c.co",
      "ab@c.co",
    ];
    for (const email of emails) {
      const slug = agentNameFromEmail(email);
      // If this fires, two distinct emails share an instance — a real isolation leak.
      expect(seen.has(slug), `collision: ${email} and ${seen.get(slug)} both -> ${slug}`).toBe(false);
      seen.set(slug, email);
    }
  });

  it("produces only slug-safe characters", () => {
    const slug = agentNameFromEmail("weird!#$%name@do-main.co.uk");
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.startsWith("-")).toBe(false);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("caps length at 64 characters", () => {
    const long = "a".repeat(200) + "@example.com";
    expect(agentNameFromEmail(long).length).toBeLessThanOrEqual(64);
  });
});
