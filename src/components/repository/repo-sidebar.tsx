// @ts-nocheck
/* eslint-disable */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronDown, ChevronRight, Search, FolderPlus, Package, Plus,
  GitBranch, Globe, FileText, Pencil, FolderOpen, GitCommitVertical,
  Check, AlertCircle, Loader2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProject, createProject, getRecentLocalProjects } from "@/actions/workspace-actions";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { FolderBrowserDialog } from "@/components/layout/folder-browser-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";

interface ProjectSidebarProps {
  project: {
    id: string;
    name: string;
    alias: string | null;
    description: string | null;
    type: string;
    gitUrl: string | null;
    localPath: string | null;
  };
  workspaceId: string;
}

interface GitInfo {
  isGit: boolean;
  currentBranch?: string;
  branches?: string[];
  remoteBranches?: string[];
  statusSummary?: { modified: number; staged: number; untracked: number };
}

export function RepoSidebar({ project, workspaceId }: ProjectSidebarProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [gitExpanded, setGitExpanded] = useState(true);
  const [browseExpanded, setBrowseExpanded] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editAlias, setEditAlias] = useState(project.alias ?? "");
  const [editDesc, setEditDesc] = useState(project.description ?? "");
  const [editLocalPath, setEditLocalPath] = useState(project.localPath ?? "");
  const [editProjectType, setEditProjectType] = useState<"FRONTEND" | "BACKEND">((project as any).projectType ?? "FRONTEND");

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

  // Git state
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [showCreateBranch, setShowCreateBranch] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
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
    } finally {
      setBrowseCreateLoading(false);
    }
  };

  const handleSaveProject = async () => {
    await updateProject(project.id, {
      name: editName.trim(),
      alias: editAlias.trim() || undefined,
      description: editDesc.trim() || undefined,
      localPath: editLocalPath.trim() || undefined,
      projectType: editProjectType,
    });
    router.refresh();
    setShowEditDialog(false);
  };

  return (
    <aside className="relative w-72 flex-shrink-0 overflow-y-auto border-l border-border bg-sidebar">
      {toast && (
        <div className="sticky left-3 right-3 top-3 z-10 mx-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 shadow-lg">
          {toast}
        </div>
      )}

      {/* ── Project Details ── */}
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-foreground">{project.name}</h2>
            {project.alias && (
              <p className="mt-0.5 text-xs text-muted-foreground">{project.alias}</p>
            )}
          </div>
          <button
            onClick={() => {
              setEditName(project.name);
              setEditAlias(project.alias ?? "");
              setEditDesc(project.description ?? "");
              setEditLocalPath(project.localPath ?? "");
              setShowEditDialog(true);
            }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
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
      </div>

      {/* ── Git Section ── */}
      <div className="border-b border-border p-4">
        <button
          onClick={() => setGitExpanded(!gitExpanded)}
          className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-accent"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("git.section")}</span>
          {gitExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>

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
                  size="sm"
                  className="mt-3 h-7 w-full gap-1.5 bg-amber-500/15 text-xs text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
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

                {/* Status */}
                {gitInfo.statusSummary && (gitInfo.statusSummary.modified > 0 || gitInfo.statusSummary.staged > 0 || gitInfo.statusSummary.untracked > 0) && (
                  <div className="flex gap-3 text-[11px]">
                    {gitInfo.statusSummary.modified > 0 && (
                      <span className="text-amber-400">{gitInfo.statusSummary.modified} {t("git.modified")}</span>
                    )}
                    {gitInfo.statusSummary.staged > 0 && (
                      <span className="text-emerald-400">{gitInfo.statusSummary.staged} {t("git.staged")}</span>
                    )}
                    {gitInfo.statusSummary.untracked > 0 && (
                      <span className="text-muted-foreground">{gitInfo.statusSummary.untracked} {t("git.untracked")}</span>
                    )}
                  </div>
                )}

                {/* Local branch selector */}
                {gitInfo.branches && gitInfo.branches.length > 0 && (
                  <BranchDropdown
                    label={t("git.localBranches")}
                    branches={gitInfo.branches}
                    currentBranch={gitInfo.currentBranch ?? ""}
                    onSwitch={handleSwitchBranch}
                  />
                )}

                {/* Remote branch selector */}
                {gitInfo.remoteBranches && gitInfo.remoteBranches.filter((b) => !gitInfo.branches?.includes(b)).length > 0 && (
                  <BranchDropdown
                    label={t("git.remoteBranches")}
                    branches={gitInfo.remoteBranches.filter((b) => !gitInfo.branches?.includes(b))}
                    currentBranch={gitInfo.currentBranch ?? ""}
                    onSwitch={handleSwitchBranch}
                    isRemote
                  />
                )}

                {/* Operations */}
                <div className="border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t("common.edit")}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-7 gap-1.5 text-xs"
                    onClick={() => setShowCreateBranch(true)}
                  >
                    <Plus className="h-3 w-3" />
                    {t("git.createBranch")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Browse Local ── */}
      <div className="p-4">
        <button
          onClick={() => setBrowseExpanded(!browseExpanded)}
          className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-accent"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("sidebar.right.browseRepo")}</span>
          {browseExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        {browseExpanded && (
          <div className="mt-3 space-y-3">
            <Button
              variant="outline"
              size="sm"
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
                      onClick={() => navigateToProject(rp.workspaceId, rp.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent ${
                        rp.id === project.id ? "bg-amber-500/10 text-amber-300" : ""
                      }`}
                    >
                      {rp.type === "GIT" ? (
                        <GitBranch className="h-3 w-3 shrink-0 text-emerald-400" />
                      ) : (
                        <FolderOpen className="h-3 w-3 shrink-0 text-amber-400/70" />
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
              <label className="text-xs font-medium text-muted-foreground">{t("project.description")}</label>
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={2}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 resize-none"
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
                <Button variant="outline" size="sm" onClick={() => setShowFolderBrowser(true)} className="h-8 shrink-0">
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
              className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
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
              <textarea
                value={browseCreateDesc}
                onChange={(e) => setBrowseCreateDesc(e.target.value)}
                placeholder={t("project.descPlaceholder")}
                rows={2}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBrowseCreate(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={handleBrowseCreate}
              disabled={!browseCreateName.trim() || browseCreateLoading}
              className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
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

// ── Branch Dropdown with search filter ──
function BranchDropdown({
  label,
  branches,
  currentBranch,
  onSwitch,
  isRemote = false,
}: {
  label: string;
  branches: string[];
  currentBranch: string;
  onSwitch: (branch: string) => void;
  isRemote?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click outside to close
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

  const filtered = branches.filter((b) =>
    b.toLowerCase().includes(filter.toLowerCase())
  );

  const selected = isRemote ? null : currentBranch;

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => { setOpen(!open); setFilter(""); }}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className={`h-3 w-3 shrink-0 ${isRemote ? "text-sky-400" : "text-emerald-400"}`} />
            <span className="truncate font-mono text-xs text-foreground">
              {isRemote ? `${branches.length} branches` : (selected || "—")}
            </span>
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
                  className="h-7 w-full rounded-md bg-muted/50 pl-7 pr-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-amber-500/20"
                />
              </div>
            </div>
            {/* Branch list */}
            <div className="max-h-48 overflow-auto py-1">
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No branches found</p>
              )}
              {filtered.map((b) => {
                const isActive = b === currentBranch;
                return (
                  <button
                    key={b}
                    onClick={() => {
                      if (!isActive) onSwitch(b);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                      isActive
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "text-secondary-foreground hover:bg-accent"
                    }`}
                  >
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="truncate font-mono text-xs">{b}</span>
                    {isActive && <Check className="h-3 w-3 ml-auto shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create Branch Dialog ──
function CreateBranchDialog({
  open, onOpenChange, branches, currentBranch, localPath, onCreated, onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: string[];
  currentBranch: string;
  localPath: string;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [baseBranch, setBaseBranch] = useState(currentBranch);
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [baseFilter, setBaseFilter] = useState("");
  const [showBaseList, setShowBaseList] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setBaseBranch(currentBranch);
      setDesc("");
      setBaseFilter("");
    }
  }, [open, currentBranch]);

  const filteredBases = branches.filter((b) =>
    b.toLowerCase().includes(baseFilter.toLowerCase())
  );

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-branch",
          path: localPath,
          branch: name.trim(),
          baseBranch,
        }),
      });
      if (res.ok) {
        onOpenChange(false);
        onCreated();
      } else {
        const err = await res.json();
        onError(err.error || "Unknown error");
      }
    } catch {
      onError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("git.createBranch")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {/* Branch name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("git.branchName")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("git.branchNamePlaceholder")}
              className="mt-1.5 font-mono text-xs"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          {/* Base branch — searchable dropdown */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("git.baseBranch")}</label>
            <div className="relative mt-1.5">
              <button
                onClick={() => setShowBaseList(!showBaseList)}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-2">
                  <GitBranch className="h-3 w-3 text-emerald-400" />
                  <span className="font-mono text-xs text-foreground">{baseBranch}</span>
                </div>
                <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${showBaseList ? "rotate-180" : ""}`} />
              </button>

              {showBaseList && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-border bg-popover shadow-xl">
                  <div className="border-b border-border p-1.5">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <input
                        value={baseFilter}
                        onChange={(e) => setBaseFilter(e.target.value)}
                        placeholder="Filter..."
                        autoFocus
                        className="h-7 w-full rounded-md bg-muted/50 pl-7 pr-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-amber-500/20"
                      />
                    </div>
                  </div>
                  <div className="max-h-40 overflow-auto py-1">
                    {filteredBases.map((b) => (
                      <button
                        key={b}
                        onClick={() => { setBaseBranch(b); setShowBaseList(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                          b === baseBranch ? "bg-emerald-500/10 text-emerald-400" : "text-secondary-foreground hover:bg-accent"
                        }`}
                      >
                        <GitBranch className="h-3 w-3 shrink-0" />
                        <span className="truncate font-mono text-xs">{b}</span>
                        {b === baseBranch && <Check className="h-3 w-3 ml-auto shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("git.branchDesc")}</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t("git.branchDescPlaceholder")}
              rows={2}
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25 hover:bg-amber-500/25"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
