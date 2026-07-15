import { Select } from "@cloudflare/kumo/components/select";
import { Surface } from "@cloudflare/kumo/components/surface";
import { Switch } from "@cloudflare/kumo/components/switch";
import { Text } from "@cloudflare/kumo/components/text";
import { Field } from "@cloudflare/kumo/components/field";
import { Button } from "@cloudflare/kumo/components/button";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Meter } from "@cloudflare/kumo/components/meter";
import { WarningIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { HolstonAgentConnection } from "../app";
import { MemoryCard } from "./MemoryCard";
import { GATED_TOOLS } from "../lib/tools";
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
  const [error, setError] = useState<string | null>(null);

  // Adopt a server-side change only when the user isn't mid-edit, so an
  // unrelated state sync never clobbers an in-progress draft.
  useEffect(() => {
    if (!dirty) setInstructions(s.customInstructions);
  }, [s.customInstructions, dirty]);

  // Every settings write surfaces failure — no more silent "did nothing".
  const patch = async (
    p: Parameters<HolstonAgentConnection["stub"]["updateSettings"]>[0],
  ) => {
    setError(null);
    try {
      await agent.stub.updateSettings(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save setting");
    }
  };

  const usage = state.usage;
  const overrides = s.toolApprovals ?? {};

  return (
    <div className="h-full overflow-y-auto holston-scroll">
      <div className="mx-auto w-full max-w-2xl p-6 flex flex-col gap-4">
        <Text variant="heading2" as="h2">Settings</Text>
        <Text variant="secondary" size="sm">
          These are stored on your agent and take effect immediately — they drive
          the model, skill behavior, and tool approvals on every turn.
        </Text>

        {error && (
          <Banner variant="error" icon={<WarningIcon />}>{error}</Banner>
        )}

        {usage && (
          <Surface className="p-4 rounded-xl">
            <div className="flex items-center justify-between">
              <Text variant="heading3" as="h3">AI usage today</Text>
              <Text variant="secondary" size="sm">{usage.calls} / {usage.limit} calls</Text>
            </div>
            <div className="mt-2">
              <Meter value={usage.calls} max={usage.limit} label="AI calls today" />
            </div>
            {usage.exceeded && (
              <div className="mt-2">
                <Text variant="error" size="sm">Daily AI budget reached — resets at midnight UTC.</Text>
              </div>
            )}
          </Surface>
        )}

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

          <div className="flex items-start justify-between gap-4">
            <div>
              <Text>Record browser sessions</Text>
              <Text variant="secondary" size="sm">Capture browser automation as replayable rrweb recordings. View live sessions and replays in the Lab tab. Playback needs Cloudflare API credentials.</Text>
            </div>
            <Switch checked={s.browserRecording} onCheckedChange={(v) => patch({ browserRecording: v })} aria-label="Record browser sessions" />
          </div>

          <Field label="Tool approval" description="Baseline policy by risk. 'Always' gates every write/destructive/external tool (bash, code execution, browser, MCP, delete…); 'destructive-only' gates destructive + external; 'never' gates nothing.">
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

          <div>
            <Text>Per-tool overrides</Text>
            <Text variant="secondary" size="sm">Pin a specific tool to always-ask or never-ask, regardless of the baseline above.</Text>
            <div className="mt-2 flex flex-col gap-1">
              {GATED_TOOLS.map((tool) => (
                <div key={tool.name} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Text size="sm" truncate>{tool.label}</Text>
                  </div>
                  <div className="w-40">
                    <Select
                      value={overrides[tool.name] ?? "default"}
                      onValueChange={(v) =>
                        patch({
                          toolApprovals: {
                            ...overrides,
                            ...(v === "default"
                              ? { [tool.name]: undefined as never }
                              : { [tool.name]: v as "always" | "never" }),
                          },
                        })
                      }
                      aria-label={`Approval for ${tool.label}`}
                    >
                      <Select.Option value="default">Use baseline</Select.Option>
                      <Select.Option value="always">Always ask</Select.Option>
                      <Select.Option value="never">Never ask</Select.Option>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </div>

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
