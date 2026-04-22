"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ArrowUpRight, X, TerminalSquare } from "lucide-react";

import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { openInTerminal } from "@/actions/preview-actions";
import { toast } from "sonner";
import type { ActiveExecutionInfo } from "@/actions/agent-actions";

const TaskTerminal = dynamic(
  () => import("@/components/task/task-terminal").then((m) => m.TaskTerminal),
  { ssr: false, loading: () => <div className="h-full w-full bg-[#0a0a0a] animate-pulse" /> }
);

interface MissionCardProps {
  execution: ActiveExecutionInfo;
  isRemoving: boolean;
  removeReason?: "stopped" | "completed";
  onStop: (taskId: string) => void;
  onSessionEnd?: (taskId: string, exitCode: number) => void;
}

export function MissionCard({
  execution,
  isRemoving,
  removeReason,
  onStop,
  onSessionEnd,
}: MissionCardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: execution.executionId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isRemoving ? 0 : 1,
  };

  const [elapsed, setElapsed] = useState(() =>
    execution.startedAt
      ? Math.floor((Date.now() - new Date(execution.startedAt).getTime()) / 1000)
      : 0
  );

  useEffect(() => {
    if (isRemoving) return;
    const interval = setInterval(() => {
      setElapsed(
        execution.startedAt
          ? Math.floor((Date.now() - new Date(execution.startedAt).getTime()) / 1000)
          : 0
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [execution.startedAt, isRemoving]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const formattedTime = `${minutes}m ${seconds}s`;

  async function handleOpenInTerminal() {
    if (!execution.projectLocalPath) return;
    try {
      await openInTerminal(execution.projectLocalPath);
    } catch {
      toast.error(t("preview.terminalError"));
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border border-border rounded-lg overflow-hidden flex flex-col transition-opacity duration-300"
      {...attributes}
    >
      {/* Header */}
      <div className="h-10 px-3 flex items-center gap-1 border-b border-border bg-card shrink-0">
        {/* Drag handle */}
        <button
          {...listeners}
          aria-label={t("missions.dragHandle")}
          aria-roledescription="sortable"
          className="cursor-grab text-muted-foreground hover:text-foreground mr-1"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        {/* Breadcrumb */}
        <span className="text-[11px] text-muted-foreground truncate flex-1">
          {execution.workspaceName} &#x203A;{" "}
          {execution.projectAlias || execution.projectName} &#x203A;{" "}
          <span className="text-foreground font-semibold">{execution.taskTitle}</span>
        </span>

        {/* Status badge */}
        {isRemoving ? (
          <Badge
            variant="outline"
            className="text-[11px] text-muted-foreground bg-muted ml-1 shrink-0"
          >
            {removeReason === "stopped"
              ? t("missions.statusStopped")
              : t("missions.statusCompleted")}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-[11px] text-primary border-primary/30 bg-primary/10 ml-1 shrink-0"
          >
            {t("missions.statusRunning")}
          </Badge>
        )}

        {/* Running time */}
        <span className="text-[11px] text-muted-foreground ml-1 shrink-0">
          {formattedTime}
        </span>

        {/* Open in terminal — only when project has a localPath */}
        {execution.projectLocalPath && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-md p-0 ml-1 shrink-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={handleOpenInTerminal}
                />
              }
            >
              <TerminalSquare className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>{t("missions.openInTerminal")}</TooltipContent>
          </Tooltip>
        )}

        {/* Open full view */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md p-0 ml-1 shrink-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() =>
                  router.push(
                    `/workspaces/${execution.workspaceId}/tasks/${execution.taskId}`
                  )
                }
              />
            }
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>{t("missions.openFullView")}</TooltipContent>
        </Tooltip>

        {/* Stop button */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md p-0 ml-1 shrink-0 text-destructive transition-colors hover:bg-destructive/10"
                onClick={() => onStop(execution.taskId)}
                disabled={isRemoving}
              />
            }
          >
            <X className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>{t("missions.stopTask")}</TooltipContent>
        </Tooltip>
      </div>

      {/* Terminal area */}
      <div className="flex-1 overflow-hidden">
        <TaskTerminal
          taskId={execution.taskId}
          worktreePath={execution.worktreePath ?? execution.projectLocalPath}
          onSessionEnd={(exitCode) => onSessionEnd?.(execution.taskId, exitCode)}
        />
      </div>
    </div>
  );
}
