"use client";

import { useState, useEffect } from "react";
import { GitBranch, Loader2, Check, AlertCircle, Sparkles, FolderOpen } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { toCloneUrl, parseGitUrl } from "@/lib/git-url";
import { resolveGitLocalPathWithSource, type GitLocalPathSource } from "@/actions/config-actions";
import { analyzeProjectDirectory } from "@/actions/project-actions";
import { FolderBrowserDialog } from "@/components/layout/folder-browser-dialog";
import { GroupSelect } from "@/components/project/group-select";
import { setProjectGroup } from "@/actions/group-actions";
import { toast } from "sonner";

interface CreateProjectData {
  name: string;
  alias?: string;
  description?: string;
  gitUrl?: string;
  localPath?: string;
  projectType?: "FRONTEND" | "BACKEND";
  workspaceId?: string;
}

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject?: (data: CreateProjectData) => Promise<{ id: string } | void> | { id: string } | void;
  /** Workspaces to choose from; the dialog picks a target workspace instead of inheriting the active one. */
  workspaces?: Array<{ id: string; name: string }>;
  /** Preselected workspace (the currently highlighted one). */
  defaultWorkspaceId?: string;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreateProject,
  workspaces = [],
  defaultWorkspaceId,
}: CreateProjectDialogProps) {
  const { t, locale } = useI18n();
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId ?? "");
  const [groupId, setGroupId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectAlias, setProjectAlias] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [localPathManual, setLocalPathManual] = useState(false);
  const [pathSource, setPathSource] = useState<GitLocalPathSource>("empty");
  const [projectType, setProjectType] = useState<"FRONTEND" | "BACKEND">("FRONTEND");
  const [cloneStatus, setCloneStatus] = useState<"idle" | "cloning" | "success" | "error">("idle");
  const [cloneError, setCloneError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  const resetForm = () => {
    setProjectName("");
    setProjectAlias("");
    setProjectDesc("");
    setGitUrl("");
    setLocalPath("");
    setLocalPathManual(false);
    setPathSource("empty");
    setProjectType("FRONTEND");
    setCloneStatus("idle");
    setCloneError("");
    setIsAnalyzing(false);
    setWorkspaceId(defaultWorkspaceId ?? "");
    setGroupId("");
  };

  // Default the target workspace to the currently highlighted one each time the
  // dialog opens (defaultWorkspaceId follows the URL/active workspace).
  useEffect(() => {
    if (open) {
      setWorkspaceId(defaultWorkspaceId ?? "");
      setGroupId("");
    }
  }, [open, defaultWorkspaceId]);

  const handleAnalyze = async () => {
    if (!localPath.trim() || isAnalyzing || cloneStatus !== "success") return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeProjectDirectory(localPath.trim(), locale);
      setProjectDesc(result);
    } catch {
      toast.error(t("project.analyzeError"));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGitUrlChange = async (value: string) => {
    setGitUrl(value);
    setCloneStatus("idle");
    setCloneError("");

    // Auto-derive project name from git URL
    const parsed = parseGitUrl(value);
    if (parsed && parsed.pathSegments.length > 0) {
      const repoName = parsed.pathSegments[parsed.pathSegments.length - 1];
      setProjectName(repoName);
    }

    // Auto-resolve local path
    if (!localPathManual) {
      const { path, source } = await resolveGitLocalPathWithSource(value);
      setLocalPath(path);
      setPathSource(source);
    }
  };

  const handleClone = async () => {
    if (!gitUrl.trim() || !localPath.trim()) return;
    setCloneStatus("cloning");
    setCloneError("");
    try {
      const cloneUrl = toCloneUrl(gitUrl.trim());
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clone", url: cloneUrl, path: localPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCloneStatus("error");
        setCloneError(data.error || "Clone failed");
        return;
      }
      setCloneStatus("success");
    } catch {
      setCloneStatus("error");
      setCloneError("Network error");
    }
  };

  const handleLocalPathChange = (value: string) => {
    setLocalPath(value);
    setLocalPathManual(true);
  };

  const handleBrowseSelect = (selectedPath: string) => {
    setLocalPath(selectedPath);
    setLocalPathManual(true);
    if (!projectName.trim()) {
      const folderName = selectedPath.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? "";
      if (folderName) setProjectName(folderName);
    }
  };

  const handleCreate = async () => {
    if (projectName.trim()) {
      const result = await onCreateProject?.({
        name: projectName.trim(),
        alias: projectAlias.trim() || undefined,
        description: projectDesc.trim() || undefined,
        gitUrl: gitUrl.trim() || undefined,
        localPath: localPath.trim() || undefined,
        projectType,
        workspaceId: workspaceId || undefined,
      });
      // Attach to a product group after the project exists (needs its id).
      if (groupId && result && "id" in result) {
        try {
          await setProjectGroup(result.id, groupId);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t("group.createError"));
        }
      }
      resetForm();
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}
        disablePointerDismissal
      >
        <DialogContent style={{ maxWidth: "32rem" }}>
          <DialogHeader>
            <DialogTitle>{t("topbar.newProject")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Target workspace — pick explicitly to avoid creating in the wrong one */}
            {workspaces.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t("project.workspace")}</label>
                <Select value={workspaceId} onValueChange={(v) => { setWorkspaceId(v ?? ""); setGroupId(""); }}>
                  <SelectTrigger className="mt-1.5 w-full">
                    <span className="truncate">
                      {workspaces.find((w) => w.id === workspaceId)?.name ?? t("project.workspacePlaceholder")}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Product group — cascades on the chosen workspace */}
            {workspaceId && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t("project.group")}</label>
                <GroupSelect workspaceId={workspaceId} value={groupId} onChange={setGroupId} />
              </div>
            )}

            {/* Git URL — primary input */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.gitUrl")}</label>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("project.gitUrlHint")}</p>
              <Input
                placeholder={t("project.gitPlaceholder")}
                value={gitUrl}
                onChange={(e) => handleGitUrlChange(e.target.value)}
                className="mt-1.5 font-mono text-xs"
              />
            </div>

            {/* Local Path */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.localPath")}</label>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("project.localPathHint")}</p>
              <div className="mt-1.5 flex gap-2">
                <Input
                  placeholder={t("project.localPathPlaceholder")}
                  value={localPath}
                  onChange={(e) => handleLocalPathChange(e.target.value)}
                  className="flex-1 min-w-0 font-mono text-xs"
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowFolderBrowser(true)}
                        className="shrink-0 gap-1.5 px-2.5 text-xs text-muted-foreground"
                      />
                    }
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>{t("folder.browse")}</span>
                  </TooltipTrigger>
                  <TooltipContent>{t("folder.selectFolder")}</TooltipContent>
                </Tooltip>
              </div>
              {localPath.trim().startsWith("~") && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-400">
                  <AlertCircle className="h-3 w-3" />
                  {t("project.tildeWarning")}
                </p>
              )}
              {!localPathManual &&
                pathSource === "fallback" &&
                gitUrl.trim() &&
                localPath.trim() && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {t("project.gitPathFallbackHint")}
                  </p>
                )}

              {/* Clone button */}
              {gitUrl.trim() && localPath.trim() && (
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    disabled={cloneStatus === "cloning" || cloneStatus === "success"}
                    onClick={handleClone}
                    className="gap-1.5 text-xs bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {cloneStatus === "cloning" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : cloneStatus === "success" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <GitBranch className="h-3 w-3" />
                    )}
                    {cloneStatus === "cloning" ? t("git.cloning") : cloneStatus === "success" ? t("git.cloned") : t("git.clone")}
                  </Button>
                  {cloneStatus === "error" && (
                    <span className="flex items-center gap-1 text-[11px] text-rose-400">
                      <AlertCircle className="h-3 w-3" />
                      {cloneError}
                    </span>
                  )}
                  {cloneStatus === "success" && (
                    <span className="text-[11px] text-emerald-400">{t("git.cloneSuccess")}</span>
                  )}
                </div>
              )}
            </div>

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
                        onClick={handleAnalyze}
                        className={`h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground ${!localPath.trim() || isAnalyzing ? "opacity-50" : ""}`}
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
                  <TooltipContent>
                    {!localPath.trim()
                      ? t("project.genDescNoPath")
                      : cloneStatus !== "success"
                        ? t("project.genDescNotCloned")
                        : t("project.genDescReady")}
                  </TooltipContent>
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
              disabled={!projectName.trim() || isAnalyzing}
              className="bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/20"
            >
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FolderBrowserDialog
        open={showFolderBrowser}
        onOpenChange={setShowFolderBrowser}
        onSelect={handleBrowseSelect}
      />
    </>
  );
}
