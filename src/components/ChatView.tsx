import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Collapsible } from "@cloudflare/kumo/components/collapsible";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import {
  ChatCircleIcon,
  MicrophoneIcon,
  PaperPlaneRightIcon,
  StopIcon,
} from "@phosphor-icons/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";

interface ChatViewProps {
  messages: UIMessage[];
  stop: () => void;
  sendMessage: (msg: { text: string }) => void;
  isLoading: boolean;
  isListening: boolean;
  /** Accumulated final transcript from the voice hook (source of truth). */
  transcript: string;
  /** In-progress partial transcript (updates in place; do NOT accumulate). */
  interimTranscript: string | null;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onVoiceClear: () => void;
}

export function ChatView({
  messages,
  stop,
  sendMessage,
  isLoading,
  isListening,
  transcript,
  interimTranscript,
  onVoiceStart,
  onVoiceStop,
  onVoiceClear,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // When dictation stops, seed the editable field with the final transcript so
  // the user can review/edit before sending, then clear the hook's buffer.
  useEffect(() => {
    if (!isListening && transcript.trim()) {
      setTyped(transcript.trim());
      onVoiceClear();
    }
  }, [isListening, transcript, onVoiceClear]);

  // While the mic is active, the voice hook owns the value: its final
  // `transcript` plus the in-place `interimTranscript` (never accumulated).
  const voiceText = [transcript, interimTranscript]
    .filter(Boolean)
    .join(" ")
    .trim();
  const input = isListening ? voiceText : typed;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setTyped("");
    onVoiceClear();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto holston-scroll px-4 py-6">
        <div className="mx-auto w-full max-w-3xl flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="pt-16">
              <Empty
                icon={<ChatCircleIcon size={32} />}
                title="Ask Holston anything"
                description="It has workspace tools, MCP servers, skills, reminders, and can reach you by Telegram, email, and push."
              />
            </div>
          )}

          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 text-kumo-subtle">
              <Loader size={16} />
              <Text variant="secondary" size="sm">Thinking…</Text>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </div>

      <form onSubmit={submit} className="border-t border-kumo-hairline bg-kumo-base px-4 py-3">
        <div className="mx-auto w-full max-w-3xl flex items-center gap-2">
          <Button
            type="button"
            variant={isListening ? "primary" : "ghost"}
            size="base"
            icon={MicrophoneIcon}
            onClick={isListening ? onVoiceStop : onVoiceStart}
            aria-label={isListening ? "Stop voice input" : "Start voice input"}
          />
          <div className="flex-1">
            <Input
              value={input}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={isListening ? "Listening…" : "Message Holston…"}
              aria-label="Message Holston"
              disabled={isLoading || isListening}
            />
          </div>
          {isLoading ? (
            <Button type="button" variant="secondary-destructive" icon={StopIcon} onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" icon={PaperPlaneRightIcon} disabled={!input.trim()}>
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

  const textParts = (message.parts ?? []).filter((p) => p.type === "text") as Array<{ type: "text"; text: string }>;
  const reasoningParts = (message.parts ?? []).filter((p) => p.type === "reasoning") as Array<{ text?: string; reasoning?: string }>;
  const toolParts = (message.parts ?? []).filter((p) => isToolUIPart(p));

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <Surface
        className={`max-w-[85%] px-4 py-3 rounded-xl border border-kumo-hairline ${isUser ? "bg-kumo-brand text-kumo-inverse" : "bg-kumo-base"}`}
      >
        {reasoningParts.length > 0 && (
          <Collapsible title="Reasoning" defaultOpen={false}>
            <div className="text-kumo-subtle text-sm">
              {reasoningParts.map((part, i) => (
                <p key={i}>{part.reasoning ?? part.text}</p>
              ))}
            </div>
          </Collapsible>
        )}

        {textParts.map((part, i) => (
          <div key={i} className="holston-markdown">
            <Streamdown>{part.text}</Streamdown>
          </div>
        ))}

        {toolParts.map((part, i) => (
          <ToolPart key={i} part={part} />
        ))}
      </Surface>
    </div>
  );
}

function ToolPart({ part }: { part: unknown }) {
  const p = part as { state?: string; input?: unknown; output?: unknown };
  const name = getToolName(part as never);
  const state = p.state;

  if (state === "approval-requested") {
    return (
      <ToolBox tone="warning" name={name} badge="Approval needed">
        <Preview value={p.input} />
      </ToolBox>
    );
  }
  if (state === "output-denied") {
    return <ToolBox tone="danger" name={name} badge="Rejected" />;
  }
  if (state === "output-available") {
    return (
      <ToolBox tone="success" name={name} badge="Done">
        <ToolOutput name={name} value={p.output} />
      </ToolBox>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-2 text-kumo-subtle">
      <Loader size={14} />
      <Text variant="mono-secondary">Running {name}…</Text>
    </div>
  );
}

/** Find a base64/data-URL image anywhere in a tool result (browser screenshots). */
function findImage(value: unknown): string | null {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return value;
    if (/^[A-Za-z0-9+/]{200,}={0,2}$/.test(value)) return `data:image/png;base64,${value}`;
    return null;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      const found = findImage(v);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Render a tool result well: screenshots as images, code/exec output in full
 * (behind a show-more toggle), everything else as pretty JSON.
 */
function ToolOutput({ name, value }: { name: string; value: unknown }) {
  const [expanded, setExpanded] = useState(false);

  // Browser screenshots (or any tool returning an image) render as an image.
  if (name.startsWith("browser_") || name.includes("screenshot")) {
    const img = findImage(value);
    if (img) {
      return <img src={img} alt="tool result" className="mt-2 max-h-96 rounded border border-kumo-hairline" />;
    }
  }

  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const LIMIT = 800;
  const truncated = text.length > LIMIT && !expanded;
  return (
    <>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-kumo-subtle holston-scroll">
        {truncated ? text.slice(0, LIMIT) : text}
      </pre>
      {text.length > LIMIT && (
        <button
          type="button"
          className="mt-1 text-xs text-kumo-link underline"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Show less" : `Show more (${text.length} chars)`}
        </button>
      )}
    </>
  );
}

function ToolBox({
  tone,
  name,
  badge,
  children,
}: {
  tone: "warning" | "danger" | "success";
  name: string;
  badge: string;
  children?: React.ReactNode;
}) {
  const variant = tone === "danger" ? "destructive" : tone === "success" ? "secondary" : "outline";
  return (
    <div className="mt-2 rounded-lg border border-kumo-hairline bg-kumo-tint p-2">
      <div className="flex items-center gap-2">
        <Text variant="mono">{name}</Text>
        <Badge variant={variant as never}>{badge}</Badge>
      </div>
      {children}
    </div>
  );
}

function Preview({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 overflow-x-auto text-xs text-kumo-subtle holston-scroll">
      {JSON.stringify(value, null, 2).slice(0, 600)}
    </pre>
  );
}
