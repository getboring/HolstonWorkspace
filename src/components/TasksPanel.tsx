import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Text } from "@cloudflare/kumo/components/text";
import {
  BellIcon,
  PlusIcon,
  TrashIcon,
  ArrowsClockwiseIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { HolstonAgentConnection } from "../app";
import type { HolstonState, ReminderView } from "../shared/state";
import { enablePush } from "../lib/push";

export function TasksPanel({
  agent,
  state,
}: {
  agent: HolstonAgentConnection;
  state: HolstonState;
}) {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<"idle" | "enabling" | "on" | "error">("idle");

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await agent.stub.createReminder(request.trim());
      setRequest("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create reminder");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await agent.stub.cancelReminder(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    }
  };

  const turnOnPush = async () => {
    setPushState("enabling");
    try {
      const ok = await enablePush(agent);
      setPushState(ok ? "on" : "error");
    } catch {
      setPushState("error");
    }
  };

  return (
    <div className="h-full overflow-y-auto holston-scroll">
      <div className="mx-auto w-full max-w-2xl p-6 flex flex-col gap-5">
        <div>
          <Text variant="heading2" as="h2">Reminders &amp; tasks</Text>
          <Text variant="secondary" size="sm">
            Describe when in plain language — "tomorrow at 3pm", "every weekday at 9am".
            Holston reaches you by push, Telegram, and email when it fires.
          </Text>
        </div>

        {pushState !== "on" && (
          <Banner
            variant="default"
            icon={<BellIcon />}
            action={
              <Button size="sm" variant="secondary" loading={pushState === "enabling"} onClick={turnOnPush}>
                Enable push
              </Button>
            }
          >
            {pushState === "error"
              ? "Push could not be enabled (missing VAPID keys or permission denied)."
              : "Turn on browser push to get reminders even when this tab is closed."}
          </Banner>
        )}

        <Surface className="p-4 rounded-xl">
          <form onSubmit={create} className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="New reminder"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="Remind me to review PRs every weekday at 9am"
              />
            </div>
            <Button type="submit" variant="primary" icon={PlusIcon} loading={busy} disabled={!request.trim()}>
              Add
            </Button>
          </form>
          {error && <div className="mt-2"><Text variant="error" size="sm">{error}</Text></div>}
        </Surface>

        <div className="flex items-center justify-between">
          <Text variant="heading3" as="h3">Scheduled ({state.reminders.length})</Text>
          <Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} onClick={() => agent.stub.listReminders()}>
            Refresh
          </Button>
        </div>

        {state.reminders.length === 0 ? (
          <Empty icon={<BellIcon size={32} />} title="No reminders yet" description="Add one above and it will appear here." />
        ) : (
          <div className="flex flex-col gap-2">
            {state.reminders.map((r) => (
              <ReminderRow key={r.id} reminder={r} onCancel={() => cancel(r.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReminderRow({ reminder, onCancel }: { reminder: ReminderView; onCancel: () => void }) {
  return (
    <Surface className="flex items-center gap-3 p-3 rounded-lg border border-kumo-hairline">
      <div className="flex-1 min-w-0">
        <Text truncate>{reminder.message}</Text>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant={reminder.recurring ? "primary" : "secondary"}>{reminder.recurring ? "recurring" : "one-time"}</Badge>
          <Text variant="secondary" size="sm">{reminder.when}</Text>
        </div>
      </div>
      <Button size="sm" variant="ghost" icon={TrashIcon} onClick={onCancel} aria-label="Cancel reminder" />
    </Surface>
  );
}
