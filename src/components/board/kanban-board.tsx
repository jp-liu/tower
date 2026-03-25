"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { BoardColumn } from "./board-column";
import { TaskCard } from "./task-card";
import { useBoardStore } from "@/stores/board-store";
import { BOARD_COLUMNS } from "@/lib/constants";
import type { Task, TaskStatus } from "@prisma/client";

interface KanbanBoardProps {
  initialTasks: Task[];
  onTaskMove?: (taskId: string, newStatus: TaskStatus) => void;
  onTaskClick?: (task: Task) => void;
  onAddTask?: (status: TaskStatus) => void;
  onDeleteTask?: (taskId: string) => void;
}

export function KanbanBoard({
  initialTasks,
  onTaskMove,
  onTaskClick,
  onAddTask,
  onDeleteTask,
}: KanbanBoardProps) {
  const { tasks, setTasks, moveTask, getTasksByStatus } = useBoardStore();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // Initialize tasks from props
  if (tasks.length === 0 && initialTasks.length > 0) {
    setTasks(initialTasks);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      if (task) setActiveTask(task);
    },
    [tasks]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Check if we're dragging over a column
      const isOverColumn = BOARD_COLUMNS.some((col) => col.id === overId);
      if (isOverColumn) {
        moveTask(activeId, overId as TaskStatus);
      }
    },
    [moveTask]
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
      const targetStatus = isOverColumn
        ? (overId as TaskStatus)
        : tasks.find((t) => t.id === overId)?.status;

      if (targetStatus) {
        moveTask(activeId, targetStatus);
        onTaskMove?.(activeId, targetStatus);
      }
    },
    [tasks, moveTask, onTaskMove]
  );

  const displayTasks = tasks.length > 0 ? tasks : initialTasks;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto px-6 pb-6">
        {BOARD_COLUMNS.map((column) => (
          <BoardColumn
            key={column.id}
            id={column.id}
            label={column.label}
            color={column.color}
            tasks={displayTasks.filter((t) => t.status === column.id)}
            onTaskClick={onTaskClick}
            onAddTask={() => onAddTask?.(column.id)}
            onDeleteTask={onDeleteTask}
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
    </DndContext>
  );
}
