import { describe, expect, it } from "vitest";
import { riskFor, shouldApprove } from "./tool-policy";

describe("riskFor", () => {
  it("classifies built-in workspace tools", () => {
    expect(riskFor("read")).toBe("read");
    expect(riskFor("grep")).toBe("read");
    expect(riskFor("write")).toBe("write");
    expect(riskFor("delete")).toBe("destructive");
    expect(riskFor("bash")).toBe("destructive");
  });

  it("classifies code execution as destructive (runs arbitrary code)", () => {
    expect(riskFor("execute")).toBe("destructive");
  });

  it("classifies browser + MCP + unknown external tools as external", () => {
    expect(riskFor("browser_screenshot")).toBe("external");
    expect(riskFor("browser_navigate")).toBe("external");
    expect(riskFor("cdp_click")).toBe("external");
    expect(riskFor("tool_github_create_pr")).toBe("external");
    expect(riskFor("mcp_weather")).toBe("external");
  });

  it("defaults an unknown tool to write (never silently read-only)", () => {
    expect(riskFor("some_unknown_tool")).toBe("write");
  });
});

describe("shouldApprove", () => {
  it("never gates read tools regardless of mode", () => {
    expect(shouldApprove("read", "always")).toBe(false);
    expect(shouldApprove("grep", "always")).toBe(false);
  });

  it("always mode gates every write/destructive/external tool", () => {
    expect(shouldApprove("write", "always")).toBe(true);
    expect(shouldApprove("bash", "always")).toBe(true);
    // The previously-ungated dangerous tools MUST now be gated in always mode:
    expect(shouldApprove("execute", "always")).toBe(true);
    expect(shouldApprove("browser_navigate", "always")).toBe(true);
    expect(shouldApprove("tool_github_delete_repo", "always")).toBe(true);
  });

  it("destructive-only gates destructive + external, allows plain writes", () => {
    expect(shouldApprove("write", "destructive-only")).toBe(false);
    expect(shouldApprove("edit", "destructive-only")).toBe(false);
    expect(shouldApprove("delete", "destructive-only")).toBe(true);
    expect(shouldApprove("execute", "destructive-only")).toBe(true);
    expect(shouldApprove("browser_navigate", "destructive-only")).toBe(true);
  });

  it("never mode gates nothing", () => {
    expect(shouldApprove("delete", "never")).toBe(false);
    expect(shouldApprove("execute", "never")).toBe(false);
  });

  it("per-tool overrides win over the mode", () => {
    // Pin a normally-ungated tool to always-approve:
    expect(shouldApprove("read", "never", { read: "always" })).toBe(true);
    // Pin a normally-gated tool to never-approve:
    expect(shouldApprove("delete", "always", { delete: "never" })).toBe(false);
  });
});
