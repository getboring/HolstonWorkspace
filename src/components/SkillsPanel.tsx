import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import {
  CheckIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { HolstonAgentConnection } from "../app";

interface Skill {
  name: string;
  description: string;
  triggers: string[];
  version: number;
  successCount: number;
  failCount: number;
  updatedAt: string;
}

interface Draft {
  name: string;
  description: string;
  triggers: string;
  body: string;
}

const EMPTY_DRAFT: Draft = { name: "", description: "", triggers: "", body: "" };

export function SkillsPanel({ agent }: { agent: HolstonAgentConnection }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [pending, setPending] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  // The skill currently being authored: a name for edit, "" for a new draft,
  // or null when the editor is closed.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

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

  const openNew = () => { setDraft(EMPTY_DRAFT); setEditing(""); setError(null); };
  const openEdit = (s: Skill) => {
    // Body isn't in the list payload; the author edits metadata + a fresh body.
    setDraft({ name: s.name, description: s.description, triggers: s.triggers.join(", "), body: "" });
    setEditing(s.name);
    setError(null);
  };

  const saveDraft = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await agent.stub.saveSkill({
        name: draft.name.trim(),
        description: draft.description.trim(),
        triggers: draft.triggers.split(",").map((t) => t.trim()).filter(Boolean),
        body: draft.body,
      });
      if (!res.ok) {
        setError(res.error ?? "Save failed");
        return;
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    setActingOn(name);
    try {
      await agent.stub.deleteSkillByName(name);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setActingOn(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto holston-scroll">
      <div className="mx-auto w-full max-w-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Text variant="heading2" as="h2">Skills</Text>
            <Text variant="secondary" size="sm">
              Holston proposes skills after complex tasks; approve them to make them
              retrievable. You can also author or edit skills directly — only
              approved skills are embedded and surfaced to the agent.
            </Text>
          </div>
          <Button size="sm" variant="secondary" icon={PlusIcon} onClick={openNew}>New</Button>
        </div>

        {loading && <div className="flex items-center gap-2"><Loader size={16} /><Text variant="secondary" size="sm">Loading…</Text></div>}
        {error && <Text variant="error" size="sm">{error}</Text>}

        {editing !== null && (
          <Surface className="p-4 rounded-lg border border-kumo-hairline">
            <Text variant="heading3" as="h3">{editing ? `Edit "${editing}"` : "New skill"}</Text>
            <div className="mt-2 flex flex-col gap-2">
              <Input
                label="Name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="deploy-cloudflare-worker"
                disabled={!!editing}
              />
              <Input
                label="Description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="One sentence on what this skill does"
              />
              <Input
                label="Triggers (comma-separated)"
                value={draft.triggers}
                onChange={(e) => setDraft({ ...draft, triggers: e.target.value })}
                placeholder="deploy, wrangler, cloudflare"
              />
              <div>
                <Text size="sm">Instructions (markdown)</Text>
                <textarea
                  className="mt-1 w-full min-h-32 rounded-lg border border-kumo-line bg-kumo-base p-2 text-kumo-default text-sm holston-scroll"
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  placeholder="Step-by-step instructions…"
                  maxLength={8000}
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={saving} onClick={saveDraft}>Save skill</Button>
            </div>
          </Surface>
        )}

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

        {!loading && !error && skills.length === 0 && pending.length === 0 && editing === null && (
          <Empty icon={<SparkleIcon size={32} />} title="No skills yet" description="Send a complex request (5+ tool calls) and Holston will propose a skill — or click New to author one." />
        )}

        {!loading && skills.length > 0 && (
          <div className="flex flex-col gap-2">
            <Text variant="heading3" as="h3">Approved ({skills.length})</Text>
            {skills.map((skill) => (
              <Surface key={skill.name} className="p-4 rounded-lg border border-kumo-hairline">
                <div className="flex items-center gap-2">
                  <Text>{skill.name}</Text>
                  <Badge variant="secondary">v{skill.version}</Badge>
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" icon={PencilSimpleIcon} onClick={() => openEdit(skill)} aria-label={`Edit ${skill.name}`} />
                    <Button size="sm" variant="ghost" icon={TrashIcon} loading={actingOn === skill.name} onClick={() => remove(skill.name)} aria-label={`Delete ${skill.name}`} />
                  </div>
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
