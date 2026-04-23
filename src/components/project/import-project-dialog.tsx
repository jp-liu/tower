"use client";

import { useState, useCallback } from "react";
import { FolderOpen, AlertCircle, Info, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FolderBrowserDialog } from "@/components/layout/folder-browser-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { resolveGitLocalPath } from "@/actions/config-actions";
import { migrateProjectPath, checkMigrationSafety, analyzeProjectDirectory } from "@/actions/project-actions";

export interface CreateProjectData {
  name: string;
  alias?: string;
  description?: string;
  gitUrl?: string;
  localPath?: string;
  projectType?: "FRONTEND" | "BACKEND";
}

interface ImportProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject?: (data: CreateProjectData) => Promise<{ id: string } | void> | { id: string } | void;
}

export function ImportProjectDialog({
  open,
  onOpenChange,
  onCreateProject,
}: ImportProjectDialogProps) {
  const { t } = useI18n();
  const [projectName, setProjectName] = useState("");
  const [projectAlias, setProjectAlias] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [projectType, setProjectType] = useState<"FRONTEND" | "BACKEND">("FRONTEND");
  const [gitDetected, setGitDetected] = useState(false);

  // Migration state
  const [migrateEnabled, setMigrateEnabled] = useState(false);
  const [targetPath, setTargetPath] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [migrateError, setMigrateError] = useState("");
  const [safetyWarning, setSafetyWarning] = useState("");
  const [isSamePath, setIsSamePath] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const resetForm = () => {
    setProjectName("");
    setProjectAlias("");
    setProjectDesc("");
    setGitUrl("");
    setLocalPath("");
    setProjectType("FRONTEND");
    setGitDetected(false);
    setMigrateEnabled(false);
    setTargetPath("");
    setMigrating(false);
    setMigrateError("");
    setSafetyWarning("");
    setIsSamePath(false);
    setIsAnalyzing(false);
  };

  const handleFolderSelect = async (selectedPath: string) => {
    setLocalPath(selectedPath);
    setGitDetected(false);
    setMigrateEnabled(false);
    setTargetPath("");
    setMigrateError("");
    setSafetyWarning("");
    setIsSamePath(false);

    // Derive default project name from folder basename
    const basename = selectedPath.split("/").filter(Boolean).pop() ?? "";
    setProjectName(basename);

    // Auto-detect git remote
    try {
      const res = await fetch(`/api/git?path=${encodeURIComponent(selectedPath)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.isGit && data.remoteUrl) {
          setGitUrl(data.remoteUrl);
          setGitDetected(true);
          // Use repo name from remote if available
          const repoMatch = data.remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
          if (repoMatch) {
            setProjectName(repoMatch[1]);
          }
        }
      }
    } catch {
      // Not a git repo or path doesn't exist — that's fine
    }
  };

  const handleMigrateToggle = useCallback(async (enabled: boolean) => {
    setMigrateEnabled(enabled);
    setMigrateError("");
    setSafetyWarning("");
    setIsSamePath(false);

    if (!enabled) {
      setTargetPath("");
      return;
    }

    // Derive target path from git URL rules
    if (gitUrl) {
      try {
        const resolved = await resolveGitLocalPath(gitUrl);
        if (resolved) {
          setTargetPath(resolved);
          if (resolved === localPath) {
            setIsSamePath(true);
          }
        }
      } catch {
        // Failed to resolve — leave empty for user to fill
      }
    }

    // Pre-flight safety check: check worktrees in source path via git API
    if (localPath) {
      try {
        const checkRes = await fetch(`/api/git?path=${encodeURIComponent(localPath)}&checkWorktrees=true`);
        if (checkRes.ok) {
          const data = await checkRes.json();
          if (data.hasWorktrees) {
            setSafetyWarning(t("project.worktreeWarning"));
          }
        }
      } catch {
        // Safety check failed — full check runs again at migration time
      }
    }
  }, [gitUrl, localPath]);

  const handleAnalyze = async () => {
    if (!localPath || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeProjectDirectory(localPath.trim());
      setProjectDesc(result);
    } catch {
      toast.error(t("project.analyzeError"));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCreate = async () => {
    if (!projectName.trim()) return;

    const createData: CreateProjectData = {
      name: projectName.trim(),
      alias: projectAlias.trim() || undefined,
      description: projectDesc.trim() || undefined,
      gitUrl: gitUrl.trim() || undefined,
      localPath: localPath.trim() || undefined,
      projectType,
    };

    // Create project first
    const result = await onCreateProject?.(createData);

    // If migration is enabled and we have a project ID
    if (migrateEnabled && targetPath && targetPath !== localPath && result && "id" in result) {
      setMigrating(true);
      setMigrateError("");

      // Run safety check
      const safetyResult = await checkMigrationSafety(result.id);
      if (!safetyResult.safe) {
        setMigrateError(safetyResult.reason);
        setMigrating(false);
        return; // Keep dialog open so user sees the error
      }

      const migrateResult = await migrateProjectPath(result.id, targetPath);
      setMigrating(false);

      if (!migrateResult.success) {
        setMigrateError(migrateResult.error ?? t("project.migrateError"));
        return; // Keep dialog open — source is intact, show specific error
      }

      toast.success(t("project.migrateSuccess"));
    }

    resetForm();
    onOpenChange(false);
  };

  const canMigrate = migrateEnabled && targetPath && !isSamePath && !migrating;
  const isConfirmDisabled = !projectName.trim() || !localPath.trim() || migrating || isAnalyzing || (migrateEnabled && !!safetyWarning);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}
        disablePointerDismissal
      >
        <DialogContent style={{ maxWidth: "32rem" }}>
          <DialogHeader>
            <DialogTitle>{t("topbar.importProject")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Browse folder — primary action */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.localPath")}</label>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("project.importHint")}</p>
              <div className="mt-1.5 flex gap-2">
                <Input
                  value={localPath}
                  readOnly
                  placeholder={t("project.localPathPlaceholder")}
                  className="flex-1 font-mono text-xs bg-muted/30"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowFolderBrowser(true)}
                  className="shrink-0 gap-1.5"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("folder.browse")}
                </Button>
              </div>
              {gitDetected && (
                <p className="mt-1.5 text-[11px] text-emerald-400">{t("project.autoDetected")}</p>
              )}
            </div>

            {/* Git URL (auto-filled, editable) */}
            {gitUrl && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t("project.gitUrl")}</label>
                <Input
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  className="mt-1.5 font-mono text-xs"
                />
              </div>
            )}

            {/* Migration toggle — only when git detected */}
            {gitDetected && localPath && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-medium">{t("project.migrate")}</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{t("project.migrateHint")}</p>
                  </div>
                  <Switch
                    checked={migrateEnabled}
                    onCheckedChange={(checked) => handleMigrateToggle(checked)}
                  />
                </div>

                {migrateEnabled && (
                  <div className="space-y-2 pt-1">
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground">{t("project.targetPath")}</label>
                      <Input
                        value={targetPath}
                        onChange={(e) => {
                          setTargetPath(e.target.value);
                          setIsSamePath(e.target.value === localPath);
                        }}
                        placeholder="/path/to/canonical/location"
                        className="mt-1 font-mono text-xs"
                      />
                    </div>

                    {isSamePath && (
                      <p className="flex items-center gap-1 text-[11px] text-sky-400">
                        <Info className="h-3 w-3" />
                        {t("project.samePathInfo")}
                      </p>
                    )}

                    {safetyWarning && (
                      <p className="flex items-center gap-1 text-[11px] text-amber-400">
                        <AlertCircle className="h-3 w-3" />
                        {safetyWarning}
                      </p>
                    )}

                    {migrateError && (
                      <p className="flex items-center gap-1 text-[11px] text-rose-400">
                        <AlertCircle className="h-3 w-3" />
                        {migrateError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.name")}</label>
              <Input
                placeholder={t("project.namePlaceholder")}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="mt-1.5"
              />
            </div>

            {/* Project type */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.type.label")}</label>
              <div className="mt-1.5">
                <SegmentedControl
                  options={[
                    { value: "FRONTEND" as const, label: t("project.type.frontend") },
                    { value: "BACKEND" as const, label: t("project.type.backend") },
                  ]}
                  value={projectType}
                  onChange={setProjectType}
                />
              </div>
            </div>

            {/* Alias */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.alias")}</label>
              <Input
                placeholder={t("project.aliasPlaceholder")}
                value={projectAlias}
                onChange={(e) => setProjectAlias(e.target.value)}
                className="mt-1.5"
              />
            </div>

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mt-0.5">
                <label className="text-xs font-medium text-muted-foreground">{t("project.description")}</label>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={!localPath || isAnalyzing}
                        onClick={handleAnalyze}
                        className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      />
                    }
                  >
                    {isAnalyzing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {isAnalyzing ? t("project.analyzing") : t("project.genDesc")}
                  </TooltipTrigger>
                  {!localPath && <TooltipContent>{t("project.genDescDisabledTooltip")}</TooltipContent>}
                </Tooltip>
              </div>
              <Textarea
                placeholder={t("project.descPlaceholder")}
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                rows={3}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring resize-none max-h-[200px] overflow-y-auto"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isConfirmDisabled}
              className="bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/20"
            >
              {migrating ? t("project.migrating") : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Browser Dialog */}
      <FolderBrowserDialog
        open={showFolderBrowser}
        onOpenChange={setShowFolderBrowser}
        onSelect={(p) => handleFolderSelect(p)}
      />
    </>
  );
}
