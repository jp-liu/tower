"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GitBranch, Loader2, FolderTree, GitCompare, Eye, Terminal } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TaskDiffView } from "@/components/task/task-diff-view";
import { FileTree } from "@/components/task/file-tree";
import { CodeEditor } from "@/components/task/code-editor";
import { PreviewPanel } from "@/components/task/preview-panel";
import { Badge } from "@/components/ui/badge";
import { startPtyExecution } from "@/actions/agent-actions";
import { useI18n } from "@/lib/i18n";
import type { DiffResponse } from "@/lib/diff-parser";

const TaskTerminal = dynamic(
  () => import("@/components/task/task-terminal").then(m => ({ default: m.TaskTerminal })),
  { ssr: false }
);

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

export function TaskPageClient({ task, workspaceId, workspaceName, latestExecution }: TaskPageClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [taskStatus, setTaskStatus] = useState(task.status);
  const [diffData, setDiffData] = useState<DiffData | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeWorktreePath, setActiveWorktreePath] = useState<string | null>(
    latestExecution?.worktreePath ?? null
  );

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
    if (!prompt.trim() || isExecuting) return;
    setIsExecuting(true);
    try {
      const { worktreePath } = await startPtyExecution(task.id, prompt.trim());
      if (worktreePath) {
        setActiveWorktreePath(worktreePath);
      }
      // Terminal auto-connects via WebSocket; status update fires onSessionEnd
    } catch (err) {
      // Show minimal error — terminal area will show nothing if PTY failed to start
      console.error("[execute]", err);
      setIsExecuting(false);
    }
  }, [task.id, prompt, isExecuting]);

  const handleSessionEnd = useCallback((exitCode: number) => {
    setIsExecuting(false);
    if (exitCode === 0) {
      setTaskStatus("IN_REVIEW");
    }
    router.refresh();
  }, [router]);

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
              href={`/workspaces/${workspaceId}`}
              className="flex shrink-0 items-center justify-center rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
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

        {/* Terminal fills available space */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <TaskTerminal
            taskId={task.id}
            worktreePath={activeWorktreePath}
            onSessionEnd={handleSessionEnd}
          />
        </div>

        {/* Execute controls — bottom bar */}
        <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3">
          <textarea
            className="w-full resize-none rounded-md border border-border bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-0 disabled:opacity-50"
            rows={3}
            placeholder={t("terminal.promptPlaceholder")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isExecuting}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleExecute();
              }
            }}
          />
          <button
            onClick={handleExecute}
            disabled={isExecuting || !prompt.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isExecuting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("terminal.executing")}
              </>
            ) : (
              <>
                <Terminal className="h-4 w-4" />
                {t("terminal.execute")}
              </>
            )}
          </button>
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
            />
          </TabsContent>
        </Tabs>
      </Panel>
    </PanelGroup>
  );
}
