"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  CircleAlert,
  Clock3,
  Loader2,
  Route,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import {
  getAiCapabilityChoices,
  getAiCapabilityDiagnostics,
  listAiCapabilities,
  replaceAiCapabilityTargets,
} from "@/actions/ai-config-actions";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  DEFAULT_ASSISTANT_HISTORY_TURNS,
  MAX_ASSISTANT_HISTORY_TURNS,
  MIN_ASSISTANT_HISTORY_TURNS,
  normalizeAssistantHistoryTurns,
} from "@/lib/ai/assistant-history";
import { useI18n } from "@/lib/i18n";

type Slot = "terminal" | "summary" | "dreaming" | "analysis" | "assistant";
type ConfigResult = Awaited<ReturnType<typeof listAiCapabilities>>;
type SlotConfig = Extract<ConfigResult, { ok: true }>["data"][number];
type Target = SlotConfig["targets"][number];
type ChoiceResult = Awaited<ReturnType<typeof getAiCapabilityChoices>>;
type Choice = Extract<ChoiceResult, { ok: true }>["data"][number];
type DiagnosticsResult = Awaited<ReturnType<typeof getAiCapabilityDiagnostics>>;
type Diagnostic = Extract<DiagnosticsResult, { ok: true }>["data"][number];
type TargetRole = "primary" | "fallback";

type TargetOption = {
  value: string;
  connectionId: string;
  modelId: string | null;
  name: string;
  kind: string;
  testStatus: string;
  testOk: boolean;
  enabled: boolean;
  available: boolean;
};

const SLOT_META = [
  { slot: "terminal", icon: Terminal, desc: "terminalDesc" },
  { slot: "summary", icon: BookOpen, desc: "summaryDesc" },
  { slot: "dreaming", icon: Brain, desc: "dreamingDesc" },
  { slot: "analysis", icon: BarChart3, desc: "analysisDesc" },
  { slot: "assistant", icon: Bot, desc: "assistantDesc" },
] as const;

const EFFORT_OPTIONS = ["low", "medium", "high"] as const;
const CONNECTIONS_CHANGED_EVENT = "tower:provider-connections-changed";
const EMPTY_TARGET = "__tower_empty_target__";

function targetValue(connectionId: string, modelId: string | null) {
  return JSON.stringify([connectionId, modelId]);
}

function optionLabel(option: TargetOption, cliDefaultModel: string) {
  const target = option.kind === "api"
    ? option.modelId
    : option.modelId || cliDefaultModel;
  return `${option.name} · ${target}`;
}

function targetOptions(slotChoices: Choice[], currentTargets: Target[]): TargetOption[] {
  const options = new Map<string, TargetOption>();
  for (const choice of slotChoices) {
    if (choice.kind === "api") {
      for (const model of choice.models) {
        const value = targetValue(choice.id, model.modelId);
        options.set(value, {
          value,
          connectionId: choice.id,
          modelId: model.modelId,
          name: choice.name,
          kind: choice.kind,
          testStatus: choice.testStatus,
          testOk: choice.testOk,
          enabled: choice.enabled,
          available: model.available,
        });
      }
    } else {
      const value = targetValue(choice.id, null);
      options.set(value, {
        value,
        connectionId: choice.id,
        modelId: null,
        name: choice.name,
        kind: choice.kind,
        testStatus: choice.testStatus,
        testOk: choice.testOk,
        enabled: choice.enabled,
        available: true,
      });
    }
  }

  // Keep legacy/custom model selections visible until the user replaces them.
  for (const target of currentTargets) {
    const value = targetValue(target.connectionId, target.modelId);
    if (options.has(value)) continue;
    options.set(value, {
      value,
      connectionId: target.connectionId,
      modelId: target.modelId,
      name: target.connection.name,
      kind: target.connection.kind,
      testStatus: target.connection.testStatus,
      testOk: target.connection.testOk,
      enabled: target.connection.enabled,
      available: target.connection.kind === "cli",
    });
  }
  return [...options.values()];
}

