export function SkillsPanel() {
  return (
    <div style={{ padding: "1rem", height: "100%", overflowY: "auto" }}>
      <p style={{ fontWeight: 600, fontSize: "1rem", margin: 0 }}>Skills</p>
      <p style={{ fontSize: "0.85rem", color: "var(--kumo-muted, #888)", marginTop: "0.5rem", marginBottom: "1rem" }}>
        Skills are created automatically when Holston solves complex tasks (5+ tool calls).
        They are stored in R2 and embedded in Vectorize for semantic retrieval.
      </p>
      <div style={{
        textAlign: "center",
        padding: "2rem",
        color: "var(--kumo-muted, #888)",
        border: "1px dashed var(--kumo-line, #e0e0e0)",
        borderRadius: "0.5rem",
      }}>
        <p>Skills will appear here after the agent creates them.</p>
      </div>
    </div>
  );
}