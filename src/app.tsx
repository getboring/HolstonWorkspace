import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useVoiceInput } from "@cloudflare/voice/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useState, useEffect, type ReactNode } from "react";
import { ChatView } from "./components/ChatView";
import { SessionList } from "./components/SessionList";
import { SkillsPanel } from "./components/SkillsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ToolApproval } from "./components/ToolApproval";
import { PoweredBy } from "./components/PoweredBy";

export function App() {
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

  // The server derives the instance name from the Access JWT, so each user
  // lands on their own agent. Falls back to "default" for local dev.
  const [agentName, setAgentName] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/setup/info")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ agentName: string }>;
      })
      .then((info) => {
        if (!cancelled) setAgentName(info.agentName || "default");
      })
      .catch((err) => {
        if (!cancelled) setInfoError(err instanceof Error ? err.message : "Failed to load agent info");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (infoError) {
    return (
      <div className="holston-app" data-mode={dark ? "dark" : "light"}>
        <div className="holston-main">
          <p className="holston-error">Could not connect to your agent ({infoError}). Are you signed in?</p>
        </div>
      </div>
    );
  }

  if (!agentName) {
    return (
      <div className="holston-app" data-mode={dark ? "dark" : "light"}>
        <div className="holston-main">
          <p className="holston-loading">Connecting to your agent...</p>
        </div>
      </div>
    );
  }

  return <Workspace agentName={agentName} dark={dark} setDark={setDark} />;
}

function Workspace({
  agentName,
  dark,
  setDark,
}: {
  agentName: string;
  dark: boolean;
  setDark: (dark: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<"chat" | "skills" | "settings">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const agent = useAgent({
    agent: "HolstonAgent",
    name: agentName,
    onOpen: () => console.log("[holston] WebSocket connected"),
    onClose: () => console.log("[holston] WebSocket disconnected"),
    onError: (error: Event) => console.error("[holston] WebSocket error:", error),
  });

  const {
    messages,
    status,
    stop,
    sendMessage,
    addToolApprovalResponse,
  } = useAgentChat({ agent });

  const isLoading = status === "streaming" || status === "submitted";

  const { interimTranscript, isListening, start, stop: stopVoice } =
    useVoiceInput({ agent: "HolstonAgent", name: agentName });

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
  const pendingToolName = pendingPart && isToolUIPart(pendingPart) ? getToolName(pendingPart) : undefined;
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
            sendMessage={sendMessage}
            isLoading={isLoading}
            isListening={isListening}
            interimTranscript={interimTranscript}
            onVoiceStart={start}
            onVoiceStop={stopVoice}
          />
        )}

        {activeTab === "skills" && <SkillsPanel />}
        {activeTab === "settings" && <SettingsPanel />}

        {pendingApproval && pendingApprovalId && (
          <ToolApproval
            toolName={pendingToolName ?? "unknown"}
            input={pendingToolInput}
            onApprove={() => addToolApprovalResponse({ id: pendingApprovalId, approved: true })}
            onReject={() => addToolApprovalResponse({ id: pendingApprovalId, approved: false })}
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
