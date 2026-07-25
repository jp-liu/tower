"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  CircleAlert,
  CircleDashed,
  Clock3,
  Loader2,
  Pencil,
  Plus,
  Route,
  Terminal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  addAiCapabilityTarget,
  deleteAiCapabilityTarget,
  getAiCapabilityChoices,
  getAiCapabilityDiagnostics,
  listAiCapabilities,
  reorderAiCapabilityTargets,
  updateAiCapabilityTarget,
} from "@/actions/ai-config-actions";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

const SLOT_META = [
  { slot: "terminal", icon: Terminal, desc: "terminalDesc" },
  { slot: "summary", icon: BookOpen, desc: "summaryDesc" },
  { slot: "dreaming", icon: Brain, desc: "dreamingDesc" },
  { slot: "analysis", icon: BarChart3, desc: "analysisDesc" },
  { slot: "assistant", icon: Bot, desc: "assistantDesc" },
] as const;

const EFFORT_OPTIONS = ["low", "medium", "high"] as const;
const CONNECTIONS_CHANGED_EVENT = "tower:provider-connections-changed";

function IconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={label} {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function unavailableReason(choice: Choice, modelId: string | null) {
  if (!choice.enabled) return "connectionDisabled";
  if (!choice.testOk) return "connectionFailed";
  if (choice.kind === "api" && modelId) {
    const model = choice.models.find((item) => item.modelId === modelId);
    if (!model || !model.available) return "modelUnavailable";
  }
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
  const [editor, setEditor] = useState<null | { slot: Slot; target: Target | null }>(null);
  const [connectionId, setConnectionId] = useState("");
  const [modelId, setModelId] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<null | { slot: Slot; target: Target }>(null);
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

  function openTargetEditor(slot: Slot, target: Target | null) {
    setEditor({ slot, target });
    setConnectionId(target?.connectionId ?? "");
    setModelId(target?.modelId ?? "");
    setEditorError(null);
  }

  const selectedChoice = useMemo(
    () => editor ? choices[editor.slot].find((choice) => choice.id === connectionId) ?? null : null,
    [choices, connectionId, editor],
  );

  async function saveTarget() {
    if (!editor || !connectionId) return;
    if (selectedChoice?.kind === "api" && !modelId.trim()) {
      setEditorError(t("settings.capabilitySlots.apiModelRequired"));
      return;
    }
    const key = `save:${editor.slot}:${editor.target?.id ?? "new"}`;
    markPending(key, true);
    const input = { connectionId, modelId: modelId.trim() || null };
    const result = editor.target
      ? await updateAiCapabilityTarget(editor.slot, editor.target.id, input)
      : await addAiCapabilityTarget(editor.slot, input);
    if (!result.ok) {
      setEditorError(actionError(result.error.code));
      markPending(key, false);
      return;
    }
    setEditor(null);
    await load();
    markPending(key, false);
    toast.success(t("settings.capabilitySlots.saved"));
  }

  async function removeTarget() {
    if (!deleteTarget) return;
    const { slot, target } = deleteTarget;
    setDeleteTarget(null);
    const key = `delete:${target.id}`;
    markPending(key, true);
    const result = await deleteAiCapabilityTarget(slot, target.id);
    if (!result.ok) toast.error(actionError(result.error.code));
    else await load();
    markPending(key, false);
  }

  async function moveTarget(slot: Slot, index: number, direction: -1 | 1) {
    const config = configs.find((item) => item.slot === slot);
    if (!config) return;
    const destination = index + direction;
    if (destination < 0 || destination >= config.targets.length) return;
    const ids = config.targets.map((target) => target.id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    const key = `reorder:${slot}`;
    markPending(key, true);
    const result = await reorderAiCapabilityTargets(slot, ids);
    if (!result.ok) toast.error(actionError(result.error.code));
    else await load();
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
        const recent = diagnostics.find((attempt) => attempt.slot === slot);
        const migrationWarning = config && config.migrationStatus !== "complete" && config.migrationStatus !== "defaulted" && config.migrationStatus !== "missing";
        return (
          <article key={slot} className="overflow-hidden rounded-lg border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:flex-nowrap">
              <div className="flex min-w-0 gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">{t(`settings.capabilitySlots.${slot}` as never)}</h3>
                  <p className="text-xs text-muted-foreground">{t(`settings.capabilitySlots.${desc}` as never)}</p>
                </div>
              </div>
              <Button onClick={() => openTargetEditor(slot, null)}><Plus />{t("settings.capabilitySlots.addTarget")}</Button>
            </div>

            {migrationWarning && (
              <div className="flex gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">
                <CircleAlert className="size-4 shrink-0" aria-hidden />
                <span>{t("settings.capabilitySlots.migrationUnmapped")}</span>
              </div>
            )}

            {targets.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
                <CircleDashed className="size-4" aria-hidden />
                {t("settings.capabilitySlots.unconfigured")}
              </div>
            ) : (
              <ol className="divide-y">
                {targets.map((target, index) => {
                  const choice = choices[slot].find((item) => item.id === target.connectionId);
                  const reason = choice ? unavailableReason(choice, target.modelId) : "connectionMissing";
                  const model = choice?.models.find((item) => item.modelId === target.modelId);
                  return (
                    <li key={target.id} className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-3 sm:flex-nowrap">
                      <Badge variant={index === 0 ? "default" : "outline"}>
                        {index === 0 ? t("settings.capabilitySlots.primary") : `${t("settings.capabilitySlots.fallback")} ${index}`}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="break-words text-sm font-medium">{target.connection.name}</span>
                          <Badge variant="outline">{target.connection.kind.toUpperCase()}</Badge>
                          <Badge variant={target.connection.testOk ? "secondary" : "destructive"}>
                            {t(`settings.aiTools.status.${target.connection.testStatus}` as never)}
                          </Badge>
                        </div>
                        <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                          {target.modelId || t("settings.capabilitySlots.cliDefaultModel")}
                          {model ? ` · ${model.source}` : ""}
                        </p>
                        {reason && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                            <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                            {t(`settings.capabilitySlots.diagnostic.${reason}` as never)}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <IconButton label={t("settings.capabilitySlots.moveUp")} disabled={index === 0 || pending[`reorder:${slot}`]} onClick={() => void moveTarget(slot, index, -1)}><ArrowUp /></IconButton>
                        <IconButton label={t("settings.capabilitySlots.moveDown")} disabled={index === targets.length - 1 || pending[`reorder:${slot}`]} onClick={() => void moveTarget(slot, index, 1)}><ArrowDown /></IconButton>
                        <IconButton label={t("common.edit")} onClick={() => openTargetEditor(slot, target)}><Pencil /></IconButton>
                        <IconButton label={t("common.delete")} disabled={pending[`delete:${target.id}`]} onClick={() => setDeleteTarget({ slot, target })}><Trash2 /></IconButton>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

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

      <Dialog open={editor !== null} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor?.target ? t("settings.capabilitySlots.editTarget") : t("settings.capabilitySlots.addTarget")}</DialogTitle>
            <DialogDescription>{t("settings.capabilitySlots.targetDialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="slot-connection">{t("settings.capabilitySlots.connection")}</Label>
              <Select value={connectionId || null} onValueChange={(value) => { setConnectionId(value ?? ""); setModelId(""); setEditorError(null); }}>
                <SelectTrigger id="slot-connection" className="w-full">
                  <span className="truncate">{selectedChoice ? `${selectedChoice.name} · ${selectedChoice.kind.toUpperCase()} · ${t(`settings.aiTools.status.${selectedChoice.testStatus}` as never)}` : t("settings.capabilitySlots.selectConnection")}</span>
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
                  {editor && choices[editor.slot].map((choice) => (
                    <SelectItem key={choice.id} value={choice.id}>
                      {choice.name} · {choice.kind.toUpperCase()} · {t(`settings.aiTools.status.${choice.testStatus}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editor?.slot === "terminal" && <p className="text-[11px] text-muted-foreground">{t("settings.capabilitySlots.terminalCliOnly")}</p>}
            </div>

            {selectedChoice?.kind === "api" ? (
              <div className="space-y-1.5">
                <Label htmlFor="slot-model">{t("settings.capabilitySlots.model")}</Label>
                <Select value={modelId || null} onValueChange={(value) => setModelId(value ?? "")}>
                  <SelectTrigger id="slot-model" className="w-full">
                    <span className="truncate">{modelId || t("settings.capabilitySlots.selectModel")}</span>
                  </SelectTrigger>
                  <SelectContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
                    {selectedChoice.models.map((model) => (
                      <SelectItem key={model.modelId} value={model.modelId}>
                        {model.modelId} · {model.source} · {model.available ? t("settings.aiTools.available") : t("settings.aiTools.unavailable")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : selectedChoice ? (
              <div className="space-y-1.5">
                <Label htmlFor="slot-cli-model">{t("settings.capabilitySlots.modelOptional")}</Label>
                <Input id="slot-cli-model" value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder={t("settings.capabilitySlots.cliDefaultModel")} className="font-mono" />
              </div>
            ) : null}

            {selectedChoice && unavailableReason(selectedChoice, modelId || null) && (
              <p className="flex gap-2 text-xs text-destructive">
                <CircleAlert className="size-4 shrink-0" aria-hidden />
                {t(`settings.capabilitySlots.diagnostic.${unavailableReason(selectedChoice, modelId || null)}` as never)}
              </p>
            )}
            {editorError && <p className="text-xs text-destructive" role="alert">{editorError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => void saveTarget()} disabled={!connectionId || pending[`save:${editor?.slot}:${editor?.target?.id ?? "new"}`]}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="rounded-lg sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings.capabilitySlots.deleteTarget")}</DialogTitle>
            <DialogDescription>{t("settings.capabilitySlots.deleteTargetConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => void removeTarget()}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
