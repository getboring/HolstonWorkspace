import { useState } from "react";

export function SettingsPanel() {
  const [autoSkills, setAutoSkills] = useState(true);

  return (
    <div style={{
      padding: "1rem",
      maxWidth: "600px",
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      gap: "1rem",
    }}>
      <p style={{ fontWeight: 600, fontSize: "1rem", margin: 0 }}>Settings</p>

      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={autoSkills}
          onChange={(e) => setAutoSkills(e.target.checked)}
        />
        <span>Auto skill creation (suggest after 5+ tool calls)</span>
      </label>

      <label style={{ display: "block" }}>
        <span style={{ fontSize: "0.85rem", display: "block", marginBottom: "0.25rem" }}>
          Model (Workers AI)
        </span>
        <select
          defaultValue="@cf/moonshotai/kimi-k2.7-code"
          style={{
            padding: "0.5rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--kumo-line, #e0e0e0)",
            background: "var(--kumo-base, #fff)",
            width: "100%",
          }}
        >
          <option value="@cf/moonshotai/kimi-k2.7-code">Kimi K2.7 Code (default)</option>
          <option value="@cf/meta/llama-3.3-70b-instruct">Llama 3.3 70B</option>
          <option value="@cf/qwen/qwq-32b">Qwen QWQ 32B</option>
        </select>
      </label>
    </div>
  );
}