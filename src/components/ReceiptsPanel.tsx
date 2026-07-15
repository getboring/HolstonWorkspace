import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import {
  ArrowsClockwiseIcon,
  DownloadSimpleIcon,
  ReceiptIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { HolstonAgentConnection } from "../app";
import { downloadText } from "../lib/download";
import type { ReceiptView } from "../shared/state";

export function ReceiptsPanel({
  agent,
  revision,
}: {
  agent: HolstonAgentConnection;
  revision?: number;
}) {
  const [receipts, setReceipts] = useState<ReceiptView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await agent.stub.listReceiptsPage({ limit: 50 });
      setReceipts(page.receipts as ReceiptView[]);
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load receipts");
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => { load(); }, [load]);
  // Refetch the first page when the agent signals derived data changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the trigger; load is stable.
  useEffect(() => { if (revision) load(); }, [revision]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await agent.stub.listReceiptsPage({ limit: 50, cursor });
      setReceipts((prev) => [...prev, ...(page.receipts as ReceiptView[])]);
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
      const ndjson = await agent.stub.exportReceipts();
      downloadText(`holston-receipts-${Date.now()}.ndjson`, ndjson);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <div className="h-full overflow-y-auto holston-scroll">
      <div className="mx-auto w-full max-w-3xl p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Text variant="heading2" as="h2">Receipts</Text>
            <Text variant="secondary" size="sm">
              Every gated action writes an immutable audit record (validate →
              idempotency → authorize → execute → receipt). Newest first.
            </Text>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" icon={DownloadSimpleIcon} onClick={exportAll} aria-label="Export receipts" />
            <Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} onClick={load} aria-label="Refresh" />
          </div>
        </div>

        {loading && <div className="flex items-center gap-2"><Loader size={16} /><Text variant="secondary" size="sm">Loading…</Text></div>}
        {error && <Text variant="error" size="sm">{error}</Text>}

        {!loading && !error && receipts.length === 0 && (
          <Empty icon={<ReceiptIcon size={32} />} title="No receipts yet" description="When Holston runs a gated action (send a message, set a reminder, save a memory), the record appears here." />
        )}

        {!loading && receipts.length > 0 && (
          <div className="flex flex-col gap-2">
            {receipts.map((r) => (
              <Surface key={r.id} className="p-3 rounded-lg border border-kumo-hairline">
                <div className="flex items-center gap-2">
                  <Text variant="mono">{r.action}</Text>
                  {r.idempotencyKey && <Badge variant="outline">key: {r.idempotencyKey}</Badge>}
                  <div className="ml-auto"><Text variant="secondary" size="sm">{new Date(r.createdAt).toLocaleString()}</Text></div>
                </div>
                <div className="mt-1"><Text variant="secondary" size="sm">actor: {r.actor}</Text></div>
                <pre className="mt-2 overflow-x-auto text-xs text-kumo-subtle holston-scroll">
                  {JSON.stringify({ input: r.input, output: r.output }, null, 2).slice(0, 800)}
                </pre>
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
