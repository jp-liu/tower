"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { TaskCard } from "./task-card";
import type { Task } from "@prisma/client";

interface BoardColumnProps {
  id: string;
  label: string;
  color: string;
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onAddTask?: () => void;
  onDeleteTask?: (taskId: string) => void;
}

export function BoardColumn({
  id,
  label,
  color,
  tasks,
  onTaskClick,
  onEditTask,
  onAddTask,
  onDeleteTask,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      className={`flex w-0 min-w-[220px] flex-1 flex-col min-h-0 border-r border-border/50 last:border-r-0 transition-colors ${
        isOver ? "bg-amber-500/5" : ""
      }`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${color}`} />
          <span className="text-xs font-semibold tracking-wide text-secondary-foreground">{label}</span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={onAddTask}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="add"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Task List */}
      <div
        ref={setNodeRef}
        className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 min-h-0"
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick?.(task)}
              onEdit={onEditTask}
              onDelete={onDeleteTask}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
