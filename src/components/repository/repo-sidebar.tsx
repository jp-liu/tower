"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronDown, ChevronRight, Search, Plus,
  GitBranch, Globe, FileText, Pencil, FolderOpen, GitCommitVertical,
  Check, AlertCircle, Loader2, Sparkles, RefreshCw,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateProject, createProject, getRecentLocalProjects } from "@/actions/workspace-actions";
import { analyzeProjectDirectory } from "@/actions/project-actions";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { FolderBrowserDialog } from "@/components/layout/folder-browser-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CreateBranchDialog } from "./create-branch-dialog";
import { GitChangesPanel } from "./git-changes-panel";
import { GitLogPanel } from "./git-log-panel";
import { GitStashPanel } from "./git-stash-panel";

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

export function RepoSidebar({ project, workspaceId }: ProjectSidebarProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [gitExpanded, setGitExpanded] = useState(true);
  const [browseExpanded, setBrowseExpanded] = useState(true);
  const [showEditDialog, setShowEditDialog] = useState(false);
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
  const [showCreateBranch, setShowCreateBranch] = useState(false);

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

  const handleSwitchBranch = async (branch: string) => {
    if (!project.localPath) return;
    try {
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkout", path: project.localPath, branch }),
      });
      if (res.ok) {
        showToast(`${t("git.switchSuccess")} ${branch}`);
        await loadGitInfo();
      } else {
        const err = await res.json();
        showToast(`${t("git.switchFailed")}: ${err.error}`);
      }
    } catch {
      showToast(t("git.switchFailed"));
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
      const result = await analyzeProjectDirectory(editLocalPath.trim());
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
        </div>
        {project.description && (
          <p className="mt-2 text-sm text-secondary-foreground leading-relaxed">{project.description}</p>
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
        {project.localPath && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs">
            <FolderOpen className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="break-all font-mono text-secondary-foreground">{project.localPath}</span>
          </div>
        )}
        {project.gitUrl && (
          <div className="mt-2 flex items-start gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs">
            <Globe className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="break-all text-secondary-foreground">{project.gitUrl}</span>
          </div>
        )}
        {project.localPath && (
          <Button
            variant="outline"
            className="mt-3 w-full h-8 gap-1.5 text-xs"
            onClick={() => router.push(`/workspaces/${workspaceId}/projects/${project.id}`)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("git.openStudio")}
          </Button>
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
              /* Git repo — show current branch + dropdown selectors */
              <div className="space-y-3">
                {/* Current branch */}
                <div className="rounded-lg border border-border bg-muted/50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("git.currentBranch")}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <GitBranch className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="font-mono text-sm font-medium text-foreground">{gitInfo.currentBranch}</span>
                  </div>
                </div>

                {/* Changes + Commit + Pull/Push */}
                <GitChangesPanel
                  localPath={project.localPath!}
                  changedFiles={gitInfo.changedFiles ?? []}
                  ahead={gitInfo.ahead ?? 0}
                  behind={gitInfo.behind ?? 0}
                  hasRemote={!!gitInfo.remoteUrl}
                  onRefresh={loadGitInfo}
                />

                {/* Branch selector + fetch */}
                <UnifiedBranchDropdown
                  localBranches={gitInfo.branches ?? []}
                  remoteBranches={(gitInfo.remoteBranches ?? []).filter((b) => !gitInfo.branches?.includes(b))}
                  currentBranch={gitInfo.currentBranch ?? ""}
                  onSwitch={handleSwitchBranch}
                  onFetch={async () => {
                    if (!project.localPath) return;
                    await fetch("/api/git", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "fetch", path: project.localPath }),
                    });
                    await loadGitInfo();
                  }}
                  onCreateBranch={() => setShowCreateBranch(true)}
                />

                {/* Commit log */}
                <GitLogPanel commits={gitInfo.commits ?? []} />

                {/* Stash */}
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
        <DialogContent className="sm:max-w-sm">
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
                  disabled={!editLocalPath || isAnalyzing}
                  onClick={handleEditAnalyze}
                  className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
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
              <div className="mt-1.5 flex gap-2">
                <Input
                  value={editLocalPath}
                  onChange={(e) => setEditLocalPath(e.target.value)}
                  placeholder={t("project.localPathPlaceholder")}
                  className="flex-1 font-mono text-xs"
                />
                <Button variant="outline" onClick={() => setShowFolderBrowser(true)} className="h-8 shrink-0">
                  {t("folder.browse")}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={handleSaveProject}
              disabled={!editName.trim()}
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

      {/* Create Branch Dialog */}
      {gitInfo?.isGit && (
        <CreateBranchDialog
          open={showCreateBranch}
          onOpenChange={setShowCreateBranch}
          branches={gitInfo.branches ?? []}
          currentBranch={gitInfo.currentBranch ?? ""}
          localPath={project.localPath!}
          onCreated={async () => {
            await loadGitInfo();
            showToast(t("git.createSuccess"));
          }}
          onError={(msg) => showToast(`${t("git.createFailed")}: ${msg}`)}
        />
      )}
    </aside>
  );
}

