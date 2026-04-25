"use client";

import { useState, useCallback, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BoardStats } from "@/components/board/board-stats";
import { BoardFilters } from "@/components/board/board-filters";
import { KanbanBoard } from "@/components/board/kanban-board";
import { CreateTaskDialog } from "@/components/board/create-task-dialog";
import { RepoSidebar } from "@/components/repository/repo-sidebar";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { TaskOverviewDrawer } from "@/components/task/task-overview-drawer";
import { createTask, updateTaskStatus, updateTask, deleteTask, toggleTaskPinned } from "@/actions/task-actions";
import { startPtyExecution } from "@/actions/agent-actions";
import { ProjectTabs } from "@/components/board/project-tabs";
import type { TaskStatus, Priority } from "@prisma/client";
import type { TaskWithLabels } from "@/types";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<TaskStatus>("TODO");
  const [selectedTask, setSelectedTask] = useState<TaskWithLabels | null>(
    openTaskId ? initialTasks.find((t) => t.id === openTaskId) ?? null : null
  );
  const [editingTask, setEditingTask] = useState<TaskWithLabels | null>(null);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);

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

  const handleTaskMove = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    await updateTaskStatus(taskId, newStatus);
    if (selectedTask?.id === taskId) {
      setSelectedTask({ ...selectedTask, status: newStatus });
    }
    refreshData();
  }, [refreshData, selectedTask]);

  const handleCreateTask = useCallback(
    async (data: { title: string; description: string; priority: Priority; status: TaskStatus; labelIds: string[]; baseBranch?: string; subPath?: string }) => {
      await createTask({
        title: data.title,
        description: data.description,
        projectId,
        priority: data.priority,
        status: data.status,
        labelIds: data.labelIds,
        baseBranch: data.baseBranch,
        subPath: data.subPath,
      });
      refreshData();
    },
    [projectId, refreshData]
  );

  const handleUpdateTask = useCallback(async (taskId: string, data: { title: string; description: string; priority: Priority; labelIds: string[]; subPath?: string }) => {
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
    await updateTaskStatus(taskId, status);
    if (selectedTask?.id === taskId) {
      setSelectedTask({ ...selectedTask, status });
    }
    refreshData();
  }, [refreshData, selectedTask]);

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
    (t) => !t.labels?.some((tl) => tl.label.name === "Tower" && tl.label.isBuiltin)
  );

  const filteredTasks = searchQuery.trim()
    ? boardTasks.filter((t) => {
        const q = searchQuery.toLowerCase();
        return t.title.toLowerCase().includes(q) ||
          (t.description?.toLowerCase().includes(q) ?? false);
      })
    : boardTasks;

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
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
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
              if (task.status === "DONE" || task.status === "CANCELLED") {
                setDrawerTaskId(task.id);
              } else {
                setSelectedTask(task);
              }
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
          projectLocalPath={project.localPath}
          onClose={() => setSelectedTask(null)}
        />
      ) : (
        <RepoSidebar project={project} workspaceId={workspaceId} />
      )}

      {/* Task Overview Drawer for completed/cancelled tasks */}
      <TaskOverviewDrawer
        open={!!drawerTaskId}
        onOpenChange={(o) => { if (!o) setDrawerTaskId(null); }}
        taskId={drawerTaskId}
      />
    </div>
  );
}
