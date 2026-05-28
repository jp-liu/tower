"use client";

import { useState } from "react";
import {
  ChevronRight,
  Calendar,
  GitBranch,
  GitCommitHorizontal,
  Tag,
  GitCompare,
  FolderOpen,
  FileText,
  Image,
  Pencil,
  PackageCheck,
  PanelRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { BOARD_COLUMNS, PRIORITY_CONFIG } from "@/lib/constants";
import { VersionTypeBadge, VersionStatusBadge } from "@/components/version/version-badges";
import { useI18n } from "@/lib/i18n";
import type { getProjectVersions } from "@/actions/version-actions";

type VersionWithTasks = Awaited<ReturnType<typeof getProjectVersions>>[number];
export type TaskWithDetails = VersionWithTasks["tasks"][number];

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "";
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${m}-${day}`;
}

function shortCommit(hash: string | null | undefined): string {
  if (!hash) return "";
  return hash.slice(0, 7);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Mirror the kanban board's status colors (BOARD_COLUMNS) so a status looks
// the same here as on the board.
const STATUS_DOT_COLOR: Record<string, string> = Object.fromEntries(
  BOARD_COLUMNS.map((c) => [c.id, c.color]),
);


// ─── Sub-components ──────────────────────────────────────────────────────────

function MetaChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

interface TaskRowProps {
  task: TaskWithDetails;
  onOpenDetail?: (taskId: string) => void;
}

export function TaskRow({ task, onOpenDetail }: TaskRowProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // active = normal text; DONE = muted; CANCELLED = muted + strikethrough
  const titleClass =
    task.status === "CANCELLED"
      ? "text-muted-foreground line-through decoration-muted-foreground/40"
      : task.status === "DONE"
        ? "text-muted-foreground"
        : "text-foreground";

  return (
    <div className="rounded-[10px]">
      {/* Task summary row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 flex-none text-muted-foreground/60 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        {/* Status dot */}
        <span
          className={`h-2 w-2 flex-none rounded-full ${STATUS_DOT_COLOR[task.status] ?? "bg-slate-400"}`}
        />
        {/* Title */}
        <span className={`text-[13.5px] font-medium ${titleClass}`}>
          {task.title}
        </span>
        {/* Labels */}
        {task.labels.map(({ label }) => (
          <span
            key={label.id}
            className="rounded-full border border-border px-1.5 py-px text-[10.5px] text-muted-foreground"
            style={label.color ? { borderColor: label.color + "55", color: label.color } : undefined}
          >
            {label.name}
          </span>
        ))}
        <span className="flex-1" />
        {/* Right cluster — fixed-width columns so they align across rows */}
        {/* Priority */}
        <span className="flex w-16 flex-none justify-center">
          <span className={`rounded-[5px] px-1.5 py-px text-[10.5px] font-bold ${PRIORITY_CONFIG[task.priority]?.color ?? PRIORITY_CONFIG.LOW.color}`}>
            {task.priority}
          </span>
        </span>
        {/* Separator */}
        <span className="h-3 w-px bg-border flex-none" />
        {/* Status */}
        <span className="flex w-[72px] flex-none items-center gap-1.5">
          <span className={`h-1.5 w-1.5 flex-none rounded-full ${STATUS_DOT_COLOR[task.status] ?? "bg-slate-400"}`} />
          <span className="truncate text-[10.5px] text-muted-foreground">
            {t(`version.taskStatus.${task.status}` as Parameters<typeof t>[0])}
          </span>
        </span>
        {/* Separator */}
        <span className="h-3 w-px bg-border flex-none" />
        {/* Detail button */}
        <span className="flex w-6 flex-none justify-center">
          {onOpenDetail && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={(e) => { e.stopPropagation(); onOpenDetail(task.id); }}
                  />
                }
              >
                <PanelRight className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent>{t("version.detail")}</TooltipContent>
            </Tooltip>
          )}
        </span>
      </button>

      {/* Expandable leaf: resources + notes */}
      {open && (
        <div className="flex flex-col gap-2.5 pb-3 pl-[30px] pr-3 pt-1">
          {/* Resources */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <FolderOpen className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground/60">
                {t("version.resources")}
              </span>
            </div>
            {task.assets.length === 0 ? (
              <p className="text-[12px] italic text-muted-foreground/60">{t("version.empty.resources")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {task.assets.map((asset) => {
                  const isImage = asset.mimeType?.startsWith("image/");
                  return (
                    <span
                      key={asset.id}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground shadow-sm transition-colors hover:border-primary/50"
                    >
                      {isImage ? (
                        <Image className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span>{asset.filename}</span>
                      {asset.size != null && (
                        <span className="text-[11px] text-muted-foreground/60">
                          {formatFileSize(asset.size)}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <FileText className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground/60">
                {t("version.notes")}
              </span>
            </div>
            {task.notes.length === 0 ? (
              <p className="text-[12px] italic text-muted-foreground/60">{t("version.empty.notes")}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {task.notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg border border-border border-l-violet-500/50 bg-background px-2.5 py-2 shadow-sm [border-left-width:3px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-semibold text-foreground">{note.title}</span>
                      {note.category && (
                        <span className="rounded-[5px] border border-violet-500/30 bg-violet-500/15 px-1.5 py-px text-[10px] font-bold text-violet-300">
                          {note.category}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface VersionCardProps {
  version: VersionWithTasks;
  diffStat?: { additions: number; deletions: number; files: number } | null;
  onEdit?: (versionId: string) => void;
  onRelease?: (versionId: string) => void;
  onViewDiff?: (versionId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
}

export function VersionCard({ version, diffStat, onEdit, onRelease, onViewDiff, onOpenTaskDetail }: VersionCardProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(version.isCurrent);

  const isReleased = version.status === "RELEASED";
  const isActive = version.status === "ACTIVE";

  const totalTasks = version.tasks.length;
  const doneTasks = version.tasks.filter((t) => t.status === "DONE").length;

  const hasDiff = !!(version.releaseCommit || diffStat);

  // Count chip text: "3 任务 · 1 完成" or "1 任务"
  const countText = (() => {
    const base = `${totalTasks} ${t("version.tasksCount")}`;
    if (doneTasks > 0 && doneTasks < totalTasks) return `${base} · ${doneTasks} ${t("version.doneCount")}`;
    if (doneTasks > 0 && doneTasks === totalTasks) return `${base} · ${t("version.allDone")}`;
    return base;
  })();

  return (
    <div
      className={[
        "overflow-hidden rounded-[14px] border bg-card shadow-sm transition-shadow duration-150 hover:shadow-md",
        version.isCurrent
          ? "border-border border-l-2 border-l-primary ring-1 ring-primary/20"
          : "border-border",
        isReleased ? "opacity-[.96]" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Card header (always visible) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="px-4 py-3.5">
          {/* Top row: chevron + version number + name + badges + spacer + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <ChevronRight
              className={`h-4 w-4 flex-none text-muted-foreground/60 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            />
            {/* Version number */}
            <span className="font-mono text-[14.5px] font-bold text-foreground">
              {version.number}
            </span>
            {/* Version name */}
            <span className="text-[14.5px] font-semibold text-foreground">{version.name}</span>
            {/* Type badge */}
            <VersionTypeBadge name={version.type?.name ?? null} />
            {/* Status badge */}
            <VersionStatusBadge status={version.status as "PLANNED" | "ACTIVE" | "RELEASED"} />
            {/* Current pill */}
            {version.isCurrent && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-primary opacity-90" />
                {t("version.current")}
              </span>
            )}
            <span className="flex-1" />
            {/* Task count */}
            {totalTasks > 0 && (
              <span className="text-[11.5px] text-muted-foreground">{countText}</span>
            )}
            {/* Action buttons — stop click propagation so they don't toggle collapse */}
            <span
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {onEdit && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => onEdit(version.id)}
                      />
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{t("version.edit")}</TooltipContent>
                </Tooltip>
              )}
              {isActive && onRelease && (
                <Button
                  variant="outline"
                  className="h-7 px-2 text-xs font-semibold"
                  onClick={() => onRelease(version.id)}
                >
                  <PackageCheck className="h-3.5 w-3.5" />
                  {t("version.release")}
                </Button>
              )}
            </span>
          </div>

          {/* Meta chips row */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {/* Dates */}
            {isReleased && version.releasedAt ? (
              <MetaChip>
                <Calendar className="h-3 w-3" />
                {t("version.releasedAt")}
                <strong className="text-foreground">{formatDate(version.releasedAt)}</strong>
              </MetaChip>
            ) : (version.startDate || version.targetDate) ? (
              <MetaChip>
                <Calendar className="h-3 w-3" />
                {version.startDate ? formatDate(version.startDate) : "—"}
                {" → "}
                {version.targetDate ? (
                  <strong className="text-foreground">{formatDate(version.targetDate)}</strong>
                ) : "—"}
              </MetaChip>
            ) : null}

            {/* Branch */}
            {version.baseBranch && (
              <MetaChip>
                <GitBranch className="h-3 w-3" />
                <span className="font-mono text-[11px] text-foreground">{version.baseBranch}</span>
              </MetaChip>
            )}

            {/* Base commit */}
            {version.baseCommit && (
              <MetaChip>
                <GitCommitHorizontal className="h-3 w-3" />
                {t("version.field.baseCommit")}
                <span className="font-mono text-[11px] text-foreground">
                  {shortCommit(version.baseCommit)}
                </span>
              </MetaChip>
            )}

            {/* Release tag (for released versions) */}
            {isReleased && (
              <MetaChip>
                <Tag className="h-3 w-3" />
                <span className="font-mono text-[11px] text-foreground">{version.number}</span>
              </MetaChip>
            )}

            {/* Diff stat */}
            {diffStat && (
              <MetaChip>
                <GitCompare className="h-3 w-3" />
                {!isReleased && (
                  <span className="text-muted-foreground">{t("version.diff.live")}</span>
                )}
                <span className="font-bold text-emerald-400">+{diffStat.additions.toLocaleString()}</span>
                <span className="font-bold text-rose-400">−{diffStat.deletions.toLocaleString()}</span>
                <span className="text-muted-foreground">
                  · {diffStat.files} {t("version.diff.files")}
                </span>
              </MetaChip>
            )}

            {/* View diff link */}
            {hasDiff && onViewDiff && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                onClick={(e) => { e.stopPropagation(); onViewDiff(version.id); }}
              >
                <GitCompare className="h-3 w-3" />
                {t("version.diff.view")} →
              </Button>
            )}
          </div>

          {/* Description */}
          {version.description && (
            <p className="mt-2 text-[13px] text-muted-foreground">{version.description}</p>
          )}
        </div>
      </button>

      {/* Collapsible task list */}
      {open && totalTasks > 0 && (
        <div className="border-t border-dashed border-border bg-muted/40 px-2 pb-2 pt-1.5">
          {version.tasks.map((task) => (
            <TaskRow key={task.id} task={task} onOpenDetail={onOpenTaskDetail} />
          ))}
        </div>
      )}
    </div>
  );
}
