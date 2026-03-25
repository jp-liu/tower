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
import { sendTaskMessage } from "@/actions/agent-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Task, TaskStatus, Priority } from "@prisma/client";

type FilterType = "ALL" | "IN_PROGRESS" | "IN_REVIEW";

interface BoardPageClientProps {
  workspaceId: string;
  projectId: string;
  projectName: string;
  projects: Array<{ id: string; name: string }>;
  initialTasks: Task[];
  totalTasks: number;
  runningTasks: number;
}

export function BoardPageClient({
  workspaceId,
  projectId,
  projectName,
  projects,
  initialTasks,
  totalTasks,
  runningTasks,
}: BoardPageClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<TaskStatus>("TODO");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

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
    async (data: { title: string; description: string; priority: Priority; status: TaskStatus }) => {
      await createTask({
        title: data.title,
        description: data.description,
        projectId,
        priority: data.priority,
        status: data.status,
      });
      refreshData();
    },
    [projectId, refreshData]
  );

  const handleUpdateTask = useCallback(async (taskId: string, data: { title: string; description: string; priority: Priority }) => {
    await updateTask(taskId, data);
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

  const handleAddTaskToColumn = useCallback((status: TaskStatus) => {
    setCreateDefaultStatus(status);
    setEditingTask(null);
    setShowCreateDialog(true);
  }, []);

  const handleSendMessage = useCallback(async (taskId: string, message: string) => {
    const result = await sendTaskMessage(taskId, message);
    return result;
  }, []);

  const handleEditTask = useCallback((task: Task) => {
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
        {/* Page Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-1">
          <div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>📋 任务看板</span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold text-gray-800">
                任务看板 — {projectName}
              </h1>
              {/* Project Selector */}
              {projects.length > 1 && (
                <Select value={projectId} onValueChange={(v) => {
                  if (v) router.push(`/workspaces/${workspaceId}?projectId=${v}`);
                }}>
                  <SelectTrigger className="h-8 w-40 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <BoardStats
          totalTasks={totalTasks}
          runningTasks={runningTasks}
          tip="复用现有拖拽、详情和任务创建链路"
          tipDescription="先把工作台入口对齐原型，再逐步补 Settings、Skills、Plugins。"
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
        <div className="flex-1 overflow-auto py-4">
          <KanbanBoard
            initialTasks={filteredTasks}
            onTaskMove={handleTaskMove}
            onTaskClick={(task) => setSelectedTask(task)}
            onEditTask={handleEditTask}
            onAddTask={handleAddTaskToColumn}
            onDeleteTask={handleDeleteTask}
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
        />
      </div>

      {/* Right: Task Detail Panel or Repo Sidebar */}
      {selectedTask ? (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onSendMessage={handleSendMessage}
        />
      ) : (
        <RepoSidebar projectName={projectName} />
      )}
    </div>
  );
}
