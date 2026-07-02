"use client";

import { useState, useEffect, useTransition } from "react";
import { Terminal, Lock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import {
  getAiCapabilityConfigs,
  updateAiCapabilityConfig,
  getAvailableProviders,
} from "@/actions/ai-config-actions";
import { getConnectedProviders } from "@/actions/provider-connection-actions";

type ProviderAvail = Awaited<ReturnType<typeof getAvailableProviders>>[number];
type SlotConfig = Awaited<ReturnType<typeof getAiCapabilityConfigs>>[number];

// The 4 query slots still run on a hardcoded Claude path (see design doc §3.1).
// Shown greyed so the user knows they exist but aren't wired to the slot system
// yet — Phase B migrates them to resolveQueryAdapter.
const DEFERRED_SLOTS = [
  { slot: "summary", key: "settings.capabilitySlots.summary" },
  { slot: "dreaming", key: "settings.capabilitySlots.dreaming" },
  { slot: "analysis", key: "settings.capabilitySlots.analysis" },
  { slot: "assistant", key: "settings.capabilitySlots.assistant" },
] as const;

/**
 * Capability slots panel. MVP wires only the `terminal` slot (which already
 * routes through resolveCliAdapter in agent-actions.ts) — pick which connected
 * provider runs task terminals. The other 4 slots are display-only for now.
 */
export function CapabilitySlotsSection() {
  const { t } = useI18n();
  const [providers, setProviders] = useState<ProviderAvail[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [configs, setConfigs] = useState<SlotConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    Promise.all([
      getAvailableProviders(),
      getConnectedProviders(),
      getAiCapabilityConfigs(),
    ])
      .then(([p, c, cfg]) => {
        if (!alive) return;
        setProviders(p);
        setConnected(c);
        setConfigs(cfg);
      })
      .catch((e) => {
        if (alive) toast.error(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const terminalCfg = configs.find((c) => c.slot === "terminal");
  // Mirror capability-resolver's fallback: no config → prefer claude if
  // connected, else first connected. Purely for display of the current effective
  // choice; the resolver is the source of truth at runtime.
  const effectiveProvider =
    terminalCfg?.provider ??
    (connected.includes("claude") ? "claude" : connected[0] ?? "claude");

  const displayName = (name: string) =>
    providers.find((p) => p.name === name)?.displayName ?? name;

  function handleChange(provider: string | null) {
    if (!provider) return;
    startTransition(async () => {
      try {
        await updateAiCapabilityConfig("terminal", {
          provider,
          mode: "cli",
          model: null,
        });
        setConfigs((prev) => {
          const others = prev.filter((c) => c.slot !== "terminal");
          const base =
            terminalCfg ??
            ({
              id: "",
              slot: "terminal",
              mode: "cli",
              model: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as SlotConfig);
          return [...others, { ...base, slot: "terminal", provider, mode: "cli", model: null }];
        });
        toast.success(t("settings.capabilitySlots.updated"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (loading) {
    return <div className="h-32 rounded-xl bg-muted animate-pulse" />;
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          {t("settings.capabilitySlots.title")}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("settings.capabilitySlots.desc")}
        </p>
      </div>

      {/* terminal slot — the only wired slot in MVP */}
      <div
        className={`flex items-center justify-between gap-4 ${
          isPending ? "opacity-40 pointer-events-none" : ""
        }`}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {t("settings.capabilitySlots.terminal")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("settings.capabilitySlots.terminalDesc")}
          </div>
        </div>
        {connected.length === 0 ? (
          <span className="text-xs text-muted-foreground shrink-0">
            {t("settings.capabilitySlots.noConnected")}
          </span>
        ) : (
          <Select value={effectiveProvider} onValueChange={handleChange}>
            <SelectTrigger className="w-44 shrink-0">
              <span className="truncate">{displayName(effectiveProvider)}</span>
            </SelectTrigger>
            <SelectContent>
              {connected.map((name) => (
                <SelectItem key={name} value={name}>
                  {displayName(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* deferred slots — display-only until Phase B */}
      <div className="space-y-2.5 border-t border-border/50 pt-3">
        {DEFERRED_SLOTS.map((d) => (
          <div key={d.slot} className="flex items-center justify-between gap-4 opacity-60">
            <div className="text-sm font-medium flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              {t(d.key)}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {t("settings.capabilitySlots.claudeFixed")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
