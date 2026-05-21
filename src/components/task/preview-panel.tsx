"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@iconify/react";
import {
  RefreshCw,
  Terminal,
  Loader2,
  Eye,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  getPreviewState,
  startPreview,
  stopPreview,
  installPreviewDeps,
  redetectPreset,
  setProjectPreset,
  setProjectDefaults,
  openInTerminal,
} from "@/actions/preview-actions";
import { getActualWsPort } from "@/actions/config-actions";
import { updateTask } from "@/actions/task-actions";
import { PreviewLogDrawer } from "./preview-log-drawer";
import { StopPreviewConfirmDialog } from "./stop-preview-confirm-dialog";

// xterm 在模块加载期访问 window —— 必须 ssr: false
const PreviewLogTerminal = dynamic(
  () =>
    import("./preview-log-terminal").then((m) => m.PreviewLogTerminal),
  { ssr: false },
);
import { PRESETS } from "@/lib/preview/presets";
import type { EffectiveSource } from "@/lib/preview/preview-key";
import { PREVIEW_TASK_ID } from "@/lib/preview/ws-constants";

export interface PreviewPanelProps {
  taskId: string;
  projectId: string;
  worktreePath: string | null;
  projectLocalPath: string | null;
  refreshKey: number;
  previewUrl?: string;
  onPreviewUrlChange?: (url: string) => void;
}

type StateSnapshot = Awaited<ReturnType<typeof getPreviewState>>;

