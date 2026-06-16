"use client";

import { useState, useCallback, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BoardStats } from "@/components/board/board-stats";
import { BoardFilters } from "@/components/board/board-filters";
import { KanbanBoard } from "@/components/board/kanban-board";
import { CreateTaskDialog } from "@/components/board/create-task-dialog";
import { RepoSidebar } from "@/components/repository/repo-sidebar";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { createTask, updateTaskStatus, updateTask, deleteTask, toggleTaskPinned, checkWorktreeClean } from "@/actions/task-actions";
import { startPtyExecution } from "@/actions/agent-actions";
import { getVersionsForPicker } from "@/actions/version-actions";
import { setLastProjectId } from "@/lib/workspace-last-project";
import { ProjectTabs } from "@/components/board/project-tabs";
import { TaskMergeConfirmDialog } from "@/components/task/task-merge-confirm-dialog";
import { TaskCancelConfirmDialog } from "@/components/task/task-cancel-confirm-dialog";
import type { TaskStatus, Priority } from "@prisma/client";
import { TOWER_LABEL_NAME } from "@/lib/constants";
import type { TaskWithLabels } from "@/types";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";


interface LabelOption {
  id: string;
  name: string;
  color: string;
  isBuiltin: boolean;
}

interface ProjectInfo {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  type: string;
  gitUrl: string | null;
  localPath: string | null;
}

interface BoardPageClientProps {
  workspaceId: string;
  projectId: string;
  project: ProjectInfo;
  projects: Array<{ id: string; name: string; alias: string | null }>;
  initialTasks: TaskWithLabels[];
  labels: LabelOption[];
  openTaskId?: string;
}

type VersionPickerItem = {
  id: string;
  number: string;
  name: string;
  isCurrent: boolean;
  status: string;
};

