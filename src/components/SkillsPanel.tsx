import { useCallback, useEffect, useState } from "react";

interface Skill {
  name: string;
  description: string;
  triggers: string[];
  version: number;
  successCount: number;
  failCount: number;
  createdAt: string;
  updatedAt: string;
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [pending, setPending] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    try {
      const response = await fetch("/api/skills");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { skills: Skill[]; pending?: Skill[] };
      setSkills(data.skills ?? []);
      setPending(data.pending ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const resolvePending = useCallback(
    async (name: string, action: "approve" | "reject") => {
      setActingOn(name);
      try {
        const response = await fetch(
          `/api/skills/pending/${encodeURIComponent(name)}/${action}`,
          { method: "POST" },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await loadSkills();
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to ${action} skill`);
      } finally {
        setActingOn(null);
      }
    },
    [loadSkills],
  );

  return (
    <div className="holston-panel">
      <h2 className="holston-panel-title">Skills</h2>
      <p className="holston-panel-description">
        Skills are proposed automatically when Holston solves complex tasks (5+ tool calls).
        Proposals wait below for your approval before the agent can use them.
      </p>

      {loading && <p className="holston-loading">Loading skills...</p>}
      {error && <p className="holston-error">Error: {error}</p>}

      {!loading && pending.length > 0 && (
        <div className="holston-skill-list">
          <h3 className="holston-panel-title">Pending approval ({pending.length})</h3>
          {pending.map((skill) => (
            <div key={`pending-${skill.name}`} className="holston-skill-card">
              <div className="holston-skill-header">
                <h3 className="holston-skill-name">{skill.name}</h3>
                <span className="holston-skill-version">proposed</span>
              </div>
              <p className="holston-skill-description">{skill.description}</p>
              <div className="holston-skill-triggers">
                {skill.triggers.map((trigger, i) => (
                  <span key={i} className="holston-skill-trigger">{trigger}</span>
                ))}
              </div>
              <div className="holston-skill-stats">
                <button
                  className="holston-tab"
                  disabled={actingOn === skill.name}
                  onClick={() => resolvePending(skill.name, "approve")}
                >
                  Approve
                </button>
                <button
                  className="holston-tab"
                  disabled={actingOn === skill.name}
                  onClick={() => resolvePending(skill.name, "reject")}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && skills.length === 0 && pending.length === 0 && (
        <div className="holston-empty-state">
          <p>No skills yet. Skills will appear here after the agent proposes them.</p>
          <p className="holston-hint">
            Send a complex request that requires 5+ tool calls and the agent will propose
            a reusable skill from the experience for your approval.
          </p>
        </div>
      )}

      {!loading && !error && skills.length > 0 && (
        <div className="holston-skill-list">
          <h3 className="holston-panel-title">Approved ({skills.length})</h3>
          {skills.map((skill) => (
            <div key={skill.name} className="holston-skill-card">
              <div className="holston-skill-header">
                <h3 className="holston-skill-name">{skill.name}</h3>
                <span className="holston-skill-version">v{skill.version}</span>
              </div>
              <p className="holston-skill-description">{skill.description}</p>
              <div className="holston-skill-triggers">
                {skill.triggers.map((trigger, i) => (
                  <span key={i} className="holston-skill-trigger">{trigger}</span>
                ))}
              </div>
              <div className="holston-skill-stats">
                <span>Success: {skill.successCount}</span>
                <span>Fail: {skill.failCount}</span>
                <span>Updated: {new Date(skill.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
