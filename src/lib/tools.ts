/**
 * The tools a user can pin an approval override on, grouped for the Settings UI.
 * These mirror the risk registry in src/core/tool-policy.ts (the server enforces;
 * this is just the presentable list).
 */
export const GATED_TOOLS: { name: string; label: string; risk: string }[] = [
  { name: "bash", label: "Run shell (bash)", risk: "destructive" },
  { name: "write", label: "Write file", risk: "write" },
  { name: "edit", label: "Edit file", risk: "write" },
  { name: "delete", label: "Delete file", risk: "destructive" },
  { name: "execute", label: "Run code (Codemode)", risk: "destructive" },
  { name: "send_message", label: "Send a message", risk: "external" },
  { name: "set_reminder", label: "Set a reminder", risk: "write" },
  { name: "save_memory", label: "Save a memory", risk: "write" },
  { name: "remove_skill", label: "Delete a skill", risk: "destructive" },
];
