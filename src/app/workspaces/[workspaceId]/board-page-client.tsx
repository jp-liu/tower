"use client";

import { useState, useCallback } from "react";
import { BoardStats } from "@/components/board/board-stats";
import { BoardFilters } from "@/components/board/board-filters";
import { KanbanBoard } from "@/components/board/kanban-board";
import { CreateTaskDialog } from "@/components/board/create-task-dialog";
import { RepoSidebar } from "@/components/repository/repo-sidebar";
import { createTask, updateTaskStatus, deleteTask } from "@/actions/task-actions";
import type { Task, TaskStatus, Priority } from "@prisma/client";

type FilterType = "ALL" | "IN_PROGRESS" | "IN_REVIEW";

interface BoardPageClientProps {
  workspaceId: string;
  projectId: string;
  projectName: string;
  initialTasks: Task[];
  totalTasks: number;
  runningTasks: number;
}

export function BoardPageClient({
  workspaceId,
  projectId,
  projectName,
  initialTasks,
  totalTasks,
  runningTasks,
}: BoardPageClientProps) {
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<TaskStatus>("TODO");

  const handleFilterChange = useCallback((newFilter: FilterType) => {
    setFilter(newFilter);
  }, []);

  const handleTaskMove = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    await updateTaskStatus(taskId, newStatus);
  }, []);

  const handleCreateTask = useCallback(
    async (data: { title: string; description: string; priority: Priority; status: TaskStatus }) => {
      await createTask({
        title: data.title,
        description: data.description,
        projectId,
        priority: data.priority,
        status: data.status,
      });
    },
    [projectId]
  );

  const handleDeleteTask = useCallback(async (taskId: string) => {
    await deleteTask(taskId);
  }, []);

  const handleAddTaskToColumn = useCallback((status: TaskStatus) => {
    setCreateDefaultStatus(status);
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
        <div className="flex items-center justify-between px-6 pt-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>任务看板</span>
            </div>
            <h1 className="text-lg font-semibold">
              任务看板 — {projectName}
            </h1>
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
          onCreateTask={() => setShowCreateDialog(true)}
        />

        {/* Kanban Board */}
        <div className="flex-1 overflow-auto">
          <KanbanBoard
            initialTasks={filteredTasks}
            onTaskMove={handleTaskMove}
            onTaskClick={(task) => {
              // TODO: Open task detail panel
              console.log("Task clicked:", task.id);
            }}
            onAddTask={handleAddTaskToColumn}
            onDeleteTask={handleDeleteTask}
          />
        </div>

        {/* Create Task Dialog */}
        <CreateTaskDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onSubmit={handleCreateTask}
          defaultStatus={createDefaultStatus}
        />
      </div>

      {/* Right Sidebar */}
      <RepoSidebar projectName={projectName} />
    </div>
  );
}
