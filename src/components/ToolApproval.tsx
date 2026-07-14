import { useState } from "react";

interface ToolApprovalProps {
  toolName: string;
  input: unknown;
  onApprove: () => void;
  onReject: (reason?: string) => void;
}

export function ToolApproval({ toolName, input, onApprove, onReject }: ToolApprovalProps) {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: "1rem",
      right: "1rem",
      maxWidth: "400px",
      background: "var(--kumo-elevated, #f9f9f9)",
      border: "1px solid var(--kumo-line, #e0e0e0)",
      borderRadius: "0.75rem",
      padding: "1rem",
      boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
      zIndex: 1000,
    }}>
      <p style={{ fontWeight: 600, margin: "0 0 0.5rem 0" }}>
        Tool Approval Required
      </p>
      <p style={{ fontSize: "0.85rem", margin: "0 0 0.5rem 0" }}>
        The agent wants to call:
      </p>
      <div style={{
        margin: "0.5rem 0",
        padding: "0.75rem",
        border: "1px solid var(--kumo-line, #e0e0e0)",
        borderRadius: "0.5rem",
        background: "var(--kumo-recessed, #f0f0f0)",
      }}>
        <p style={{ fontWeight: 500, fontSize: "0.85rem", margin: 0 }}>
          {toolName}
        </p>
        <pre style={{
          marginTop: "0.5rem",
          fontSize: "0.8rem",
          overflowX: "auto",
          margin: 0,
          whiteSpace: "pre-wrap",
        }}>
          {JSON.stringify(input, null, 2).slice(0, 500)}
        </pre>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <button
          onClick={() => {
            onReject("User rejected the tool call");
            setOpen(false);
          }}
          style={{
            padding: "0.5rem 1rem",
            border: "1px solid var(--kumo-danger, #dc2626)",
            borderRadius: "0.375rem",
            background: "transparent",
            color: "var(--kumo-danger, #dc2626)",
            cursor: "pointer",
          }}
        >
          Reject
        </button>
        <button
          onClick={() => {
            onApprove();
            setOpen(false);
          }}
          style={{
            padding: "0.5rem 1rem",
            border: "none",
            borderRadius: "0.375rem",
            background: "var(--kumo-brand, #f6821f)",
            color: "white",
            cursor: "pointer",
          }}
        >
          Approve
        </button>
      </div>
    </div>
  );
}