import type { UIMessage } from "ai";
import { useEffect, useState } from "react";

interface SessionListProps {
  messages: UIMessage[];
  onClear: () => void;
}

interface Session {
  id: string;
  preview: string;
  timestamp: string;
  messageCount: number;
}

export function SessionList({ messages, onClear }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    const currentSession: Session = {
      id: "current",
      preview: messages.length > 0
        ? (messages[0]?.parts?.find((p) => p.type === "text") as { text?: string } | undefined)?.text?.slice(0, 60) ?? "New conversation"
        : "New conversation",
      timestamp: new Date().toISOString(),
      messageCount: messages.length,
    };
    setSessions([currentSession]);
  }, [messages]);

  const handleNew = () => {
    if (messages.length > 0 && typeof window !== "undefined") {
      if (window.confirm("Start a new conversation? Current chat will be cleared from view.")) {
        onClear();
        window.location.reload();
      }
    }
  };

  return (
    <div className="holston-sidebar-content">
      <div className="holston-sidebar-header">
        <h2 className="holston-sidebar-title">Holston Workspace</h2>
        <button className="holston-btn holston-btn-ghost" onClick={handleNew} title="New conversation">
          + New
        </button>
      </div>

      <div className="holston-session-list">
        {sessions.map((session) => (
          <div key={session.id} className="holston-session-item holston-session-active">
            <div className="holston-session-preview">{session.preview}</div>
            <div className="holston-session-meta">
              <span>{session.messageCount} messages</span>
            </div>
          </div>
        ))}
      </div>

      <div className="holston-sidebar-footer">
        <p>State persists in Durable Object SQLite.</p>
      </div>
    </div>
  );
}