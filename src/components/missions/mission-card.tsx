"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ArrowUpRight, X, TerminalSquare, Check, Activity, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { TerminalControls } from "@/components/task/task-terminal";
import { TerminalOutlet } from "@/components/task/terminal-portal";

/**
 * Live "Xm Ys" running-time counter, isolated in its own component so the 1s
 * tick re-renders only this <span> — not the whole MissionCard (which carries
 * useSortable + the terminal OutPortal). With up to 16 panes that's 16 tiny
 * text updates/sec instead of 16 full card reconciliations/sec.
 */
function ElapsedTime({ startedAt, paused }: { startedAt: string | null; paused: boolean }) {
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : 0
  );
  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      setElapsed(startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : 0);
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, paused]);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return (
    <span className="text-[11px] text-muted-foreground ml-1 shrink-0">
      {minutes}m {seconds}s
    </span>
  );
}

function WorkbenchHealthBadge({ execution }: { execution: ActiveExecutionInfo }) {
  const runtime = execution.workbenchRuntime;
  if (!execution.isSystemTask) return null;
  if (!runtime) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
        <Activity className="h-3 w-3 mr-1" />
        未上报
      </Badge>
    );
  }
  const unhealthy = runtime.state === "BLOCKED" || runtime.state === "DEGRADED";
  const detail = [
    `Workbench generation ${runtime.generation}`,
    `state=${runtime.state}`,
    `pending=${runtime.pendingEvents}`,
    runtime.activeBatchId ? `batch=${runtime.activeBatchId}` : null,
    runtime.blockedReason,
    runtime.lastError,
    `heartbeat=${new Date(runtime.lastHeartbeatAt).toLocaleString()}`,
  ].filter(Boolean).join("\n");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className={
              unhealthy
                ? "text-[10px] text-amber-600 border-amber-500/40 bg-amber-500/10 shrink-0"
                : "text-[10px] text-emerald-600 border-emerald-500/40 bg-emerald-500/10 shrink-0"
            }
            title={detail}
          />
        }
      >
        {unhealthy
          ? <AlertTriangle className="h-3 w-3 mr-1" />
          : <Activity className="h-3 w-3 mr-1" />}
        G{runtime.generation} · {runtime.state}
        {runtime.pendingEvents > 0 ? ` · ${runtime.pendingEvents}` : ""}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm whitespace-pre-line">{detail}</TooltipContent>
    </Tooltip>
  );
}

interface MissionCardProps {
  execution: ActiveExecutionInfo;
  isRemoving: boolean;
  removeReason?: "stopped" | "completed";
  onStop: (taskId: string) => void;
  /** Complete the task — run the merge/return flow (commit-clean → merge → cleanup). */
  onComplete: (execution: ActiveExecutionInfo) => void;
  onSessionEnd?: (taskId: string, exitCode: number) => void;
  /** Zero-based position within the visible grid (used for pane focus/scroll). */
  index: number;
  /** Register/unregister the terminal's imperative controls by taskId. */
  onRegisterControls: (taskId: string, controls: TerminalControls | null) => void;
}

export function MissionCard({
  execution,
  isRemoving,
  removeReason,
  onStop,
  onComplete,
  onSessionEnd,
  index,
  onRegisterControls,
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

  async function handleOpenInTerminal() {
    // Mirror startPtyExecution's cwd resolution (agent-actions.ts:538-539):
    // base = worktreePath ?? project.localPath, then append subPath if set.
    const base = execution.worktreePath ?? execution.projectLocalPath;
    if (!base) return;
    const target = execution.subPath ? `${base}/${execution.subPath}` : base;
    try {
      await openInTerminal(target);
    } catch {
      toast.error(t("preview.terminalError"));
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-pane-index={index}
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

        {/* Breadcrumb — workspace › project prefix is capped to a relative
            max-width and truncated so a long alias can't swallow the task title
            or shove the right-side status/controls. Full names show on hover. */}
        <div className="flex items-center gap-1 min-w-0 flex-1 text-[11px] text-muted-foreground">
          <span
            className="truncate max-w-[45%] shrink-0"
            title={`${execution.workspaceName} › ${execution.projectAlias || execution.projectName}`}
          >
            {execution.workspaceName} &#x203A;{" "}
            {execution.projectAlias || execution.projectName}
          </span>
          <span className="shrink-0">&#x203A;</span>
          <span
            className="text-foreground font-semibold truncate min-w-0 flex-1"
            title={execution.taskTitle}
          >
            {execution.taskTitle}
          </span>
        </div>

        {/* Status badge */}
        <WorkbenchHealthBadge execution={execution} />
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

        {/* Running time — isolated so its 1s tick doesn't re-render the card */}
        <ElapsedTime startedAt={execution.startedAt} paused={isRemoving} />

        {/* Open in terminal — only when project has a localPath */}
        {execution.projectLocalPath && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 shrink-0 text-muted-foreground"
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
              <Button
                variant="ghost"
                size="icon"
                className="ml-1 shrink-0 text-muted-foreground"
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

        {/* Complete button — merge/return flow. Hidden for system/workbench tasks
            (builtin "Tower" label): those aren't completable via merge. */}
        {!execution.isSystemTask && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 shrink-0 text-emerald-500 hover:text-emerald-500"
                  onClick={() => onComplete(execution)}
                  disabled={isRemoving}
                />
              }
            >
              <Check className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>{t("missions.completeTask")}</TooltipContent>
          </Tooltip>
        )}

        {/* Stop button */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="destructive"
                size="icon"
                className="ml-1 shrink-0"
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

      {/* Terminal area — portal-backed so it survives route changes (missions →
          task detail → missions). Without persistence the terminal is disposed
          on every navigation and its history/statusline is lost to a lossy WS
          replay; the portal keeps the live xterm alive above LayoutInner. */}
      <div className="relative flex-1 overflow-hidden">
        <TerminalOutlet
          taskId={execution.taskId}
          worktreePath={execution.worktreePath ?? execution.projectLocalPath ?? ""}
          onSessionEnd={(exitCode) => onSessionEnd?.(execution.taskId, exitCode)}
          onReady={(c) => onRegisterControls(execution.taskId, c)}
        />
      </div>
    </div>
  );
}
