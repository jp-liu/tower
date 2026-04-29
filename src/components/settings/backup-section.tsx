"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Download,
  Upload,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Archive,
} from "lucide-react";
import { toast } from "sonner";
import {
  createBackup,
  listBackupFiles,
  deleteBackupFile,
  restoreBackup,
  resetSystem,
  getBackupDir,
  setBackupDir,
} from "@/actions/backup-actions";
import type { BackupInfo } from "@/lib/backup";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string, loc: string): string {
  const l = loc === "zh" ? "zh-CN" : "en-US";
  return new Date(iso).toLocaleString(l, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BackupSection() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupDir, setBackupDirState] = useState("");
  const [editingDir, setEditingDir] = useState(false);
  const [dirInput, setDirInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState<string | null>(null);

  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetInput, setResetInput] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [list, dir] = await Promise.all([listBackupFiles(), getBackupDir()]);
      setBackups(list);
      setBackupDirState(dir);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    setOperating("create");
    try {
      await createBackup();
      toast.success(t("settings.backup.createSuccess"));
      await loadData();
    } catch {
      toast.error(t("settings.backup.createError"));
    } finally {
      setOperating(null);
    }
  };

  const handleRestore = async (filename: string) => {
    if (!confirm(t("settings.backup.restoreConfirm"))) return;
    setOperating("restore");
    try {
      await restoreBackup(filename);
      toast.success(t("settings.backup.restoreSuccess"), {
        action: {
          label: t("settings.backup.reload"),
          onClick: () => window.location.reload(),
        },
        duration: 15000,
      });
      await loadData();
    } catch {
      toast.error(t("settings.backup.restoreError"));
    } finally {
      setOperating(null);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(t("settings.backup.deleteConfirm"))) return;
    try {
      await deleteBackupFile(filename);
      toast.success(t("settings.backup.deleteSuccess"));
      setBackups((prev) => prev.filter((b) => b.filename !== filename));
    } catch {
      toast.error(t("settings.backup.deleteError"));
    }
  };

  const handleSaveDir = async () => {
    try {
      await setBackupDir(dirInput);
      setBackupDirState(dirInput);
      setEditingDir(false);
      toast.success(t("settings.backup.dirSaved"));
      await loadData();
    } catch {
      toast.error(t("settings.backup.dirError"));
    }
  };

  const handleReset = async () => {
    if (resetInput !== "RESET") return;
    setShowResetDialog(false);
    setResetInput("");
    setOperating("reset");
    try {
      await resetSystem("RESET");
      toast.success(t("settings.backup.resetSuccess"));
      router.push("/");
    } catch {
      toast.error(t("settings.backup.resetError"));
    } finally {
      setOperating(null);
    }
  };

  const isDisabled = operating !== null;

  return (
    <div className="space-y-6">
      {(operating === "restore" || operating === "reset") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {operating === "restore" ? t("settings.backup.restoring") : t("settings.backup.resetting")}
            </p>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-base font-semibold">{t("settings.backup.sectionTitle")}</h3>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t("settings.backup.dir")}:</span>
          {editingDir ? (
            <>
              <Input
                value={dirInput}
                onChange={(e) => setDirInput(e.target.value)}
                placeholder={t("settings.backup.dirPlaceholder")}
                className="h-8 w-64"
              />
              <Button variant="outline" onClick={handleSaveDir}>
                {t("common.save")}
              </Button>
              <Button variant="ghost" onClick={() => setEditingDir(false)}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <>
              <code className="rounded bg-muted px-2 py-0.5 text-xs">{backupDir}</code>
              <Button
                variant="ghost"
                onClick={() => { setDirInput(backupDir); setEditingDir(true); }}
                className="text-xs text-muted-foreground"
              >
                {t("settings.backup.dirChange")}
              </Button>
            </>
          )}
        </div>
      </div>

      <Button
        onClick={handleCreate}
        disabled={isDisabled}
        className="gap-2"
      >
        {operating === "create" ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> {t("settings.backup.creating")}</>
        ) : (
          <><Download className="h-4 w-4" /> {t("settings.backup.create")}</>
        )}
      </Button>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : backups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Archive className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t("settings.backup.empty")}</p>
          <p className="text-xs text-muted-foreground/60">{t("settings.backup.emptyDesc")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {backups.map((backup) => (
            <div
              key={backup.filename}
              className="group rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium font-mono text-foreground">
                      {backup.filename}
                    </span>
                    {backup.autoBackup && (
                      <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500 ring-1 ring-amber-500/20">
                        {t("settings.backup.autoLabel")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(backup.size)} · {formatDate(backup.createdAt, locale)}
                  </div>
                  {backup.preview.length > 0 && (
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      {backup.preview.map((p, i) => (
                        <span key={i}>
                          {i > 0 && " "}
                          {p.workspace}({p.projects.join(", ")})
                        </span>
                      ))}
                      {backup.stats.workspaces > backup.preview.length && (
                        <span> {t("settings.backup.workspaces", { count: String(backup.stats.workspaces) })}</span>
                      )}
                    </div>
                  )}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("settings.backup.projects", { count: String(backup.stats.projects) })}
                    {" · "}
                    {t("settings.backup.tasks", { count: String(backup.stats.tasks) })}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleRestore(backup.filename)}
                    disabled={isDisabled}
                    title={t("settings.backup.restore")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(backup.filename)}
                    disabled={isDisabled}
                    title={t("settings.backup.delete")}
                    className="text-muted-foreground hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border pt-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-rose-400">
          <AlertTriangle className="h-4 w-4" />
          {t("settings.backup.dangerZone")}
        </div>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          {t("settings.backup.resetDesc")}
        </p>
        <Button
          variant="outline"
          onClick={() => { setResetInput(""); setShowResetDialog(true); }}
          disabled={isDisabled}
          className="mt-3 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
        >
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
          {t("settings.backup.reset")}
        </Button>
      </div>

      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settings.backup.resetConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("settings.backup.resetConfirmDesc")}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.backup.resetConfirmInput")}
            </label>
            <Input
              value={resetInput}
              onChange={(e) => setResetInput(e.target.value)}
              placeholder="RESET"
              className="mt-1.5 font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={resetInput !== "RESET"}
              onClick={handleReset}
              className="border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
            >
              {t("settings.backup.reset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