function unavailableReason(option: TargetOption | undefined) {
  if (!option) return "connectionMissing";
  if (!option.enabled) return "connectionDisabled";
  if (!option.testOk) return "connectionFailed";
  if (!option.available) return "modelUnavailable";
  return null;
}

export function CapabilitySlotsSection() {
  const { t } = useI18n();
  const [configs, setConfigs] = useState<SlotConfig[]>([]);
  const [choices, setChoices] = useState<Record<Slot, Choice[]>>({
    terminal: [], summary: [], dreaming: [], analysis: [], assistant: [],
  });
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [effort, setEffort] = useState("low");
  const [historyTurns, setHistoryTurns] = useState(String(DEFAULT_ASSISTANT_HISTORY_TURNS));

  const load = useCallback(async () => {
    setLoadError(false);
    const [configResult, terminal, summary, dreaming, analysis, assistant, diagnosticResult, effortValue, historyTurnsValue] = await Promise.all([
      listAiCapabilities(),
      getAiCapabilityChoices("terminal"),
      getAiCapabilityChoices("summary"),
      getAiCapabilityChoices("dreaming"),
      getAiCapabilityChoices("analysis"),
      getAiCapabilityChoices("assistant"),
      getAiCapabilityDiagnostics({ limit: 25 }),
      getConfigValue("assistant.effort", "low"),
      getConfigValue("assistant.historyTurns", DEFAULT_ASSISTANT_HISTORY_TURNS),
    ]);
    if (!configResult.ok || !terminal.ok || !summary.ok || !dreaming.ok || !analysis.ok || !assistant.ok) {
      setLoadError(true);
    } else {
      setConfigs(configResult.data);
      setChoices({
        terminal: terminal.data,
        summary: summary.data,
        dreaming: dreaming.data,
        analysis: analysis.data,
        assistant: assistant.data,
      });
    }
    if (diagnosticResult.ok) setDiagnostics(diagnosticResult.data);
    setEffort(String(effortValue));
    setHistoryTurns(String(normalizeAssistantHistoryTurns(historyTurnsValue)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const reload = () => { void load(); };
    window.addEventListener(CONNECTIONS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(CONNECTIONS_CHANGED_EVENT, reload);
  }, [load]);

  function markPending(key: string, value: boolean) {
    setPending((current) => ({ ...current, [key]: value }));
  }

  function actionError(code?: string) {
    return t(`settings.capabilitySlots.error.${code ?? "capability_operation_failed"}` as never);
  }

  async function selectTarget(slot: Slot, role: TargetRole, value: string | null) {
    const config = configs.find((item) => item.slot === slot);
    if (!config) return;
    const options = targetOptions(choices[slot], config.targets);
    const selected = value && value !== EMPTY_TARGET
      ? options.find((option) => option.value === value)
      : null;
    if (value !== EMPTY_TARGET && !selected) return;

    const currentPrimary = config.targets[0] ?? null;
    const currentFallback = config.targets[1] ?? null;
    const primaryValue = currentPrimary
      ? targetValue(currentPrimary.connectionId, currentPrimary.modelId)
      : null;
    const fallbackValue = currentFallback
      ? targetValue(currentFallback.connectionId, currentFallback.modelId)
      : null;
    const nextPrimaryValue = role === "primary" ? selected?.value ?? null : primaryValue;
    let nextFallbackValue = role === "fallback" ? selected?.value ?? null : fallbackValue;
    if (!nextPrimaryValue || nextPrimaryValue === nextFallbackValue) nextFallbackValue = null;

    const existingByValue = new Map(config.targets.map((target) => [
      targetValue(target.connectionId, target.modelId),
      target,
    ]));
    const nextValues = [nextPrimaryValue, nextFallbackValue].filter((item): item is string => Boolean(item));
    const inputs = nextValues.map((targetSelection) => {
      const option = options.find((candidate) => candidate.value === targetSelection)!;
      const existing = existingByValue.get(targetSelection);
      return {
        ...(existing ? { targetId: existing.id } : {}),
        connectionId: option.connectionId,
        modelId: option.modelId,
      };
    });

    const key = `select:${slot}`;
    markPending(key, true);
    const result = await replaceAiCapabilityTargets(slot, inputs);
    if (!result.ok) {
      toast.error(actionError(result.error.code));
    } else {
      await load();
      toast.success(t("settings.capabilitySlots.saved"));
    }
    markPending(key, false);
  }

  async function saveEffort(value: string | null) {
    if (!value) return;
    setPending((current) => ({ ...current, effort: true }));
    try {
      await setConfigValue("assistant.effort", value);
      setEffort(value);
      toast.success(t("settings.assistantCapability.updated"));
    } catch {
      toast.error(t("settings.capabilitySlots.error.capability_operation_failed"));
    } finally {
      setPending((current) => ({ ...current, effort: false }));
    }
  }

  async function saveHistoryTurns(value: string) {
    const normalized = normalizeAssistantHistoryTurns(Number(value));
    setHistoryTurns(String(normalized));
    setPending((current) => ({ ...current, historyTurns: true }));
    try {
      await setConfigValue("assistant.historyTurns", normalized);
      toast.success(t("settings.assistantCapability.updated"));
    } catch {
      toast.error(t("settings.capabilitySlots.error.capability_operation_failed"));
    } finally {
      setPending((current) => ({ ...current, historyTurns: false }));
    }
  }

  if (loading) {
    return (
      <section className="relative h-44 rounded-lg border bg-card" aria-label={t("common.loading")}>
        <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="capability-slots-title">
      <div className="flex items-start gap-3 border-t pt-4">
        <div className="mt-0.5 rounded-md border bg-muted/40 p-1.5"><Route className="size-4" aria-hidden /></div>
        <div className="min-w-0">
          <h2 id="capability-slots-title" className="text-sm font-semibold">{t("settings.capabilitySlots.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("settings.capabilitySlots.desc")}</p>
        </div>
      </div>

      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-6 text-sm text-destructive">
          <span>{t("settings.capabilitySlots.loadFailed")}</span>
          <Button variant="outline" onClick={() => void load()}>{t("settings.aiTools.retry")}</Button>
        </div>
      ) : SLOT_META.map(({ slot, icon: Icon, desc }) => {
        const config = configs.find((item) => item.slot === slot);
        const targets = config?.targets ?? [];
        const options = targetOptions(choices[slot], targets);
        const primaryValue = targets[0] ? targetValue(targets[0].connectionId, targets[0].modelId) : EMPTY_TARGET;
        const fallbackValue = targets[1] ? targetValue(targets[1].connectionId, targets[1].modelId) : EMPTY_TARGET;
        const recent = diagnostics.find((attempt) => attempt.slot === slot);
        const migrationWarning = config && config.migrationStatus !== "complete" && config.migrationStatus !== "defaulted" && config.migrationStatus !== "missing";
        return (
          <article key={slot} className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <div className="flex min-w-0 gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">{t(`settings.capabilitySlots.${slot}` as never)}</h3>
                  <p className="text-xs text-muted-foreground">{t(`settings.capabilitySlots.${desc}` as never)}</p>
                </div>
              </div>
            </div>

            {migrationWarning && (
              <div className="flex gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">
                <CircleAlert className="size-4 shrink-0" aria-hidden />
                <span>{t("settings.capabilitySlots.migrationUnmapped")}</span>
              </div>
            )}

            <div className="grid px-4 py-4 md:grid-cols-2 md:divide-x">
              {(["primary", "fallback"] as const).map((role) => {
                const value = role === "primary" ? primaryValue : fallbackValue;
                const selectedOption = options.find((option) => option.value === value);
                const reason = value === EMPTY_TARGET ? null : unavailableReason(selectedOption);
                const oppositeValue = role === "primary" ? fallbackValue : primaryValue;
                return (
                  <div
                    key={role}
                    className={role === "primary"
                      ? "min-w-0 pb-4 md:pr-4 md:pb-0"
                      : "min-w-0 border-t pt-4 md:border-t-0 md:pt-0 md:pl-4"}
                  >
                    <div className="mb-2">
                      <Label htmlFor={`${slot}-${role}`}>{t(`settings.capabilitySlots.${role}` as never)}</Label>
                      <p className="text-[11px] text-muted-foreground">
                        {t(`settings.capabilitySlots.${role}Desc` as never)}
                      </p>
                    </div>
                    <Select
                      value={value}
                      onValueChange={(nextValue) => void selectTarget(slot, role, nextValue)}
                      disabled={pending[`select:${slot}`] || (role === "fallback" && primaryValue === EMPTY_TARGET)}
                    >
                      <SelectTrigger id={`${slot}-${role}`} className="w-full">
                        <span className="truncate">
                          {selectedOption
                            ? optionLabel(selectedOption, t("settings.capabilitySlots.cliDefaultModel"))
                            : role === "primary"
                              ? t("settings.capabilitySlots.selectPrimary")
                              : t("settings.capabilitySlots.noFallback")}
                        </span>
                      </SelectTrigger>
                      <SelectContent className="max-w-[calc(100vw-2rem)] sm:max-w-xl">
                        <SelectItem value={EMPTY_TARGET}>
                          {role === "primary"
                            ? t("settings.capabilitySlots.unconfigured")
                            : t("settings.capabilitySlots.noFallback")}
                        </SelectItem>
                        {options
                          .filter((option) => option.enabled || option.value === value)
                          .map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              disabled={option.value === oppositeValue}
                            >
                              {optionLabel(option, t("settings.capabilitySlots.cliDefaultModel"))}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {selectedOption && (
                      <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                        {selectedOption.kind.toUpperCase()} · {t(`settings.aiTools.status.${selectedOption.testStatus}` as never)}
                      </p>
                    )}
                    {reason && (
                      <p className="mt-1.5 flex items-center gap-1 text-xs text-destructive">
                        <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                        {t(`settings.capabilitySlots.diagnostic.${reason}` as never)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {slot === "assistant" && (
              <div className="divide-y border-t bg-muted/20 px-4">
                <div className="flex min-w-0 flex-wrap items-center gap-3 py-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <Label htmlFor="assistant-effort">{t("settings.assistantCapability.effort")}</Label>
                    <p className="text-[11px] text-muted-foreground">{t("settings.assistantCapability.effortDesc")}</p>
                  </div>
                  <Select value={effort} onValueChange={(value) => void saveEffort(value)} disabled={pending.effort}>
                    <SelectTrigger id="assistant-effort" className="w-full sm:w-44">
                      <span className="truncate">{t(`settings.assistantCapability.effort${effort[0]?.toUpperCase()}${effort.slice(1)}` as never)}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {EFFORT_OPTIONS.map((option) => <SelectItem key={option} value={option}>{t(`settings.assistantCapability.effort${option[0].toUpperCase()}${option.slice(1)}` as never)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-3 py-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <Label htmlFor="assistant-history-turns">{t("settings.assistantCapability.historyTurns")}</Label>
                    <p className="text-[11px] text-muted-foreground">{t("settings.assistantCapability.historyTurnsDesc")}</p>
                  </div>
                  <Input
                    id="assistant-history-turns"
                    type="number"
                    min={MIN_ASSISTANT_HISTORY_TURNS}
                    max={MAX_ASSISTANT_HISTORY_TURNS}
                    step={1}
                    value={historyTurns}
                    disabled={pending.historyTurns}
                    onChange={(event) => setHistoryTurns(event.target.value)}
                    onBlur={(event) => void saveHistoryTurns(event.currentTarget.value)}
                    className="w-full sm:w-44"
                  />
                </div>
              </div>
            )}

            {recent && (
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" aria-hidden />{t("settings.capabilitySlots.recentAttempt")}</span>
                <span>{recent.result}</span>
                <span>{recent.durationMs} ms</span>
                {recent.errorCode && <span className="break-all text-destructive">{recent.errorCode}</span>}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
