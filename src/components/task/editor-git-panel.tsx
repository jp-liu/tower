"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  File, FilePlus, FileMinus, FileQuestion, FileEdit,
  Loader2, ArrowDown, ArrowUp, Check, ChevronRight, ChevronDown,
  Folder, Minus, Plus, MoreHorizontal, RefreshCw, Archive, ArrowUpFromLine,
  Undo2, GitBranch, Search, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
  DropdownMenuGroup, DropdownMenuSub, DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CreateBranchDialog } from "@/components/repository/create-branch-dialog";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { gitAction } from "@/lib/git-api";

interface ChangedFile {
  file: string;
  status: string;
  staged: boolean;
}

interface GitInfoData {
  changedFiles: ChangedFile[];
  ahead: number;
  behind: number;
  remoteUrl: string;
  currentBranch: string;
  branches: string[];
  remoteBranches: string[];
}

export interface EditorGitPanelProps {
  localPath: string;
  onFileSelect?: (filePath: string, originalContent: string) => void;
}

const STATUS_ICON: Record<string, typeof File> = {
  modified: FileEdit, added: FilePlus,
  deleted: FileMinus, untracked: FileQuestion,
  renamed: FileEdit,
};

const STATUS_COLOR: Record<string, string> = {
  modified: "text-amber-400", added: "text-emerald-400",
  deleted: "text-rose-400", untracked: "text-muted-foreground",
  renamed: "text-sky-400",
};

const STATUS_LETTER: Record<string, string> = {
  modified: "M", added: "A", deleted: "D",
  untracked: "U", renamed: "R",
};

// ── Tree builder ──

interface TreeNode {
  name: string;
  path: string; // full relative path
  isDir: boolean;
  children: TreeNode[];
  file?: ChangedFile;
}

