"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronDown, ChevronRight,
  GitBranch, FileText, Pencil, FolderOpen, GitCommitVertical,
  AlertCircle, Loader2, Sparkles, Trash2, FolderSearch, Code, Terminal,
  Copy, Check,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateProject, createProject, deleteProject, getRecentLocalProjects, getOrCreateTowerTaskId } from "@/actions/workspace-actions";
import { openInFileManager, openInEditor, openInTerminal } from "@/actions/preview-actions";
import { analyzeProjectDirectory } from "@/actions/project-actions";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { FolderBrowserDialog } from "@/components/layout/folder-browser-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { GitLogPanel } from "./git-log-panel";
import { GitStashPanel } from "./git-stash-panel";
import { EditorGitPanel } from "@/components/task/editor-git-panel";

interface ProjectSidebarProps {
  project: {
    id: string;
    name: string;
    alias: string | null;
    description: string | null;
    type: string;
    gitUrl: string | null;
    localPath: string | null;
    projectType?: string | null;
  };
  workspaceId: string;
}

interface ChangedFile {
  file: string;
  status: string;
  staged: boolean;
}

interface GitInfo {
  isGit: boolean;
  currentBranch?: string;
  branches?: string[];
  remoteBranches?: string[];
  statusSummary?: { modified: number; staged: number; untracked: number };
  changedFiles?: ChangedFile[];
  ahead?: number;
  behind?: number;
  remoteUrl?: string;
  commits?: { hash: string; shortHash: string; message: string; author: string; date: string }[];
  stashes?: { index: number; message: string }[];
}

// ---------------------------------------------------------------------------
// CopyableBox — a read-only value box with a copy-to-clipboard icon button.
// Mirrors the copy pattern used in assistant-chat-bubble / commit-action-menu.
// ---------------------------------------------------------------------------

