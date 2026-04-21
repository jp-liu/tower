"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GitBranch, Loader2, FolderTree, GitCompare, Eye, Terminal, Square, CheckCircle2, Search } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import Link from "next/link";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TaskDiffView } from "@/components/task/task-diff-view";
import { TaskMergeConfirmDialog } from "@/components/task/task-merge-confirm-dialog";
import { FileTree } from "@/components/task/file-tree";
import { CodeEditor } from "@/components/task/code-editor";
import { CodeSearch } from "@/components/task/code-search";
import { PreviewPanel } from "@/components/task/preview-panel";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { startPtyExecution, stopPtyExecution, resumePtyExecution, continueLatestPtyExecution, getTaskExecutions } from "@/actions/agent-actions";
import { updateTaskStatus, checkWorktreeClean, commitWorktreeChanges } from "@/actions/task-actions";
import { getPrompts } from "@/actions/prompt-actions";
import { ExecutionTimeline } from "@/components/task/execution-timeline";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import type { DiffResponse } from "@/lib/diff-parser";

import { TerminalOutlet, useTerminalPortal } from "@/components/task/terminal-portal";

interface TaskPageClientProps {
  task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    baseBranch: string | null;
    subPath: string | null;
    projectId: string;
    createdAt: string;
    updatedAt: string;
    project: { id: string; name: string; type: string; localPath: string | null; projectType: string; previewCommand: string | null; previewPort: number | null } | null;
  };
  workspaceId: string;
  workspaceName: string;
  latestExecution?: {
    worktreePath: string | null;
    worktreeBranch: string | null;
    status: string;
  } | null;
  executions?: Array<{
    id: string;
    status: string;
    sessionId?: string | null;
    summary?: string | null;
    gitLog?: string | null;
    gitStats?: string | null;
    exitCode?: number | null;
    terminalLog?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
  }>;
}

type DiffData = DiffResponse & { commitCount: number; hasUncommitted?: boolean; branchDeleted?: boolean };

const STATUS_LABELS: Record<string, string> = {
  TODO: "待处理",
  IN_PROGRESS: "执行中",
  IN_REVIEW: "待评审",
  DONE: "已完成",
  CANCELLED: "已取消",
};

const STATUS_COLORS: Record<string, string> = {
  TODO: "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  IN_REVIEW: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  DONE: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  CANCELLED: "bg-muted text-muted-foreground",
};