function buildFileTree(files: ChangedFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const f of files) {
    const parts = f.file.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join("/");

      if (isLast) {
        current.children.push({
          name: part,
          path: partPath,
          isDir: false,
          children: [],
          file: f,
        });
      } else {
        let dir = current.children.find((c) => c.isDir && c.name === part);
        if (!dir) {
          dir = { name: part, path: partPath, isDir: true, children: [] };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }

  // Collapse single-child directories: a/b/c.ts → a/b/c.ts with dir "a/b"
  function collapse(node: TreeNode): TreeNode {
    if (node.isDir) {
      node.children = node.children.map(collapse);
      if (node.children.length === 1 && node.children[0].isDir && node.name !== "") {
        const child = node.children[0];
        return { ...child, name: `${node.name}/${child.name}` };
      }
    }
    return node;
  }

  return collapse(root).children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── Main component ──

export function EditorGitPanel({ localPath, onFileSelect }: EditorGitPanelProps) {
  const { t } = useI18n();
  const [gitInfo, setGitInfo] = useState<GitInfoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const branchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!branchOpen) return;
    function handleClick(e: MouseEvent) {
      if (branchRef.current && !branchRef.current.contains(e.target as Node)) {
        setBranchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [branchOpen]);
  const [showCreateBranch, setShowCreateBranch] = useState(false);

  const loadGitInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/git?path=${encodeURIComponent(localPath)}`);
      if (res.ok) {
        const data = await res.json();
        setGitInfo({
          changedFiles: data.changedFiles ?? [],
          ahead: data.ahead ?? 0,
          behind: data.behind ?? 0,
          remoteUrl: data.remoteUrl ?? "",
          currentBranch: data.currentBranch ?? "",
          branches: data.branches ?? [],
          remoteBranches: data.remoteBranches ?? [],
        });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [localPath]);

  useEffect(() => {
    loadGitInfo();
    const timer = setInterval(loadGitInfo, 5000);
    return () => clearInterval(timer);
  }, [loadGitInfo]);

  const handleStage = async (files: string[]) => {
    try {
      await gitAction(localPath, "stage", { files });
      await loadGitInfo();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUnstage = async (files: string[]) => {
    try {
      await gitAction(localPath, "unstage", { files });
      await loadGitInfo();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      await gitAction(localPath, "commit", { message: commitMsg });
      setCommitMsg("");
      toast.success(t("git.commitSuccess"));
      await loadGitInfo();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  };

  const handlePull = async (branch?: string) => {
    setPulling(true);
    try {
      await gitAction(localPath, "pull", branch ? { branch } : {});
      toast.success(t("git.pullSuccess"));
      await loadGitInfo();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  };

  const handlePush = async (branch?: string) => {
    setPushing(true);
    try {
      await gitAction(localPath, "push", branch ? { branch } : {});
      toast.success(t("git.pushSuccess"));
      await loadGitInfo();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  };

  const handleFetch = async () => {
    setFetching(true);
    try {
      await gitAction(localPath, "fetch");
      toast.success(t("git.fetchSuccess"));
      await loadGitInfo();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };

  const handleSwitchBranch = async (branch: string) => {
    try {
      await gitAction(localPath, "checkout", { branch });
      setBranchOpen(false);
      toast.success(`${t("git.switchSuccess")} ${branch}`);
      await loadGitInfo();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const openCreateBranchDialog = () => {
    setBranchOpen(false);
    setShowCreateBranch(true);
  };

  const handleStashSave = async () => {
    try {
      await gitAction(localPath, "stash-save", { message: commitMsg || undefined });
      setCommitMsg("");
      toast.success(t("git.stashSaved"));
      await loadGitInfo();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStashPop = async () => {
    try {
      await gitAction(localPath, "stash-pop", { index: 0 });
      toast.success(t("git.stashApplied"));
      await loadGitInfo();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDiscardAll = async () => {
    try {
      await gitAction(localPath, "discard-all");
      toast.success(t("git.discardSuccess"));
      await loadGitInfo();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleFileClick = async (file: ChangedFile) => {
    if (file.status === "deleted") return;
    try {
      const res = await gitAction(localPath, "show", { file: file.file });
      onFileSelect?.(file.file, res.content ?? "");
    } catch {
      onFileSelect?.(file.file, "");
    }
  };

  const stagedFiles = gitInfo?.changedFiles.filter((f) => f.staged) ?? [];
  const unstagedFiles = gitInfo?.changedFiles.filter((f) => !f.staged) ?? [];

  const stagedTree = useMemo(() => buildFileTree(stagedFiles), [stagedFiles]);
  const unstagedTree = useMemo(() => buildFileTree(unstagedFiles), [unstagedFiles]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!gitInfo) return null;

  // Collect all file paths from a tree node (for batch stage/unstage)
  function collectFiles(nodes: TreeNode[]): string[] {
    const result: string[] = [];
    for (const n of nodes) {
      if (n.isDir) {
        result.push(...collectFiles(n.children));
      } else if (n.file) {
        result.push(n.file.file);
      }
    }
    return result;
  }

  const allBranches = [
    ...(gitInfo?.branches ?? []),
    ...(gitInfo?.remoteBranches ?? []).filter((b) => !gitInfo?.branches?.includes(b)),
  ];
  const filteredBranches = branchFilter
    ? allBranches.filter((b) => b.toLowerCase().includes(branchFilter.toLowerCase()))
    : allBranches;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Branch selector ── */}
      <div className="shrink-0 px-2 pt-2 pb-1">
        <div className="relative" ref={branchRef}>
          <button
            onClick={() => { setBranchOpen(!branchOpen); setBranchFilter(""); }}
            className="flex w-full items-center justify-between rounded-md border border-border bg-muted/50 px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <GitBranch className="h-3 w-3 shrink-0 text-emerald-400" />
              <span className="truncate font-mono text-xs text-foreground">{gitInfo?.currentBranch || "—"}</span>
            </div>
            <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${branchOpen ? "rotate-180" : ""}`} />
          </button>

          {branchOpen && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-border bg-popover shadow-xl">
              <div className="border-b border-border p-1.5">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <input
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    placeholder="Filter..."
                    autoFocus
                    className="h-7 w-full rounded-md bg-muted/50 pl-7 pr-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="max-h-48 overflow-auto py-1">
                {/* Local branches */}
                {(gitInfo?.branches ?? []).filter((b) => b.toLowerCase().includes(branchFilter.toLowerCase())).length > 0 && (
                  <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("git.localBranches")}
                  </p>
                )}
                {(gitInfo?.branches ?? [])
                  .filter((b) => b.toLowerCase().includes(branchFilter.toLowerCase()))
                  .map((b) => {
                    const isActive = b === gitInfo?.currentBranch;
                    return (
                      <button
                        key={`local-${b}`}
                        onClick={() => { if (!isActive) handleSwitchBranch(b); else setBranchOpen(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-1 text-left transition-colors ${
                          isActive ? "bg-emerald-500/10 text-emerald-400" : "text-secondary-foreground hover:bg-accent"
                        }`}
                      >
                        <GitBranch className="h-3 w-3 shrink-0" />
                        <span className="truncate font-mono text-xs">{b}</span>
                        {isActive && <Check className="h-3 w-3 ml-auto shrink-0" />}
                      </button>
                    );
                  })}
                {/* Remote branches */}
                {(gitInfo?.remoteBranches ?? [])
                  .filter((b) => !gitInfo?.branches?.includes(b))
                  .filter((b) => b.toLowerCase().includes(branchFilter.toLowerCase())).length > 0 && (
                  <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("git.remoteBranches")}
                  </p>
                )}
                {(gitInfo?.remoteBranches ?? [])
                  .filter((b) => !gitInfo?.branches?.includes(b))
                  .filter((b) => b.toLowerCase().includes(branchFilter.toLowerCase()))
                  .map((b) => (
                    <button
                      key={`remote-${b}`}
                      onClick={() => handleSwitchBranch(b)}
                      className="flex w-full items-center gap-2 px-3 py-1 text-left text-secondary-foreground transition-colors hover:bg-accent"
                    >
                      <Globe className="h-3 w-3 shrink-0 text-sky-400" />
                      <span className="truncate font-mono text-xs">{b}</span>
                    </button>
                  ))}
                {filteredBranches.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No branches found</p>
                )}
              </div>
              {/* Create branch + Fetch */}
              <div className="border-t border-border p-1.5 flex gap-1">
                <Button variant="ghost" className="flex-1 h-6 gap-1 text-[10px] text-muted-foreground" onClick={() => { setBranchOpen(false); openCreateBranchDialog(); }}>
                  <Plus className="h-3 w-3" />
                  {t("git.createBranch")}
                </Button>
                <Button variant="ghost" className="h-6 gap-1 text-[10px] text-muted-foreground" onClick={handleFetch} disabled={fetching}>
                  <RefreshCw className={`h-3 w-3 ${fetching ? "animate-spin" : ""}`} />
                  Fetch
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Commit message ── */}
      <div className="shrink-0 px-2 pb-2 space-y-1.5 border-b border-border">
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder={t("git.commitMsgPlaceholder")}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring resize-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleCommit();
          }}
        />

        {/* Commit button + actions menu */}
        <div className="flex items-center gap-1">
          <Button
            variant="default"
            className="flex-1 h-7 gap-1.5 text-xs"
            onClick={handleCommit}
            disabled={committing || !commitMsg.trim() || stagedFiles.length === 0}
          >
            {committing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {t("git.commit")}
          </Button>

          {/* ⋯ More actions menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="icon-xs" className="h-7 w-7 shrink-0" />
              }
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-52">
              {/* Commit actions */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("git.commit")}</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={handleCommit}
                  disabled={!commitMsg.trim() || stagedFiles.length === 0}
                >
                  <Check className="h-3.5 w-3.5 mr-2" />
                  {t("git.commit")}
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              {/* Stage / Unstage */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("git.changes")}</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => handleStage(collectFiles(unstagedTree))}
                  disabled={unstagedFiles.length === 0}
                >
                  <Plus className="h-3.5 w-3.5 mr-2" />
                  {t("git.stageAll")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleUnstage(collectFiles(stagedTree))}
                  disabled={stagedFiles.length === 0}
                >
                  <Minus className="h-3.5 w-3.5 mr-2" />
                  {t("git.unstageAll")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDiscardAll} disabled={unstagedFiles.length === 0}>
                  <Undo2 className="h-3.5 w-3.5 mr-2" />
                  {t("git.discardAll")}
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              {/* Pull / Push / Fetch */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("git.sync")}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => handlePull()} disabled={pulling}>
                  <ArrowDown className="h-3.5 w-3.5 mr-2" />
                  {t("git.pull")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlePush()} disabled={pushing}>
                  <ArrowUp className="h-3.5 w-3.5 mr-2" />
                  {t("git.push")}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={pulling}>
                    <ArrowDown className="h-3.5 w-3.5 mr-2" />
                    {t("git.pullFrom")}...
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-60 overflow-y-auto">
                    {/* Current branch first */}
                    <DropdownMenuItem onClick={() => handlePull()}>
                      <GitBranch className="h-3 w-3 mr-2 text-emerald-400" />
                      {gitInfo.currentBranch}
                      {gitInfo.behind > 0 && <span className="ml-auto text-[10px] text-muted-foreground">↓{gitInfo.behind}</span>}
                    </DropdownMenuItem>
                    {gitInfo.remoteBranches
                      .filter((b) => b !== gitInfo.currentBranch)
                      .map((b) => (
                        <DropdownMenuItem key={b} onClick={() => handlePull(b)}>
                          <GitBranch className="h-3 w-3 mr-2 text-sky-400" />
                          {b}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={pushing}>
                    <ArrowUp className="h-3.5 w-3.5 mr-2" />
                    {t("git.pushTo")}...
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-60 overflow-y-auto">
                    <DropdownMenuItem onClick={() => handlePush()}>
                      <GitBranch className="h-3 w-3 mr-2 text-emerald-400" />
                      {gitInfo.currentBranch}
                      {gitInfo.ahead > 0 && <span className="ml-auto text-[10px] text-muted-foreground">↑{gitInfo.ahead}</span>}
                    </DropdownMenuItem>
                    {gitInfo.remoteBranches
                      .filter((b) => b !== gitInfo.currentBranch)
                      .map((b) => (
                        <DropdownMenuItem key={b} onClick={() => handlePush(b)}>
                          <GitBranch className="h-3 w-3 mr-2 text-sky-400" />
                          {b}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onClick={handleFetch} disabled={fetching}>
                  <RefreshCw className={`h-3.5 w-3.5 mr-2 ${fetching ? "animate-spin" : ""}`} />
                  {t("git.fetchAll")}
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              {/* Stash */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("git.stash")}</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={handleStashSave}
                  disabled={gitInfo.changedFiles.length === 0}
                >
                  <Archive className="h-3.5 w-3.5 mr-2" />
                  {t("git.stashSave")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleStashPop}>
                  <ArrowUpFromLine className="h-3.5 w-3.5 mr-2" />
                  {t("git.stashPopLatest")}
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              {/* Branch info */}
              <DropdownMenuItem disabled className="text-muted-foreground">
                <GitBranch className="h-3.5 w-3.5 mr-2" />
                {gitInfo.currentBranch}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── File sections ── */}
      <ScrollArea className="flex-1 min-h-0">
        {/* Staged */}
        <FileSection
          label={t("git.stagedChanges")}
          count={stagedFiles.length}
          labelColor="text-emerald-400"
          tree={stagedTree}
          batchAction={() => handleUnstage(collectFiles(stagedTree))}
          batchLabel={t("git.unstageAll")}
          batchIcon={<Minus className="h-3 w-3" />}
          onFileClick={handleFileClick}
          onFileAction={(f) => handleUnstage([f])}
          fileActionIcon="−"
        />

        {/* Unstaged */}
        <FileSection
          label={t("git.unstagedChanges")}
          count={unstagedFiles.length}
          labelColor="text-muted-foreground"
          tree={unstagedTree}
          batchAction={() => handleStage(collectFiles(unstagedTree))}
          batchLabel={t("git.stageAll")}
          batchIcon={<Plus className="h-3 w-3" />}
          onFileClick={handleFileClick}
          onFileAction={(f) => handleStage([f])}
          fileActionIcon="+"
        />

        {gitInfo.changedFiles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Check className="h-5 w-5 text-emerald-400 mb-2" />
            <p className="text-xs text-muted-foreground">{t("git.noChanges")}</p>
          </div>
        )}
      </ScrollArea>

      {/* Create Branch Dialog — reuse shared component */}
      <CreateBranchDialog
        open={showCreateBranch}
        onOpenChange={setShowCreateBranch}
        branches={[...(gitInfo?.branches ?? []), ...(gitInfo?.remoteBranches ?? [])]}
        currentBranch={gitInfo?.currentBranch ?? ""}
        localPath={localPath}
        onCreated={async () => {
          toast.success(t("git.createSuccess"));
          await loadGitInfo();
        }}
        onError={(msg) => toast.error(`${t("git.createFailed")}: ${msg}`)}
      />
    </div>
  );
}

// ── File section (Staged / Unstaged) ──

function FileSection({
  label, count, labelColor, tree,
  batchAction, batchLabel, batchIcon,
  onFileClick, onFileAction, fileActionIcon,
}: {
  label: string;
  count: number;
  labelColor: string;
  tree: TreeNode[];
  batchAction: () => void;
  batchLabel: string;
  batchIcon: React.ReactNode;
  onFileClick: (f: ChangedFile) => void;
  onFileAction: (filePath: string) => void;
  fileActionIcon: string;
}) {
  const [expanded, setExpanded] = useState(true);

  if (count === 0) return null;

  return (
    <div className="border-b border-border">
      {/* Section header */}
      <div className="group flex items-center justify-between px-2 py-1.5 hover:bg-accent/50 transition-colors">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 flex-1 min-w-0"
        >
          {expanded
            ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${labelColor}`}>
            {label} ({count})
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={batchAction}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={batchLabel}
        >
          {batchIcon}
        </Button>
      </div>

      {expanded && (
        <div className="pb-1">
          {tree.map((node) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              onFileClick={onFileClick}
              onFileAction={onFileAction}
              fileActionIcon={fileActionIcon}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tree row (recursive) ──

function TreeRow({
  node, depth, onFileClick, onFileAction, fileActionIcon,
}: {
  node: TreeNode;
  depth: number;
  onFileClick: (f: ChangedFile) => void;
  onFileAction: (filePath: string) => void;
  fileActionIcon: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const paddingLeft = 8 + depth * 12;

  if (node.isDir) {
    return (
      <>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 py-0.5 hover:bg-accent/50 transition-colors text-left"
          style={{ paddingLeft }}
        >
          {expanded
            ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <Folder className="h-3 w-3 shrink-0 text-amber-400/70" />
          <span className="text-xs text-muted-foreground truncate">{node.name}</span>
        </button>
        {expanded && node.children
          .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              onFileAction={onFileAction}
              fileActionIcon={fileActionIcon}
            />
          ))}
      </>
    );
  }

  // File node
  const file = node.file!;
  const Icon = STATUS_ICON[file.status] || File;
  const color = STATUS_COLOR[file.status] || "text-muted-foreground";
  const letter = STATUS_LETTER[file.status] || "?";

  return (
    <div
      className="group flex items-center gap-1 py-0.5 hover:bg-accent/50 transition-colors cursor-pointer"
      style={{ paddingLeft: paddingLeft + 16 }} // extra indent for file (no chevron)
      onClick={() => onFileClick(file)}
    >
      <Icon className={`h-3 w-3 shrink-0 ${color}`} />
      <span className="text-xs text-foreground truncate flex-1">{node.name}</span>
      <span className={`text-[10px] font-mono font-bold shrink-0 mr-1 ${color}`}>{letter}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onFileAction(file.file); }}
        className="shrink-0 rounded px-1 text-xs font-mono text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground transition-all mr-1"
      >
        {fileActionIcon}
      </button>
    </div>
  );
}
