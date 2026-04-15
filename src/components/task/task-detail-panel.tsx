"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Terminal, Loader2, Square, FileText, CheckCircle2 } from "lucide-react";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { TaskMetadata } from "./task-metadata";
import { TaskDiffView } from "./task-diff-view";
import { TaskMergeConfirmDialog } from "./task-merge-confirm-dialog";
import { TerminalOutlet, useTerminalPortal } from "./terminal-portal";
import { getTaskExecutions, startPtyExecution, stopPtyExecution, resumePtyExecution } from "@/actions/agent-actions";
import { updateTaskStatus, checkWorktreeClean, commitWorktreeChanges } from "@/actions/task-actions";
import { toast } from "sonner";
import { getPrompts } from "@/actions/prompt-actions";
import { ExecutionTimeline } from "./execution-timeline";
import { TaskNotesPanel } from "./task-notes-panel";
import type { Task, TaskExecution } from "@prisma/client";
import { useI18n } from "@/lib/i18n";

interface TaskDetailPanelProps {
  task: Task;
  workspaceId: string;
  projectLocalPath?: string | null;
  onClose: () => void;
}

type TabType = "terminal" | "changes" | "notes";

export function TaskDetailPanel({
  task,
  workspaceId,
  projectLocalPath,
  onClose,
}: TaskDetailPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { removePortal } = useTerminalPortal();
  const [activeTab, setActiveTab] = useState<TabType>("terminal");
  const [diffData, setDiffData] = useState<any>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [taskStatus, setTaskStatus] = useState(task.status);

  // Sync taskStatus when task prop changes (e.g. drag-and-drop status change)
  useEffect(() => {
    setTaskStatus(task.status);
  }, [task.status]);

  // Terminal + execution history state — reset when task changes
  const [activeWorktreePath, setActiveWorktreePath] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionLoaded, setExecutionLoaded] = useState(false);
  const [pastExecutions, setPastExecutions] = useState<TaskExecution[]>([]);

  // Reset terminal state when switching tasks
  useEffect(() => {
    setActiveWorktreePath(null);
    setIsExecuting(false);
    setExecutionLoaded(false);
    setPastExecutions([]);
    setDiffData(null);
    setActiveTab("terminal");
  }, [task.id]);
  const [prompts, setPrompts] = useState<Array<{ id: string; name: string; isDefault: boolean }>>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);

  // Load prompts
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

  // Load executions: check for active terminal + build history
  useEffect(() => {
    let cancelled = false;
    getTaskExecutions(task.id).then((executions) => {
      if (cancelled) return;
      const latest = executions[0];
      if (latest?.status === "RUNNING") {
        // worktreePath for worktree mode, or project localPath for direct mode
        const cwdPath = latest.worktreePath || projectLocalPath || null;
        if (cwdPath) setActiveWorktreePath(cwdPath);
      }
      // Past executions = all non-RUNNING ones
      setPastExecutions(executions.filter((e) => e.status !== "RUNNING"));
      setExecutionLoaded(true);
    });
    return () => { cancelled = true; };
  }, [task.id]);

  // Fetch diff when Changes tab is active and task has been executed
  useEffect(() => {
    if (activeTab !== "changes" || taskStatus === "TODO" || taskStatus === "CANCELLED") return;
    let cancelled = false;
    setIsLoadingDiff(true);
    fetch(`/api/tasks/${task.id}/diff`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setDiffData(data?.files || data?.branchDeleted ? data : null);
      })
      .catch(() => { if (!cancelled) setDiffData(null); })
      .finally(() => { if (!cancelled) setIsLoadingDiff(false); });
    return () => { cancelled = true; };
  }, [activeTab, taskStatus, task.id]);

  const handleExecute = useCallback(async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    try {
      const { worktreePath } = await startPtyExecution(task.id, "", selectedPromptId);
      setActiveWorktreePath(worktreePath);
      setTaskStatus("IN_PROGRESS");
    } catch (err) {
      setIsExecuting(false);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [task.id, isExecuting, selectedPromptId]);

  const handleSessionEnd = useCallback(
    (exitCode: number) => {
      setIsExecuting(false);
      setActiveWorktreePath(null);
      removePortal(task.id);
      if (exitCode === 0) {
        setTaskStatus("IN_REVIEW");
      }
      getTaskExecutions(task.id).then((execs) => {
        setPastExecutions(execs.filter((e) => e.status !== "RUNNING"));
      });
      router.refresh();
    },
    [router, task.id]
  );

  const handleStop = useCallback(async () => {
    await stopPtyExecution(task.id);
    setIsExecuting(false);
    setActiveWorktreePath(null);
    setTaskStatus("IN_REVIEW");
    getTaskExecutions(task.id).then((execs) => {
      setPastExecutions(execs.filter((e) => e.status !== "RUNNING"));
    });
    router.refresh();
  }, [task.id, router]);

  const handleResume = useCallback(async (sessionId: string) => {
    setIsExecuting(true);
    try {
      const { worktreePath } = await resumePtyExecution(task.id, sessionId);
      setActiveWorktreePath(worktreePath);
      setTaskStatus("IN_PROGRESS");
    } catch {
      setIsExecuting(false);
    }
  }, [task.id]);

  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeCommitLog, setMergeCommitLog] = useState<string[]>([]);

  const handleComplete = useCallback(async () => {
    try {
      const result = await checkWorktreeClean(task.id);

      // Has worktree with uncommitted files → tell user to commit first
      if (result.hasWorktree && !result.clean) {
        toast.error(t("taskPage.uncommittedChanges", { count: String(result.files.length) }));
        return;
      }

      // Has worktree but no commits and no uncommitted files → nothing was done
      if (result.hasWorktree && result.clean && !result.hasCommits) {
        toast.error(t("taskPage.noChangesToComplete"));
        return;
      }

      // Has worktree with commits → show merge dialog
      if (result.hasWorktree && result.hasCommits) {
        setMergeCommitLog(result.commitLog);
        setShowMergeDialog(true);
        return;
      }

      // No worktree — just mark DONE
      await updateTaskStatus(task.id, "DONE");
      setTaskStatus("DONE");
      toast.success(t("taskPage.taskCompleted"));
      router.refresh();
    } catch {
      toast.error("Failed to complete task");
    }
  }, [task.id, router, t]);

  const handleMergeComplete = useCallback(() => {
    setTaskStatus("DONE");
    setShowMergeDialog(false);
    toast.success(t("taskPage.taskCompleted"));
    router.refresh();
  }, [router, t]);

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
    <div
      className="flex h-full w-[600px] flex-shrink-0 flex-col border-l border-border bg-sidebar"
      data-testid="task-detail-panel"
    >
      <TaskMetadata
        title={task.title}
        description={t("taskDetail.panelDescription")}
        branch={`task/${task.id}`}
        baseBranch={task.baseBranch}
        hasConversation={false}
        updatedAt={task.updatedAt}
        onBack={onClose}
      />

      {/* Tab bar + View Details button */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab("terminal")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md ${
              activeTab === "terminal"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Terminal className="h-3 w-3" />
            {t("terminal.execute")}
          </button>
          <button
            onClick={() => setActiveTab("changes")}
            className={`px-3 py-1 text-xs font-medium rounded-md ${
              activeTab === "changes"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("taskPage.changes")}
          </button>
          <button
            onClick={() => setActiveTab("notes")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md ${
              activeTab === "notes"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-3 w-3" />
            {t("taskPage.notes")}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {taskStatus === "IN_REVIEW" && (
            <button
              onClick={handleComplete}
              className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
            >
              <CheckCircle2 className="h-3 w-3" />
              {t("taskPage.completeTask")}
            </button>
          )}
          {taskStatus !== "DONE" && taskStatus !== "CANCELLED" && (
            <button
              onClick={() => router.push(`/workspaces/${workspaceId}/tasks/${task.id}`)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              {t("taskPage.viewDetails")}
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      {activeTab === "terminal" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          {!executionLoaded ? (
            <div className="flex h-full items-center justify-center bg-[#0f1419]">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
            </div>
          ) : activeWorktreePath ? (
            <div className="flex h-full flex-col overflow-hidden">
              {/* Stop button bar */}
              <div className="shrink-0 flex items-center justify-between border-b border-neutral-800 px-3 py-2 bg-[#0f1419]">
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
                />
              </div>
            </div>
          ) : taskStatus === "DONE" || taskStatus === "CANCELLED" ? (
            <div className="flex h-full flex-col overflow-hidden">
              {/* History only — no launch/resume for completed/cancelled tasks */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ExecutionTimeline executions={pastExecutions} />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col overflow-hidden">
              {/* Prompt selector + Launch button */}
              <div className="shrink-0 flex items-center gap-2 border-b border-border px-4 py-3">
                {prompts.length > 0 && (
                  <Select key={`prompt-${prompts.length}`} defaultValue={selectedPromptId ?? "none"} onValueChange={(v) => setSelectedPromptId(v === "none" ? null : v)}>
                    <SelectTrigger className="h-8 min-w-[120px]">
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
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {isExecuting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Terminal className="h-3.5 w-3.5" />
                  )}
                  {isExecuting ? t("terminal.executing") : t("terminal.launch")}
                </button>
              </div>
              {/* Execution history */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ExecutionTimeline executions={pastExecutions} onResume={handleResume} />
              </div>
            </div>
          )}
        </div>
      ) : activeTab === "changes" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          {isLoadingDiff ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">{t("taskPage.loadingDiff")}</p>
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
              <p className="text-sm text-muted-foreground">{t("taskPage.noChanges")}</p>
            </div>
          )}
        </div>
      ) : activeTab === "notes" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <TaskNotesPanel taskId={task.id} projectId={task.projectId} />
        </div>
      ) : null}

      {/* Merge confirm dialog — triggered by Complete button */}
      <TaskMergeConfirmDialog
        open={showMergeDialog}
        onOpenChange={setShowMergeDialog}
        taskId={task.id}
        taskTitle={task.title}
        baseBranch={(task as any).baseBranch ?? "main"}
        fileCount={diffData?.files?.length ?? 0}
        commitCount={diffData?.commitCount ?? 0}
        commitLog={mergeCommitLog}
        onMergeComplete={handleMergeComplete}
      />
    </div>
  );
}
