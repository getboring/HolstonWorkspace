import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  PlugsConnectedIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { HolstonAgentConnection } from "../app";
import type { HolstonState, McpServerView } from "../shared/state";

const STATE_VARIANT: Record<McpServerView["state"], "primary" | "secondary" | "destructive" | "beta"> = {
  ready: "primary",
  connected: "primary",
  discovering: "beta",
  connecting: "beta",
  authenticating: "beta",
  failed: "destructive",
};

/**
 * Open an OAuth authorization URL. The URL originates from an MCP server
 * (untrusted), so only http(s) is allowed — this blocks javascript:/data: URLs.
 * Returns false if the URL was rejected.
 */
function openAuthUrl(authUrl: string): boolean {
  try {
    const parsed = new URL(authUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    window.open(parsed.href, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

export function McpPanel({
  agent,
  state,
}: {
  agent: HolstonAgentConnection;
  state: HolstonState;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await agent.stub.connectMcpServer(name.trim(), url.trim());
      if (result.state === "authenticating" && result.authUrl) {
        if (!openAuthUrl(result.authUrl)) {
          setError("Server returned an invalid authorization URL.");
        }
      }
      setName("");
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (id: string) => {
    try {
      await agent.stub.disconnectMcpServer(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    }
  };

  return (
    <div className="h-full overflow-y-auto holston-scroll">
      <div className="mx-auto w-full max-w-2xl p-6 flex flex-col gap-5">
        <div>
          <Text variant="heading2" as="h2">MCP servers</Text>
          <Text variant="secondary" size="sm">
            Connect Model Context Protocol servers to give Holston more tools. OAuth
            servers open an authorization tab; tokens persist across restarts.
          </Text>
        </div>

        <Surface className="p-4 rounded-xl">
          <form onSubmit={connect} className="flex flex-col gap-3">
            <div className="flex gap-2">
              <div className="w-1/3">
                <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="github" />
              </div>
              <div className="flex-1">
                <Input label="Server URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" icon={PlusIcon} loading={busy} disabled={!name.trim() || !url.trim()}>
                Connect
              </Button>
            </div>
          </form>
          {error && <div className="mt-2"><Text variant="error" size="sm">{error}</Text></div>}
        </Surface>

        <div className="flex items-center justify-between">
          <Text variant="heading3" as="h3">Connected ({state.mcpServers.length})</Text>
          <Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} onClick={() => agent.stub.refreshMcpServers()}>
            Refresh
          </Button>
        </div>

        {state.mcpServers.length === 0 ? (
          <Empty icon={<PlugsConnectedIcon size={32} />} title="No MCP servers" description="Connect one above to expand Holston's toolset." />
        ) : (
          <div className="flex flex-col gap-2">
            {state.mcpServers.map((server) => (
              <ServerRow key={server.id} server={server} onDisconnect={() => disconnect(server.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ServerRow({ server, onDisconnect }: { server: McpServerView; onDisconnect: () => void }) {
  return (
    <Surface className="flex items-center gap-3 p-3 rounded-lg border border-kumo-hairline">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Text truncate>{server.name}</Text>
          <Badge variant={STATE_VARIANT[server.state]}>{server.state}</Badge>
          {server.state === "ready" && <Text variant="secondary" size="sm">{server.toolCount} tools</Text>}
        </div>
        <div className="truncate"><Text variant="mono-secondary">{server.url}</Text></div>
        {server.error && <Text variant="error" size="sm">{server.error}</Text>}
      </div>
      {server.state === "authenticating" && server.authUrl && (
        <Button
          size="sm"
          variant="secondary"
          icon={ArrowSquareOutIcon}
          onClick={() => server.authUrl && openAuthUrl(server.authUrl)}
        >
          Authorize
        </Button>
      )}
      <Button size="sm" variant="ghost" icon={TrashIcon} onClick={onDisconnect} aria-label="Disconnect server" />
    </Surface>
  );
}
