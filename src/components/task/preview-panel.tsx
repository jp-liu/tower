"use client";

import { useState, useEffect } from "react";
import { Eye, Loader2, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { startPreview, stopPreview, openInTerminal } from "@/actions/preview-actions";
import { updateProject } from "@/actions/workspace-actions";

export interface PreviewPanelProps {
  taskId: string;
  worktreePath: string | null;
  previewCommand: string | null;       // initial command from project.previewCommand
  refreshKey: number;                  // parent-controlled; increment on editor save (PV-06)
  projectId: string;                   // needed for updateProject when command changes
}

type ServerStatus = "stopped" | "starting" | "running" | "error";

function getStatusClass(status: ServerStatus): string {
  switch (status) {
    case "running":
      return "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20";
    case "error":
      return "text-red-400 bg-red-500/10 border border-red-500/20";
    case "starting":
    case "stopped":
    default:
      return "text-muted-foreground bg-muted border border-transparent";
  }
}

function StatusIcon({ status }: { status: ServerStatus }) {
  if (status === "running") {
    return <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />;
  }
  if (status === "error") {
    return <span className="h-1.5 w-1.5 rounded-full bg-red-400 inline-block" />;
  }
  if (status === "starting") {
    return <Loader2 className="h-3 w-3 animate-spin inline-block" />;
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 inline-block" />;
}

export function PreviewPanel({
  taskId,
  worktreePath,
  previewCommand,
  refreshKey,
  projectId,
}: PreviewPanelProps) {
  const { t } = useI18n();

  const [serverStatus, setServerStatus] = useState<ServerStatus>("stopped");
  const [errorMsg, setErrorMsg] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [iframeUrl, setIframeUrl] = useState("");
  const [commandInput, setCommandInput] = useState("");

  useEffect(() => {
    if (previewCommand) {
      setCommandInput(previewCommand);
    }
  }, [previewCommand]);

  const statusLabel = (() => {
    switch (serverStatus) {
      case "running":
        return t("preview.statusRunning");
      case "starting":
        return t("preview.statusStarting");
      case "error":
        return t("preview.statusError");
      default:
        return t("preview.statusStopped");
    }
  })();

  async function handleRun() {
    if (!worktreePath || !commandInput) return;
    setServerStatus("starting");
    setErrorMsg("");
    try {
      const result = await startPreview(taskId, commandInput, worktreePath);
      if (result.started) {
        setServerStatus("running");
      } else {
        setServerStatus("error");
        setErrorMsg(result.error ?? "");
      }
    } catch (err) {
      setServerStatus("error");
      setErrorMsg(String(err));
    }
  }

  async function handleStop() {
    await stopPreview(taskId);
    setServerStatus("stopped");
  }

  function handleAddressKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      setIframeUrl(addressInput);
    }
  }

  async function handleOpenTerminal() {
    if (!worktreePath) return;
    try {
      await openInTerminal(worktreePath);
    } catch (err) {
      // Log error — no toast library; error shown in console
      console.error(t("preview.terminalError"), err);
    }
  }

  async function handleCommandBlur() {
    await updateProject(projectId, { previewCommand: commandInput });
  }

  // Empty state — no worktree
  if (!worktreePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Eye className="h-10 w-10 text-muted-foreground/40" />
        <h3 className="text-sm font-medium text-foreground">{t("preview.noWorktree")}</h3>
        <p className="text-xs text-muted-foreground">{t("preview.noWorktreeDesc")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar row */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        {/* Status badge */}
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${getStatusClass(serverStatus)}`}
        >
          <StatusIcon status={serverStatus} />
          {statusLabel}
        </span>

        {/* Run / Stop button */}
        {serverStatus === "running" ? (
          <Button variant="destructive" size="sm" onClick={handleStop}>
            {t("preview.stop")}
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            disabled={serverStatus === "starting" || !commandInput || !worktreePath}
            onClick={handleRun}
          >
            {serverStatus === "starting" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            {t("preview.run")}
          </Button>
        )}

        <div className="flex-1" />

        {/* Refresh button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={t("preview.refresh")}
          onClick={() => {
            if (iframeUrl) {
              // refreshKey is parent-controlled; trigger re-render by re-setting iframeUrl
              setIframeUrl((url) => url);
            }
          }}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>

        {/* Open in Terminal button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={t("preview.openTerminal")}
          disabled={!worktreePath}
          onClick={handleOpenTerminal}
        >
          <Terminal className="h-4 w-4" />
        </Button>
      </div>

      {/* Error message (when status === "error") */}
      {serverStatus === "error" && errorMsg && (
        <div className="border-b border-border bg-red-500/10 px-3 py-1 text-xs text-red-400">
          {t("preview.errorDesc")}: {errorMsg}
        </div>
      )}

      {/* Preview command input row */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-1">
        <span className="text-xs text-muted-foreground">{t("project.previewCommand")}:</span>
        <input
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onBlur={handleCommandBlur}
          placeholder={t("project.previewCommandPlaceholder")}
          className="h-7 flex-1 rounded border border-border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Address bar row */}
      <div className="flex shrink-0 items-center border-b border-border bg-background px-3 py-1">
        <input
          type="text"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={handleAddressKeyDown}
          placeholder={t("preview.addressPlaceholder")}
          className="h-8 w-full rounded border border-border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* iframe — fills remaining height */}
      <div className="flex-1 overflow-hidden">
        <iframe
          key={refreshKey}
          src={iframeUrl || undefined}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
          title="Preview"
        />
      </div>
    </div>
  );
}
