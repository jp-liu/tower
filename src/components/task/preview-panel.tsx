"use client";

import { useState, useEffect, useRef } from "react";
import { Eye, Loader2, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { startPreview, stopPreview, openInTerminal } from "@/actions/preview-actions";
import { updateProject } from "@/actions/workspace-actions";

export interface PreviewPanelProps {
  taskId: string;
  worktreePath: string | null;
  previewCommand: string | null;
  previewPort: number | null;
  refreshKey: number;
  projectId: string;
  previewUrl?: string;
  onPreviewUrlChange?: (url: string) => void;
}

type ServerStatus = "stopped" | "starting" | "running" | "error";

const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn"] as const;

function parseCommand(cmd: string | null): { pm: string; script: string } {
  if (!cmd) return { pm: "pnpm", script: "dev" };
  const parts = cmd.trim().split(/\s+/);
  const pm = PACKAGE_MANAGERS.includes(parts[0] as (typeof PACKAGE_MANAGERS)[number]) ? parts[0] : "pnpm";
  // Skip "run" if present: "pnpm run dev" → script = "dev"
  const rest = parts.slice(1);
  const script = rest[0] === "run" ? (rest[1] ?? "dev") : (rest[0] ?? "dev");
  return { pm, script };
}

function getStatusClass(status: ServerStatus): string {
  switch (status) {
    case "running":
      return "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20";
    case "error":
      return "text-red-400 bg-red-500/10 border border-red-500/20";
    default:
      return "text-muted-foreground bg-muted border border-transparent";
  }
}

function StatusIcon({ status }: { status: ServerStatus }) {
  if (status === "running") return <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />;
  if (status === "error") return <span className="h-1.5 w-1.5 rounded-full bg-red-400 inline-block" />;
  if (status === "starting") return <Loader2 className="h-3 w-3 animate-spin inline-block" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 inline-block" />;
}

export function PreviewPanel({
  taskId,
  worktreePath,
  previewCommand,
  previewPort,
  refreshKey,
  projectId,
  previewUrl,
  onPreviewUrlChange,
}: PreviewPanelProps) {
  const { t } = useI18n();

  const [serverStatus, setServerStatus] = useState<ServerStatus>("stopped");
  const [errorMsg, setErrorMsg] = useState("");
  const [addressInput, setAddressInput] = useState(previewUrl ?? "");
  const [iframeUrl, setIframeUrl] = useState(previewUrl ?? "");
  const [manualRefreshKey, setManualRefreshKey] = useState(0);

  // Structured config
  const parsed = parseCommand(previewCommand);
  const [pm, setPm] = useState(parsed.pm);
  const [script, setScript] = useState(parsed.script);
  const [port, setPort] = useState(previewPort ?? 5173);

  useEffect(() => {
    const p = parseCommand(previewCommand);
    setPm(p.pm);
    setScript(p.script);
  }, [previewCommand]);

  useEffect(() => {
    if (previewPort != null) setPort(previewPort);
  }, [previewPort]);

  // Sync parent URL on mount
  useEffect(() => {
    if (previewUrl) {
      setAddressInput(previewUrl);
      setIframeUrl(previewUrl);
    }
  }, [previewUrl]);

  // Auto-stop on unmount
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;
  useEffect(() => {
    return () => { stopPreview(taskIdRef.current).catch(() => {}); };
  }, []);

  const statusLabel = (() => {
    switch (serverStatus) {
      case "running": return t("preview.statusRunning");
      case "starting": return t("preview.statusStarting");
      case "error": return t("preview.statusError");
      default: return t("preview.statusStopped");
    }
  })();

  const fullCommand = `${pm} ${script}`;

  async function saveConfig() {
    await updateProject(projectId, {
      previewCommand: fullCommand,
      previewPort: port,
    });
  }

  async function handleRun() {
    if (!worktreePath || !script) return;
    setServerStatus("starting");
    setErrorMsg("");
    try {
      await saveConfig();
      const result = await startPreview(taskId, fullCommand, worktreePath);
      if (result.started) {
        setServerStatus("running");
        if (!addressInput) {
          const url = `http://localhost:${port}`;
          setAddressInput(url);
          setIframeUrl(url);
          onPreviewUrlChange?.(url);
        }
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
      onPreviewUrlChange?.(addressInput);
    }
  }

  async function handleOpenTerminal() {
    if (!worktreePath) return;
    try {
      await openInTerminal(worktreePath);
    } catch {
      setServerStatus("error");
      setErrorMsg(t("preview.terminalError"));
    }
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
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${getStatusClass(serverStatus)}`}>
          <StatusIcon status={serverStatus} />
          {statusLabel}
        </span>

        {serverStatus === "running" ? (
          <Button variant="destructive" onClick={handleStop}>{t("preview.stop")}</Button>
        ) : (
          <Button
            variant="default"
            disabled={serverStatus === "starting" || !script || !worktreePath}
            onClick={handleRun}
          >
            {serverStatus === "starting" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {t("preview.run")}
          </Button>
        )}

        <div className="flex-1" />

        <Button variant="ghost" size="icon" className="h-8 w-8" title={t("preview.refresh")}
          onClick={() => { if (iframeUrl) setManualRefreshKey((k) => k + 1); }}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" title={t("preview.openTerminal")}
          disabled={!worktreePath} onClick={handleOpenTerminal}>
          <Terminal className="h-4 w-4" />
        </Button>
      </div>

      {serverStatus === "error" && errorMsg && (
        <div className="border-b border-border bg-red-500/10 px-3 py-1 text-xs text-red-400">
          {t("preview.errorDesc")}: {errorMsg}
        </div>
      )}

      {/* Config row: PM + Script + Port */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-1.5">
        {/* Package manager */}
        <Select value={pm} onValueChange={(v) => { if (v) { setPm(v); setTimeout(saveConfig, 0); } }}>
          <SelectTrigger className="h-7 w-auto min-w-[80px] text-xs">
            <span>{pm}</span>
          </SelectTrigger>
          <SelectContent>
            {PACKAGE_MANAGERS.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Script */}
        <span className="text-xs text-muted-foreground">run</span>
        <input
          type="text"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          onBlur={saveConfig}
          placeholder="dev"
          className="h-7 w-24 rounded border border-border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />

        {/* Port */}
        <span className="text-xs text-muted-foreground">{t("preview.port")}</span>
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
          onBlur={saveConfig}
          placeholder="5173"
          className="h-7 w-20 rounded border border-border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Address bar */}
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

      {/* iframe */}
      <div className="flex-1 overflow-hidden">
        <iframe
          key={`${refreshKey}-${manualRefreshKey}`}
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
