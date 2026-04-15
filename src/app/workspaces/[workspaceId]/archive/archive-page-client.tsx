"use client";

import { useState, useTransition, useCallback } from "react";
import { Archive, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { SubPageNav } from "@/components/layout/sub-page-nav";
import { getArchivedTasks } from "@/actions/task-actions";
import type { TaskStatus } from "@prisma/client";

interface SimpleProject {
  id: string;
  name: string;
  alias: string | null;
}

interface SimpleWorkspace {
  id: string;
  name: string;
  projects: SimpleProject[];
}

interface LabelItem {
  label: { id: string; name: string; color: string };
}

interface ExecutionItem {
  id: string;
  agent: string;
  status: string;
  createdAt: Date;
}

interface ArchivedTask {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: string;
  createdAt: Date;
  updatedAt: Date;
  labels: LabelItem[];
  executions: ExecutionItem[];
}

interface ArchivePageClientProps {
  allWorkspaces: SimpleWorkspace[];
  initialWorkspaceId: string;
  initialProjectId: string | null;
  initialTasks: ArchivedTask[];
}

function formatDate(date: Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    LOW: "bg-slate-400",
    MEDIUM: "bg-amber-400",
    HIGH: "bg-orange-500",
    CRITICAL: "bg-rose-500",
  };
  return (
    <span className={`inline-block h-1.5 w-1.5 rounded-full ${colors[priority] ?? "bg-slate-400"}`} />
  );
}

export function ArchivePageClient({
  allWorkspaces,
  initialWorkspaceId,
  initialProjectId,
  initialTasks,
}: ArchivePageClientProps) {
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();

  const [wsId, setWsId] = useState(initialWorkspaceId);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [tasks, setTasks] = useState<ArchivedTask[]>(initialTasks);

  const ws = allWorkspaces.find((w) => w.id === wsId);
  const projects = ws?.projects ?? [];

  const reload = useCallback(
    (pid: string | null) => {
      if (!pid) { setTasks([]); return; }
      startTransition(async () => {
        const fresh = await getArchivedTasks(pid);
        setTasks(fresh);
      });
    },
    [startTransition]
  );

  const handleWsChange = (id: string) => {
    if (id === wsId) return;
    setWsId(id);
    const w = allWorkspaces.find((x) => x.id === id);
    const first = w?.projects[0] ?? null;
    setProjectId(first?.id ?? null);
    reload(first?.id ?? null);
  };

  const handleProjectChange = (id: string) => {
    if (id === projectId) return;
    setProjectId(id);
    reload(id);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SubPageNav workspaceId={wsId} />

      {/* Action bar */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-2">
        <Select value={wsId} onValueChange={(v) => v && handleWsChange(v)}>
          <SelectTrigger className="h-8 w-auto min-w-[120px]">
            <span className="truncate">{ws?.name ?? wsId}</span>
          </SelectTrigger>
          <SelectContent>
            {allWorkspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {projects.length > 0 && (
          <Select value={projectId ?? ""} onValueChange={(v) => v && handleProjectChange(v)}>
            <SelectTrigger className="h-8 w-auto min-w-[140px]">
              <span className="truncate">
                {(() => { const p = projects.find((x) => x.id === projectId); return p ? (p.alias ? `${p.name} (${p.alias})` : p.name) : ""; })()}
              </span>
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}{p.alias ? ` (${p.alias})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
          {tasks.length} {t("archive.tasksCount")}
        </span>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className={`relative ${isPending ? "opacity-40 pointer-events-none" : ""} transition-opacity`}>
          {isPending && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {tasks.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
              <Archive className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">
                {t("archive.noTasks")}
              </p>
              <p className="text-xs text-muted-foreground/60">
                {t("archive.noTasksDesc")}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => {
                const isDone = task.status === "DONE";
                const lastExecution = task.executions[0];
                return (
                  <div
                    key={task.id}
                    className="group rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-border/80 hover:bg-accent/30"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {isDone ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-rose-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <PriorityDot priority={task.priority} />
                          <span className="truncate text-sm font-medium text-foreground">
                            {task.title}
                          </span>
                          <span
                            className={`ml-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              isDone
                                ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20"
                            }`}
                          >
                            {isDone ? t("archive.status.done") : t("archive.status.cancelled")}
                          </span>
                        </div>
                        {task.labels.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {task.labels.map((tl) => (
                              <span
                                key={tl.label.id}
                                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  backgroundColor: `${tl.label.color}20`,
                                  color: tl.label.color,
                                  outline: `1px solid ${tl.label.color}40`,
                                }}
                              >
                                {tl.label.name}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                          <span>{t("archive.createdAt")}: {formatDate(task.createdAt)}</span>
                          <span>
                            {isDone ? t("archive.completedAt") : t("archive.cancelledAt")}
                            : {formatDate(task.updatedAt)}
                          </span>
                          {lastExecution && (
                            <span className="flex items-center gap-1">
                              {t("archive.lastExecution")}:{" "}
                              <span
                                className={`rounded px-1 py-0.5 font-mono text-[10px] ${
                                  lastExecution.status === "COMPLETED"
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : lastExecution.status === "FAILED"
                                    ? "bg-rose-500/10 text-rose-400"
                                    : "bg-amber-500/10 text-amber-400"
                                }`}
                              >
                                {lastExecution.status}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
