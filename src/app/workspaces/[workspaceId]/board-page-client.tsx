"use client";

import { useState, useCallback, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { BoardStats } from "@/components/board/board-stats";
import { BoardFilters } from "@/components/board/board-filters";
import { KanbanBoard } from "@/components/board/kanban-board";
import { CreateTaskDialog } from "@/components/board/create-task-dialog";
import { RepoSidebar } from "@/components/repository/repo-sidebar";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { createTask, updateTaskStatus, updateTask, deleteTask, toggleTaskPinned } from "@/actions/task-actions";
import { startPtyExecution } from "@/actions/agent-actions";
import { getVersionsForPicker } from "@/actions/version-actions";
import { ProjectTabs } from "@/components/board/project-tabs";
import { Button } from "@/components/ui/button";
import type { TaskStatus, Priority } from "@prisma/client";
import { TOWER_LABEL_NAME } from "@/lib/constants";
import type { TaskWithLabels } from "@/types";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";


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
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] = useState<TaskStatus>("TODO");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(openTaskId ?? null);
  const [versions, setVersions] = useState<VersionPickerItem[]>([]);
  // Derive selectedTask from initialTasks so router.refresh auto-syncs status
  const selectedTask = selectedTaskId ? initialTasks.find((t) => t.id === selectedTaskId) ?? null : null;
  const [editingTask, setEditingTask] = useState<TaskWithLabels | null>(null);

  // Fetch versions for the active project (for the version picker in create dialog)
  useEffect(() => {
    getVersionsForPicker(projectId).then(setVersions).catch(() => setVersions([]));
  }, [projectId]);

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

  const handleTaskMove = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    await updateTaskStatus(taskId, newStatus);
    refreshData();
  }, [refreshData]);

  const handleCreateTask = useCallback(
    async (data: { title: string; description: string; priority: Priority; status: TaskStatus; labelIds: string[]; baseBranch?: string; subPath?: string; versionId?: string | null }) => {
      await createTask({
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

  // Exclude Tower-labeled tasks from kanban (system workbench tasks)
  const boardTasks = initialTasks.filter(
    (t) => !t.labels?.some((tl) => tl.label.name === TOWER_LABEL_NAME && tl.label.isBuiltin)
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
          totalTasks={boardTasks.length}
          runningTasks={boardTasks.filter((t) => t.status === "IN_PROGRESS").length}
        />

        {/* Filters + Version Timeline button */}
        <div className="flex items-center gap-2 pr-4">
          <div className="flex-1">
            <BoardFilters
              searchQuery={searchQuery}
              onSearchChange={handleSearchChange}
              onCreateTask={() => {
                setEditingTask(null);
                setShowCreateDialog(true);
              }}
            />
          </div>
          <Link href={`/workspaces/${workspaceId}/projects/${projectId}/versions`}>
            <Button variant="outline" className="h-8 gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              {t("version.timeline")}
            </Button>
          </Link>
        </div>

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

    </div>
  );
}