export function BoardPageClient({
  workspaceId,
  projectId,
  project,
  projects,
  initialTasks,
  labels,
  openTaskId,
}: BoardPageClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState("");
  const [versionFilter, setVersionFilter] = useState<string>("all"); // "all" | "backlog" | versionId
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<TaskStatus>("TODO");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(openTaskId ?? null);
  const [versions, setVersions] = useState<VersionPickerItem[]>([]);
  // Derive selectedTask from initialTasks so router.refresh auto-syncs status
  const selectedTask = selectedTaskId ? initialTasks.find((t) => t.id === selectedTaskId) ?? null : null;
  const [editingTask, setEditingTask] = useState<TaskWithLabels | null>(null);
  const [mergeDialog, setMergeDialog] = useState<{
    task: TaskWithLabels;
    commitLog: string[];
    commitCount: number;
  } | null>(null);
  const [cancelDialog, setCancelDialog] = useState<{
    task: TaskWithLabels;
    files: string[];
    commitLog: string[];
  } | null>(null);

  // Fetch versions for the active project (for the version picker in create dialog)
  useEffect(() => {
    getVersionsForPicker(projectId).then(setVersions).catch(() => setVersions([]));
  }, [projectId]);

  // 记忆当前工作区高亮的项目，供下次切回该工作区时恢复（覆盖 tab 切换、详情页返回等场景）。
  useEffect(() => {
    setLastProjectId(workspaceId, projectId);
  }, [workspaceId, projectId]);

  const defaultVersionId = versions.find((v) => v.isCurrent)?.id ?? null;

  const refreshData = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  // Auto-poll for external changes (MCP task creation, etc.)
  // Pause polling while create/edit dialog is open to prevent form reset
  useEffect(() => {
    if (showCreateDialog) return;
    const timer = setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [router, showCreateDialog]);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  // Run the same completion checks as the task detail panel's "Complete" button
  // (worktree clean check, merge dialog, cancel suggestion).
  // Returns false when the status change should NOT be persisted by the caller.
  const tryCompleteTask = useCallback(async (taskId: string) => {
    const task = initialTasks.find((x) => x.id === taskId);
    if (!task) return;
    try {
      const result = await checkWorktreeClean(taskId);

      if (result.hasWorktree && !result.clean) {
        toast.error(t("taskPage.uncommittedChanges", { count: String(result.files.length) }));
        refreshData();
        return;
      }

      if (result.hasWorktree && result.clean && !result.hasCommits) {
        toast.error(t("taskPage.noChangesToComplete"), {
          action: {
            label: t("taskPage.markAsCancelled"),
            onClick: () => {
              updateTaskStatus(taskId, "CANCELLED")
                .then(() => {
                  toast.success(t("taskPage.taskCancelled"));
                  refreshData();
                })
                .catch(() => toast.error("Failed to cancel task"));
            },
          },
        });
        refreshData();
        return;
      }

      if (result.hasWorktree && result.hasCommits) {
        setMergeDialog({ task, commitLog: result.commitLog, commitCount: result.commitLog.length });
        refreshData();
        return;
      }

      // No worktree — just mark DONE
      await updateTaskStatus(taskId, "DONE");
      toast.success(t("taskPage.taskCompleted"));
      refreshData();
    } catch {
      toast.error("Failed to complete task");
      refreshData();
    }
  }, [initialTasks, refreshData, t]);

  // Cancelled deletes the worktree dir + task branch — irreversible.
  // Always confirm for worktree-mode tasks (even if clean), because re-activating
  // the task only creates a fresh worktree/branch; the original cannot be restored.
  // Direct-mode tasks (no worktree) have nothing to clean — cancel directly.
  const tryCancelTask = useCallback(async (taskId: string) => {
    const task = initialTasks.find((x) => x.id === taskId);
    if (!task) return;
    try {
      const result = await checkWorktreeClean(taskId);
      if (!result.hasWorktree) {
        // No worktree to clean — safe to cancel directly
        await updateTaskStatus(taskId, "CANCELLED");
        toast.success(t("taskPage.taskCancelled"));
        refreshData();
        return;
      }
      setCancelDialog({ task, files: result.files, commitLog: result.commitLog });
      refreshData(); // roll back optimistic drag while user decides
    } catch {
      toast.error("Failed to cancel task");
      refreshData();
    }
  }, [initialTasks, refreshData, t]);

  const handleTaskMove = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    if (newStatus === "DONE") {
      await tryCompleteTask(taskId);
      return;
    }
    if (newStatus === "CANCELLED") {
      await tryCancelTask(taskId);
      return;
    }
    await updateTaskStatus(taskId, newStatus);
    refreshData();
  }, [refreshData, tryCompleteTask, tryCancelTask]);

  const handleCreateTask = useCallback(
    async (data: { title: string; description: string; priority: Priority; status: TaskStatus; labelIds: string[]; baseBranch?: string; subPath?: string; versionId?: string | null; autoStart?: boolean }) => {
      const created = await createTask({
        title: data.title,
        description: data.description,
        projectId,
        priority: data.priority,
        status: data.status,
        labelIds: data.labelIds,
        baseBranch: data.baseBranch,
        subPath: data.subPath,
        versionId: data.versionId ?? undefined,
      });
      // Auto-start runs the PTY in the background, then opens the board task
      // panel (right side) so the terminal is visible — without navigating to
      // the full detail page.
      if (data.autoStart && created?.id) {
        try {
          await startPtyExecution(created.id, "");
          setSelectedTaskId(created.id);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
      }
      refreshData();
    },
    [projectId, refreshData]
  );

  const handleUpdateTask = useCallback(async (taskId: string, data: { title: string; description: string; priority: Priority; labelIds: string[]; subPath?: string; versionId?: string | null }) => {
    await updateTask(taskId, { ...data, labelIds: data.labelIds });
    setEditingTask(null);
    refreshData();
  }, [refreshData]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    await deleteTask(taskId);
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
    }
    refreshData();
  }, [refreshData, selectedTaskId]);

  const handleTogglePin = useCallback(async (taskId: string) => {
    await toggleTaskPinned(taskId);
    refreshData();
  }, [refreshData]);

  const handleLaunchTask = useCallback(async (taskId: string) => {
    try {
      await startPtyExecution(taskId, "");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
    router.push(`/workspaces/${workspaceId}/tasks/${taskId}`);
  }, [router, workspaceId]);

  const handleContextMenuStatusChange = useCallback(async (taskId: string, status: TaskStatus) => {
    if (status === "DONE") {
      await tryCompleteTask(taskId);
      return;
    }
    if (status === "CANCELLED") {
      await tryCancelTask(taskId);
      return;
    }
    await updateTaskStatus(taskId, status);
    refreshData();
  }, [refreshData, tryCompleteTask, tryCancelTask]);

  const handleAddTaskToColumn = useCallback((status: TaskStatus) => {
    setCreateDefaultStatus(status);
    setEditingTask(null);
    setShowCreateDialog(true);
  }, []);

  const handleEditTask = useCallback((task: TaskWithLabels) => {
    setEditingTask(task);
    setShowCreateDialog(true);
  }, []);

  // Exclude Tower-labeled tasks from kanban (system workbench tasks)
  const boardTasks = initialTasks.filter(
    (t) => !t.labels?.some((tl) => tl.label.name === TOWER_LABEL_NAME && tl.label.isBuiltin)
  );

  const filteredTasks = boardTasks.filter((t) => {
    // Version filter: "all" = no filter, "backlog" = unassigned, else specific versionId
    if (versionFilter === "backlog") {
      if (t.versionId) return false;
    } else if (versionFilter !== "all") {
      if (t.versionId !== versionFilter) return false;
    }
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (
        !t.title.toLowerCase().includes(q) &&
        !(t.description?.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Project Tabs */}
        <div className="px-6 pt-3 pb-1">
          <ProjectTabs
            projects={projects}
            activeProjectId={projectId}
            onSelect={(id) => router.push(`/workspaces/${workspaceId}?projectId=${id}`, { scroll: false })}
          />
        </div>

        {/* Stats */}
        <BoardStats
          totalTasks={boardTasks.length}
          runningTasks={boardTasks.filter((t) => t.status === "IN_PROGRESS").length}
        />

        {/* Filters */}
        <BoardFilters
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          versions={versions}
          versionFilter={versionFilter}
          onVersionFilterChange={setVersionFilter}
          versionsHref={`/workspaces/${workspaceId}/projects/${projectId}/versions`}
          onCreateTask={() => {
            setEditingTask(null);
            setShowCreateDialog(true);
          }}
        />

        {/* Kanban Board */}
        <div className="flex-1 min-h-0 overflow-hidden p-4">
          <KanbanBoard
            initialTasks={filteredTasks}
            onTaskMove={handleTaskMove}
            onTaskClick={(task) => {
              setSelectedTaskId(task.id);
            }}
            onEditTask={handleEditTask}
            onAddTask={handleAddTaskToColumn}
            onDeleteTask={handleDeleteTask}
            onTogglePin={handleTogglePin}
            workspaceId={workspaceId}
            onContextMenuStatusChange={handleContextMenuStatusChange}
            onContextMenuLaunch={handleLaunchTask}
          />
        </div>

        {/* Create/Edit Task Dialog */}
        <CreateTaskDialog
          open={showCreateDialog}
          onOpenChange={(open) => {
            setShowCreateDialog(open);
            if (!open) setEditingTask(null);
          }}
          onSubmit={handleCreateTask}
          onUpdate={handleUpdateTask}
          defaultStatus={createDefaultStatus}
          editTask={editingTask}
          editTaskLabelIds={
            editingTask?.labels
              ? editingTask.labels.map((tl) => tl.labelId)
              : []
          }
          labels={labels.filter((l) => !(l.name === TOWER_LABEL_NAME && l.isBuiltin))}
          projectType={project.type}
          projectLocalPath={project.localPath}
          versions={versions}
          defaultVersionId={defaultVersionId}
        />
      </div>

      {/* Right: Task Detail Panel or Repo Sidebar */}
      {selectedTask ? (
        <TaskDetailPanel
          task={selectedTask}
          workspaceId={workspaceId}
          projectLocalPath={project.localPath}
          onClose={() => setSelectedTaskId(null)}
        />
      ) : (
        <RepoSidebar project={project} workspaceId={workspaceId} />
      )}

      {/* Merge confirm dialog — triggered by board context-menu DONE / drag-to-DONE */}
      {mergeDialog && (
        <TaskMergeConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setMergeDialog(null); }}
          taskId={mergeDialog.task.id}
          taskTitle={mergeDialog.task.title}
          baseBranch={mergeDialog.task.baseBranch ?? "main"}
          fileCount={0}
          commitCount={mergeDialog.commitCount}
          commitLog={mergeDialog.commitLog}
          onMergeComplete={() => {
            setMergeDialog(null);
            toast.success(t("taskPage.taskCompleted"));
            refreshData();
          }}
        />
      )}

      {/* Cancel confirm dialog — triggered for any worktree-mode task */}
      {cancelDialog && (
        <TaskCancelConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setCancelDialog(null); }}
          taskTitle={cancelDialog.task.title}
          uncommittedFiles={cancelDialog.files}
          commitLog={cancelDialog.commitLog}
          onConfirm={() => {
            const taskId = cancelDialog.task.id;
            setCancelDialog(null);
            updateTaskStatus(taskId, "CANCELLED")
              .then(() => {
                toast.success(t("taskPage.taskCancelled"));
                refreshData();
              })
              .catch(() => toast.error("Failed to cancel task"));
          }}
        />
      )}
    </div>
  );
}