export function TaskPageClient({ task, workspaceId, workspaceName, latestExecution, executions = [] }: TaskPageClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const { removePortal } = useTerminalPortal();
  const [taskStatus, setTaskStatus] = useState(task.status);
  const [diffData, setDiffData] = useState<DiffData | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [prompts, setPrompts] = useState<Array<{ id: string; name: string; isDefault: boolean }>>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  // Only show live terminal if execution is actively RUNNING
  const [activeWorktreePath, setActiveWorktreePath] = useState<string | null>(
    latestExecution?.status === "RUNNING" ? (latestExecution?.worktreePath ?? null) : null
  );
  const respawningRef = useRef(false);

  // Effective file root: worktreePath (worktree mode) or localPath+subPath (direct mode)
  const directCwd = task.project?.localPath
    ? (task.subPath ? `${task.project.localPath}/${task.subPath}` : task.project.localPath)
    : null;
  const fileRootPath = latestExecution?.worktreePath ?? directCwd;

  // Load available prompts
  useEffect(() => {
    let cancelled = false;
    getPrompts().then((data) => {
      if (cancelled) return;
      setPrompts(data.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault })));
      const defaultP = data.find((p) => p.isDefault);
      if (defaultP) setSelectedPromptId(defaultP.id);
    });
    return () => { cancelled = true; };
  }, []);

  // Refresh execution status client-side (server props may be stale)
  useEffect(() => {
    let cancelled = false;
    getTaskExecutions(task.id).then((executions) => {
      if (cancelled) return;
      const latest = executions[0];
      if (latest?.status === "RUNNING") {
        const cwdPath = latest.worktreePath || task.project?.localPath || null;
        if (cwdPath) setActiveWorktreePath(cwdPath);
      }
    });
    return () => { cancelled = true; };
  }, [task.id, task.project?.localPath]);

  // Auto-fetch diff when task has an execution (IN_PROGRESS, IN_REVIEW, DONE)
  useEffect(() => {
    if (taskStatus === "TODO" || taskStatus === "CANCELLED") return;
    let cancelled = false;
    setIsLoadingDiff(true);
    fetch(`/api/tasks/${task.id}/diff`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: DiffData & { branchDeleted?: boolean }) => {
        if (cancelled) return;
        // Accept branchDeleted responses or valid diff responses
        if (!data.files && !data.branchDeleted) { setDiffData(null); return; }
        setDiffData(data as DiffData);
      })
      .catch(() => {
        if (cancelled) return;
        setDiffData(null);
        toast.error(t("taskPage.loadDiffFailed"));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDiff(false);
      });
    return () => { cancelled = true; };
  }, [task.id, taskStatus]);

  const handleExecute = useCallback(async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    try {
      const { worktreePath } = await startPtyExecution(task.id, "", selectedPromptId);
      setActiveWorktreePath(worktreePath);
    } catch (err) {
      setIsExecuting(false);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [task.id, isExecuting, selectedPromptId]);

  const handleSessionEnd = useCallback((exitCode: number) => {
    if (respawningRef.current) return;
    setIsExecuting(false);
    setActiveWorktreePath(null);
    removePortal(task.id);
    if (exitCode === 0) {
      setTaskStatus("IN_REVIEW");
    }
    router.refresh();
  }, [router, removePortal, task.id]);

  const handleStop = useCallback(async () => {
    await stopPtyExecution(task.id);
    setIsExecuting(false);
    setActiveWorktreePath(null);
    setTaskStatus("IN_REVIEW");
    router.refresh();
  }, [task.id, router]);

  const handleResume = useCallback(async (sessionId: string) => {
    setIsExecuting(true);
    respawningRef.current = true;
    setActiveWorktreePath(null);
    await new Promise((r) => setTimeout(r, 50));
    try {
      const { worktreePath } = await resumePtyExecution(task.id, sessionId);
      respawningRef.current = false;
      setActiveWorktreePath(worktreePath);
      setTaskStatus("IN_PROGRESS");
    } catch {
      respawningRef.current = false;
      setIsExecuting(false);
    }
  }, [task.id]);

  const handleContinueLatest = useCallback(async () => {
    setIsExecuting(true);
    respawningRef.current = true;
    setActiveWorktreePath(null);
    await new Promise((r) => setTimeout(r, 50));
    try {
      const { worktreePath } = await continueLatestPtyExecution(task.id);
      respawningRef.current = false;
      setActiveWorktreePath(worktreePath);
      setTaskStatus("IN_PROGRESS");
    } catch (err) {
      setIsExecuting(false);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [task.id]);

  const handleMergeComplete = useCallback(() => {
    setTaskStatus("DONE");
    setShowMergeDialog(false);
    toast.success(t("taskPage.taskCompleted"));
    // Refresh diff data to show final state
    fetch(`/api/tasks/${task.id}/diff`).then((res) => {
      if (res.ok) return res.json();
    }).then((data) => {
      if (data?.files) setDiffData(data);
    }).catch(() => {
      toast.error(t("taskPage.loadDiffFailed"));
    });
    router.refresh();
  }, [router, t, task.id]);

  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeCommitLog, setMergeCommitLog] = useState<string[]>([]);

  const handleComplete = useCallback(async () => {
    try {
      const result = await checkWorktreeClean(task.id);

      if (result.hasWorktree && !result.clean) {
        toast.error(t("taskPage.uncommittedChanges", { count: String(result.files.length) }));
        return;
      }

      if (result.hasWorktree && result.clean && !result.hasCommits) {
        toast.error(t("taskPage.noChangesToComplete"));
        return;
      }

      if (result.hasWorktree && result.hasCommits) {
        setMergeCommitLog(result.commitLog);
        setShowMergeDialog(true);
        return;
      }

      // No worktree — just mark DONE
      await updateTaskStatus(task.id, "DONE");
      setTaskStatus("DONE");
      router.refresh();
      toast.success(t("taskPage.taskCompleted"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [task.id, router, t, latestExecution]);

  const handleCommit = useCallback(async (message: string) => {
    try {
      const { hash } = await commitWorktreeChanges(task.id, message);
      toast.success(t("diff.commitSuccess", { hash }));
      router.refresh();
      const res = await fetch(`/api/tasks/${task.id}/diff`);
      if (res.ok) {
        const data = await res.json();
        setDiffData(data?.files ? data : null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Commit failed");
    }
  }, [task.id, router, t]);

  return (
    <PanelGroup direction="horizontal" className="h-screen bg-background">
      {/* Left panel: Terminal — 35% default, 20% minimum */}
      <Panel defaultSize={35} minSize={20} className="flex flex-col border-r border-border bg-sidebar">
        {/* Header: back + breadcrumb + status + branch */}
        <div className="border-b border-border px-4 py-3">
          {/* Back button + breadcrumb: workspace / project / task */}
          <div className="flex items-center gap-2">
            <Link
              href={`/workspaces/${workspaceId}?projectId=${task.projectId}&taskId=${task.id}`}
              className="flex shrink-0 items-center justify-center rounded-md border border-border bg-muted px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="mr-1 h-3 w-3" />
              {t("taskPage.back")}
            </Link>
            <div className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
              <span className="shrink-0">{workspaceName}</span>
              {task.project && (
                <>
                  <span className="shrink-0">/</span>
                  <span className="shrink-0">{task.project.name}</span>
                </>
              )}
              <span className="shrink-0">/</span>
              <span className="truncate font-semibold text-foreground">{task.title}</span>
            </div>
          </div>
          {/* Status + branch badges */}
          <div className="mt-2 flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[taskStatus] ?? "bg-muted text-muted-foreground"}`}>
              {STATUS_LABELS[taskStatus] ?? taskStatus}
            </span>
            {(task.baseBranch || latestExecution?.worktreeBranch) && (
              <Badge variant="secondary" className="gap-1 border border-border bg-muted font-mono text-[10px] text-muted-foreground">
                <GitBranch className="h-2.5 w-2.5" />
                {task.baseBranch ?? latestExecution?.worktreeBranch}
              </Badge>
            )}
          </div>
          {/* Complete button — only for IN_REVIEW tasks */}
          {taskStatus === "IN_REVIEW" && (
            <div className="mt-2">
              <button
                onClick={handleComplete}
                className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("taskPage.completeTask")}
              </button>
            </div>
          )}
        </div>

        {/* Terminal fills all remaining space */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeWorktreePath ? (
            <div className="flex h-full flex-col overflow-hidden">
              {/* Stop button bar */}
              <div className="shrink-0 flex items-center justify-between border-b border-neutral-800 px-3 py-2 bg-[#0a0a0a]">
                <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {t("execution.running")}
                </span>
                <Tooltip>
                  <TooltipTrigger
                    onClick={handleStop}
                    className="flex items-center gap-1.5 rounded-md bg-red-500/15 px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-500/25 transition-colors"
                  >
                    <Square className="h-3 w-3" />
                    {t("terminal.stopExecution")}
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t("terminal.stopHint")}
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex-1 min-h-0">
                <TerminalOutlet
                  taskId={task.id}
                  worktreePath={activeWorktreePath}
                  onSessionEnd={handleSessionEnd}
                  onFileOpen={(fullPath) => {
                    setSelectedFilePath(fullPath);
                    setActiveTab("files");
                  }}
                />
              </div>
            </div>
          ) : taskStatus === "DONE" || taskStatus === "CANCELLED" ? (
            <div className="flex h-full flex-col overflow-hidden bg-[#0a0a0a]">
              {/* Execution history only — no launch/resume for completed/cancelled tasks */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ExecutionTimeline executions={executions} />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col overflow-hidden bg-[#0a0a0a]">
              {/* Launch button */}
              <div className="shrink-0 flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
                {/* Prompt selector */}
                {prompts.length > 0 && (
                  <Select key={`prompt-${prompts.length}`} defaultValue={selectedPromptId ?? "none"} onValueChange={(v) => setSelectedPromptId(v === "none" ? null : v)}>
                    <SelectTrigger className="h-9 min-w-[140px]">
                      <span className="text-left truncate">
                        {selectedPromptId
                          ? prompts.find((p) => p.id === selectedPromptId)?.name ?? t("terminal.noPrompt")
                          : t("terminal.noPrompt")}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="min-w-[200px]">
                      <SelectItem value="none">{t("terminal.noPrompt")}</SelectItem>
                      {prompts.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}{p.isDefault ? " ★" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <button
                  onClick={handleExecute}
                  disabled={isExecuting}
                  className="flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {isExecuting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Terminal className="h-4 w-4" />
                  )}
                  {isExecuting ? t("terminal.executing") : t("terminal.launch")}
                </button>
              </div>
              {/* Execution history */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ExecutionTimeline executions={executions} onResume={handleResume} onContinueLatest={handleContinueLatest} />
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* Drag resize handle — 4px, bg-border at rest, bg-primary/20 on hover per UI-SPEC */}
      <PanelResizeHandle className="relative w-px bg-border transition-colors hover:bg-primary/20 active:bg-primary/40 cursor-col-resize" />

      {/* Right panel: Tabs — 65% default, 20% minimum per D-02 and D-03 */}
      <Panel defaultSize={65} minSize={20} className="flex flex-col">
        {(() => {
          // DONE + worktree mode: worktree is gone, hide files/preview, show only changes
          const isWorktreeDone = taskStatus === "DONE" && !!task.baseBranch;
          const defaultTab = isWorktreeDone ? "changes" : "files";
          return (
        <Tabs value={activeTab ?? defaultTab} onValueChange={setActiveTab} key={defaultTab} className="flex h-full flex-col gap-0">
          {/* Tab bar — segmented control style matching Settings page */}
          <div className="flex shrink-0 items-center border-b border-border px-3 py-2">
            <TabsList className="h-auto border border-border">
              {!isWorktreeDone && (
                <TabsTrigger value="files" className="data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                  <FolderTree className="h-3.5 w-3.5" />
                  {t("taskPage.tabFiles")}
                </TabsTrigger>
              )}
              <TabsTrigger value="changes" className="data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                <GitCompare className="h-3.5 w-3.5" />
                {t("taskPage.changes")}
              </TabsTrigger>
              {!isWorktreeDone && task.project?.projectType !== "BACKEND" && (
                <TabsTrigger value="preview" className="data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                  <Eye className="h-3.5 w-3.5" />
                  {t("taskPage.tabPreview")}
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          {/* Files tab — Phase 21+64: FileTree/Search sub-tabs + CodeEditor */}
          <TabsContent value="files" className="flex-1 min-h-0 overflow-hidden">
            <div className="flex h-full flex-row overflow-hidden">
              {/* Left: sub-tabs for file tree vs search (240px fixed) */}
              <div className="w-60 flex-none border-r border-border overflow-hidden flex flex-col">
                <Tabs defaultValue="filetree" className="flex h-full flex-col gap-0">
                  {/* Sub-tab bar */}
                  <div className="flex shrink-0 border-b border-border px-2 py-1.5">
                    <TabsList className="h-auto border border-border w-full">
                      <TabsTrigger value="filetree" className="flex-1 text-xs gap-1 data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                        <FolderTree className="h-3 w-3" />
                        {t("taskPage.tabFileTree")}
                      </TabsTrigger>
                      <TabsTrigger value="search" className="flex-1 text-xs gap-1 data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                        <Search className="h-3 w-3" />
                        {t("taskPage.tabSearch")}
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  {/* File tree sub-tab */}
                  <TabsContent value="filetree" className="flex-1 min-h-0 overflow-hidden mt-0">
                    <FileTree
                      worktreePath={fileRootPath ?? null}
                      baseBranch={task.baseBranch ?? null}
                      worktreeBranch={latestExecution?.worktreeBranch ?? null}
                      executionStatus={latestExecution?.status ?? "COMPLETED"}
                      onFileSelect={(absolutePath) => {
                        setSelectedFilePath(absolutePath);
                        setSelectedLine(null);
                      }}
                    />
                  </TabsContent>
                  {/* Search sub-tab */}
                  <TabsContent value="search" className="flex-1 min-h-0 overflow-hidden mt-0">
                    <CodeSearch
                      localPath={fileRootPath ?? task.project?.localPath ?? null}
                      onResultSelect={(absolutePath, line) => {
                        setSelectedFilePath(absolutePath);
                        setSelectedLine(line);
                        setActiveTab("files");
                      }}
                    />
                  </TabsContent>
                </Tabs>
              </div>
              {/* Right: Monaco editor, fills remaining width */}
              <div className="flex-1 min-w-0 overflow-hidden">
                {fileRootPath ? (
                  <CodeEditor
                    worktreePath={fileRootPath}
                    selectedFilePath={selectedFilePath}
                    selectedLine={selectedLine}
                    onFilePathChange={setSelectedFilePath}
                    onSave={() => setPreviewRefreshKey((k) => k + 1)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-sm text-muted-foreground">{t("editor.noWorktree")}</p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Changes tab — functional, uses existing TaskDiffView */}
          <TabsContent value="changes" className="flex-1 min-h-0 overflow-auto">
            {isLoadingDiff ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : diffData?.branchDeleted ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">{t("taskPage.branchDeleted")}</p>
              </div>
            ) : diffData ? (
              <TaskDiffView
                files={diffData.files}
                totalAdded={diffData.totalAdded}
                totalRemoved={diffData.totalRemoved}
                hasConflicts={diffData.hasConflicts}
                conflictFiles={diffData.conflictFiles}
                onCommit={handleCommit}
                hasUncommitted={diffData.hasUncommitted}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {taskStatus === "TODO" ? t("taskPage.startExecution") : t("taskPage.noDiff")}
                </p>
              </div>
            )}
          </TabsContent>

          {/* Preview tab — Phase 23: functional PreviewPanel */}
          <TabsContent value="preview" className="flex-1 min-h-0 overflow-hidden">
            <PreviewPanel
              taskId={task.id}
              worktreePath={latestExecution?.worktreePath ?? null}
              previewCommand={task.project?.previewCommand ?? null}
              previewPort={task.project?.previewPort ?? null}
              refreshKey={previewRefreshKey}
              projectId={task.projectId}
              previewUrl={previewUrl}
              onPreviewUrlChange={setPreviewUrl}
            />
          </TabsContent>
        </Tabs>
          );
        })()}
      </Panel>

      {/* Merge confirm dialog — triggered by Complete button */}
      <TaskMergeConfirmDialog
        open={showMergeDialog}
        onOpenChange={setShowMergeDialog}
        taskId={task.id}
        taskTitle={task.title}
        baseBranch={task.baseBranch ?? "main"}
        fileCount={diffData?.files?.length ?? 0}
        commitCount={diffData?.commitCount ?? 0}
        commitLog={mergeCommitLog}
        onMergeComplete={handleMergeComplete}
      />
    </PanelGroup>
  );
}
