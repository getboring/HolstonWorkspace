import { describe, expect, it } from "vitest";
import { bearerOk } from "./bearer";

const KEY = "s3cret-key-123";

describe("bearerOk (MCP /mcp gate)", () => {
  it("is closed when no key is configured", () => {
    expect(bearerOk("Bearer whatever", undefined)).toBe(false);
    expect(bearerOk(null, undefined)).toBe(false);
  });

  it("accepts the exact key with the Bearer prefix", () => {
    expect(bearerOk(`Bearer ${KEY}`, KEY)).toBe(true);
  });

  it("accepts the key without the Bearer prefix", () => {
    expect(bearerOk(KEY, KEY)).toBe(true);
  });

  it("rejects a wrong key of the same length", () => {
    expect(bearerOk("Bearer s3cret-key-124", KEY)).toBe(false);
  });

  it("rejects a wrong-length token (prefix of the real key)", () => {
    expect(bearerOk("Bearer s3cret", KEY)).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    expect(bearerOk(null, KEY)).toBe(false);
  });

  it("rejects an empty bearer token", () => {
    expect(bearerOk("Bearer ", KEY)).toBe(false);
  });
});
