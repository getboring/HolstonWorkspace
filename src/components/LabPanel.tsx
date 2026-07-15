import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import {
  ArrowsClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowUUpLeftIcon,
  BroadcastIcon,
  CheckIcon,
  CodeIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  MonitorPlayIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { HolstonAgentConnection } from "../app";
import { downloadText } from "../lib/download";
import type {
  BrowserLiveViewResult,
  ExecutionView,
  HolstonState,
  SnippetView,
} from "../shared/state";

const STATUS_VARIANT: Record<string, "primary" | "secondary" | "destructive" | "beta"> = {
  completed: "primary",
  applied: "primary",
  error: "destructive",
  rejected: "destructive",
  paused: "beta",
  pending: "beta",
  executing: "beta",
};

/**
 * Open a Live View / auth URL in a new tab. URLs come from the browser
 * connector (Cloudflare) — restrict to http(s) as defense in depth.
 */
function openUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    window.open(u.href, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

export function LabPanel({
  agent,
  state,
}: {
  agent: HolstonAgentConnection;
  state: HolstonState;
}) {
  return (
    <div className="h-full overflow-y-auto holston-scroll">
      <div className="mx-auto w-full max-w-3xl p-6 flex flex-col gap-6">
        <div>
          <Text variant="heading2" as="h2">Lab</Text>
          <Text variant="secondary" size="sm">
            The code-execution and browser surfaces — save proven code as reusable
            snippets, audit what ran, and watch or replay browser automation.
          </Text>
        </div>
        <BrowserSection agent={agent} state={state} />
        <ExecutionsSection agent={agent} />
        <SnippetsSection agent={agent} />
      </div>
    </div>
  );
}

/* ── Browser: Live View + recording state ─────────────────────────────── */
function BrowserSection({
  agent,
  state,
}: {
  agent: HolstonAgentConnection;
  state: HolstonState;
}) {
  const [view, setView] = useState<BrowserLiveViewResult | null>(null);
  const [loading, setLoading] = useState(false);
  // Remember the last session id we saw (from a Live View check or a manual
  // entry) so a finished session's recording can be fetched afterward.
  const [sessionId, setSessionId] = useState("");
  const [fetchingRec, setFetchingRec] = useState(false);
  const [recNote, setRecNote] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    try {
      const v = await agent.stub.browserLiveView();
      setView(v);
      if (v.sessionId) setSessionId(v.sessionId);
    } catch {
      setView({ active: false, targets: [], error: "Could not reach Live View" });
    } finally {
      setLoading(false);
    }
  }, [agent]);

  const fetchRecording = async () => {
    const id = sessionId.trim();
    if (!id) return;
    setFetchingRec(true);
    setRecNote(null);
    try {
      const rec = await agent.stub.browserRecording(id);
      if (!rec.ok) {
        setRecNote(rec.error ?? "Recording not found");
        return;
      }
      const tabs = rec.events ? Object.keys(rec.events).length : 0;
      const secs = rec.durationMs ? Math.round(rec.durationMs / 1000) : 0;
      // rrweb JSON — downloadable and replayable in any rrweb-player.
      downloadText(
        `holston-recording-${id}.json`,
        JSON.stringify(rec.events ?? {}),
        "application/json",
      );
      setRecNote(`Downloaded recording — ${tabs} tab(s), ~${secs}s. Replay it in an rrweb-player.`);
    } catch (err) {
      setRecNote(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetchingRec(false);
    }
  };

  return (
    <Surface className="p-4 rounded-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BroadcastIcon size={18} />
          <Text variant="heading3" as="h3">Browser Live View</Text>
        </div>
        <Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} onClick={check} loading={loading}>
          Check
        </Button>
      </div>
      <Text variant="secondary" size="sm">
        When Holston is driving a browser, open a live, interactive view of each
        tab to watch or take over. Recording is{" "}
        {state.settings.browserRecording ? "on" : "off"} (toggle in Settings) —
        with it on, download a finished session's rrweb recording below.
      </Text>

      {view === null ? (
        <div className="mt-3">
          <Text variant="secondary" size="sm">Click Check to look for an active browser session.</Text>
        </div>
      ) : view.error ? (
        <div className="mt-3"><Text variant="error" size="sm">{view.error}</Text></div>
      ) : !view.active ? (
        <div className="mt-3">
          <Text variant="secondary" size="sm">No active browser session right now.</Text>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {view.targets.map((t) => (
            <div key={t.url} className="flex items-center gap-2 rounded-lg border border-kumo-hairline bg-kumo-tint p-2">
              <MonitorPlayIcon size={16} />
              <div className="flex-1 min-w-0">
                <Text size="sm" truncate>{t.title || t.pageUrl || "Browser tab"}</Text>
                {t.pageUrl && <div className="truncate"><Text variant="mono-secondary">{t.pageUrl}</Text></div>}
              </div>
              <Button size="sm" variant="secondary" icon={ArrowSquareOutIcon} onClick={() => openUrl(t.url)}>
                Open
              </Button>
            </div>
          ))}
          {view.expiresInMs != null && (
            <Text variant="secondary" size="xs">
              Links expire in ~{Math.round(view.expiresInMs / 60000)} min — click Check for fresh ones.
            </Text>
          )}
        </div>
      )}

      {/* Recording download — reachable when a session id is known. Playback
          needs CF_ACCOUNT_ID + CF_API_TOKEN (the callable reports if unset). */}
      <div className="mt-4 border-t border-kumo-hairline pt-3">
        <Text size="sm">Session recording</Text>
        <div className="mt-2 flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Browser session id"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="from a Live View check, or paste one"
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={DownloadSimpleIcon}
            loading={fetchingRec}
            disabled={!sessionId.trim()}
            onClick={fetchRecording}
          >
            Download
          </Button>
        </div>
        {recNote && <div className="mt-2"><Text variant="secondary" size="sm">{recNote}</Text></div>}
      </div>
    </Surface>
  );
}

