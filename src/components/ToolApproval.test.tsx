import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToolApproval } from "./ToolApproval";

/** A minimal tool UI part shaped like what the chat passes in. */
const part = {
  type: "tool-bash",
  toolCallId: "call_1",
  state: "approval-requested",
  input: { command: "ls -la" },
};

describe("ToolApproval", () => {
  it("shows the tool name and its input", () => {
    render(<ToolApproval part={part} onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText("Approve tool call")).toBeInTheDocument();
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText(/ls -la/)).toBeInTheDocument();
  });

  it("calls onApprove when Approve is clicked", async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<ToolApproval part={part} onApprove={onApprove} onReject={onReject} />);
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("calls onReject when Reject is clicked", async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<ToolApproval part={part} onApprove={onApprove} onReject={onReject} />);
    await userEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledOnce();
    expect(onApprove).not.toHaveBeenCalled();
  });
});
