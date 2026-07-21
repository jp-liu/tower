"use client";

import { useState, useEffect, useTransition } from "react";
import { Terminal, BookOpen, Brain, BarChart3 } from "lucide-react";
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
import { AiCapabilityBlock } from "./ai-capability-block";
import { AssistantCapabilityBlock } from "./assistant-capability-block";

type ProviderAvail = Awaited<ReturnType<typeof getAvailableProviders>>[number];
type SlotConfig = Awaited<ReturnType<typeof getAiCapabilityConfigs>>[number];

/**
 * Capability slots panel. Each AI capability gets its own independent block.
 * The `terminal` slot is fully wired; `assistant` has model/effort config.
 * The remaining 3 slots (summary / dreaming / analysis) are display-only for now.
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
  const effectiveProvider =
    terminalCfg?.provider ??
    (connected.includes("claude") ? "claude" : connected[0] ?? "claude");

  const displayName = (name: string) =>
    providers.find((p) => p.name === name)?.displayName ?? name;

  function handleTerminalChange(provider: string | null) {
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
    <div className="space-y-3">
      {/* Terminal slot — fully wired */}
      <AiCapabilityBlock
        icon={Terminal}
        title={t("settings.capabilitySlots.terminal")}
        description={t("settings.capabilitySlots.terminalDesc")}
        badge="active"
      >
        <div
          className={`flex items-center justify-between gap-4 ${
            isPending ? "opacity-40 pointer-events-none" : ""
          }`}
        >
          {connected.length === 0 ? (
            <span className="text-xs text-muted-foreground shrink-0">
              {t("settings.capabilitySlots.noConnected")}
            </span>
          ) : (
            <Select value={effectiveProvider} onValueChange={handleTerminalChange}>
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
      </AiCapabilityBlock>

      {/* Assistant slot — model + effort config */}
      <AssistantCapabilityBlock />

      {/* Summary slot — coming soon */}
      <AiCapabilityBlock
        icon={BookOpen}
        title={t("settings.capabilitySlots.summary")}
        badge="coming-soon"
      >
        <span className="text-xs text-muted-foreground">
          {t("settings.capabilitySlots.claudeFixed")}
        </span>
      </AiCapabilityBlock>

      {/* Dreaming slot — coming soon */}
      <AiCapabilityBlock
        icon={Brain}
        title={t("settings.capabilitySlots.dreaming")}
        badge="coming-soon"
      >
        <span className="text-xs text-muted-foreground">
          {t("settings.capabilitySlots.claudeFixed")}
        </span>
      </AiCapabilityBlock>

      {/* Analysis slot — coming soon */}
      <AiCapabilityBlock
        icon={BarChart3}
        title={t("settings.capabilitySlots.analysis")}
        badge="coming-soon"
      >
        <span className="text-xs text-muted-foreground">
          {t("settings.capabilitySlots.claudeFixed")}
        </span>
      </AiCapabilityBlock>
    </div>
  );
}
