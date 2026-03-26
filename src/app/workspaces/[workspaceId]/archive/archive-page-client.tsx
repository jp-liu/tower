"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Archive, CheckCircle2, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { TaskStatus } from "@prisma/client";

interface LabelItem {
  label: {
    id: string;
    name: string;
    color: string;
  };
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

interface Project {
  id: string;
  name: string;
  alias: string | null;
}

interface ArchivePageClientProps {
  workspaceId: string;
  projects: Project[];
  activeProjectId: string;
  archivedTasks: ArchivedTask[];
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
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${colors[priority] ?? "bg-slate-400"}`}
    />
  );
}

export function ArchivePageClient({
  workspaceId,
  projects,
  activeProjectId,
  archivedTasks,
}: ArchivePageClientProps) {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t("archive.backToBoard")}</span>
        </Link>
        <span className="text-border">·</span>
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <span>{t("archive.title")}</span>
        </div>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {archivedTasks.length}
        </span>
      </div>

      {/* Project Tabs */}
      {projects.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-6 py-2"
          style={{ scrollbarWidth: "none" }}
        >
          {projects.map((p) => {
            const isActive = activeProjectId === p.id;
            return (
              <button
                key={p.id}
                onClick={() =>
                  router.push(
                    `/workspaces/${workspaceId}/archive?projectId=${p.id}`,
                    { scroll: false }
                  )
                }
                className={`shrink-0 rounded-lg border-b-2 px-4 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-amber-400 bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20"
                    : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <span>{p.name}</span>
                {p.alias && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {p.alias}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Task List */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {archivedTasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
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
            {archivedTasks.map((task) => {
              const isDone = task.status === "DONE";
              const lastExecution = task.executions[0];
              return (
                <div
                  key={task.id}
                  className="group rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-border/80 hover:bg-accent/30"
                >
                  <div className="flex items-start gap-3">
                    {/* Status icon */}
                    <div className="mt-0.5 shrink-0">
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-rose-500" />
                      )}
                    </div>

                    {/* Main content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <PriorityDot priority={task.priority} />
                        <span className="truncate text-sm font-medium text-foreground">
                          {task.title}
                        </span>
                        {/* Status badge */}
                        <span
                          className={`ml-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            isDone
                              ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20"
                          }`}
                        >
                          {isDone
                            ? t("archive.status.done")
                            : t("archive.status.cancelled")}
                        </span>
                      </div>

                      {/* Labels */}
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

                      {/* Meta info */}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        <span>
                          {t("archive.createdAt")}: {formatDate(task.createdAt)}
                        </span>
                        <span>
                          {isDone
                            ? t("archive.completedAt")
                            : t("archive.cancelledAt")}
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
  );
}