// ── Unified Branch Dropdown with Local/Remote groups + Fetch ──
function UnifiedBranchDropdown({
  localBranches,
  remoteBranches,
  currentBranch,
  onSwitch,
  onFetch,
  onCreateBranch,
}: {
  localBranches: string[];
  remoteBranches: string[];
  currentBranch: string;
  onSwitch: (branch: string) => void;
  onFetch: () => Promise<void>;
  onCreateBranch: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [fetching, setFetching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const lc = filter.toLowerCase();
  const filteredLocal = localBranches.filter((b) => b.toLowerCase().includes(lc));
  const filteredRemote = remoteBranches.filter((b) => b.toLowerCase().includes(lc));
  const hasResults = filteredLocal.length > 0 || filteredRemote.length > 0;

  const handleFetch = async () => {
    setFetching(true);
    try {
      await onFetch();
    } finally {
      setFetching(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("git.switchBranch")}</p>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleFetch}
            disabled={fetching}
            className="text-muted-foreground"
            aria-label="Fetch"
          >
            <RefreshCw className={`h-3 w-3 ${fetching ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onCreateBranch}
            className="text-muted-foreground"
            aria-label={t("git.createBranch")}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => { setOpen(!open); setFilter(""); }}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className="h-3 w-3 shrink-0 text-emerald-400" />
            <span className="truncate font-mono text-xs text-foreground">{currentBranch || "—"}</span>
          </div>
          <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-border bg-popover shadow-xl">
            {/* Search */}
            <div className="border-b border-border p-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter..."
                  autoFocus
                  className="h-7 w-full rounded-md bg-muted/50 pl-7 pr-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
            <div className="max-h-60 overflow-auto py-1">
              {!hasResults && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No branches found</p>
              )}
              {/* Local branches group */}
              {filteredLocal.length > 0 && (
                <>
                  <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("git.localBranches")}
                  </p>
                  {filteredLocal.map((b) => {
                    const isActive = b === currentBranch;
                    return (
                      <button
                        key={`local-${b}`}
                        onClick={() => { if (!isActive) onSwitch(b); setOpen(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                          isActive ? "bg-emerald-500/10 text-emerald-400" : "text-secondary-foreground hover:bg-accent"
                        }`}
                      >
                        <GitBranch className="h-3 w-3 shrink-0" />
                        <span className="truncate font-mono text-xs">{b}</span>
                        {isActive && <Check className="h-3 w-3 ml-auto shrink-0" />}
                      </button>
                    );
                  })}
                </>
              )}
              {/* Remote branches group */}
              {filteredRemote.length > 0 && (
                <>
                  <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("git.remoteBranches")}
                  </p>
                  {filteredRemote.map((b) => (
                    <button
                      key={`remote-${b}`}
                      onClick={() => { onSwitch(b); setOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-secondary-foreground transition-colors hover:bg-accent"
                    >
                      <Globe className="h-3 w-3 shrink-0 text-sky-400" />
                      <span className="truncate font-mono text-xs">{b}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

