"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { getWorkspacesWithRecentTasks } from "@/actions/workspace-actions";
import { getProjectTasks } from "@/actions/task-actions";
import { startPtyExecution, resumePtyExecution } from "@/actions/agent-actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Play, RotateCcw } from "lucide-react";

type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";
type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  executions?: Array<{ sessionId: string | null }>;
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

/** Task row with Continue / New launch actions */
function TaskRow({
  task,
  isRunning,
  launchingId,
  onLaunchNew,
  onResume,
  t,
}: {
  task: TaskItem;
  isRunning: boolean;
  launchingId: string | null;
  onLaunchNew: (taskId: string) => void;
  onResume: (taskId: string, sessionId: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const lastSessionId = task.executions?.[0]?.sessionId;
  const isLaunching = launchingId === task.id;

  return (
    <div className="group/task flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50 cursor-default">
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
        <div className="flex items-center gap-1 opacity-0 group-hover/task:opacity-100 transition-opacity shrink-0">
          {lastSessionId && (
            <Button
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => onResume(task.id, lastSessionId)}
              disabled={isLaunching}
              title={t("missions.continueSession")}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              {t("missions.continueLabel")}
            </Button>
          )}
          <Button
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => onLaunchNew(task.id)}
            disabled={isLaunching}
            title={t("missions.launchNew")}
          >
            <Play className="h-3 w-3 mr-1" />
            {isLaunching ? "..." : t("missions.launchNewLabel")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Full task selector Dialog — opened from popover footer */
function FullTaskDialog({
  open,
  onOpenChange,
  onLaunchNew,
  onResume,
  runningTaskIds,
  launchingId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLaunchNew: (taskId: string) => void;
  onResume: (taskId: string, sessionId: string) => void;
  runningTaskIds: Set<string>;
  launchingId: string | null;
}) {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [selectedWsId, setSelectedWsId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelectedWsId("");
    setSelectedProjectId("");
    setTasks([]);
    getWorkspacesWithRecentTasks(100)
      .then(setWorkspaces)
      .catch(() => toast.error(t("missions.error.launchFailed")));
  }, [open, t]);

  useEffect(() => {
    if (!selectedProjectId) { setTasks([]); return; }
    getProjectTasks(selectedProjectId)
      .then((all) => {
        setTasks(
          all.filter(
            (tk) => tk.status === "TODO" || tk.status === "IN_PROGRESS" || tk.status === "IN_REVIEW"
          ) as TaskItem[]
        );
      })
      .catch(() => toast.error(t("missions.error.launchFailed")));
  }, [selectedProjectId, t]);

  const selectedWs = workspaces.find((w) => w.id === selectedWsId);
  const projects = selectedWs?.projects ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("missions.fullPickerTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={selectedWsId} onValueChange={(v) => { setSelectedWsId(v ?? ""); setSelectedProjectId(""); }}>
            <SelectTrigger id="full-picker-ws" className="w-48 h-8">
              <span className="truncate">
                {workspaces.find((w) => w.id === selectedWsId)?.name ?? t("missions.launcher.selectWorkspace")}
              </span>
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedProjectId} onValueChange={(v) => setSelectedProjectId(v ?? "")} disabled={!selectedWsId}>
            <SelectTrigger id="full-picker-proj" className="w-48 h-8">
              <span className="truncate">
                {projects.find((p) => p.id === selectedProjectId)?.name ?? t("missions.launcher.selectProject")}
              </span>
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.alias ?? p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 -mx-2">
          {tasks.length === 0 && selectedProjectId ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("missions.launcher.noTasks")}</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("missions.fullPickerHint")}</p>
          ) : (
            tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isRunning={runningTaskIds.has(task.id)}
                launchingId={launchingId}
                onLaunchNew={onLaunchNew}
                onResume={onResume}
                t={t}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
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
  const [fullDialogOpen, setFullDialogOpen] = useState(false);

  // Load data when opened
  useEffect(() => {
    if (!open) return;
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
        if (anchorRef?.current && anchorRef.current.contains(target)) return;
        onOpenChange(false);
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open, onOpenChange, anchorRef]);

  const handleLaunchNew = useCallback(async (taskId: string) => {
    try {
      setLaunchingId(taskId);
      await startPtyExecution(taskId, "");
      onLaunched(taskId);
      onOpenChange(false);
      setFullDialogOpen(false);
    } catch {
      toast.error(t("missions.error.launchFailed"));
    } finally {
      setLaunchingId(null);
    }
  }, [onLaunched, onOpenChange, t]);

  const handleResume = useCallback(async (taskId: string, sessionId: string) => {
    try {
      setLaunchingId(taskId);
      await resumePtyExecution(taskId, sessionId);
      onLaunched(taskId);
      onOpenChange(false);
      setFullDialogOpen(false);
    } catch {
      toast.error(t("missions.error.launchFailed"));
    } finally {
      setLaunchingId(null);
    }
  }, [onLaunched, onOpenChange, t]);

  const handleOpenFullDialog = useCallback(() => {
    onOpenChange(false);
    setFullDialogOpen(true);
  }, [onOpenChange]);

  if (!open && !fullDialogOpen) return null;

  return (
    <>
      {/* Quick picker popover */}
      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 z-50 mt-1 w-96 rounded-lg border border-border bg-popover shadow-xl flex flex-col overflow-hidden"
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
                    if (project._count.tasks === 0) return null;
                    return (
                      <div key={project.id} className="mb-1">
                        <div className="px-3 pt-2 pb-0.5">
                          <span className="text-xs font-medium text-blue-500">
                            {project.alias ?? project.name}
                          </span>
                        </div>
                        {project.tasks.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            isRunning={runningTaskIds.has(task.id)}
                            launchingId={launchingId}
                            onLaunchNew={handleLaunchNew}
                            onResume={handleResume}
                            t={t}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer — clickable to open full dialog */}
          <button
            className="w-full px-3 py-2 border-t border-border shrink-0 text-xs text-primary hover:bg-accent/50 transition-colors text-center font-medium"
            onClick={handleOpenFullDialog}
          >
            {t("missions.showMoreTasks")}
          </button>
        </div>
      )}

      {/* Full task selector dialog */}
      <FullTaskDialog
        open={fullDialogOpen}
        onOpenChange={setFullDialogOpen}
        onLaunchNew={handleLaunchNew}
        onResume={handleResume}
        runningTaskIds={runningTaskIds}
        launchingId={launchingId}
      />
    </>
  );
}
