"use client";

import { useState, useCallback, useEffect } from "react";
import { TaskCardContextMenu } from "./task-card-context-menu";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { BoardColumn } from "./board-column";
import { TaskCard } from "./task-card";
import { BOARD_COLUMNS } from "@/lib/constants";
import type { TaskStatus } from "@prisma/client";
import type { TaskWithLabels } from "@/types";

interface KanbanBoardProps {
  initialTasks: TaskWithLabels[];
  onTaskMove?: (taskId: string, newStatus: TaskStatus) => void;
  onTaskClick?: (task: TaskWithLabels) => void;
  onEditTask?: (task: TaskWithLabels) => void;
  onAddTask?: (status: TaskStatus) => void;
  onDeleteTask?: (taskId: string) => void;
  onContextMenuStatusChange?: (taskId: string, status: TaskStatus) => void;
  onContextMenuLaunch?: (taskId: string) => void;
  workspaceId?: string;
}

export function KanbanBoard({
  initialTasks,
  onTaskMove,
  onTaskClick,
  onEditTask,
  onAddTask,
  onDeleteTask,
  onContextMenuStatusChange,
  onContextMenuLaunch,
  workspaceId,
}: KanbanBoardProps) {
  // Local tasks state for optimistic drag updates
  const [tasks, setTasks] = useState<TaskWithLabels[]>(initialTasks);
  const [activeTask, setActiveTask] = useState<TaskWithLabels | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    task: TaskWithLabels;
    x: number;
    y: number;
  } | null>(null);

  // Sync with server data when props change
  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleContextMenu = useCallback((task: TaskWithLabels, x: number, y: number) => {
    setContextMenu({ task, x, y });
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      if (task) setActiveTask(task);
    },
    [tasks]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);

      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Determine target column
      const isOverColumn = BOARD_COLUMNS.some((col) => col.id === overId);
      let targetStatus: TaskStatus | undefined;

      if (isOverColumn) {
        targetStatus = overId as TaskStatus;
      } else {
        // Dropped on another task — use that task's column
        const overTask = tasks.find((t) => t.id === overId);
        targetStatus = overTask?.status;
      }

      if (targetStatus) {
        // Optimistic update
        setTasks((prev) =>
          prev.map((t) =>
            t.id === activeId ? { ...t, status: targetStatus! } : t
          )
        );
        // Persist to server
        onTaskMove?.(activeId, targetStatus);
      }
    },
    [tasks, onTaskMove]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="mx-2 flex min-h-full overflow-x-auto rounded-xl border border-border bg-card/50">
        {BOARD_COLUMNS.map((column) => (
          <BoardColumn
            key={column.id}
            id={column.id}
            label={column.label}
            color={column.color}
            tasks={tasks.filter((t) => t.status === column.id)}
            onTaskClick={onTaskClick}
            onEditTask={onEditTask}
            onAddTask={() => onAddTask?.(column.id)}
            onDeleteTask={onDeleteTask}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="rotate-3 scale-105">
            <TaskCard task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>

      {contextMenu && (
        <TaskCardContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          taskId={contextMenu.task.id}
          currentStatus={contextMenu.task.status}
          hasExecutions={((contextMenu.task as any)._count?.executions ?? 0) > 0}
          workspaceId={workspaceId ?? ""}
          onClose={() => setContextMenu(null)}
          onStatusChange={(taskId, status) => {
            onContextMenuStatusChange?.(taskId, status);
            setContextMenu(null);
          }}
          onLaunch={(taskId) => {
            onContextMenuLaunch?.(taskId);
            setContextMenu(null);
          }}
        />
      )}
    </DndContext>
  );
}
