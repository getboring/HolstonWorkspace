import { useState } from "react";

export function SettingsPanel() {
  const [autoSkills, setAutoSkills] = useState(true);
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [model, setModel] = useState("@cf/moonshotai/kimi-k2.7-code");

  return (
    <div className="holston-panel">
      <h2 className="holston-panel-title">Settings</h2>

      <div className="holston-setting">
        <label className="holston-setting-label">
          Auto skill creation
        </label>
        <p className="holston-setting-description">
          Automatically suggest saving skills after 5+ tool calls
        </p>
        <label className="holston-switch">
          <input
            type="checkbox"
            checked={autoSkills}
            onChange={(e) => setAutoSkills(e.target.checked)}
          />
          <span className="holston-switch-slider" />
        </label>
      </div>

      <div className="holston-setting">
        <label className="holston-setting-label">
          Tool approval required
        </label>
        <p className="holston-setting-description">
          Require user approval before destructive tool calls
        </p>
        <label className="holston-switch">
          <input
            type="checkbox"
            checked={approvalRequired}
            onChange={(e) => setApprovalRequired(e.target.checked)}
          />
          <span className="holston-switch-slider" />
        </label>
      </div>

      <div className="holston-setting">
        <label className="holston-setting-label">
          Model (Workers AI)
        </label>
        <p className="holston-setting-description">
          LLM model used for inference. Workers AI requires no API keys.
        </p>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="holston-select"
        >
          <option value="@cf/moonshotai/kimi-k2.7-code">Kimi K2.7 Code (default)</option>
          <option value="@cf/meta/llama-3.3-70b-instruct">Llama 3.3 70B</option>
          <option value="@cf/qwen/qwq-32b">Qwen QWQ 32B</option>
          <option value="@cf/deepseek-ai/deepseek-r1-distill-qwen-32b">DeepSeek R1 Distill 32B</option>
        </select>
      </div>

      <div className="holston-setting">
        <label className="holston-setting-label">
          About Holston
        </label>
        <p className="holston-setting-description">
          Holston Workspace v0.2.0
          <br />
          Built on Cloudflare Agents SDK (Think)
          <br />
          Workers AI for inference, R2 for skills, Vectorize for search
        </p>
      </div>
    </div>
  );
}