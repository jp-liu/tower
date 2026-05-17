"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@iconify/react";
import { RefreshCw, Terminal, Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  // Sync iframe URL when state.url changes
  useEffect(() => {
    if (state?.url && state.url !== iframeUrl) {
      setAddressInput(state.url);
      setIframeUrl(state.url);
      onPreviewUrlChange?.(state.url);
    }
  }, [state?.url, iframeUrl, onPreviewUrlChange]);

  const refresh = useCallback(async () => {
    const fresh = await getPreviewState({ taskId, projectId, worktreePath });
    setState(fresh);
  }, [taskId, projectId, worktreePath]);

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

  const showInstallBanner =
    state.installed === false &&
    !!state.installCommand &&
    state.status === "stopped";

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <StatusPill status={state.status} t={t} />
        <PresetBadge
          presetId={state.preset?.id ?? null}
          presetName={state.preset?.name ?? null}
          presetIcon={state.preset?.icon ?? null}
          onReDetect={handleReDetect}
          onSelect={handlePresetSelect}
        />
        {state.status === "running" ? (
          <Button variant="destructive" onClick={handleStop}>
            {t("preview.stop")}
          </Button>
        ) : state.status === "installing" ? (
          <Button variant="destructive" onClick={handleStop}>
            {t("preview.cancelInstall")}
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
        <CommandInput value={state.command} onBlur={handleCommandBlur} />
        <PortInput value={state.port} onBlur={handlePortBlur} />
        <input
          type="text"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setIframeUrl(addressInput);
              onPreviewUrlChange?.(addressInput);
            }
          }}
          placeholder="http://localhost:5173"
          className="h-8 flex-1 rounded border border-border bg-background px-2 text-xs font-mono"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (iframeUrl) setManualRefreshKey((k) => k + 1);
          }}
          title={t("preview.refresh")}
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={!worktreePath}
          onClick={() => {
            if (worktreePath) void openInTerminal(worktreePath);
          }}
        >
          <Terminal className="size-4" />
        </Button>
      </div>

      {state.status === "error" && state.errorMessage && (
        <div className="border-b border-border bg-red-500/10 px-3 py-1 text-xs text-red-400">
          {state.errorMessage}
        </div>
      )}

      {/* iframe */}
      <div className="flex-1 overflow-hidden">
        <iframe
          key={`${refreshKey}-${manualRefreshKey}`}
          src={iframeUrl || undefined}
          className="size-full border-0"
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
          title="Preview"
        />
      </div>

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
        : status === "installing"
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
    <input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onBlur(local)}
      placeholder="pnpm dev"
      className="h-8 w-44 rounded border border-border bg-background px-2 text-xs font-mono"
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
    <input
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onBlur(parseInt(local, 10) || 0)}
      className="h-8 w-20 rounded border border-border bg-background px-2 text-xs font-mono"
    />
  );
}
