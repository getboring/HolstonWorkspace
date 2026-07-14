import { useAgentChat } from "@cloudflare/think/react";
import { useState } from "react";
import type { UIMessage } from "ai";
import { ChatView } from "./components/ChatView";
import { SessionList } from "./components/SessionList";
import { SkillsPanel } from "./components/SkillsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ToolApproval } from "./components/ToolApproval";
import { PoweredBy } from "./components/PoweredBy";

const AGENT_NAME = "default";

export function App() {
  const [activeTab, setActiveTab] = useState<"chat" | "skills" | "settings">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [localInput, setLocalInput] = useState("");

  const { messages, status, stop, sendMessage, addToolResult } = useAgentChat({
    agent: AGENT_NAME,
    name: "HolstonAgent",
    maxSteps: 50,
  } as never);

  const isLoading = status === "streaming" || status === "submitted";

  const pendingTool = messages.find((m: UIMessage) =>
    m.parts?.some(
      (p: { type: string; state?: string }) =>
        p.type === "tool-invocation" &&
        p.state === "input-available",
    ),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localInput.trim() || isLoading) return;
    sendMessage({ text: localInput });
    setLocalInput("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalInput(e.target.value);
  };

  return (
    <div className="holston-app">
      {sidebarOpen && (
        <div className="holston-sidebar">
          <SessionList />
        </div>
      )}

      <div className="holston-main">
        <div className="holston-tab-bar">
          <TabButton active={activeTab === "chat"} onClick={() => setActiveTab("chat")}>
            Chat
          </TabButton>
          <TabButton active={activeTab === "skills"} onClick={() => setActiveTab("skills")}>
            Skills
          </TabButton>
          <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>
            Settings
          </TabButton>
          <button
            className="holston-tab"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ marginLeft: "auto" }}
          >
            Sidebar
          </button>
        </div>

        {activeTab === "chat" && (
          <ChatView
            messages={messages}
            input={localInput}
            handleSubmit={handleSubmit}
            handleInputChange={handleInputChange}
            status={status}
            stop={stop}
          />
        )}

        {activeTab === "skills" && <SkillsPanel />}
        {activeTab === "settings" && <SettingsPanel />}

        {pendingTool && (
          <ToolApproval
            toolName="pending"
            input={{}}
            onApprove={() => addToolResult({ toolCallId: "", output: { approved: true } } as never)}
            onReject={() => addToolResult({ toolCallId: "", output: { approved: false } } as never)}
          />
        )}

        <PoweredBy />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`holston-tab ${active ? "holston-tab-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}