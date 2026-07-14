import { Button } from "@cloudflare/kumo/components/button";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import { PlusIcon } from "@phosphor-icons/react";
import type { UIMessage } from "ai";

export function SessionList({ messages }: { messages: UIMessage[] }) {
  const preview =
    messages.length > 0
      ? (messages[0]?.parts?.find((p) => p.type === "text") as { text?: string } | undefined)?.text?.slice(0, 60) ?? "New conversation"
      : "New conversation";

  const newConversation = () => {
    if (messages.length > 0 && typeof window !== "undefined") {
      if (window.confirm("Start a new conversation? The current chat stays in the agent's history but clears from view.")) {
        window.location.reload();
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-3 border-b border-kumo-hairline">
        <Text variant="heading3" as="h1">Holston</Text>
        <Button size="sm" variant="ghost" icon={PlusIcon} onClick={newConversation}>New</Button>
      </div>

      <div className="flex-1 overflow-y-auto holston-scroll p-2">
        <Surface className="p-3 rounded-lg">
          <Text size="sm" truncate>{preview}</Text>
          <Text variant="secondary" size="sm">{messages.length} messages</Text>
        </Surface>
      </div>

      <div className="px-3 py-2 border-t border-kumo-hairline">
        <Text variant="secondary" size="xs">State persists in Durable Object SQLite.</Text>
      </div>
    </div>
  );
}
