import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import type { UIMessage } from "ai";
import { useCallback, useRef, useState } from "react";
import type { HolstonAgentConnection } from "../app";

interface HistoryHit {
  id: string;
  role: string;
  content: string;
  createdAt?: string;
}

export function SessionList({
  agent,
  messages,
}: {
  agent: HolstonAgentConnection;
  messages: UIMessage[];
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<HistoryHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setHits(null);
        setError(null);
        return;
      }
      setSearching(true);
      setError(null);
      try {
        const results = await agent.stub.searchHistory(trimmed, 20);
        setHits(results as HistoryHit[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setHits([]);
      } finally {
        setSearching(false);
      }
    },
    [agent],
  );

  const onQueryChange = (v: string) => {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(v), 250);
  };

  const clearSearch = () => {
    setQuery("");
    setHits(null);
    setError(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-3 border-b border-kumo-hairline">
        <Text variant="heading3" as="h1">Holston</Text>
        <Button size="sm" variant="ghost" icon={PlusIcon} onClick={newConversation}>New</Button>
      </div>

      <div className="px-2 pt-2 flex items-center gap-1">
        <div className="flex-1">
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search this conversation…"
            aria-label="Search conversation history"
          />
        </div>
        {query && (
          <Button size="sm" variant="ghost" icon={XIcon} onClick={clearSearch} aria-label="Clear search" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto holston-scroll p-2">
        {hits === null ? (
          <Surface className="p-3 rounded-lg">
            <Text size="sm" truncate>{preview}</Text>
            <Text variant="secondary" size="sm">{messages.length} messages</Text>
          </Surface>
        ) : (
          <div className="flex flex-col gap-2">
            {searching && (
              <div className="flex items-center gap-2">
                <Loader size={14} />
                <Text variant="secondary" size="sm">Searching…</Text>
              </div>
            )}
            {error && <Text variant="error" size="sm">{error}</Text>}
            {!searching && !error && hits.length === 0 && (
              <Text variant="secondary" size="sm">No matches.</Text>
            )}
            {hits.map((h) => (
              <Surface key={h.id} className="p-2 rounded-lg border border-kumo-hairline">
                <Text variant="secondary" size="xs">{h.role}</Text>
                <Text size="sm">{h.content.slice(0, 140)}</Text>
              </Surface>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-kumo-hairline">
        <Text variant="secondary" size="xs">State persists in Durable Object SQLite.</Text>
      </div>
    </div>
  );
}
