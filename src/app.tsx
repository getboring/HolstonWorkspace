import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { useState, useEffect, type ReactNode } from "react";
import { ChatView } from "./components/ChatView";
import { SessionList } from "./components/SessionList";
import { SkillsPanel } from "./components/SkillsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ToolApproval } from "./components/ToolApproval";
import { PoweredBy } from "./components/PoweredBy";

export function App() {
  const [activeTab, setActiveTab] = useState<"chat" | "skills" | "settings">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dark, setDark] = useState(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("theme") : null;
    return saved === "dark" || (!saved && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  });

  useEffect(() => {
    const mode = dark ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    try { localStorage.setItem("theme", mode); } catch {}
  }, [dark]);

  const agent = useAgent({
    agent: "HolstonAgent",
    name: "default",
    onOpen: () => console.log("[holston] WebSocket connected"),
    onClose: () => console.log("[holston] WebSocket disconnected"),
    onError: (error: Event) => console.error("[holston] WebSocket error:", error),
  } as never);

  const {
    messages,
    status,
    stop,
    sendMessage,
    addToolApprovalResponse,
  } = useAgentChat({
    agent,
  } as never);

  const isLoading = status === "streaming" || status === "submitted";

  const pendingApproval = messages.find((m: UIMessage) =>
    m.parts?.some((p) => {
      if (!isToolUIPart(p)) return false;
      return "approval" in p && (p as { state?: string }).state === "approval-requested";
    }),
  );

  const pendingPart = pendingApproval?.parts?.find((p) => {
    if (!isToolUIPart(p)) return false;
    return "approval" in p && (p as { state?: string }).state === "approval-requested";
  });

  const pendingApprovalId = pendingPart && "approval" in pendingPart
    ? (pendingPart as { approval?: { id?: string } }).approval?.id
    : undefined;
  const pendingToolName = pendingPart ? getToolName(pendingPart as never) : undefined;
  const pendingToolInput = pendingPart && "input" in pendingPart
    ? (pendingPart as { input?: unknown }).input
    : undefined;

  return (
    <div className="holston-app" data-mode={dark ? "dark" : "light"}>
      {sidebarOpen && (
        <div className="holston-sidebar">
          <SessionList messages={messages as UIMessage[]} onClear={() => {}} />
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
            {sidebarOpen ? "Hide" : "Show"} Sidebar
          </button>
          <button
            className="holston-tab"
            onClick={() => setDark(!dark)}
            title="Toggle theme"
          >
            {dark ? "Light" : "Dark"}
          </button>
        </div>

        {activeTab === "chat" && (
          <ChatView
            messages={messages as UIMessage[]}
            stop={stop}
            sendMessage={sendMessage as never}
            isLoading={isLoading}
          />
        )}

        {activeTab === "skills" && <SkillsPanel />}
        {activeTab === "settings" && <SettingsPanel />}

        {pendingApproval && pendingApprovalId && (
          <ToolApproval
            toolName={pendingToolName ?? "unknown"}
            input={pendingToolInput}
            onApprove={() => addToolApprovalResponse({ id: pendingApprovalId, approved: true } as never)}
            onReject={() => addToolApprovalResponse({ id: pendingApprovalId, approved: false } as never)}
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
  children: ReactNode;
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