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
  onAddTask?: () => void;
  onDeleteTask?: (taskId: string) => void;
}

export function BoardColumn({
  id,
  label,
  color,
  tasks,
  onTaskClick,
  onAddTask,
  onDeleteTask,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      className={`flex w-64 flex-shrink-0 flex-col rounded-lg ${
        isOver ? "bg-blue-50/50" : "bg-transparent"
      }`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <button
          onClick={onAddTask}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="add"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Task List */}
      <div
        ref={setNodeRef}
        className="flex min-h-[200px] flex-1 flex-col gap-2 px-1"
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
              onDelete={onDeleteTask}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
