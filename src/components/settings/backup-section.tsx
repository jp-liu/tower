"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { FolderBrowserDialog } from "@/components/layout/folder-browser-dialog";
import {
  Download,
  Upload,
  FolderUp,
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
import { getStorageLocation, setStorageLocation, type StorageLocation } from "@/actions/storage-actions";

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
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [storageLoc, setStorageLoc] = useState<StorageLocation | null>(null);
  const [showStorageBrowser, setShowStorageBrowser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState<string | null>(null);

  // Create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset dialog
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetInput, setResetInput] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [list, dir, storage] = await Promise.all([
        listBackupFiles(),
        getBackupDir(),
        getStorageLocation(),
      ]);
      setBackups(list);
      setBackupDirState(dir);
      setStorageLoc(storage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    const label = createLabel.trim() || undefined;
    setShowCreateDialog(false);
    setCreateLabel("");
    setOperating("create");
    try {
      await createBackup(label);
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

  const handleSelectDir = async (path: string) => {
    setShowFolderBrowser(false);
    try {
      await setBackupDir(path);
      setBackupDirState(path);
      toast.success(t("settings.backup.dirSaved"));
      await loadData();
    } catch {
      toast.error(t("settings.backup.dirError"));
    }
  };

  const relocateStorage = async (newPath: string) => {
    setOperating("storage");
    try {
      const res = await setStorageLocation({ newPath });
      if (!res.ok) {
        toast.error(res.error || t("settings.storage.moveError"));
        return;
      }
      toast.success(t("settings.storage.moveSuccess", { count: String(res.moved ?? 0) }));
      await loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.storage.moveError"));
    } finally {
      setOperating(null);
    }
  };

  const handleSelectStorageDir = async (path: string) => {
    setShowStorageBrowser(false);
    if (!confirm(t("settings.storage.moveConfirm"))) return;
    await relocateStorage(path);
  };

  const handleResetStorageDir = async () => {
    if (!storageLoc || storageLoc.isDefault) return;
    if (!confirm(t("settings.storage.resetConfirm"))) return;
    await relocateStorage(storageLoc.default);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-selected
    e.target.value = "";

    setOperating("import");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/internal/backup/import", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error === "Invalid backup archive"
          ? t("settings.backup.importInvalid")
          : err.error === "File already exists"
            ? t("settings.backup.importError")
            : t("settings.backup.importError"));
        return;
      }
      toast.success(t("settings.backup.importSuccess"));
      await loadData();
    } catch {
      toast.error(t("settings.backup.importError"));
    } finally {
      setOperating(null);
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
        <h3 className="text-base font-semibold">{t("settings.storage.sectionTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.storage.hint")}</p>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t("settings.storage.current")}:</span>
          <code className="rounded bg-muted px-2 py-0.5 text-xs">{storageLoc?.current ?? "…"}</code>
          {storageLoc?.isDefault && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t("settings.storage.defaultBadge")}
            </span>
          )}
          <Button
            variant="ghost"
            onClick={() => setShowStorageBrowser(true)}
            disabled={operating === "storage"}
            className="text-xs text-muted-foreground"
          >
            {operating === "storage" ? <Loader2 className="h-3 w-3 animate-spin" /> : t("settings.storage.change")}
          </Button>
          {storageLoc && !storageLoc.isDefault && (
            <Button
              variant="ghost"
              onClick={handleResetStorageDir}
              disabled={operating === "storage"}
              className="text-xs text-muted-foreground"
            >
              {t("settings.storage.reset")}
            </Button>
          )}
        </div>

        <FolderBrowserDialog
          open={showStorageBrowser}
          onOpenChange={setShowStorageBrowser}
          onSelect={handleSelectStorageDir}
        />
      </div>

      <div>
        <h3 className="text-base font-semibold">{t("settings.backup.sectionTitle")}</h3>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t("settings.backup.dir")}:</span>
          <code className="rounded bg-muted px-2 py-0.5 text-xs">{backupDir}</code>
          <Button
            variant="ghost"
            onClick={() => setShowFolderBrowser(true)}
            className="text-xs text-muted-foreground"
          >
            {t("settings.backup.dirChange")}
          </Button>
        </div>

        <FolderBrowserDialog
          open={showFolderBrowser}
          onOpenChange={setShowFolderBrowser}
          onSelect={handleSelectDir}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={() => { setCreateLabel(""); setShowCreateDialog(true); }}
          disabled={isDisabled}
          className="gap-2"
        >
          {operating === "create" ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {t("settings.backup.creating")}</>
          ) : (
            <><Download className="h-4 w-4" /> {t("settings.backup.create")}</>
          )}
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                disabled={isDisabled}
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              />
            }
          >
            <FolderUp className="h-4 w-4" />
            {t("settings.backup.import")}
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {t("settings.backup.importHint")}
          </TooltipContent>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tar.gz,.gz"
          className="hidden"
          onChange={handleImport}
        />
      </div>

      {/* Create backup dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settings.backup.create")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.backup.createLabel")}
            </label>
            <Input
              value={createLabel}
              onChange={(e) => setCreateLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder={t("settings.backup.createLabelPlaceholder")}
              className="mt-1.5"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              className="bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/15"
            >
              {t("settings.backup.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backup list */}
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
                    {backup.label ? (
                      <span className="truncate text-sm font-medium text-foreground">{backup.label}</span>
                    ) : (
                      <span className="truncate text-sm font-medium font-mono text-foreground">
                        {backup.filename}
                      </span>
                    )}
                    {backup.autoBackup && (
                      <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500 ring-1 ring-amber-500/20">
                        {t("settings.backup.autoLabel")}
                      </span>
                    )}
                  </div>
                  {backup.label && (
                    <div className="mt-0.5 text-[11px] font-mono text-muted-foreground/60">{backup.filename}</div>
                  )}
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
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleRestore(backup.filename)}
                          disabled={isDisabled}
                          className="text-muted-foreground hover:text-foreground"
                        />
                      }
                    >
                      <Upload className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={4}>{t("settings.backup.restore")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleDelete(backup.filename)}
                          disabled={isDisabled}
                          className="text-muted-foreground hover:text-rose-400"
                        />
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={4}>{t("settings.backup.delete")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Danger zone */}
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

      {/* Reset confirmation dialog */}
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
