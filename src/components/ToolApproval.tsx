import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Text } from "@cloudflare/kumo/components/text";
import { getToolName } from "ai";
import { useState } from "react";

interface ToolApprovalProps {
  part: unknown;
  onApprove: () => void;
  onReject: () => void;
}

export function ToolApproval({ part, onApprove, onReject }: ToolApprovalProps) {
  const [open, setOpen] = useState(true);
  const p = part as { input?: unknown };
  const toolName = getToolName(part as never);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog size="base" className="p-6">
        <Dialog.Title>Approve tool call</Dialog.Title>
        <Dialog.Description>Holston wants to run this tool.</Dialog.Description>
        <div className="mt-3 rounded-lg border border-kumo-hairline bg-kumo-tint p-3">
          <Text variant="mono">{toolName}</Text>
          <pre className="mt-2 max-h-64 overflow-auto text-xs text-kumo-subtle holston-scroll">
            {JSON.stringify(p.input, null, 2).slice(0, 800)}
          </pre>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="secondary-destructive"
            onClick={() => { onReject(); setOpen(false); }}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            onClick={() => { onApprove(); setOpen(false); }}
          >
            Approve
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