export function PreviewPanel({
  taskId,
  projectId,
  worktreePath,
  projectLocalPath,
  refreshKey,
  previewUrl,
  onPreviewUrlChange,
}: PreviewPanelProps) {
  const { t } = useI18n();
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [userToggledAt, setUserToggledAt] = useState<number | null>(null);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [addressInput, setAddressInput] = useState(previewUrl ?? "");
  const [iframeUrl, setIframeUrl] = useState(previewUrl ?? "");
  const [manualRefreshKey, setManualRefreshKey] = useState(0);
  const [urlHistory, setUrlHistory] = useState<string[]>(
    previewUrl ? [previewUrl] : [],
  );
  const [historyIndex, setHistoryIndex] = useState(previewUrl ? 0 : -1);

  const navigateTo = useCallback(
    (url: string) => {
      if (!url || url === iframeUrl) return;
      setUrlHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex + 1);
        trimmed.push(url);
        return trimmed;
      });
      setHistoryIndex((i) => i + 1);
      setAddressInput(url);
      setIframeUrl(url);
      onPreviewUrlChange?.(url);
    },
    [historyIndex, iframeUrl, onPreviewUrlChange],
  );

  const goBack = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const url = urlHistory[newIndex];
    setHistoryIndex(newIndex);
    setAddressInput(url);
    setIframeUrl(url);
    onPreviewUrlChange?.(url);
  }, [historyIndex, urlHistory, onPreviewUrlChange]);

  const goForward = useCallback(() => {
    if (historyIndex >= urlHistory.length - 1) return;
    const newIndex = historyIndex + 1;
    const url = urlHistory[newIndex];
    setHistoryIndex(newIndex);
    setAddressInput(url);
    setIframeUrl(url);
    onPreviewUrlChange?.(url);
  }, [historyIndex, urlHistory, onPreviewUrlChange]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < urlHistory.length - 1;

  const cwd = worktreePath ?? projectLocalPath;

  // Initial state fetch
  useEffect(() => {
    if (!cwd) return;
    void getPreviewState({ taskId, projectId, worktreePath }).then(setState);
  }, [taskId, projectId, worktreePath, cwd]);

  // WS state subscription
  useEffect(() => {
    if (!state?.previewKey || state.previewKey === "no-cwd") return;
    let ws: WebSocket | null = null;
    let aborted = false;
    void (async () => {
      const wsPort = await getActualWsPort();
      if (aborted) return;
      const params = new URLSearchParams({
        taskId: PREVIEW_TASK_ID,
        role: "state",
        previewKey: state.previewKey,
        connectionId: crypto.randomUUID(),
        clientTaskId: taskId,
      });
      ws = new WebSocket(`ws://localhost:${wsPort}/?${params.toString()}`);
      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(String(e.data)) as {
            type: string;
            state: Partial<StateSnapshot>;
          };
          if (frame.type === "state") {
            setState((prev) => (prev ? { ...prev, ...frame.state } : prev));
          }
        } catch {
          // ignore
        }
      };
    })();
    return () => {
      aborted = true;
      ws?.close();
    };
  }, [state?.previewKey, taskId]);

  // Auto expand/collapse logic
  useEffect(() => {
    if (!state) return;
    const lockMs = 30_000;
    if (userToggledAt && Date.now() - userToggledAt < lockMs) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (state.status === "starting" || state.status === "installing") {
      setDrawerExpanded(true);
    } else if (state.status === "running") {
      timer = setTimeout(() => {
        if (!userToggledAt || Date.now() - userToggledAt > lockMs) {
          setDrawerExpanded(false);
        }
      }, 3000);
    } else if (state.status === "error") {
      setDrawerExpanded(true);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [state?.status, userToggledAt]);

  // Sync iframe URL when state.url changes (preview start auto-injects URL)
  useEffect(() => {
    if (state?.url && state.url !== iframeUrl) {
      navigateTo(state.url);
    }
  }, [state?.url, iframeUrl, navigateTo]);

  const refresh = useCallback(async () => {
    const fresh = await getPreviewState({ taskId, projectId, worktreePath });
    setState(fresh);
  }, [taskId, projectId, worktreePath]);

  // Fallback poll — protects against WS broadcasts being lost during the
  // tight window between session creation and a fast process exit. Only
  // runs while we're in a "waiting" state; the poll naturally stops as
  // soon as the server reports running/error/stopped.
  useEffect(() => {
    const s = state?.status;
    if (s !== "starting" && s !== "installing" && s !== "stopping") return;
    const interval = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(interval);
  }, [state?.status, refresh]);

  // Empty state — no cwd
  if (!cwd) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Eye className="size-10 text-muted-foreground/40" />
        <h3 className="text-sm font-medium text-foreground">
          {t("preview.noWorktree")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("preview.noLocalPath")}
        </p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  async function handleRun() {
    setState((s) => (s ? { ...s, status: "starting" } : s));
    const r = await startPreview({ taskId, projectId, worktreePath });
    if (!r.started && r.error) {
      setState((s) =>
        s ? { ...s, status: "error", errorMessage: r.error ?? null } : s,
      );
    }
  }

  async function handleStop() {
    if (!state) return;
    const otherTabs = state.activeSubscribers - 1;
    if (otherTabs > 0) {
      setStopDialogOpen(true);
    } else {
      await stopPreview({ previewKey: state.previewKey });
      await refresh();
    }
  }

  async function confirmStop() {
    setStopDialogOpen(false);
    if (state) {
      await stopPreview({ previewKey: state.previewKey });
      await refresh();
    }
  }

  async function handleInstall() {
    await installPreviewDeps({
      taskId,
      projectId,
      worktreePath,
      autoStartAfter: true,
    });
  }

  async function handleReDetect() {
    await redetectPreset({ projectId, worktreePath });
    await refresh();
  }

  async function handlePresetSelect(presetId: string | null) {
    await setProjectPreset({ projectId, presetId });
    await refresh();
  }

  async function handleCommandBlur(newCommand: string) {
    if (!state) return;
    if (newCommand === state.command) return;
    await updateTask(taskId, {
      previewCommandOverride: newCommand || null,
    });
    await refresh();
  }

  async function handlePortBlur(newPort: number) {
    if (!state) return;
    if (newPort === state.port) return;
    await updateTask(taskId, {
      previewPortOverride: newPort || null,
    });
    await refresh();
  }

  async function handleSyncToProject() {
    if (!state) return;
    const updates: { command?: string | null; port?: number | null } = {};
    if (state.commandSource === "task") updates.command = state.command;
    if (state.portSource === "task") updates.port = state.port;
    if (Object.keys(updates).length === 0) return;
    await setProjectDefaults({ projectId, ...updates });
    await updateTask(taskId, {
      previewCommandOverride: null,
      previewPortOverride: null,
    });
    await refresh();
  }

  async function handleResetCurrentLevel() {
    if (!state) return;
    const hasTask =
      state.commandSource === "task" || state.portSource === "task";
    const hasProject =
      state.commandSource === "project" || state.portSource === "project";
    if (hasTask) {
      await updateTask(taskId, {
        previewCommandOverride: null,
        previewPortOverride: null,
      });
    } else if (hasProject) {
      await setProjectDefaults({ projectId, command: null, port: null });
    }
    await refresh();
  }

  const showInstallBanner =
    state.installed === false &&
    !!state.installCommand &&
    state.status === "stopped";

  return (
    <div className="flex h-full flex-col">
      {/* Row 1: config — preset · command · port · level · sync · reset · run · terminal */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <PresetBadge
          presetId={state.preset?.id ?? null}
          presetName={state.preset?.name ?? null}
          presetIcon={state.preset?.icon ?? null}
          onReDetect={handleReDetect}
          onSelect={handlePresetSelect}
        />
        <CommandInput value={state.command} onBlur={handleCommandBlur} />
        <PortInput value={state.port} onBlur={handlePortBlur} />
        <ConfigLevelIndicator
          commandSource={state.commandSource}
          portSource={state.portSource}
        />
        {(state.commandSource === "task" || state.portSource === "task") && (
          <Button
            variant="outline"
            onClick={handleSyncToProject}
            title={t("preview.syncToProjectHint")}
            className="h-8 shrink-0 px-2 text-xs"
          >
            {t("preview.syncToProject")}
          </Button>
        )}
        {(state.commandSource !== "preset" || state.portSource !== "preset") && (
          <Button
            variant="ghost"
            onClick={handleResetCurrentLevel}
            title={
              state.commandSource === "task" || state.portSource === "task"
                ? t("preview.resetCurrentTaskHint")
                : t("preview.resetCurrentProjectHint")
            }
            className="h-8 shrink-0 gap-1.5 rounded border border-border px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
            <span>{t("preview.resetCurrent")}</span>
          </Button>
        )}
        {state.status === "running" ? (
          <Button variant="destructive" onClick={handleStop}>
            {t("preview.stop")}
          </Button>
        ) : state.status === "installing" ? (
          <Button variant="destructive" onClick={handleStop}>
            {t("preview.cancelInstall")}
          </Button>
        ) : state.status === "stopping" ? (
          <Button variant="destructive" disabled>
            <Loader2 className="mr-1 size-3 animate-spin" />
            {t("preview.statusStopping")}
          </Button>
        ) : (
          <Button
            variant="default"
            disabled={state.status === "starting" || !state.command}
            onClick={handleRun}
          >
            {state.status === "starting" && (
              <Loader2 className="mr-1 size-3 animate-spin" />
            )}
            {t("preview.run")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          disabled={!state.cwd}
          onClick={() => {
            if (state.cwd) void openInTerminal(state.cwd);
          }}
          title={t("preview.openTerminal")}
        >
          <Terminal className="size-4" />
        </Button>
      </div>

      {/* Row 2: chrome — status / back / forward / refresh / address */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <StatusPill status={state.status} t={t} />
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          disabled={!canGoBack}
          onClick={goBack}
          title={t("preview.back")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          disabled={!canGoForward}
          onClick={goForward}
          title={t("preview.forward")}
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          onClick={() => {
            if (iframeUrl) setManualRefreshKey((k) => k + 1);
          }}
          title={t("preview.refresh")}
        >
          <RefreshCw className="size-4" />
        </Button>
        <Input
          type="text"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              navigateTo(addressInput);
            }
          }}
          placeholder={t("preview.addressPlaceholder")}
          className="flex-1 rounded-full px-3 font-mono text-xs"
        />
      </div>

      <ProjectDefaultHint state={state} />

      {state.status === "error" && state.errorMessage && (
        <div className="border-b border-border bg-red-500/10 px-3 py-1 text-xs text-red-400">
          {state.errorMessage}
        </div>
      )}

      {/* iframe (or empty state when no URL) */}
      <div className="flex-1 overflow-hidden">
        {iframeUrl ? (
          <iframe
            key={`${refreshKey}-${manualRefreshKey}`}
            src={iframeUrl}
            className="size-full border-0"
            allow="clipboard-read; clipboard-write"
            referrerPolicy="no-referrer-when-downgrade"
            title="Preview"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <Eye className="size-12 text-muted-foreground/30" />
            <h3 className="text-sm font-medium text-foreground">
              {t("preview.previewEmpty")}
            </h3>
            <p className="max-w-xs text-xs text-muted-foreground">
              {t("preview.previewEmptyHint")}
            </p>
          </div>
        )}
      </div>

      {(state.status !== "stopped" ||
        state.recentLogs.length > 0 ||
        showInstallBanner) && (
        <PreviewLogDrawer
          expanded={drawerExpanded}
          latestLogLine={state.recentLogs[state.recentLogs.length - 1] ?? ""}
          onToggle={() => {
            setDrawerExpanded((v) => !v);
            setUserToggledAt(Date.now());
          }}
          showInstallBanner={showInstallBanner}
          onInstallNow={handleInstall}
          onRunAnyway={handleRun}
          terminalSlot={
            drawerExpanded &&
            state.previewKey &&
            state.previewKey !== "no-cwd" ? (
              <PreviewLogTerminal
                previewKey={state.previewKey}
                taskId={taskId}
              />
            ) : null
          }
        />
      )}

      <StopPreviewConfirmDialog
        open={stopDialogOpen}
        otherTabsCount={state.activeSubscribers - 1}
        onConfirm={confirmStop}
        onCancel={() => setStopDialogOpen(false)}
      />
    </div>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: string;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}) {
  const cls =
    status === "running"
      ? "text-emerald-400 bg-emerald-500/10"
      : status === "error"
        ? "text-red-400 bg-red-500/10"
        : status === "installing" || status === "stopping"
          ? "text-blue-400 bg-blue-500/10"
          : "text-muted-foreground bg-muted";
  const labelKey =
    status === "running"
      ? "preview.statusRunning"
      : status === "starting"
        ? "preview.statusStarting"
        : status === "error"
          ? "preview.statusError"
          : status === "installing"
            ? "preview.statusInstalling"
            : status === "stopping"
              ? "preview.statusStopping"
              : "preview.statusStopped";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${cls}`}
    >
      {t(labelKey as TranslationKey)}
    </span>
  );
}

function PresetBadge({
  presetId,
  presetName,
  presetIcon,
  onReDetect,
  onSelect,
}: {
  presetId: string | null;
  presetName: string | null;
  presetIcon: string | null;
  onReDetect: () => void;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <Select
      value={presetId ?? ""}
      onValueChange={(v) => {
        if (v === "__redetect") onReDetect();
        else if (v === "__clear") onSelect(null);
        else onSelect(v || null);
      }}
    >
      <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
        <span className="flex items-center gap-1.5">
          {presetIcon ? <Icon icon={presetIcon} className="size-4" /> : null}
          <span>{presetName ?? t("preview.presetUnknown")}</span>
        </span>
      </SelectTrigger>
      <SelectContent className="min-w-[220px]">
        {PRESETS.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex items-center gap-1.5">
              <Icon icon={p.icon} className="size-4" />
              <span>{p.name}</span>
            </span>
          </SelectItem>
        ))}
        <SelectItem value="__redetect">
          {t("preview.presetReDetect")}
        </SelectItem>
        <SelectItem value="__clear">{t("preview.presetClear")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ProjectDefaultHint({ state }: { state: StateSnapshot }) {
  const { t } = useI18n();
  const hasOverride =
    state.commandSource === "task" || state.portSource === "task";
  if (!hasOverride) return null;

  const fallbackCmd =
    state.projectDefaultCommand ?? state.presetCommand ?? "—";
  const fallbackPort =
    state.projectDefaultPort ?? state.presetPort ?? null;

  return (
    <div className="border-b border-border bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
      <span className="font-medium">{t("preview.projectDefaultHint")}:</span>{" "}
      <span className="font-mono">{fallbackCmd}</span>
      {fallbackPort !== null && (
        <>
          {" · "}
          <span className="font-mono">{fallbackPort}</span>
        </>
      )}
    </div>
  );
}

function CommandInput({
  value,
  onBlur,
}: {
  value: string;
  onBlur: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <Input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onBlur(local)}
      placeholder="pnpm dev"
      title={local}
      className="min-w-[260px] flex-1 font-mono text-xs"
    />
  );
}

function PortInput({
  value,
  onBlur,
}: {
  value: number;
  onBlur: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  return (
    <Input
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onBlur(parseInt(local, 10) || 0)}
      className="w-20 font-mono text-xs"
    />
  );
}

function ConfigLevelIndicator({
  commandSource,
  portSource,
}: {
  commandSource: EffectiveSource;
  portSource: EffectiveSource;
}) {
  const { t } = useI18n();
  // 合并 source：task > project > preset
  const active: "preset" | "task" | "project" =
    commandSource === "task" || portSource === "task"
      ? "task"
      : commandSource === "project" || portSource === "project"
        ? "project"
        : "preset";

  const segments: Array<{
    key: "preset" | "task" | "project";
    label: string;
    activeClass: string;
  }> = [
    {
      key: "preset",
      label: t("preview.sourcePreset"),
      activeClass: "bg-muted text-foreground",
    },
    {
      key: "task",
      label: t("preview.sourceTask"),
      activeClass: "bg-amber-500/15 text-amber-500",
    },
    {
      key: "project",
      label: t("preview.sourceProject"),
      activeClass: "bg-muted text-foreground",
    },
  ];

  return (
    <span className="flex h-8 shrink-0 items-center divide-x divide-border overflow-hidden rounded border border-border text-[10px] font-medium">
      {segments.map((seg) => (
        <span
          key={seg.key}
          title={
            seg.key === "task"
              ? t("preview.sourceTaskTip")
              : seg.key === "project"
                ? t("preview.sourceProjectTip")
                : t("preview.sourcePresetTip")
          }
          className={`px-2 py-1.5 ${active === seg.key ? seg.activeClass : "text-muted-foreground/50"}`}
        >
          {seg.label}
        </span>
      ))}
    </span>
  );
}
