import { beforeEach, describe, expect, it } from "vitest";
import {
  getCircuitState,
  resetCircuit,
  withCircuitBreaker,
  withTimeout,
} from "./circuit-breaker";

describe("withCircuitBreaker", () => {
  beforeEach(() => resetCircuit("t"));

  it("returns the real result while closed", async () => {
    const r = await withCircuitBreaker("t", async () => "ok", "fallback");
    expect(r).toBe("ok");
    expect(getCircuitState("t")).toBe("closed");
  });

  it("opens after the failure threshold and then short-circuits to fallback", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("down");
    };
    // threshold defaults to 3
    for (let i = 0; i < 6; i++) {
      const r = await withCircuitBreaker("t", failing, "fb");
      expect(r).toBe("fb");
    }
    expect(calls).toBe(3); // stopped calling after the circuit opened
    expect(getCircuitState("t")).toBe("open");
  });

  it("recovers to closed after a success in half-open", async () => {
    // Force open with a short reset window.
    const cfg = { failureThreshold: 1, resetTimeoutMs: 0 };
    await withCircuitBreaker("t", async () => { throw new Error("x"); }, "fb", cfg);
    expect(getCircuitState("t")).toBe("open");
    // resetTimeoutMs 0 -> immediately half-open, a success closes it.
    const r = await withCircuitBreaker("t", async () => "recovered", "fb", cfg);
    expect(r).toBe("recovered");
    expect(getCircuitState("t")).toBe("closed");
  });
});

describe("withTimeout", () => {
  it("returns the value when the promise resolves in time", async () => {
    expect(await withTimeout(Promise.resolve("v"), 50, "fb")).toBe("v");
  });

  it("returns the fallback when the promise is too slow", async () => {
    const slow = new Promise<string>((res) => setTimeout(() => res("late"), 100));
    expect(await withTimeout(slow, 10, "fb")).toBe("fb");
  });

  it("returns the fallback when the promise rejects", async () => {
    expect(await withTimeout(Promise.reject(new Error("x")), 50, "fb")).toBe("fb");
  });
});
