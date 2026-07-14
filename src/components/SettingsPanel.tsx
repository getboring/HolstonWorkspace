import { Select } from "@cloudflare/kumo/components/select";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Switch } from "@cloudflare/kumo/components/switch";
import { Text } from "@cloudflare/kumo/components/text";
import { Field } from "@cloudflare/kumo/components/field";
import { Button } from "@cloudflare/kumo/components/button";
import { useEffect, useState } from "react";
import type { HolstonAgentConnection } from "../app";
import { MemoryCard } from "./MemoryCard";
import {
  TIMEZONES,
  WORKERS_AI_MODELS,
  type ApprovalMode,
  type HolstonState,
} from "../shared/state";

export function SettingsPanel({
  agent,
  state,
}: {
  agent: HolstonAgentConnection;
  state: HolstonState;
}) {
  const s = state.settings;
  const [instructions, setInstructions] = useState(s.customInstructions);
  const [dirty, setDirty] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);

  // Adopt a server-side change only when the user isn't mid-edit, so an
  // unrelated state sync never clobbers an in-progress draft.
  useEffect(() => {
    if (!dirty) setInstructions(s.customInstructions);
  }, [s.customInstructions, dirty]);

  const patch = (p: Parameters<HolstonAgentConnection["stub"]["updateSettings"]>[0]) =>
    agent.stub.updateSettings(p);

  return (
    <div className="h-full overflow-y-auto holston-scroll">
      <div className="mx-auto w-full max-w-2xl p-6 flex flex-col gap-4">
        <Text variant="heading2" as="h2">Settings</Text>
        <Text variant="secondary" size="sm">
          These are stored on your agent and take effect immediately — they drive
          the model, skill behavior, and tool approvals on every turn.
        </Text>

        <Surface className="p-4 rounded-xl">
          <Field label="Model" description="Workers AI model used for inference. No API keys required.">
            <Select
              value={s.model}
              onValueChange={(v) => patch({ model: v as typeof s.model })}
              aria-label="Model"
            >
              {WORKERS_AI_MODELS.map((m) => (
                <Select.Option key={m.id} value={m.id}>{m.label}</Select.Option>
              ))}
            </Select>
          </Field>
        </Surface>

        <Surface className="p-4 rounded-xl flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Text>Auto skill proposals</Text>
              <Text variant="secondary" size="sm">Propose reusable skills after complex tasks (5+ tool calls). Proposals wait for your approval.</Text>
            </div>
            <Switch checked={s.autoSkills} onCheckedChange={(v) => patch({ autoSkills: v })} aria-label="Auto skill proposals" />
          </div>

          <Field label="Tool approval" description="When Holston must ask before running a tool. 'Always' blocks bash/write/edit/delete; 'destructive-only' gates skill writes.">
            <Select
              value={s.approvalMode}
              onValueChange={(v) => patch({ approvalMode: v as ApprovalMode })}
              aria-label="Tool approval"
            >
              <Select.Option value="always">Always ask</Select.Option>
              <Select.Option value="destructive-only">Destructive only (recommended)</Select.Option>
              <Select.Option value="never">Never ask</Select.Option>
            </Select>
          </Field>

          <Field label="Timezone" description="Reminders and recurring schedules resolve in this zone.">
            <Select
              value={s.timezone ?? "America/New_York"}
              onValueChange={(v) => v && patch({ timezone: v })}
              aria-label="Timezone"
            >
              {TIMEZONES.map((tz) => (
                <Select.Option key={tz} value={tz}>{tz.replace("_", " ")}</Select.Option>
              ))}
            </Select>
          </Field>
        </Surface>

        <Surface className="p-4 rounded-xl">
          <Field
            label="Custom instructions"
            description="Appended to the system prompt on every turn. Shape Holston's persona and priorities."
          >
            <textarea
              className="w-full min-h-28 rounded-lg border border-kumo-line bg-kumo-base p-2 text-kumo-default text-sm holston-scroll"
              value={instructions}
              onChange={(e) => { setInstructions(e.target.value); setDirty(true); }}
              placeholder="You focus on Cloudflare-native solutions. Prefer concise answers…"
              maxLength={4000}
            />
          </Field>
          <div className="flex justify-end mt-2">
            <Button
              size="sm"
              variant="primary"
              loading={savingInstructions}
              disabled={instructions === s.customInstructions}
              onClick={async () => {
                setSavingInstructions(true);
                try {
                  await patch({ customInstructions: instructions });
                  setDirty(false);
                } finally {
                  setSavingInstructions(false);
                }
              }}
            >
              Save instructions
            </Button>
          </div>
        </Surface>

        <MemoryCard agent={agent} />

        <Surface className="p-4 rounded-xl border border-kumo-hairline">
          <Text variant="heading3" as="h3">About</Text>
          <Text variant="secondary" size="sm">
            Holston Workspace · Cloudflare Agents SDK (Think) · Workers AI · R2 + Vectorize skills
          </Text>
        </Surface>
      </div>
    </div>
  );
}
