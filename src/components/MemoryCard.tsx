import { Button } from "@cloudflare/kumo/components/button";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import {
  ArrowsClockwiseIcon,
  FloppyDiskIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { HolstonAgentConnection } from "../app";

/** Editable view of the durable `memory` context block Holston reads/writes. */
export function MemoryCard({ agent }: { agent: HolstonAgentConnection }) {
  const [memory, setMemory] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const content = await agent.stub.getMemory();
      setMemory(typeof content === "string" ? content : "");
    } catch (err) {
      // Distinguish a load failure from an empty memory (finding #7).
      setError(err instanceof Error ? err.message : "Could not load memory");
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => { load(); }, [load]);

  const startEdit = () => { setDraft(memory); setEditing(true); };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await agent.stub.setMemory(draft);
      setMemory(draft);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save memory");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Surface className="p-4 rounded-xl">
      <div className="flex items-center justify-between">
        <Text variant="heading3" as="h3">What Holston remembers</Text>
        <div className="flex gap-1">
          {!editing && (
            <Button size="sm" variant="ghost" icon={PencilSimpleIcon} onClick={startEdit}>Edit</Button>
          )}
          <Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} onClick={load} aria-label="Refresh memory" />
        </div>
      </div>
      <Text variant="secondary" size="sm">
        Durable facts about you, persisted across conversations. Holston writes here with the save_memory action — edit or correct them yourself.
      </Text>

      {error && <div className="mt-2"><Text variant="error" size="sm">{error}</Text></div>}

      {editing ? (
        <>
          <textarea
            className="mt-3 w-full min-h-32 rounded-lg border border-kumo-line bg-kumo-base p-2 text-kumo-default text-sm holston-scroll"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="One fact per line…"
            maxLength={8000}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" variant="primary" icon={FloppyDiskIcon} loading={saving} onClick={save}>Save</Button>
          </div>
        </>
      ) : (
        <div className="mt-3 rounded-lg border border-kumo-hairline bg-kumo-tint p-3 min-h-16">
          {loading ? (
            <Text variant="secondary" size="sm">Loading…</Text>
          ) : memory.trim() ? (
            <pre className="whitespace-pre-wrap text-sm text-kumo-default holston-scroll">{memory}</pre>
          ) : (
            <Text variant="secondary" size="sm">Nothing remembered yet. Tell Holston to remember something, or click Edit to add facts.</Text>
          )}
        </div>
      )}
    </Surface>
  );
}
