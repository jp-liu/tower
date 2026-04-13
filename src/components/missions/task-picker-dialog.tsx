"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { getWorkspacesWithRecentTasks } from "@/actions/workspace-actions";
import { getProjectTasks } from "@/actions/task-actions";
import { startPtyExecution } from "@/actions/agent-actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";
type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
}

interface ProjectItem {
  id: string;
  name: string;
  alias: string | null;
  tasks: TaskItem[];
  _count: { tasks: number };
}

interface WorkspaceItem {
  id: string;
  name: string;
  projects: ProjectItem[];
}

interface TaskPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLaunched: (taskId: string) => void;
  runningTaskIds?: Set<string>;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const STATUS_LABELS: Record<string, string> = {
  TODO: "TODO",
  IN_PROGRESS: "Running",
  IN_REVIEW: "Review",
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Med",
  HIGH: "High",
  CRITICAL: "Crit",
};

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    TODO: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    IN_PROGRESS: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    IN_REVIEW: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colorMap[status] ?? "bg-slate-100 text-slate-600"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function TaskPickerDialog({
  open,
  onOpenChange,
  onLaunched,
  runningTaskIds = new Set(),
  anchorRef,
}: TaskPickerProps) {
  const { t } = useI18n();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  // projectId -> all tasks (expanded view)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, TaskItem[]>>({});
  const [loadingProjects, setLoadingProjects] = useState<Set<string>>(new Set());

  // Load data when opened
  useEffect(() => {
    if (!open) {
      setExpandedProjects({});
      return;
    }
    setLoading(true);
    getWorkspacesWithRecentTasks(3)
      .then(setWorkspaces)
      .catch(() => toast.error(t("missions.error.launchFailed")))
      .finally(() => setLoading(false));
  }, [open, t]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        // Also don't close if click was on the anchor button (it will toggle)
        if (anchorRef?.current && anchorRef.current.contains(target)) return;
        onOpenChange(false);
      }
    }
    // Delay to avoid immediate close on the open click
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open, onOpenChange, anchorRef]);

  const handleLaunch = useCallback(async (taskId: string) => {
    try {
      setLaunchingId(taskId);
      await startPtyExecution(taskId, "");
      onLaunched(taskId);
      onOpenChange(false);
    } catch {
      toast.error(t("missions.error.launchFailed"));
    } finally {
      setLaunchingId(null);
    }
  }, [onLaunched, onOpenChange, t]);

  const handleShowMore = useCallback(async (projectId: string) => {
    if (expandedProjects[projectId]) return;
    setLoadingProjects((prev) => new Set([...prev, projectId]));
    try {
      const all = await getProjectTasks(projectId);
      const filtered = all.filter(
        (tk) => tk.status === "TODO" || tk.status === "IN_PROGRESS" || tk.status === "IN_REVIEW"
      ) as TaskItem[];
      setExpandedProjects((prev) => ({ ...prev, [projectId]: filtered }));
    } catch {
      toast.error(t("missions.error.launchFailed"));
    } finally {
      setLoadingProjects((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }, [expandedProjects, t]);

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-1 w-80 rounded-lg border border-border bg-popover shadow-xl flex flex-col overflow-hidden"
      style={{ maxHeight: "480px" }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t("missions.pickerTitle")}
        </p>
      </div>

      {/* Tree list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Loading...
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {t("missions.noAvailableTasks")}
          </div>
        ) : (
          workspaces.map((ws) => (
            <div key={ws.id}>
              {/* Workspace header */}
              <div className="sticky top-0 z-10 px-3 py-1.5 bg-popover border-b border-border/50">
                <span className="text-xs font-semibold text-violet-500 uppercase tracking-wider">
                  {ws.name}
                </span>
              </div>

              {ws.projects.map((project) => {
                const displayTasks = expandedProjects[project.id] ?? project.tasks;
                const hasMore =
                  !expandedProjects[project.id] &&
                  project._count.tasks > project.tasks.length;
                const isLoadingMore = loadingProjects.has(project.id);

                if (project._count.tasks === 0) return null;

                return (
                  <div key={project.id} className="mb-1">
                    {/* Project subheader */}
                    <div className="px-3 pt-2 pb-0.5">
                      <span className="text-xs font-medium text-blue-500">
                        {project.alias ?? project.name}
                      </span>
                    </div>

                    {/* Task rows */}
                    {displayTasks.map((task) => {
                      const isRunning = runningTaskIds.has(task.id);
                      const isLaunching = launchingId === task.id;
                      return (
                        <div
                          key={task.id}
                          className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50 cursor-default"
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm truncate ${isRunning ? "italic text-muted-foreground" : ""}`}>
                              {task.title}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <StatusBadge status={task.status} />
                              <span className="text-[10px] text-muted-foreground">
                                {PRIORITY_LABELS[task.priority] ?? task.priority}
                              </span>
                            </div>
                          </div>
                          {isRunning ? (
                            <span className="text-[10px] italic text-muted-foreground shrink-0">
                              {t("missions.alreadyMonitored")}
                            </span>
                          ) : (
                            <Button
                              className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 shrink-0"
                              onClick={() => handleLaunch(task.id)}
                              disabled={isLaunching}
                            >
                              {isLaunching ? "..." : "Launch"}
                            </Button>
                          )}
                        </div>
                      );
                    })}

                    {/* Show more */}
                    {hasMore && (
                      <button
                        className="w-full text-left px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
                        onClick={() => handleShowMore(project.id)}
                        disabled={isLoadingMore}
                      >
                        {isLoadingMore ? "Loading..." : t("missions.showMoreTasks")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <p className="text-[11px] text-muted-foreground text-center">
          {t("missions.pickerFooter")}
        </p>
      </div>
    </div>
  );
}
