export function SessionList() {
  return (
    <div style={{ padding: "1rem" }}>
      <p style={{ fontWeight: 600, fontSize: "1rem", margin: 0 }}>Holston Workspace</p>
      <p style={{ fontSize: "0.85rem", color: "var(--kumo-muted, #888)", marginTop: "0.5rem" }}>
        Sessions load from the agent durable SQLite state.
      </p>
    </div>
  );
}