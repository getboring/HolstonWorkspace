import { useRef } from "react";
import { Streamdown } from "streamdown";
import { Button, Input } from "@cloudflare/kumo";

interface ChatViewProps {
  messages: React.ReactNode[];
  input: string;
  handleSubmit: (e: React.FormEvent) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  status: string;
  stop: () => void;
}

export function ChatView({
  messages,
  input,
  handleSubmit,
  handleInputChange,
  status,
  stop,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "streaming" || status === "submitted";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        ref={scrollRef}
        className="holston-chat"
        style={{ flex: 1, overflowY: "auto" }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem", color: "#888" }}>
            <p>Ask Holston anything. It has tools, skills, and workspace access.</p>
          </div>
        )}

        {messages.map((message, i) => {
          const msg = message as unknown as {
            role: string;
            parts?: Array<{ type: string; text?: string }>;
          };
          const isUser = msg.role === "user";
          const textParts = msg.parts?.filter((p) => p.type === "text") as
            | Array<{ type: "text"; text: string }>
            | undefined;

          return (
            <div
              key={i}
              className={`holston-message ${isUser ? "holston-message-user" : "holston-message-assistant"}`}
            >
              {textParts?.map((part, j) => (
                <Streamdown key={j}>{part.text}</Streamdown>
              ))}
            </div>
          );
        })}

        {isLoading && (
          <div className="holston-message holston-message-assistant">
            <p style={{ fontSize: "0.85rem", color: "#888" }}>Thinking...</p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="holston-composer">
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
          <Input
            value={input}
            onChange={handleInputChange}
            placeholder="Message Holston..."
            style={{ flex: 1 }}
            disabled={isLoading}
          />
          {isLoading ? (
            <Button type="button" variant="destructive" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!input.trim()}>
              Send
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}