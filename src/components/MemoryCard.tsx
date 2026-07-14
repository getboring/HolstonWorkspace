import { Button } from "@cloudflare/kumo/components/button";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { HolstonAgentConnection } from "../app";

/** Read-only view of the durable `memory` context block Holston writes. */
export function MemoryCard({ agent }: { agent: HolstonAgentConnection }) {
  const [memory, setMemory] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const content = await agent.stub.getMemory();
      setMemory(typeof content === "string" ? content : "");
    } catch {
      setMemory("");
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => { load(); }, [load]);

  return (
    <Surface className="p-4 rounded-xl">
      <div className="flex items-center justify-between">
        <Text variant="heading3" as="h3">What Holston remembers</Text>
        <Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} onClick={load}>Refresh</Button>
      </div>
      <Text variant="secondary" size="sm">
        Durable facts about you. Holston writes here with the save_memory action; it persists across conversations.
      </Text>
      <div className="mt-3 rounded-lg border border-kumo-hairline bg-kumo-tint p-3 min-h-16">
        {loading ? (
          <Text variant="secondary" size="sm">Loading…</Text>
        ) : memory.trim() ? (
          <pre className="whitespace-pre-wrap text-sm text-kumo-default holston-scroll">{memory}</pre>
        ) : (
          <Text variant="secondary" size="sm">Nothing remembered yet. Tell Holston to remember something.</Text>
        )}
      </div>
    </Surface>
  );
}
