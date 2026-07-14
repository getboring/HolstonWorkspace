import { useEffect, useState } from "react";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSkills() {
      try {
        const response = await fetch("/api/skills");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { skills: Skill[] };
        setSkills(data.skills ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load skills");
      } finally {
        setLoading(false);
      }
    }
    loadSkills();
  }, []);

  return (
    <div className="holston-panel">
      <h2 className="holston-panel-title">Skills</h2>
      <p className="holston-panel-description">
        Skills are created automatically when Holston solves complex tasks (5+ tool calls).
        They are stored in R2 and embedded in Vectorize for semantic retrieval.
      </p>

      {loading && <p className="holston-loading">Loading skills...</p>}
      {error && <p className="holston-error">Error: {error}</p>}

      {!loading && !error && skills.length === 0 && (
        <div className="holston-empty-state">
          <p>No skills yet. Skills will appear here after the agent creates them.</p>
          <p className="holston-hint">
            Send a complex request that requires 5+ tool calls and the agent will automatically
            create a reusable skill from the experience.
          </p>
        </div>
      )}

      {!loading && !error && skills.length > 0 && (
        <div className="holston-skill-list">
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