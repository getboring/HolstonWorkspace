import { useRef, useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { isToolUIPart, getToolName, type UIMessage } from "ai";

interface ChatViewProps {
  messages: UIMessage[];
  stop: () => void;
  sendMessage: (msg: { text: string }) => void;
  isLoading: boolean;
  isListening: boolean;
  interimTranscript: string | null;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
}

export function ChatView({
  messages,
  stop,
  sendMessage,
  isLoading,
  isListening,
  interimTranscript,
  onVoiceStart,
  onVoiceStop,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [localInput, setLocalInput] = useState("");
  const [showReasoning, setShowReasoning] = useState<Record<string, boolean>>({});

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isLoading && inputRef.current) inputRef.current.focus();
  }, [isLoading]);

  useEffect(() => {
    if (interimTranscript) {
      setLocalInput(interimTranscript);
    }
  }, [interimTranscript]);

  useEffect(() => {
    if (!isListening && interimTranscript === null && transcriptRef.current) {
      setLocalInput(transcriptRef.current);
      transcriptRef.current = "";
    }
  }, [isListening, interimTranscript]);

  const transcriptRef = useRef("");

  useEffect(() => {
    if (isListening && interimTranscript) {
      transcriptRef.current = (transcriptRef.current + " " + interimTranscript).trim();
    }
  }, [isListening, interimTranscript]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localInput.trim() || isLoading) return;
    sendMessage({ text: localInput } as never);
    setLocalInput("");
    transcriptRef.current = "";
  };

  const handleVoiceToggle = () => {
    if (isListening) {
      onVoiceStop();
    } else {
      onVoiceStart();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="holston-chat" style={{ flex: 1, overflowY: "auto" }}>
        {messages.length === 0 && (
          <div className="holston-empty">
            <p>Ask Holston anything. It has tools, skills, and workspace access.</p>
          </div>
        )}

        {messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            showReasoning={showReasoning[message.id] ?? false}
            onToggleReasoning={() =>
              setShowReasoning((prev) => ({ ...prev, [message.id]: !prev[message.id] }))
            }
          />
        ))}

        {isLoading && (
          <div className="holston-message holston-message-assistant">
            <span className="holston-thinking">Thinking...</span>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      <form onSubmit={handleSubmit} className="holston-composer">
        <div className="holston-input-row">
          <button
            type="button"
            className={`holston-btn holston-btn-voice ${isListening ? "holston-btn-voice-active" : ""}`}
            onClick={handleVoiceToggle}
            title={isListening ? "Stop voice input" : "Start voice input"}
          >
            {isListening ? "Stop" : "Voice"}
          </button>
          <input
            ref={inputRef}
            type="text"
            value={localInput}
            onChange={(e) => setLocalInput(e.target.value)}
            placeholder={isListening ? "Listening..." : "Message Holston..."}
            className="holston-input"
            disabled={isLoading}
          />
          {isLoading ? (
            <button type="button" className="holston-btn holston-btn-stop" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="submit" className="holston-btn holston-btn-send" disabled={!localInput.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Message({
  message,
  showReasoning,
  onToggleReasoning,
}: {
  message: UIMessage;
  showReasoning: boolean;
  onToggleReasoning: () => void;
}) {
  const isUser = message.role === "user";

  const textParts = message.parts?.filter((p) => p.type === "text") as
    | Array<{ type: "text"; text: string }>
    | undefined;

  const reasoningParts = message.parts?.filter((p) => p.type === "reasoning") as
    | Array<{ type: "reasoning"; text?: string; reasoning?: string } | { type: string; reasoning?: string }>
    | undefined;

  const toolParts = message.parts?.filter((p) => isToolUIPart(p)) as
    | Array<{ type: string; state?: string; input?: unknown; output?: unknown; approval?: { id?: string } }>
    | undefined;

  const hasReasoning = reasoningParts && reasoningParts.length > 0;

  return (
    <div className={`holston-message ${isUser ? "holston-message-user" : "holston-message-assistant"}`}>
      {hasReasoning && (
        <div className="holston-reasoning">
          <button className="holston-reasoning-toggle" onClick={onToggleReasoning}>
            {showReasoning ? "Hide" : "Show"} reasoning
          </button>
          {showReasoning && (
            <div className="holston-reasoning-body">
              {reasoningParts!.map((part, i) => (
                <p key={i}>
                  {(part as { reasoning?: string }).reasoning ?? (part as { text?: string }).text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {textParts?.map((part, i) => (
        <Streamdown key={i}>{part.text}</Streamdown>
      ))}

      {toolParts?.map((part, i) => {
        const name = getToolName(part as never);
        const state = part.state;

        if (state === "approval-requested") {
          return (
            <div key={i} className="holston-tool holston-tool-approval">
              <span className="holston-tool-label">Approval needed:</span>
              <span className="holston-tool-name">{name}</span>
              <pre className="holston-tool-input">
                {JSON.stringify(part.input, null, 2).slice(0, 500)}
              </pre>
            </div>
          );
        }

        if (state === "output-denied") {
          return (
            <div key={i} className="holston-tool holston-tool-rejected">
              <span className="holston-tool-name">{name}</span>
              <span className="holston-tool-badge">Rejected</span>
            </div>
          );
        }

        if (state === "output-available") {
          return (
            <div key={i} className="holston-tool holston-tool-done">
              <div className="holston-tool-header">
                <span className="holston-tool-name">{name}</span>
                <span className="holston-tool-badge">Done</span>
              </div>
              <pre className="holston-tool-output">
                {JSON.stringify(part.output, null, 2).slice(0, 500)}
              </pre>
            </div>
          );
        }

        return (
          <div key={i} className="holston-tool holston-tool-running">
            <span className="holston-tool-spinner" />
            <span className="holston-tool-name">Running {name}...</span>
          </div>
        );
      })}
    </div>
  );
}