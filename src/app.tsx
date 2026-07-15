import { useAgentChat } from "@cloudflare/ai-chat/react";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { Text } from "@cloudflare/kumo/components/text";
import { Toast, Toasty } from "@cloudflare/kumo/components/toast";
import { Button } from "@cloudflare/kumo/components/button";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Empty } from "@cloudflare/kumo/components/empty";
import {
  ChatCircleIcon,
  GearIcon,
  LightningIcon,
  MoonIcon,
  PlugsConnectedIcon,
  FlaskIcon,
  HeartbeatIcon,
  ReceiptIcon,
  SidebarIcon,
  SparkleIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { useVoiceInput } from "@cloudflare/voice/react";
import { isToolUIPart, type UIMessage } from "ai";
import { useAgent } from "agents/react";
import { useEffect, useState } from "react";
import { ChatView } from "./components/ChatView";
import { HealthPanel } from "./components/HealthPanel";
import { LabPanel } from "./components/LabPanel";
import { McpPanel } from "./components/McpPanel";
import { PoweredBy } from "./components/PoweredBy";
import { ReceiptsPanel } from "./components/ReceiptsPanel";
import { SessionList } from "./components/SessionList";
import { SettingsPanel } from "./components/SettingsPanel";
import { SkillsPanel } from "./components/SkillsPanel";
import { TasksPanel } from "./components/TasksPanel";
import { ToolApproval } from "./components/ToolApproval";
import type { HolstonAgent } from "./server";
import { INITIAL_STATE, type HolstonState } from "./shared/state";

type Tab = "chat" | "tasks" | "mcp" | "skills" | "lab" | "receipts" | "health" | "settings";

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

  const [agentName, setAgentName] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/setup/info")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ agentName: string }>;
      })
      .then((info) => !cancelled && setAgentName(info.agentName || "default"))
      .catch((err) => !cancelled && setInfoError(err instanceof Error ? err.message : "Failed to load agent info"));
    return () => { cancelled = true; };
  }, []);

  if (infoError) {
    return (
      <Centered dark={dark}>
        <Empty title="Could not connect to your agent" description={`${infoError}. Are you signed in?`} icon={<PlugsConnectedIcon size={32} />} />
      </Centered>
    );
  }
  if (!agentName) {
    return (
      <Centered dark={dark}>
        <div className="flex flex-col items-center gap-3">
          <Loader size={28} />
          <Text variant="secondary">Connecting to your agent…</Text>
        </div>
      </Centered>
    );
  }

  return (
    <Toasty>
      <Workspace agentName={agentName} dark={dark} setDark={setDark} />
    </Toasty>
  );
}

function Centered({ children, dark }: { children: React.ReactNode; dark: boolean }) {
  return (
    <div className="holston-app bg-kumo-canvas" data-mode={dark ? "dark" : "light"}>
      <div className="flex-1 flex items-center justify-center p-8">{children}</div>
    </div>
  );
}

function Workspace({ agentName, dark, setDark }: { agentName: string; dark: boolean; setDark: (d: boolean) => void }) {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [state, setState] = useState<HolstonState>(INITIAL_STATE);
  const toast = Toast.useToastManager();

  const agent = useAgent<HolstonAgent, HolstonState>({
    agent: "HolstonAgent",
    name: agentName,
    onStateUpdate: (s) => setState(s),
    onMessage: (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === "notification") {
          toast.add({ title: data.title, description: data.body });
        }
      } catch { /* not our message */ }
    },
    onError: (error: Event) => console.error("[holston] WebSocket error:", error),
  });

  const { messages, status, stop, sendMessage, addToolApprovalResponse } = useAgentChat({ agent });
  const isLoading = status === "streaming" || status === "submitted";

  const { transcript, interimTranscript, isListening, start, stop: stopVoice, clear: clearVoice } =
    useVoiceInput({ agent: "HolstonAgent", name: agentName });

  const pendingPart = findPendingApproval(messages);
  const pendingApprovalId = pendingPart && "approval" in pendingPart
    ? (pendingPart as { approval?: { id?: string } }).approval?.id
    : undefined;

  const tabs = [
    { value: "chat", label: "Chat", icon: ChatCircleIcon },
    { value: "tasks", label: "Tasks", icon: LightningIcon, badge: state.reminders.length },
    { value: "mcp", label: "MCP", icon: PlugsConnectedIcon, badge: state.mcpServers.length },
    { value: "skills", label: "Skills", icon: SparkleIcon },
    { value: "lab", label: "Lab", icon: FlaskIcon },
    { value: "receipts", label: "Receipts", icon: ReceiptIcon, badge: state.receiptCount },
    { value: "health", label: "Health", icon: HeartbeatIcon, badge: state.healthAlerts },
    { value: "settings", label: "Settings", icon: GearIcon },
  ] as const;

  return (
    <div className="holston-app bg-kumo-canvas text-kumo-default" data-mode={dark ? "dark" : "light"}>
      {sidebarOpen && (
        <aside className="w-64 shrink-0 border-r border-kumo-hairline bg-kumo-base overflow-hidden hidden md:block">
          <SessionList agent={agent} messages={messages as UIMessage[]} />
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-kumo-hairline bg-kumo-base">
          <Button variant="ghost" size="sm" icon={SidebarIcon} onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle sidebar" />
          <div className="flex-1 min-w-0">
            <Tabs
              variant="underline"
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as Tab)}
              tabs={tabs.map((t) => ({
                value: t.value,
                label: "badge" in t && t.badge ? `${t.label} (${t.badge})` : t.label,
              }))}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={dark ? SunIcon : MoonIcon}
            onClick={() => setDark(!dark)}
            aria-label="Toggle theme"
          />
        </header>

        <main className="flex-1 min-h-0 overflow-hidden">
          {activeTab === "chat" && (
            <ChatView
              messages={messages as UIMessage[]}
              stop={stop}
              sendMessage={sendMessage}
              isLoading={isLoading}
              isListening={isListening}
              transcript={transcript}
              interimTranscript={interimTranscript}
              onVoiceStart={start}
              onVoiceStop={stopVoice}
              onVoiceClear={clearVoice}
            />
          )}
          {activeTab === "tasks" && <TasksPanel agent={agent} state={state} />}
          {activeTab === "mcp" && <McpPanel agent={agent} state={state} />}
          {activeTab === "skills" && <SkillsPanel />}
          {activeTab === "lab" && <LabPanel agent={agent} state={state} />}
          {activeTab === "receipts" && <ReceiptsPanel agent={agent} />}
          {activeTab === "health" && <HealthPanel agent={agent} />}
          {activeTab === "settings" && <SettingsPanel agent={agent} state={state} />}
        </main>

        {pendingPart && pendingApprovalId && (
          <ToolApproval
            part={pendingPart}
            onApprove={() => addToolApprovalResponse({ id: pendingApprovalId, approved: true })}
            onReject={() => addToolApprovalResponse({ id: pendingApprovalId, approved: false })}
          />
        )}

        <PoweredBy />
      </div>
    </div>
  );
}

function findPendingApproval(messages: UIMessage[]) {
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (isToolUIPart(p) && "approval" in p && (p as { state?: string }).state === "approval-requested") {
        return p;
      }
    }
  }
  return undefined;
}

// Re-exported so components can share the connected agent type.
export type HolstonAgentConnection = ReturnType<
  typeof useAgent<HolstonAgent, HolstonState>
>;
