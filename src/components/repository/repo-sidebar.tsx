// @ts-nocheck
/* eslint-disable */
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronDown, ChevronRight, Search, FolderPlus, Package,
  GitBranch, Globe, FileText, Pencil, FolderOpen, GitCommitVertical,
  Check, AlertCircle, Loader2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProject } from "@/actions/workspace-actions";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { FolderBrowserDialog } from "@/components/layout/folder-browser-dialog";

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
}

interface GitInfo {
  isGit: boolean;
  currentBranch?: string;
  branches?: string[];
  remoteBranches?: string[];
  statusSummary?: { modified: number; staged: number; untracked: number };
}

export function RepoSidebar({ project }: ProjectSidebarProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [gitExpanded, setGitExpanded] = useState(true);
  const [browseExpanded, setBrowseExpanded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editAlias, setEditAlias] = useState(project.alias ?? "");
  const [editDesc, setEditDesc] = useState(project.description ?? "");
  const [editLocalPath, setEditLocalPath] = useState(project.localPath ?? "");

  // Git state
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);

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

  const handleSaveProject = async () => {
    await updateProject(project.id, {
      name: editName.trim(),
      alias: editAlias.trim() || undefined,
      description: editDesc.trim() || undefined,
      localPath: editLocalPath.trim() || undefined,
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
          <div className="mt-3 space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 gap-1.5 text-xs"
              onClick={() => setShowFolderBrowser(true)}
            >
              <Search className="h-3.5 w-3.5" />
              {t("sidebar.right.browseRepo")}
            </Button>
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
            showToast(`Selected: ${path}`);
          }
        }}
      />
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

  const filtered = branches.filter((b) =>
    b.toLowerCase().includes(filter.toLowerCase())
  );

  const selected = isRemote ? null : currentBranch;

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
      <div className="relative">
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
