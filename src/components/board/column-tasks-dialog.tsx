"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PRIORITY_CONFIG } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";
import type { TaskWithLabels } from "@/types";

interface ColumnTasksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnLabel: string;
  columnColor: string;
  tasks: TaskWithLabels[];
  onTaskClick?: (task: TaskWithLabels) => void;
}

export function ColumnTasksDialog({
  open,
  onOpenChange,
  columnLabel,
  columnColor,
  tasks,
  onTaskClick,
}: ColumnTasksDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${columnColor}`} />
            <span>{columnLabel}</span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono font-medium text-muted-foreground">
              {tasks.length}
            </span>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(80vh-80px)]">
          <div className="grid grid-cols-3 gap-3 pr-3">
            {tasks.map((task) => {
              const priorityConfig = PRIORITY_CONFIG[task.priority];
              return (
                <div
                  key={task.id}
                  className="cursor-pointer rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/20 hover:bg-accent/50"
                  onClick={() => {
                    onTaskClick?.(task);
                    onOpenChange(false);
                  }}
                >
                  <h4 className="text-sm font-medium text-foreground line-clamp-2">
                    {task.title}
                  </h4>
                  {task.description && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {task.description}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] font-semibold ${priorityConfig.color}`}
                    >
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
                  </div>
                </div>
              );
            })}
            {tasks.length === 0 && (
              <div className="col-span-3 py-8 text-center text-sm text-muted-foreground">
                {t("board.noTasks")}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
