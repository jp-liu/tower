"use client";

import { useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BoardStats } from "@/components/board/board-stats";
import { BoardFilters } from "@/components/board/board-filters";
import { KanbanBoard } from "@/components/board/kanban-board";
import { CreateTaskDialog } from "@/components/board/create-task-dialog";
import { RepoSidebar } from "@/components/repository/repo-sidebar";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { createTask, updateTaskStatus, updateTask, deleteTask } from "@/actions/task-actions";
import { startPtyExecution } from "@/actions/agent-actions";
import { ProjectTabs } from "@/components/board/project-tabs";
import type { TaskStatus, Priority } from "@prisma/client";
import type { TaskWithLabels } from "@/types";

type FilterType = "ALL" | "IN_PROGRESS" | "IN_REVIEW";

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
  totalTasks: number;
  runningTasks: number;
  labels: LabelOption[];
  openTaskId?: string;
}

export function BoardPageClient({
  workspaceId,
  projectId,
  project,
  projects,
  initialTasks,
  totalTasks,
  runningTasks,
  labels,
  openTaskId,
}: BoardPageClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<TaskStatus>("TODO");
  const [selectedTask, setSelectedTask] = useState<TaskWithLabels | null>(
    openTaskId ? initialTasks.find((t) => t.id === openTaskId) ?? null : null
  );
  const [editingTask, setEditingTask] = useState<TaskWithLabels | null>(null);

  const refreshData = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const handleFilterChange = useCallback((newFilter: FilterType) => {
    setFilter(newFilter);
  }, []);

  const handleTaskMove = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    await updateTaskStatus(taskId, newStatus);
    refreshData();
  }, [refreshData]);

  const handleCreateTask = useCallback(
    async (data: { title: string; description: string; priority: Priority; status: TaskStatus; labelIds: string[]; baseBranch?: string }) => {
      await createTask({
        title: data.title,
        description: data.description,
        projectId,
        priority: data.priority,
        status: data.status,
        labelIds: data.labelIds,
        baseBranch: data.baseBranch,
      });
      refreshData();
    },
    [projectId, refreshData]
  );

  const handleUpdateTask = useCallback(async (taskId: string, data: { title: string; description: string; priority: Priority; labelIds: string[] }) => {
    await updateTask(taskId, { ...data, labelIds: data.labelIds });
    setEditingTask(null);
    refreshData();
  }, [refreshData]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    await deleteTask(taskId);
    if (selectedTask?.id === taskId) {
      setSelectedTask(null);
    }
    refreshData();
  }, [refreshData, selectedTask]);

  const handleLaunchTask = useCallback(async (taskId: string) => {
    try {
      await startPtyExecution(taskId, "");
    } catch {
      // Ignore errors (e.g., already running) — navigation still proceeds
    }
    router.push(`/workspaces/${workspaceId}/tasks/${taskId}`);
  }, [router, workspaceId]);

  const handleContextMenuStatusChange = useCallback(async (taskId: string, status: TaskStatus) => {
    await updateTaskStatus(taskId, status);
    refreshData();
  }, [refreshData]);

  const handleAddTaskToColumn = useCallback((status: TaskStatus) => {
    setCreateDefaultStatus(status);
    setEditingTask(null);
    setShowCreateDialog(true);
  }, []);

  const handleEditTask = useCallback((task: TaskWithLabels) => {
    setEditingTask(task);
    setShowCreateDialog(true);
  }, []);

  const filteredTasks =
    filter === "ALL"
      ? initialTasks
      : initialTasks.filter((t) => t.status === filter);

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Project Tabs — always show, single project also shown */}
        <div className="px-6 pt-3 pb-1">
          <ProjectTabs
            projects={projects}
            activeProjectId={projectId}
            onSelect={(id) => router.push(`/workspaces/${workspaceId}?projectId=${id}`, { scroll: false })}
          />
        </div>

        {/* Stats */}
        <BoardStats
          totalTasks={totalTasks}
          runningTasks={runningTasks}
        />

        {/* Filters */}
        <BoardFilters
          activeFilter={filter}
          onFilterChange={handleFilterChange}
          onCreateTask={() => {
            setEditingTask(null);
            setShowCreateDialog(true);
          }}
        />

        {/* Kanban Board */}
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <KanbanBoard
            initialTasks={filteredTasks}
            onTaskMove={handleTaskMove}
            onTaskClick={(task) => setSelectedTask(task)}
            onEditTask={handleEditTask}
            onAddTask={handleAddTaskToColumn}
            onDeleteTask={handleDeleteTask}
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
          labels={labels}
          projectType={project.type}
          projectLocalPath={project.localPath}
        />
      </div>

      {/* Right: Task Detail Panel or Repo Sidebar */}
      {selectedTask ? (
        <TaskDetailPanel
          task={selectedTask}
          workspaceId={workspaceId}
          onClose={() => setSelectedTask(null)}
        />
      ) : (
        <RepoSidebar project={project} workspaceId={workspaceId} />
      )}
    </div>
  );
}
