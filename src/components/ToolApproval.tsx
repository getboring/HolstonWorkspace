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
    <div className="holston-approval">
      <div className="holston-approval-card">
        <h3 className="holston-approval-title">Tool Approval Required</h3>
        <p className="holston-approval-text">
          The agent wants to call:
        </p>
        <div className="holston-approval-tool">
          <p className="holston-approval-toolname">{toolName}</p>
          <pre className="holston-approval-input">
            {JSON.stringify(input, null, 2).slice(0, 500)}
          </pre>
        </div>
        <div className="holston-approval-actions">
          <button
            className="holston-btn holston-btn-reject"
            onClick={() => {
              onReject("User rejected the tool call");
              setOpen(false);
            }}
          >
            Reject
          </button>
          <button
            className="holston-btn holston-btn-approve"
            onClick={() => {
              onApprove();
              setOpen(false);
            }}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}