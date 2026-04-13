"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GitBranch, Loader2, FolderTree, GitCompare, Eye, Terminal, Square } from "lucide-react";
import Link from "next/link";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TaskDiffView } from "@/components/task/task-diff-view";
import { FileTree } from "@/components/task/file-tree";
import { CodeEditor } from "@/components/task/code-editor";
import { PreviewPanel } from "@/components/task/preview-panel";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { startPtyExecution, stopPtyExecution, resumePtyExecution } from "@/actions/agent-actions";
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
    projectId: string;
    createdAt: string;
    updatedAt: string;
    project: { id: string; name: string; type: string; localPath: string | null; projectType: string; previewCommand: string | null } | null;
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

type DiffData = DiffResponse & { commitCount: number };

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
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [prompts, setPrompts] = useState<Array<{ id: string; name: string; isDefault: boolean }>>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  // Only show live terminal if execution is actively RUNNING
  const [activeWorktreePath, setActiveWorktreePath] = useState<string | null>(
    latestExecution?.status === "RUNNING" ? (latestExecution?.worktreePath ?? null) : null
  );

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

  // Auto-fetch diff when task is IN_REVIEW
  useEffect(() => {
    if (taskStatus !== "IN_REVIEW") return;
    let cancelled = false;
    setIsLoadingDiff(true);
    fetch(`/api/tasks/${task.id}/diff`)
      .then((res) => res.json())
      .then((data: DiffData) => {
        if (cancelled) return;
        setDiffData(data);
      })
      .catch(() => {
        if (cancelled) return;
        setDiffData(null);
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
      if (worktreePath) {
        setActiveWorktreePath(worktreePath);
      }
    } catch (err) {
      setIsExecuting(false);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [task.id, isExecuting, selectedPromptId]);

  const handleSessionEnd = useCallback((exitCode: number) => {
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
    router.refresh();
  }, [task.id, router]);

  const handleResume = useCallback(async (sessionId: string) => {
    setIsExecuting(true);
    try {
      const { worktreePath } = await resumePtyExecution(task.id, sessionId);
      if (worktreePath) {
        setActiveWorktreePath(worktreePath);
      }
      setTaskStatus("IN_PROGRESS");
    } catch {
      setIsExecuting(false);
    }
  }, [task.id]);

  const handleMergeComplete = useCallback(() => {
    setTaskStatus("DONE");
    router.refresh();
  }, [router]);

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
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 rounded-md bg-red-500/15 px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-500/25 transition-colors"
                >
                  <Square className="h-3 w-3" />
                  {t("terminal.stopExecution")}
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <TerminalOutlet
                  taskId={task.id}
                  worktreePath={activeWorktreePath}
                  onSessionEnd={handleSessionEnd}
                />
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
                <ExecutionTimeline executions={executions} onResume={handleResume} />
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* Drag resize handle — 4px, bg-border at rest, bg-primary/20 on hover per UI-SPEC */}
      <PanelResizeHandle className="relative w-px bg-border transition-colors hover:bg-primary/20 active:bg-primary/40 cursor-col-resize" />

      {/* Right panel: Tabs — 65% default, 20% minimum per D-02 and D-03 */}
      <Panel defaultSize={65} minSize={20} className="flex flex-col">
        <Tabs defaultValue="files" className="flex h-full flex-col gap-0">
          {/* Tab bar — segmented control style matching Settings page */}
          <div className="flex shrink-0 items-center border-b border-border px-3 py-2">
            <TabsList className="h-auto border border-border">
              <TabsTrigger value="files" className="data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                <FolderTree className="h-3.5 w-3.5" />
                {t("taskPage.tabFiles")}
              </TabsTrigger>
              <TabsTrigger value="changes" className="data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                <GitCompare className="h-3.5 w-3.5" />
                {t("taskPage.changes")}
              </TabsTrigger>
              {task.project?.projectType !== "BACKEND" && (
                <TabsTrigger value="preview" className="data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:bg-background dark:data-active:border-transparent">
                  <Eye className="h-3.5 w-3.5" />
                  {t("taskPage.tabPreview")}
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          {/* Files tab — Phase 21: FileTree + CodeEditor split layout */}
          <TabsContent value="files" className="flex-1 min-h-0 overflow-hidden">
            <div className="flex h-full flex-row overflow-hidden">
              {/* Left: file tree, fixed 240px */}
              <div className="w-60 flex-none border-r border-border overflow-hidden">
                <FileTree
                  worktreePath={latestExecution?.worktreePath ?? null}
                  baseBranch={task.baseBranch ?? null}
                  worktreeBranch={latestExecution?.worktreeBranch ?? null}
                  executionStatus={latestExecution?.status ?? "COMPLETED"}
                  onFileSelect={(absolutePath) => {
                    setSelectedFilePath(absolutePath);
                  }}
                />
              </div>
              {/* Right: Monaco editor, fills remaining width */}
              <div className="flex-1 min-w-0 overflow-hidden">
                {latestExecution?.worktreePath ? (
                  <CodeEditor
                    worktreePath={latestExecution.worktreePath}
                    selectedFilePath={selectedFilePath}
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
            ) : diffData ? (
              <TaskDiffView
                files={diffData.files}
                totalAdded={diffData.totalAdded}
                totalRemoved={diffData.totalRemoved}
                hasConflicts={diffData.hasConflicts}
                conflictFiles={diffData.conflictFiles}
                commitCount={diffData.commitCount}
                taskId={task.id}
                taskTitle={task.title}
                taskStatus={taskStatus}
                baseBranch={task.baseBranch ?? "main"}
                onMergeComplete={handleMergeComplete}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {taskStatus === "IN_REVIEW" ? t("taskPage.loadingDiff") : t("taskPage.startExecution")}
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
              refreshKey={previewRefreshKey}
              projectId={task.projectId}
              previewUrl={previewUrl}
              onPreviewUrlChange={setPreviewUrl}
            />
          </TabsContent>
        </Tabs>
      </Panel>
    </PanelGroup>
  );
}
