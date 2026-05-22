"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, History, Circle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VersionCard } from "@/components/version/version-card";
import { VersionFormDialog } from "@/components/version/version-form-dialog";
import { ReleaseVersionDialog } from "@/components/version/release-version-dialog";
import { useI18n } from "@/lib/i18n";
import type { getProjectVersions } from "@/actions/version-actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type VersionWithTasks = Awaited<ReturnType<typeof getProjectVersions>>[number];
type BacklogTask = VersionWithTasks["tasks"][number];

interface DiffStat {
  additions: number;
  deletions: number;
  files: number;
}

interface EditVersionShape {
  id: string;
  number: string;
  name: string;
  type: "FEATURE" | "BUGFIX" | "RESEARCH";
  baseBranch: string | null;
  startDate: Date | string | null;
  targetDate: Date | string | null;
  description: string | null;
}

export interface VersionTimelineClientProps {
  project: { id: string; name: string; localPath: string | null };
  versions: VersionWithTasks[];
  diffStats: Record<string, DiffStat | null>;
  backlog: BacklogTask[];
}

// ─── Node colors per status/current ─────────────────────────────────────────

function nodeClass(v: VersionWithTasks): string {
  if (v.isCurrent) return "border-indigo-600 bg-indigo-600 shadow-[0_0_0_5px_#eef2ff]";
  if (v.status === "ACTIVE") return "border-green-600 bg-white shadow-[0_0_0_4px_#ecfdf5]";
  if (v.status === "RELEASED") return "border-zinc-300 bg-zinc-50";
  // PLANNED
  return "border-slate-300 bg-white";
}

// ─── Status dot color for backlog tasks ──────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  DONE: "bg-emerald-500",
  IN_PROGRESS: "bg-blue-500",
  IN_REVIEW: "bg-violet-500",
  TODO: "bg-slate-400",
  CANCELLED: "bg-slate-300",
};

// ─── Ordering helpers ────────────────────────────────────────────────────────

