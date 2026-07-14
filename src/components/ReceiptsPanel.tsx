import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import { ArrowsClockwiseIcon, ReceiptIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { HolstonAgentConnection } from "../app";
import type { ReceiptView } from "../shared/state";

export function ReceiptsPanel({ agent }: { agent: HolstonAgentConnection }) {
  const [receipts, setReceipts] = useState<ReceiptView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await agent.stub.listReceipts(100);
      setReceipts(rows as ReceiptView[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load receipts");
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => { load(); }, [load]);

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
          <Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} onClick={load}>Refresh</Button>
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
          </div>
        )}
      </div>
    </div>
  );
}
