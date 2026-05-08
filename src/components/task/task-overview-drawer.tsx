"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { getTaskOverview } from "@/actions/task-actions";
import type { TaskOverviewData } from "@/actions/task-actions";
import { startPtyExecution } from "@/actions/agent-actions";
import { BOARD_COLUMNS, PRIORITY_CONFIG } from "@/lib/constants";
import { Calendar, Package, Play, PlayCircle } from "lucide-react";
import { TaskFileChanges } from "@/components/task/task-file-changes";
import { toast } from "sonner";

interface TaskOverviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string | null;
}

export function TaskOverviewDrawer({
  open,
  onOpenChange,
  taskId,
}: TaskOverviewDrawerProps) {
  const { t } = useI18n();
  const [task, setTask] = useState<TaskOverviewData | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isRerunning, setIsRerunning] = useState(false);

  useEffect(() => {
    if (!taskId || !open) {
      setTask(null);
      return;
    }
    startTransition(async () => {
      const data = await getTaskOverview(taskId);
      if (data) {
        setTask(data);
      }
    });
  }, [taskId, open]);

  const statusCol = task
    ? BOARD_COLUMNS.find((c) => c.id === task.status)
    : null;
  const priorityConfig = task ? PRIORITY_CONFIG[task.priority] : null;
  const lastExecution = task?.executions?.[0] ?? null;

  const lastExecGitStats = (() => {
    const raw = lastExecution?.gitStats;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { insertions?: number; deletions?: number };
      return { added: parsed.insertions ?? 0, removed: parsed.deletions ?? 0 };
    } catch {
      return null;
    }
  })();

  const handleRerun = async () => {
    if (!taskId || isRerunning) return;
    try {
      setIsRerunning(true);
      await startPtyExecution(taskId, "");
      toast.success(t("taskDrawer.rerunStarted"));
      onOpenChange(false);
    } catch {
      toast.error(t("taskDrawer.rerunFailed"));
    } finally {
      setIsRerunning(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:max-w-[380px] p-0">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border">
          <SheetTitle className="text-base font-semibold leading-tight pr-8">
            {task?.title ?? ""}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("taskDrawer.title")}
          </SheetDescription>
          {task && (
            <div className="flex items-center gap-2 mt-2">
              {statusCol && (
                <Badge variant="secondary" className="text-xs">
                  <span
                    className={`inline-block w-2 h-2 rounded-full mr-1.5 ${statusCol.color}`}
                  />
                  {statusCol.label}
                </Badge>
              )}
              {priorityConfig && (
                <Badge
                  variant="secondary"
                  className={`text-xs ${priorityConfig.color}`}
                >
                  {priorityConfig.label}
                </Badge>
              )}
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 h-[calc(100%-80px)]">
          {isPending && !task ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              {t("assets.loading")}
            </div>
          ) : task ? (
            <div className="p-4 space-y-4">
              {/* Description */}
              <section>
                <h4 className="text-xs font-medium text-muted-foreground mb-1">
                  {t("taskDrawer.description")}
                </h4>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {task.description || t("taskDrawer.noDescription")}
                </p>
              </section>

              {/* Labels */}
              {task.labels.length > 0 && (
                <section>
                  <h4 className="text-xs font-medium text-muted-foreground mb-1.5">
                    {t("taskDrawer.labels")}
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {task.labels.map((tl) => (
                      <Badge
                        key={tl.label.id}
                        variant="secondary"
                        className="text-xs"
                        style={{
                          backgroundColor: `${tl.label.color}20`,
                          color: tl.label.color,
                          borderColor: `${tl.label.color}40`,
                        }}
                      >
                        {tl.label.name}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {/* Created at */}
              <section className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>{t("taskDrawer.createdAt")}</span>
                <span className="text-foreground">
                  {new Date(task.createdAt).toLocaleDateString()}
                </span>
              </section>

              {/* Resource count */}
              <section className="flex items-center gap-2 text-sm text-muted-foreground">
                <Package className="h-3.5 w-3.5" />
                <span>{t("taskDrawer.resources")}</span>
                <span className="text-foreground">{task._count.assets}</span>
              </section>

              {/* File changes */}
              <section>
                <h4 className="text-xs font-medium text-muted-foreground mb-1.5">
                  {t("taskDrawer.fileChanges")}
                </h4>
                {lastExecGitStats ? (
                  <TaskFileChanges
                    added={lastExecGitStats.added}
                    removed={lastExecGitStats.removed}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("taskDrawer.noFileChanges")}
                  </p>
                )}
              </section>

              {/* Last execution */}
              <section>
                <h4 className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <PlayCircle className="h-3.5 w-3.5" />
                  {t("taskDrawer.lastExecution")}
                </h4>
                {lastExecution ? (
                  <div className="rounded-md border border-border p-2.5 text-sm">
                    <Badge variant="secondary" className="text-xs mb-1.5">
                      {lastExecution.status}
                    </Badge>
                    {lastExecution.summary && (
                      <p className="text-xs text-muted-foreground line-clamp-4">
                        {lastExecution.summary.slice(0, 200)}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("taskDrawer.noExecution")}
                  </p>
                )}
              </section>

              {/* Rerun action */}
              <section>
                <Button
                  variant="default"
                  className="w-full"
                  onClick={handleRerun}
                  disabled={isRerunning || !taskId}
                >
                  <Play className="h-4 w-4" />
                  {t("taskDrawer.rerun")}
                </Button>
              </section>
            </div>
          ) : null}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