function sortNonReleased(versions: VersionWithTasks[]): VersionWithTasks[] {
  return [...versions].sort((a, b) => {
    // nulls last for targetDate
    if (!a.targetDate && !b.targetDate) return 0;
    if (!a.targetDate) return 1;
    if (!b.targetDate) return -1;
    const diff =
      new Date(b.targetDate).getTime() - new Date(a.targetDate).getTime();
    if (diff !== 0) return diff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function sortReleased(versions: VersionWithTasks[]): VersionWithTasks[] {
  return [...versions].sort((a, b) => {
    if (!a.releasedAt && !b.releasedAt) return 0;
    if (!a.releasedAt) return 1;
    if (!b.releasedAt) return -1;
    return new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime();
  });
}

// ─── Timeline row ─────────────────────────────────────────────────────────────

interface TimelineRowProps {
  version: VersionWithTasks;
  isFirst: boolean;
  isLast: boolean;
  dashed?: boolean;
  diffStat: DiffStat | null | undefined;
  onEdit: (id: string) => void;
  onRelease: (id: string) => void;
  onViewDiff: (id: string) => void;
}

function TimelineRow({
  version,
  isFirst,
  isLast,
  dashed = false,
  diffStat,
  onEdit,
  onRelease,
  onViewDiff,
}: TimelineRowProps) {
  return (
    <div className="flex gap-4">
      {/* Rail column */}
      <div className="relative flex w-5 flex-none flex-col items-center">
        {/* Top line segment */}
        <div
          className={[
            "w-px flex-none",
            isFirst ? "h-6" : "h-6",
            dashed
              ? "bg-[repeating-linear-gradient(to_bottom,#cbd5e1_0_4px,transparent_4px_8px)]"
              : "bg-border",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        {/* Node dot */}
        <div
          className={[
            "z-10 h-3.5 w-3.5 flex-none rounded-full border-2",
            nodeClass(version),
          ].join(" ")}
        />
        {/* Bottom line segment */}
        {!isLast && (
          <div
            className={[
              "w-px flex-1",
              dashed
                ? "bg-[repeating-linear-gradient(to_bottom,#cbd5e1_0_4px,transparent_4px_8px)]"
                : "bg-border",
            ].join(" ")}
          />
        )}
      </div>

      {/* Card column */}
      <div className="min-w-0 flex-1 pb-5">
        <VersionCard
          version={version}
          diffStat={diffStat ?? null}
          onEdit={onEdit}
          onRelease={onRelease}
          onViewDiff={onViewDiff}
        />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VersionTimelineClient({
  project,
  versions,
  diffStats,
  backlog,
}: VersionTimelineClientProps) {
  const { t } = useI18n();
  const router = useRouter();

  // Dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editVersion, setEditVersion] = useState<EditVersionShape | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<VersionWithTasks | null>(null);

  // Split into non-released / released
  const nonReleased = sortNonReleased(
    versions.filter((v) => v.status !== "RELEASED")
  );
  const released = sortReleased(
    versions.filter((v) => v.status === "RELEASED")
  );
  const ordered = [...nonReleased, ...released];

  // Callbacks
  const handleEdit = (id: string) => {
    const v = versions.find((x) => x.id === id);
    if (!v) return;
    setEditVersion({
      id: v.id,
      number: v.number,
      name: v.name,
      type: v.type as "FEATURE" | "BUGFIX" | "RESEARCH",
      baseBranch: v.baseBranch,
      startDate: v.startDate,
      targetDate: v.targetDate,
      description: v.description,
    });
    setFormOpen(true);
  };

  const handleRelease = (id: string) => {
    const v = versions.find((x) => x.id === id);
    if (!v) return;
    setReleaseTarget(v);
    setReleaseOpen(true);
  };

  const handleViewDiff = (_id: string) => {
    toast.info(t("version.diff.view"));
  };

  const handleNewVersion = () => {
    setEditVersion(null);
    setFormOpen(true);
  };

  const handleSuccess = () => {
    router.refresh();
  };

  // Compute release candidates
  const releaseCandidates = releaseTarget
    ? versions
        .filter(
          (v) =>
            v.id !== releaseTarget.id &&
            (v.status === "PLANNED" || v.status === "ACTIVE")
        )
        .map((v) => ({ id: v.id, number: v.number, name: v.name }))
    : [];

  const releaseUnfinishedCount = releaseTarget
    ? releaseTarget.tasks.filter(
        (t) => t.status !== "DONE" && t.status !== "CANCELLED"
      ).length
    : undefined;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <div className="header-xl flex shrink-0 items-center gap-4 border-b px-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="truncate font-medium">{project.name}</span>
            <span>/</span>
            <span>{t("version.timeline")}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            {t("version.historyHint")}
          </p>
        </div>
        <Button onClick={handleNewVersion}>
          <Plus className="h-4 w-4" />
          {t("version.new")}
        </Button>
      </div>

      {/* Scrollable timeline body */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl">
          {/* Empty state */}
          {versions.length === 0 && backlog.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-20 text-center text-muted-foreground">
              <p className="text-sm">{t("version.empty.list")}</p>
              <Button variant="outline" onClick={handleNewVersion}>
                <Plus className="h-4 w-4" />
                {t("version.new")}
              </Button>
            </div>
          )}

          {/* Version timeline */}
          {ordered.length > 0 && (
            <div className="relative">
              {ordered.map((v, idx) => (
                <TimelineRow
                  key={v.id}
                  version={v}
                  isFirst={idx === 0}
                  isLast={idx === ordered.length - 1 && backlog.length === 0}
                  diffStat={diffStats[v.id]}
                  onEdit={handleEdit}
                  onRelease={handleRelease}
                  onViewDiff={handleViewDiff}
                />
              ))}
            </div>
          )}

          {/* History / backlog group */}
          {backlog.length > 0 && (
            <div className="flex gap-4">
              {/* Dashed rail for history */}
              <div className="relative flex w-5 flex-none flex-col items-center">
                <div className="h-6 w-px bg-[repeating-linear-gradient(to_bottom,#cbd5e1_0_4px,transparent_4px_8px)]" />
                <div className="z-10 h-3.5 w-3.5 flex-none rounded-full border-2 border-dashed border-slate-400 bg-white" />
              </div>

              {/* History card */}
              <div className="min-w-0 flex-1 pb-5">
                <div className="overflow-hidden rounded-[14px] border border-dashed bg-[#fbfbfc] shadow-sm">
                  {/* Header */}
                  <div className="flex items-center gap-2.5 border-b border-dashed px-4 py-3">
                    <History className="h-4 w-4 text-muted-foreground/60" />
                    <span className="text-sm font-semibold text-foreground">
                      {t("version.history")}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-px text-[11px] text-muted-foreground">
                      {backlog.length}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground/70">
                      {t("version.historyHint")}
                    </span>
                  </div>

                  {/* Task list */}
                  <div className="divide-y divide-dashed divide-border/60 px-2 py-1">
                    {backlog.map((task) => {
                      const isDone =
                        task.status === "DONE" || task.status === "CANCELLED";
                      return (
                        <div
                          key={task.id}
                          className="flex items-center gap-2.5 px-2.5 py-2"
                        >
                          <Circle
                            className={[
                              "h-2 w-2 flex-none rounded-full",
                              STATUS_DOT[task.status] ?? "bg-slate-400",
                            ].join(" ")}
                            style={{ fill: "currentColor" }}
                          />
                          <span
                            className={[
                              "flex-1 text-[13px] font-medium",
                              isDone
                                ? "text-muted-foreground line-through decoration-muted-foreground/40"
                                : "text-foreground",
                            ].join(" ")}
                          >
                            {task.title}
                          </span>
                          {/* Labels */}
                          {task.labels.map(({ label }) => (
                            <span
                              key={label.id}
                              className="rounded-full border border-border px-1.5 py-px text-[10.5px] text-muted-foreground"
                              style={
                                label.color
                                  ? {
                                      borderColor: label.color + "55",
                                      color: label.color,
                                    }
                                  : undefined
                              }
                            >
                              {label.name}
                            </span>
                          ))}
                          {/* Asset + Note counts */}
                          {task.assets.length > 0 && (
                            <span className="text-[11px] text-muted-foreground/60">
                              {task.assets.length} {t("version.resources")}
                            </span>
                          )}
                          {task.notes.length > 0 && (
                            <span className="text-[11px] text-muted-foreground/60">
                              {task.notes.length} {t("version.notes")}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Dialogs ── */}
      <VersionFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditVersion(null);
        }}
        projectId={project.id}
        editVersion={editVersion}
        defaultBaseBranch={null}
        onSuccess={handleSuccess}
      />

      <ReleaseVersionDialog
        open={releaseOpen}
        onOpenChange={(open) => {
          setReleaseOpen(open);
          if (!open) setReleaseTarget(null);
        }}
        version={
          releaseTarget
            ? {
                id: releaseTarget.id,
                number: releaseTarget.number,
                name: releaseTarget.name,
                unfinishedCount: releaseUnfinishedCount,
              }
            : null
        }
        candidates={releaseCandidates}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
