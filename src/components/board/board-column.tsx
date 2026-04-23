"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { TaskCard } from "./task-card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TaskWithLabels } from "@/types";

interface BoardColumnProps {
  id: string;
  label: string;
  color: string;
  tasks: TaskWithLabels[];
  onTaskClick?: (task: TaskWithLabels) => void;
  onEditTask?: (task: TaskWithLabels) => void;
  onAddTask?: () => void;
  onDeleteTask?: (taskId: string) => void;
  onTogglePin?: (taskId: string) => void;
  onContextMenu?: (task: TaskWithLabels, x: number, y: number) => void;
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
  onTogglePin,
  onContextMenu,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      className={`flex w-0 min-w-[220px] flex-1 flex-col min-h-0 border-r border-border/50 last:border-r-0 transition-colors ${
        isOver ? "bg-primary/[0.06]" : ""
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
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onAddTask}
          className="text-muted-foreground"
          aria-label="add"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Task List */}
      <ScrollArea className="flex-1 min-h-0">
        <div
          ref={setNodeRef}
          className="flex flex-col gap-2 p-2"
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
                onTogglePin={onTogglePin}
                onContextMenu={onContextMenu}
              />
            ))}
          </SortableContext>
        </div>
      </ScrollArea>
    </div>
  );
}