function CopyableBox({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success(t("common.copied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("common.copyFailed"));
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-muted/50 pl-3 pr-1 py-1.5">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={value}>
        {value}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground"
              aria-label={ariaLabel}
              onClick={handleCopy}
            >
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </Button>
          }
        />
        <TooltipContent>{copied ? t("common.copied") : t("common.copy")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function RepoSidebar({ project, workspaceId }: ProjectSidebarProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [gitExpanded, setGitExpanded] = useState(true);
  const [browseExpanded, setBrowseExpanded] = useState(true);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOpeningStudio, setIsOpeningStudio] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editAlias, setEditAlias] = useState(project.alias ?? "");
  const [editDesc, setEditDesc] = useState(project.description ?? "");
  const [editLocalPath, setEditLocalPath] = useState(project.localPath ?? "");
  const [editProjectType, setEditProjectType] = useState<"FRONTEND" | "BACKEND">((project.projectType as "FRONTEND" | "BACKEND") ?? "FRONTEND");

  // Recent local projects
  const [recentProjects, setRecentProjects] = useState<Array<{ id: string; name: string; alias: string | null; localPath: string | null; workspaceId: string; type: string }>>([]);

  useEffect(() => {
    getRecentLocalProjects(100).then(setRecentProjects);
  }, []);

  // Browse → Create flow
  const [showBrowseCreate, setShowBrowseCreate] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [browseCreateName, setBrowseCreateName] = useState("");
  const [browseCreateAlias, setBrowseCreateAlias] = useState("");
  const [browseCreateDesc, setBrowseCreateDesc] = useState("");
  const [browseCreateProjectType, setBrowseCreateProjectType] = useState<"FRONTEND" | "BACKEND">("FRONTEND");
  const [browseCreateLoading, setBrowseCreateLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Git state
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);

  const showToast = (msg: string) => {
    toast.info(msg);
  };

  // Load git info when localPath is available
  const loadGitInfo = useCallback(async () => {
    if (!project.localPath) return;
    setGitLoading(true);
    try {
      const res = await fetch(`/api/git?path=${encodeURIComponent(project.localPath)}`);
      if (res.ok) {
        setGitInfo(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setGitLoading(false);
    }
  }, [project.localPath]);

  useEffect(() => {
    loadGitInfo();
  }, [loadGitInfo]);

  const handleInitGit = async () => {
    if (!project.localPath) return;
    setInitLoading(true);
    try {
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "init", path: project.localPath }),
      });
      if (res.ok) {
        showToast(t("git.initSuccess"));
        await loadGitInfo();
      } else {
        showToast(t("git.initFailed"));
      }
    } catch {
      showToast(t("git.initFailed"));
    } finally {
      setInitLoading(false);
    }
  };

  const navigateToProject = (wsId: string, projId: string) => {
    router.push(`/workspaces/${wsId}?projectId=${projId}`, { scroll: false });
    router.refresh();
  };

  const handleBrowseSelect = (selectedPath: string) => {
    const existing = recentProjects.find((rp) => rp.localPath === selectedPath);
    if (existing) {
      navigateToProject(existing.workspaceId, existing.id);
      return;
    }
    // Not found → open create dialog
    const folderName = selectedPath.split("/").filter(Boolean).pop() ?? "";
    setBrowsePath(selectedPath);
    setBrowseCreateName(folderName);
    setBrowseCreateAlias("");
    setBrowseCreateDesc("");
    setShowBrowseCreate(true);
  };

  const handleBrowseCreate = async () => {
    if (!browseCreateName.trim()) return;
    setBrowseCreateLoading(true);
    try {
      const newProject = await createProject({
        name: browseCreateName.trim(),
        alias: browseCreateAlias.trim() || undefined,
        description: browseCreateDesc.trim() || undefined,
        localPath: browsePath,
        projectType: browseCreateProjectType,
        workspaceId,
      });
      setShowBrowseCreate(false);
      navigateToProject(workspaceId, newProject.id);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowseCreateLoading(false);
    }
  };

  const handleEditAnalyze = async () => {
    if (!editLocalPath || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeProjectDirectory(editLocalPath.trim(), locale);
      setEditDesc(result);
    } catch {
      toast.error(t("project.analyzeError"));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveProject = async () => {
    try {
      await updateProject(project.id, {
        name: editName.trim(),
        alias: editAlias.trim() || undefined,
        description: editDesc.trim() || undefined,
        localPath: editLocalPath.trim() || undefined,
        projectType: editProjectType,
      });
      router.refresh();
      setShowEditDialog(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <aside className="relative w-72 flex-shrink-0 overflow-y-auto border-l border-border bg-sidebar">

      {/* ── Project Details ── */}
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-foreground">{project.name}</h2>
            {project.alias && (
              <p className="mt-0.5 text-xs text-muted-foreground">{project.alias}</p>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setEditName(project.name);
                setEditAlias(project.alias ?? "");
                setEditDesc(project.description ?? "");
                setEditLocalPath(project.localPath ?? "");
                setShowEditDialog(true);
              }}
              className="text-muted-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setDeleteConfirmText("");
                setShowDeleteDialog(true);
              }}
              className="text-muted-foreground hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {project.description && (
          <p className="mt-2 text-sm text-secondary-foreground leading-relaxed line-clamp-4">{project.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
            project.type === "GIT"
              ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/20"
              : "bg-muted text-muted-foreground ring-1 ring-border"
          }`}>
            {project.type === "GIT" ? (
              <><GitBranch className="h-3 w-3" />{t("sidebar.right.gitType")}</>
            ) : (
              <><FileText className="h-3 w-3" />{t("sidebar.right.normalType")}</>
            )}
          </span>
        </div>
        {/* Path & Git URL — read-only with copy-to-clipboard */}
        {(project.localPath || project.gitUrl) && (
          <div className="mt-3 space-y-1.5">
            {project.localPath && (
              <CopyableBox value={project.localPath} ariaLabel={t("project.localPath")} />
            )}
            {project.gitUrl && (
              <CopyableBox value={project.gitUrl} ariaLabel={t("project.gitUrl")} />
            )}
          </div>
        )}
        {project.localPath && (
          <div className="mt-3 space-y-1.5">
            {/* Open externally — icon buttons */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                      onClick={async () => {
                        try {
                          await openInFileManager(project.localPath!);
                        } catch (err) {
                          console.error("openInFileManager failed:", err);
                          toast.error(t("git.openInFileManagerFailed"));
                        }
                      }}
                    >
                      <FolderSearch className="h-4 w-4" />
                    </Button>
                  }
                />
                <TooltipContent>{t("git.openInFileManager")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                      onClick={async () => {
                        try {
                          await openInEditor(project.localPath!);
                        } catch (err) {
                          console.error("openInEditor failed:", err);
                          toast.error(t("git.openInEditorFailed"));
                        }
                      }}
                    >
                      <Code className="h-4 w-4" />
                    </Button>
                  }
                />
                <TooltipContent>{t("git.openInEditor")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                      onClick={async () => {
                        try {
                          await openInTerminal(project.localPath!);
                        } catch (err) {
                          console.error("openInTerminal failed:", err);
                          toast.error(t("git.openInTerminalFailed"));
                        }
                      }}
                    >
                      <Terminal className="h-4 w-4" />
                    </Button>
                  }
                />
                <TooltipContent>{t("git.openInTerminal")}</TooltipContent>
              </Tooltip>
            </div>
            {/* Primary action — open the in-app workbench */}
            <Button
              variant="outline"
              className="w-full h-9 gap-1.5 text-xs"
              disabled={isOpeningStudio}
              onClick={async () => {
                setIsOpeningStudio(true);
                try {
                  const taskId = await getOrCreateTowerTaskId(project.id);
                  router.push(`/workspaces/${workspaceId}/tasks/${taskId}`);
                } catch {
                  toast.error(t("git.openStudioFailed"));
                } finally {
                  setIsOpeningStudio(false);
                }
              }}
            >
              {isOpeningStudio ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
              {t("git.openStudio")}
            </Button>
          </div>
        )}
      </div>

      {/* ── Git Section ── */}
      <div className="border-b border-border p-4">
        <Button
          variant="ghost"
          onClick={() => setGitExpanded(!gitExpanded)}
          className="flex w-full cursor-pointer justify-between px-2 py-2"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("git.section")}</span>
          {gitExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </Button>

        {gitExpanded && (
          <div className="mt-3">
            {!project.localPath ? (
              /* No local path set */
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <p className="text-xs">{t("git.noLocalPath")}</p>
                </div>
              </div>
            ) : gitLoading ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="ml-2 text-xs">{t("git.loading")}</span>
              </div>
            ) : gitInfo && !gitInfo.isGit ? (
              /* Not a git repo — offer init */
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <p className="text-xs">{t("git.notInitialized")}</p>
                </div>
                <Button
                 
                  className="mt-3 h-7 w-full gap-1.5 bg-primary/10 text-xs text-primary ring-1 ring-primary/20 hover:bg-primary/15"
                  onClick={handleInitGit}
                  disabled={initLoading}
                >
                  {initLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCommitVertical className="h-3 w-3" />}
                  {t("git.initRepo")}
                </Button>
              </div>
            ) : gitInfo?.isGit ? (
              /* Git repo — full git panel (branch + changed files + sync + stash actions) */
              <div className="space-y-3">
                {/* Reuses EditorGitPanel in project mode — full set of actions:
                    branch switch, fetch, create branch, stage/unstage/discard,
                    commit, pull/push, pull-from/push-to, stash save/pop. */}
                <div className="overflow-hidden h-[560px] flex flex-col">
                  <EditorGitPanel localPath={project.localPath!} mode="project" />
                </div>

                {/* Commit log (full history list) */}
                <GitLogPanel commits={gitInfo.commits ?? []} />

                {/* Stash list */}
                <GitStashPanel
                  localPath={project.localPath!}
                  stashes={gitInfo.stashes ?? []}
                  hasChanges={(gitInfo.changedFiles ?? []).length > 0}
                  onRefresh={loadGitInfo}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Browse Local ── */}
      <div className="p-4">
        <Button
          variant="ghost"
          onClick={() => setBrowseExpanded(!browseExpanded)}
          className="flex w-full cursor-pointer justify-between px-2 py-2"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("sidebar.right.browseRepo")}</span>
          {browseExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </Button>
        {browseExpanded && (
          <div className="mt-3 space-y-3">
            <Button
              variant="outline"
             
              className="w-full h-8 gap-1.5 text-xs"
              onClick={() => setShowFolderBrowser(true)}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t("sidebar.right.browseRepo")}
            </Button>

            {/* Recent local projects */}
            {recentProjects.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">{t("sidebar.right.recent")}</p>
                <div className="space-y-0.5">
                  {recentProjects.map((rp) => (
                    <button
                      key={rp.id}
                      onClick={() => { if (rp.id !== project.id) navigateToProject(rp.workspaceId, rp.id); }}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                        rp.id === project.id ? "bg-primary/10 text-primary cursor-default" : "hover:bg-accent cursor-pointer"
                      }`}
                    >
                      {rp.type === "GIT" ? (
                        <GitBranch className="h-3 w-3 shrink-0 text-emerald-400" />
                      ) : (
                        <FolderOpen className="h-3 w-3 shrink-0 text-primary/70" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">{rp.name}</p>
                        {rp.localPath && (
                          <p className="truncate text-[10px] font-mono text-muted-foreground">{rp.localPath}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Edit Project Dialog ── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent style={{ maxWidth: "32rem" }}>
          <DialogHeader>
            <DialogTitle>{t("project.edit")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.name")}</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.type.label")}</label>
              <div className="mt-1.5">
                <SegmentedControl
                  options={[
                    { value: "FRONTEND" as const, label: t("project.type.frontend") },
                    { value: "BACKEND" as const, label: t("project.type.backend") },
                  ]}
                  value={editProjectType}
                  onChange={setEditProjectType}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.alias")}</label>
              <Input value={editAlias} onChange={(e) => setEditAlias(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">{t("project.description")}</label>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleEditAnalyze}
                  className={`h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground ${!editLocalPath || isAnalyzing ? "opacity-50" : ""}`}
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {isAnalyzing ? t("project.analyzing") : t("project.genDesc")}
                </Button>
              </div>
              <Textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={2}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring resize-none max-h-[200px] overflow-y-auto"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.localPath")}</label>
              {/* Read-only — changing a project's path is not supported; re-import or create a new project instead */}
              <div className="mt-1.5 break-all rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                {editLocalPath || "—"}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={handleSaveProject}
              disabled={!editName.trim() || isAnalyzing}
              className="bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/15"
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Browser */}
      <FolderBrowserDialog
        open={showFolderBrowser}
        onOpenChange={setShowFolderBrowser}
        onSelect={(path) => {
          if (showEditDialog) {
            setEditLocalPath(path);
          } else {
            handleBrowseSelect(path);
          }
        }}
      />

      {/* Browse → Create Project Dialog */}
      <Dialog open={showBrowseCreate} onOpenChange={setShowBrowseCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("topbar.newProject")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Locked path */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.localPath")}</label>
              <div className="mt-1.5 rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                {browsePath}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.name")}</label>
              <Input
                value={browseCreateName}
                onChange={(e) => setBrowseCreateName(e.target.value)}
                placeholder={t("project.namePlaceholder")}
                className="mt-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.type.label")}</label>
              <div className="mt-1.5">
                <SegmentedControl
                  options={[
                    { value: "FRONTEND" as const, label: t("project.type.frontend") },
                    { value: "BACKEND" as const, label: t("project.type.backend") },
                  ]}
                  value={browseCreateProjectType}
                  onChange={setBrowseCreateProjectType}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.alias")}</label>
              <Input
                value={browseCreateAlias}
                onChange={(e) => setBrowseCreateAlias(e.target.value)}
                placeholder={t("project.aliasPlaceholder")}
                className="mt-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("project.description")}</label>
              <Textarea
                value={browseCreateDesc}
                onChange={(e) => setBrowseCreateDesc(e.target.value)}
                placeholder={t("project.descPlaceholder")}
                rows={2}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBrowseCreate(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={handleBrowseCreate}
              disabled={!browseCreateName.trim() || browseCreateLoading}
              className="bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/15"
            >
              {browseCreateLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Project Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => {
        setShowDeleteDialog(open);
        if (!open) setDeleteConfirmText("");
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-rose-400">{t("project.deleteTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {t("project.deleteWarning", { name: project.name })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("project.deleteIrreversible")}
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {t("project.deleteConfirmLabel")}
              </label>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={t("project.deleteConfirmPlaceholder")}
                className="mt-1.5"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== t("project.deleteConfirmText") || isDeleting}
              onClick={async () => {
                setIsDeleting(true);
                try {
                  await deleteProject(project.id);
                  toast.success(t("project.deleteSuccess"));
                  router.push(`/workspaces/${workspaceId}`);
                } catch {
                  toast.error(t("project.deleteFailed"));
                } finally {
                  setIsDeleting(false);
                  setShowDeleteDialog(false);
                }
              }}
            >
              {isDeleting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              {t("project.deleteButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}


