import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Select } from "@cloudflare/kumo/components/select";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import {
  ArrowsClockwiseIcon,
  DownloadSimpleIcon,
  HeartbeatIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { HolstonAgentConnection } from "../app";
import type { AgentEvent, EventSeverity } from "../events";
import { downloadText } from "../lib/download";

const SEVERITY_VARIANT: Record<EventSeverity, "secondary" | "beta" | "destructive"> = {
  info: "secondary",
  warning: "beta",
  error: "destructive",
  critical: "destructive",
};

type Filter = "all" | "problems" | EventSeverity;

const SEVERITIES_FOR: Record<Filter, EventSeverity[] | undefined> = {
  all: undefined,
  problems: ["error", "critical"],
  info: ["info"],
  warning: ["warning"],
  error: ["error"],
  critical: ["critical"],
};

export function HealthPanel({
  agent,
  revision,
}: {
  agent: HolstonAgentConnection;
  revision?: number;
}) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the first page for the current filter (replaces the list).
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await agent.stub.listEvents({
        limit: 50,
        severities: SEVERITIES_FOR[filter],
      });
      setEvents(page.events as AgentEvent[]);
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [agent, filter]);

  useEffect(() => { load(); }, [load]);
  // Refetch when the agent signals a health event was logged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the trigger; load is stable.
  useEffect(() => { if (revision) load(); }, [revision]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await agent.stub.listEvents({
        limit: 50,
        cursor,
        severities: SEVERITIES_FOR[filter],
      });
      setEvents((prev) => [...prev, ...(page.events as AgentEvent[])]);
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  const exportAll = async () => {
    try {
      const ndjson = await agent.stub.exportEvents();
      downloadText(`holston-health-${Date.now()}.ndjson`, ndjson);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <div className="h-full overflow-y-auto holston-scroll">
      <div className="mx-auto w-full max-w-3xl p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Text variant="heading2" as="h2">System Health</Text>
            <Text variant="secondary" size="sm">
              Durable record of scheduled-task, chat-recovery, background-work,
              and MCP failures. Critical failures also notify you. Newest first.
            </Text>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" icon={DownloadSimpleIcon} onClick={exportAll} aria-label="Export events" />
            <Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} onClick={load} aria-label="Refresh" />
          </div>
        </div>

        <div className="w-56">
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)} aria-label="Filter events">
            <Select.Option value="all">All events</Select.Option>
            <Select.Option value="problems">Problems (error + critical)</Select.Option>
            <Select.Option value="critical">Critical only</Select.Option>
            <Select.Option value="error">Error only</Select.Option>
            <Select.Option value="warning">Warning only</Select.Option>
            <Select.Option value="info">Info only</Select.Option>
          </Select>
        </div>

        {loading && <div className="flex items-center gap-2"><Loader size={16} /><Text variant="secondary" size="sm">Loading…</Text></div>}
        {error && <Text variant="error" size="sm">{error}</Text>}

        {!loading && !error && events.length === 0 && (
          <Empty
            icon={<HeartbeatIcon size={32} />}
            title="All clear"
            description="No health events recorded. Failures from scheduled tasks, chat recovery, background work, and MCP servers would show up here."
          />
        )}

        {!loading && events.length > 0 && (
          <div className="flex flex-col gap-2">
            {events.map((e) => (
              <Surface key={e.id} className="p-3 rounded-lg border border-kumo-hairline">
                <div className="flex items-center gap-2">
                  <Badge variant={SEVERITY_VARIANT[e.severity]}>{e.severity}</Badge>
                  <Text variant="mono">{e.kind}</Text>
                  <div className="ml-auto"><Text variant="secondary" size="sm">{new Date(e.createdAt).toLocaleString()}</Text></div>
                </div>
                <div className="mt-1"><Text size="sm">{e.message}</Text></div>
                {e.detail != null && (
                  <pre className="mt-2 overflow-x-auto text-xs text-kumo-subtle holston-scroll">
                    {JSON.stringify(e.detail, null, 2).slice(0, 800)}
                  </pre>
                )}
              </Surface>
            ))}
            {hasMore && (
              <div className="flex justify-center mt-2">
                <Button size="sm" variant="secondary" loading={loadingMore} onClick={loadMore}>
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
