"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreHorizontal, Pencil, Trash2, Pin, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PRIORITY_CONFIG } from "@/lib/constants";
import { TaskVersionTag } from "@/components/version/version-badges";
import { useI18n } from "@/lib/i18n";
import type { TaskWithLabels } from "@/types";

interface TaskCardProps {
  task: TaskWithLabels;
  onClick?: () => void;
  onEdit?: (task: TaskWithLabels) => void;
  onDelete?: (taskId: string) => void;
  onTogglePin?: (taskId: string) => void;
  onContextMenu?: (task: TaskWithLabels, x: number, y: number) => void;
}

export function TaskCard({ task, onClick, onEdit, onDelete, onTogglePin, onContextMenu }: TaskCardProps) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: "task", task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const priorityConfig = PRIORITY_CONFIG[task.priority];
  // worktree 模式标识：创建任务时只有勾选 worktree 才会写入 baseBranch
  const isWorktree = !!task.baseBranch;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group cursor-grab rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/20 hover:bg-accent/50 active:cursor-grabbing"
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(task, e.clientX, e.clientY);
      }}
      data-testid="task-card"
    >
      <div className="flex items-start justify-between">
        <h4 className="text-sm font-medium text-foreground">{task.title}</h4>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon-xs"
            className={`transition-all ${
              task.pinned
                ? "text-primary opacity-100"
                : "text-muted-foreground opacity-0 group-hover:opacity-100"
            }`}
            onClick={(e) => { e.stopPropagation(); onTogglePin?.(task.id); }}
            aria-label={task.pinned ? t("board.unpin") : t("board.pin")}
          >
            <Pin className={`h-3.5 w-3.5 ${task.pinned ? "-rotate-45" : ""}`} />
          </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className="rounded-md p-0.5 text-muted-foreground opacity-0 transition-all hover:bg-background hover:text-foreground group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              />
            }
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit?.(task); }}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-rose-400"
              onClick={(e) => { e.stopPropagation(); onDelete?.(task.id); }}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {task.description && (
        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {task.description}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className={`text-[10px] font-semibold ${priorityConfig.color}`}>
          {priorityConfig.label}
        </Badge>
        {task.labels?.map((tl) => (
          <span
            key={tl.label.id}
            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: tl.label.color + "20",
              color: tl.label.color,
            }}
          >
            {tl.label.name}
          </span>
        ))}
        {(isWorktree || task.version) && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {isWorktree && (
              <Tooltip disableHoverablePopup>
                <TooltipTrigger
                  render={
                    <span
                      className="inline-flex cursor-default items-center rounded-md border border-border bg-muted px-1 py-0.5 text-muted-foreground"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <GitBranch className="h-2.5 w-2.5 shrink-0" />
                    </span>
                  }
                />
                <TooltipContent side="top">
                  {t("board.card.worktree", { branch: task.baseBranch ?? "" })}
                </TooltipContent>
              </Tooltip>
            )}
            {task.version && (
              <Tooltip disableHoverablePopup>
                <TooltipTrigger
                  render={
                    <span
                      className="cursor-default"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <TaskVersionTag number={task.version.number} title="" />
                    </span>
                  }
                />
                <TooltipContent side="top">
                  {t("board.card.version", {
                    number: task.version.number,
                    name: task.version.name,
                  })}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
