import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import { CheckIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

interface Skill {
  name: string;
  description: string;
  triggers: string[];
  version: number;
  successCount: number;
  failCount: number;
  updatedAt: string;
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [pending, setPending] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/skills");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { skills: Skill[]; pending?: Skill[] };
      setSkills(data.skills ?? []);
      setPending(data.pending ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resolve = useCallback(
    async (name: string, action: "approve" | "reject") => {
      setActingOn(name);
      try {
        const res = await fetch(`/api/skills/pending/${encodeURIComponent(name)}/${action}`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to ${action}`);
      } finally {
        setActingOn(null);
      }
    },
    [load],
  );

  return (
    <div className="h-full overflow-y-auto holston-scroll">
      <div className="mx-auto w-full max-w-2xl p-6 flex flex-col gap-5">
        <div>
          <Text variant="heading2" as="h2">Skills</Text>
          <Text variant="secondary" size="sm">
            Holston proposes reusable skills after complex tasks. Approve them to make
            them retrievable; only approved skills are embedded and surfaced to the agent.
          </Text>
        </div>

        {loading && <div className="flex items-center gap-2"><Loader size={16} /><Text variant="secondary" size="sm">Loading…</Text></div>}
        {error && <Text variant="error" size="sm">{error}</Text>}

        {!loading && pending.length > 0 && (
          <div className="flex flex-col gap-2">
            <Text variant="heading3" as="h3">Pending approval ({pending.length})</Text>
            {pending.map((skill) => (
              <Surface key={`pending-${skill.name}`} className="p-4 rounded-lg">
                <div className="flex items-center gap-2">
                  <Text>{skill.name}</Text>
                  <Badge variant="beta">proposed</Badge>
                </div>
                <div className="mt-1"><Text variant="secondary" size="sm">{skill.description}</Text></div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {skill.triggers.map((t, i) => <Badge key={i} variant="outline">{t}</Badge>)}
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <Button size="sm" variant="secondary-destructive" icon={XIcon} loading={actingOn === skill.name} onClick={() => resolve(skill.name, "reject")}>Reject</Button>
                  <Button size="sm" variant="primary" icon={CheckIcon} loading={actingOn === skill.name} onClick={() => resolve(skill.name, "approve")}>Approve</Button>
                </div>
              </Surface>
            ))}
          </div>
        )}

        {!loading && !error && skills.length === 0 && pending.length === 0 && (
          <Empty icon={<SparkleIcon size={32} />} title="No skills yet" description="Send a complex request (5+ tool calls) and Holston will propose a reusable skill." />
        )}

        {!loading && skills.length > 0 && (
          <div className="flex flex-col gap-2">
            <Text variant="heading3" as="h3">Approved ({skills.length})</Text>
            {skills.map((skill) => (
              <Surface key={skill.name} className="p-4 rounded-lg border border-kumo-hairline">
                <div className="flex items-center gap-2">
                  <Text>{skill.name}</Text>
                  <Badge variant="secondary">v{skill.version}</Badge>
                </div>
                <div className="mt-1"><Text variant="secondary" size="sm">{skill.description}</Text></div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {skill.triggers.map((t, i) => <Badge key={i} variant="outline">{t}</Badge>)}
                </div>
                <div className="flex gap-3 mt-2">
                  <Text variant="success" size="sm">✓ {skill.successCount}</Text>
                  <Text variant="error" size="sm">✗ {skill.failCount}</Text>
                </div>
              </Surface>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
