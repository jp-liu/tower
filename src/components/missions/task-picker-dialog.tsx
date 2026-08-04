"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Fuse from "fuse.js";
import { useI18n } from "@/lib/i18n";
import { getWorkspacesWithActiveTasks } from "@/actions/workspace-actions";
import { startPtyExecution, resumePtyExecution } from "@/actions/agent-actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Loader2,
  Play,
  RotateCcw,
  Search,
  X as XIcon,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";
type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const PAGE_SIZE = 10;

interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  // Non-empty only for the project's Tower workbench task.
  labels?: Array<{ labelId: string }>;
  executions?: Array<{ sessionId: string | null }>;
}

/** The project workbench task carries the builtin "Tower" label. */
function isWorkbenchTask(task: TaskItem): boolean {
  return (task.labels?.length ?? 0) > 0;
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
    <div className="group/task grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 hover:bg-accent/50 cursor-default">
      <div className="min-w-0">
        <p
          title={task.title}
          className={`text-sm truncate ${isRunning ? "italic text-muted-foreground" : ""}`}
        >
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
        <span className="text-[10px] italic text-muted-foreground">
          {t("missions.alreadyMonitored")}
        </span>
      ) : (
        <div className="flex items-center gap-1 opacity-0 group-hover/task:opacity-100 transition-opacity">
          {lastSessionId && (
            <Button
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => onResume(task.id, lastSessionId)}
              disabled={isLaunching}
              title={t("missions.continueSession")}
            >
              {isLaunching ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3 mr-1" />
              )}
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
            {isLaunching ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Play className="h-3 w-3 mr-1" />
            )}
            {t("missions.launchNewLabel")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Pinned workbench bar — the project's Tower task with Continue / New actions. */
function WorkbenchBar({
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
    <div className="shrink-0 border-b bg-muted/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">{t("missions.workbench.title")}</span>
        </div>
        {isRunning ? (
          <span className="text-[10px] italic text-muted-foreground">
            {t("missions.alreadyMonitored")}
          </span>
        ) : (
          <div className="flex items-center gap-1">
            {lastSessionId && (
              <Button
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => onResume(task.id, lastSessionId)}
                disabled={isLaunching}
                title={t("missions.continueSession")}
              >
                {isLaunching ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3 mr-1" />
                )}
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
              {isLaunching ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              {t("missions.launchNewLabel")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface FlatTaskRow {
  task: TaskItem;
  workspaceName: string;
  projectName: string;
  projectId: string;
}

export function TaskPickerDialog({
  open,
  onOpenChange,
  onLaunched,
  runningTaskIds = new Set(),
}: TaskPickerProps) {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Focus the dialog popup itself on open (not the search Input) so the browser's
  // native input-history dropdown doesn't pop up; Tab still lands on the search box.
  const contentRef = useRef<HTMLDivElement>(null);
  const [expandedWs, setExpandedWs] = useState<Set<string>>(new Set());
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [page, setPage] = useState(0);

  // Workspaces/projects with at least one task to show — a regular active task
  // or the pinned workbench task (every project carries one).
  const visibleWorkspaces = useMemo(
    () =>
      workspaces
        .map((ws) => ({
          ...ws,
          projects: ws.projects.filter((p) => p.tasks.length > 0),
        }))
        .filter((ws) => ws.projects.length > 0),
    [workspaces]
  );

  // Load all active tasks when opened; default-expand & select the first project
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearchQuery("");
    setPage(0);
    getWorkspacesWithActiveTasks()
      .then((data) => {
        setWorkspaces(data);
        const firstWs = data
          .map((ws) => ({ ...ws, projects: ws.projects.filter((p) => p.tasks.length > 0) }))
          .find((ws) => ws.projects.length > 0);
        setExpandedWs(firstWs ? new Set([firstWs.id]) : new Set());
        setSelectedProjectId(firstWs?.projects[0]?.id ?? "");
      })
      .catch(() => toast.error(t("missions.error.launchFailed")))
      .finally(() => setLoading(false));
  }, [open, t]);

  const toggleWs = useCallback((id: string) => {
    setExpandedWs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectProject = useCallback((id: string) => {
    setSelectedProjectId(id);
    setPage(0);
  }, []);

  // Flatten all active tasks across workspaces (for Fuse search)
  const allTasks = useMemo<FlatTaskRow[]>(() => {
    const rows: FlatTaskRow[] = [];
    for (const ws of visibleWorkspaces) {
      for (const proj of ws.projects) {
        for (const tk of proj.tasks) {
          rows.push({
            task: tk,
            workspaceName: ws.name,
            projectName: proj.alias ?? proj.name,
            projectId: proj.id,
          });
        }
      }
    }
    return rows;
  }, [visibleWorkspaces]);

  const fuse = useMemo(
    () => new Fuse(allTasks, { keys: ["task.title"], threshold: 0.4, distance: 200 }),
    [allTasks]
  );

  const isSearching = searchQuery.trim().length > 0;

  // Search results grouped by project (preserve relevance order of first hit)
  const searchGroups = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return [];
    const hits = fuse.search(q).map((r) => r.item);
    const order: string[] = [];
    const map = new Map<string, { workspaceName: string; projectName: string; tasks: TaskItem[] }>();
    for (const row of hits) {
      let group = map.get(row.projectId);
      if (!group) {
        group = { workspaceName: row.workspaceName, projectName: row.projectName, tasks: [] };
        map.set(row.projectId, group);
        order.push(row.projectId);
      }
      group.tasks.push(row.task);
    }
    return order.map((id) => ({ id, ...map.get(id)! }));
  }, [fuse, searchQuery]);

  // Currently selected project + its paginated tasks
  const selectedProject = useMemo(
    () => allTasks.length ? visibleWorkspaces.flatMap((ws) => ws.projects).find((p) => p.id === selectedProjectId) : undefined,
    [visibleWorkspaces, selectedProjectId, allTasks.length]
  );
  // Split the pinned workbench task out of the paginated regular task list.
  const workbenchTask = useMemo(
    () => selectedProject?.tasks.find(isWorkbenchTask),
    [selectedProject]
  );
  const projectTasks = useMemo(
    () => selectedProject?.tasks.filter((tk) => !isWorkbenchTask(tk)) ?? [],
    [selectedProject]
  );
  const totalPages = Math.max(1, Math.ceil(projectTasks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedTasks = projectTasks.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const handleLaunchNew = useCallback(async (taskId: string) => {
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

  const handleResume = useCallback(async (taskId: string, sessionId: string) => {
    try {
      setLaunchingId(taskId);
      await resumePtyExecution(taskId, sessionId);
      onLaunched(taskId);
      onOpenChange(false);
    } catch {
      toast.error(t("missions.error.launchFailed"));
    } finally {
      setLaunchingId(null);
    }
  }, [onLaunched, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        initialFocus={contentRef}
        className="sm:max-w-3xl flex h-[80vh] max-h-[640px] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>{t("missions.launchTask")}</DialogTitle>
        </DialogHeader>

        {/* Search row */}
        <div className="shrink-0 border-b px-4 py-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("missions.fullPicker.searchPlaceholder")}
              autoComplete="off"
              className="pl-8 pr-8 h-8"
            />
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={() => setSearchQuery("")}
                aria-label={t("missions.fullPicker.clearSearch")}
              >
                <XIcon className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : visibleWorkspaces.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("missions.noAvailableTasks")}
          </div>
        ) : isSearching ? (
          /* Search mode — full width grouped results, no sidebar */
          <ScrollArea className="flex-1 min-h-0">
            {searchGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("missions.fullPicker.noSearchResults")}
              </p>
            ) : (
              <div className="py-1">
                {searchGroups.map((group) => (
                  <div key={group.id}>
                    <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
                      {group.workspaceName} · {group.projectName}
                    </div>
                    {group.tasks.map((task) => (
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
                ))}
              </div>
            )}
          </ScrollArea>
        ) : (
          /* Browse mode — sidebar (workspace › project tree) + paginated task list */
          <div className="flex flex-1 min-h-0">
            <aside className="w-52 shrink-0 border-r">
              <ScrollArea className="h-full">
                <div className="py-1">
                  {visibleWorkspaces.map((ws) => {
                    const isExpanded = expandedWs.has(ws.id);
                    return (
                      <div key={ws.id}>
                        <Button
                          variant="ghost"
                          onClick={() => toggleWs(ws.id)}
                          className="flex h-auto w-full justify-start gap-1 rounded-none px-2 py-1.5 hover:bg-accent"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span
                            title={ws.name}
                            className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                          >
                            {ws.name}
                          </span>
                        </Button>
                        {isExpanded &&
                          ws.projects.map((project) => {
                            const isSelected = project.id === selectedProjectId;
                            return (
                              <Button
                                key={project.id}
                                variant="ghost"
                                onClick={() => selectProject(project.id)}
                                className={`flex h-auto w-full justify-start gap-2 rounded-none py-1.5 pl-7 pr-2 hover:bg-accent ${isSelected ? "bg-accent" : ""}`}
                              >
                                <span
                                  title={project.alias ?? project.name}
                                  className="min-w-0 flex-1 truncate text-left text-xs font-medium"
                                >
                                  {project.alias ?? project.name}
                                </span>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {project._count.tasks}
                                </span>
                              </Button>
                            );
                          })}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              {/* Pinned workbench — stays fixed above the scrolling task table */}
              {workbenchTask && (
                <WorkbenchBar
                  task={workbenchTask}
                  isRunning={runningTaskIds.has(workbenchTask.id)}
                  launchingId={launchingId}
                  onLaunchNew={handleLaunchNew}
                  onResume={handleResume}
                  t={t}
                />
              )}
              <ScrollArea className="flex-1 min-h-0">
                {pagedTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t("missions.launcher.noTasks")}
                  </p>
                ) : (
                  <div className="py-1">
                    {pagedTasks.map((task) => (
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
                )}
              </ScrollArea>

              {/* Pagination footer */}
              {projectTasks.length > 0 && (
                <div className="flex shrink-0 items-center justify-center gap-3 border-t px-3 py-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage <= 0}
                    aria-label={t("missions.picker.prevPage")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {safePage + 1} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage >= totalPages - 1}
                    aria-label={t("missions.picker.nextPage")}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
