import { useRef } from "react";
import { Streamdown } from "streamdown";
import { Button, Input, Text } from "@cloudflare/kumo";
import type { UIMessage } from "ai";

interface ChatViewProps {
  messages: UIMessage[];
  input: string;
  handleSubmit: (e: React.FormEvent) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  status: "ready" | "streaming" | "submitted" | "error";
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
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--kumo-muted, #888)" }}>
            <Text>Ask Holston anything. It has tools, skills, and workspace access.</Text>
          </div>
        )}

        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        {isLoading && (
          <div className="holston-message holston-message-assistant">
            <Text size="sm">Thinking...</Text>
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

function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const textParts = message.parts?.filter((p) => p.type === "text") as
    | Array<{ type: "text"; text: string }>
    | undefined;

  return (
    <div
      className={`holston-message ${isUser ? "holston-message-user" : "holston-message-assistant"}`}
    >
      {textParts?.map((part, i) => (
        <Streamdown key={i}>{part.text}</Streamdown>
      ))}
    </div>
  );
}