/* ── Codemode executions (audit) with save-as-snippet ─────────────────── */
function ExecutionsSection({ agent }: { agent: HolstonAgentConnection }) {
  const [rows, setRows] = useState<ExecutionView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await agent.stub.listExecutions(25));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load executions");
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => { load(); }, [load]);

  const save = async (executionId: string) => {
    const clean = name.trim();
    if (!clean) return;
    setNotice(null);
    const res = await agent.stub.saveSnippet(clean, executionId);
    if (res.ok) {
      setNotice(`Saved snippet "${clean}".`);
      setSavingId(null);
      setName("");
    } else {
      setNotice(res.error ?? "Save failed");
    }
  };

  // Resolve a paused execution. approve/reject are Think built-ins (they resume
  // the run and auto-continue the chat); rollback is our own callable.
  const [actingId, setActingId] = useState<string | null>(null);
  const act = async (id: string, action: "approve" | "reject" | "rollback") => {
    setActingId(id);
    setNotice(null);
    try {
      if (action === "approve") await agent.stub.approveExecution(id);
      else if (action === "reject") await agent.stub.rejectExecution(id);
      else {
        const res = await agent.stub.rollbackExecution(id);
        if (!res.ok) setNotice(res.error ?? "Rollback failed");
      }
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setActingId(null);
    }
  };

  return (
    <Surface className="p-4 rounded-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CodeIcon size={18} />
          <Text variant="heading3" as="h3">Code executions</Text>
        </div>
        <Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} onClick={load} aria-label="Refresh executions" />
      </div>
      <Text variant="secondary" size="sm">
        The audit trail of code Holston ran. Save a working run as a reusable
        snippet the model can call again by name.
      </Text>

      {notice && <div className="mt-2"><Text size="sm">{notice}</Text></div>}
      {loading && <div className="mt-3 flex items-center gap-2"><Loader size={14} /><Text variant="secondary" size="sm">Loading…</Text></div>}
      {error && <div className="mt-2"><Text variant="error" size="sm">{error}</Text></div>}

      {!loading && !error && rows && rows.length === 0 && (
        <div className="mt-3"><Text variant="secondary" size="sm">No code has run yet. Ask Holston to use the execute tool.</Text></div>
      )}

      {!loading && rows && rows.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((e) => (
            <div key={e.id} className="rounded-lg border border-kumo-hairline bg-kumo-tint p-2">
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_VARIANT[e.status] ?? "secondary"}>{e.status}</Badge>
                <Text variant="mono-secondary">{e.steps} steps</Text>
                <div className="ml-auto"><Text variant="secondary" size="xs">{new Date(e.createdAt).toLocaleString()}</Text></div>
              </div>
              <pre className="mt-1 overflow-x-auto text-xs text-kumo-subtle holston-scroll">{e.code.slice(0, 400)}</pre>
              {e.error && <Text variant="error" size="xs">{e.error}</Text>}

              {/* Paused: the run stopped for approval — resolve it here so it
                  isn't a dead end. */}
              {e.status === "paused" && (
                <div className="mt-2 rounded-md border border-kumo-hairline bg-kumo-base p-2">
                  <Text variant="secondary" size="xs">
                    This run is paused waiting for your approval to continue.
                  </Text>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="primary" icon={CheckIcon} loading={actingId === e.id} onClick={() => act(e.id, "approve")}>
                      Approve &amp; resume
                    </Button>
                    <Button size="sm" variant="secondary-destructive" icon={XIcon} loading={actingId === e.id} onClick={() => act(e.id, "reject")}>
                      Reject
                    </Button>
                  </div>
                </div>
              )}

              {savingId === e.id ? (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1">
                    <Input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="snippet-name" aria-label="Snippet name" />
                  </div>
                  <Button size="sm" variant="primary" icon={FloppyDiskIcon} onClick={() => save(e.id)} disabled={!name.trim()}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setSavingId(null); setName(""); }}>Cancel</Button>
                </div>
              ) : (
                (e.status === "completed" || e.status === "applied") && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" icon={FloppyDiskIcon} onClick={() => { setSavingId(e.id); setNotice(null); }}>
                      Save as snippet
                    </Button>
                    <Button size="sm" variant="ghost" icon={ArrowUUpLeftIcon} loading={actingId === e.id} onClick={() => act(e.id, "rollback")}>
                      Roll back
                    </Button>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}

/* ── Saved snippets ───────────────────────────────────────────────────── */
function SnippetsSection({ agent }: { agent: HolstonAgentConnection }) {
  const [snippets, setSnippets] = useState<SnippetView[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnippets(await agent.stub.listSnippets());
    } catch {
      setSnippets([]);
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => { load(); }, [load]);

  const remove = async (n: string) => {
    await agent.stub.deleteSnippet(n);
    load();
  };

  return (
    <Surface className="p-4 rounded-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FloppyDiskIcon size={18} />
          <Text variant="heading3" as="h3">Saved snippets</Text>
        </div>
        <Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} onClick={load} aria-label="Refresh snippets" />
      </div>
      <Text variant="secondary" size="sm">
        Reusable code the model can re-run by name — executable skills, distinct
        from the prose skills in the Skills tab.
      </Text>

      {loading ? (
        <div className="mt-3 flex items-center gap-2"><Loader size={14} /><Text variant="secondary" size="sm">Loading…</Text></div>
      ) : snippets && snippets.length === 0 ? (
        <div className="mt-3">
          <Empty
            icon={<CodeIcon size={28} />}
            title="No snippets yet"
            description="Save a successful code execution above to make it a reusable snippet."
          />
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {snippets?.map((s) => (
            <div key={s.name} className="rounded-lg border border-kumo-hairline bg-kumo-tint p-2">
              <div className="flex items-center gap-2">
                <Text variant="mono">{s.name}</Text>
                {s.connectors.map((c) => (
                  <Badge key={c} variant="outline">{c}</Badge>
                ))}
                <Button size="sm" variant="ghost" icon={TrashIcon} onClick={() => remove(s.name)} aria-label={`Delete ${s.name}`} className="ml-auto" />
              </div>
              {s.description && <div className="mt-0.5"><Text variant="secondary" size="sm">{s.description}</Text></div>}
              <pre className="mt-1 overflow-x-auto text-xs text-kumo-subtle holston-scroll">{s.code.slice(0, 400)}</pre>
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}
