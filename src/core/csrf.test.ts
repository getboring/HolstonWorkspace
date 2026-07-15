import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./csrf";

function req(method: string, origin?: string): Request {
  return new Request("https://holston.example.com/api/x", {
    method,
    headers: origin ? { Origin: origin } : {},
  });
}

describe("assertSameOrigin", () => {
  it("passes safe methods regardless of origin", () => {
    expect(assertSameOrigin(req("GET"))).toBeNull();
    expect(assertSameOrigin(req("HEAD"))).toBeNull();
    expect(assertSameOrigin(req("OPTIONS"))).toBeNull();
  });

  it("passes a POST from the same origin", () => {
    expect(assertSameOrigin(req("POST", "https://holston.example.com"))).toBeNull();
  });

  it("rejects a POST with no Origin header (403)", () => {
    const res = assertSameOrigin(req("POST"));
    expect(res?.status).toBe(403);
  });

  it("rejects a POST from a different origin (403)", () => {
    const res = assertSameOrigin(req("POST", "https://evil.example.com"));
    expect(res?.status).toBe(403);
  });
});
