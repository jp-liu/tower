"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { createTask, getTaskOverview } from "@/actions/task-actions";
import type { TaskOverviewData } from "@/actions/task-actions";
import { getLabelsForWorkspace } from "@/actions/label-actions";
import { getTaskNotes } from "@/actions/note-actions";
import { getTaskAssets } from "@/actions/asset-actions";
import { openInFileManager, openInEditor, openInTerminal } from "@/actions/preview-actions";
import { CreateTaskDialog } from "@/components/board/create-task-dialog";
import { NotePreviewDialog } from "@/components/notes/note-preview-dialog";
import { ImageLightbox } from "@/components/assets/image-lightbox";
import { TextPreviewDialog } from "@/components/assets/text-preview-dialog";
import { localPathToApiUrl, isImageAsset } from "@/lib/file-serve-client";
import { BOARD_COLUMNS, PRIORITY_CONFIG } from "@/lib/constants";
import { Calendar, Copy, Package, PlayCircle, FolderSearch, Code, Terminal, FileText, Eye, Paperclip, FolderOpen } from "lucide-react";
import { TaskFileChanges } from "@/components/task/task-file-changes";
import { TaskVersionTag } from "@/components/version/version-badges";
import { toast } from "sonner";

interface DrawerNote {
  id: string;
  title: string;
  content: string;
  category: string;
}

interface DrawerAsset {
  id: string;
  filename: string;
  path: string;
  mimeType: string | null;
  size: number | null;
}

const TEXT_PREVIEW_PATTERN = /\.(txt|md|json)$/i;

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface TaskOverviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string | null;
  /**
   * Hide the "open in file manager / editor / terminal" actions. Archived tasks
   * have their worktree dirs removed, so these actions point at nothing.
   */
  hideEnvActions?: boolean;
}

/**
 * Description that clamps to 5 lines and offers an expand/collapse toggle when
 * the content actually overflows. Overflow is measured once on mount (collapsed
 * state) — re-mount via `key` on the caller side when the task changes.
 */
function CollapsibleDescription({ text }: { text: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured while line-clamp-5 is applied (expanded starts false), so a
    // taller scrollHeight means there are hidden lines worth a toggle.
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, []);

  return (
    <div>
      <p
        ref={ref}
        className={`text-sm text-foreground whitespace-pre-wrap ${expanded ? "" : "line-clamp-5"}`}
      >
        {text}
      </p>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded
            ? t("taskDrawer.collapseDescription")
            : t("taskDrawer.expandDescription")}
        </button>
      )}
    </div>
  );
}

export function TaskOverviewDrawer({
  open,
  onOpenChange,
  taskId,
  hideEnvActions = false,
}: TaskOverviewDrawerProps) {
  const { t } = useI18n();
  const [task, setTask] = useState<TaskOverviewData | null>(null);
  const [isPending, startTransition] = useTransition();
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [labels, setLabels] = useState<
    { id: string; name: string; color: string; isBuiltin: boolean }[]
  >([]);
  const [notes, setNotes] = useState<DrawerNote[]>([]);
  const [previewNote, setPreviewNote] = useState<DrawerNote | null>(null);
  const [assets, setAssets] = useState<DrawerAsset[]>([]);
  const [previewAsset, setPreviewAsset] = useState<DrawerAsset | null>(null);

  useEffect(() => {
    if (!taskId || !open) {
      setTask(null);
      setNotes([]);
      setAssets([]);
      return;
    }
    // Notes bound to this task — surfaces auto-generated overviews / insights
    // and any manual task notes right inside the asset's task drawer.
    getTaskNotes(taskId)
      .then((rows) =>
        setNotes(
          rows.map((n) => ({ id: n.id, title: n.title, content: n.content, category: n.category }))
        )
      )
      .catch(() => setNotes([]));
    // Assets bound to this task — list the actual resources, not just a count.
    getTaskAssets(taskId)
      .then((rows) =>
        setAssets(
          rows.map((a) => ({
            id: a.id,
            filename: a.filename,
            path: a.path,
            mimeType: a.mimeType,
            size: a.size,
          }))
        )
      )
      .catch(() => setAssets([]));
    startTransition(async () => {
      const data = await getTaskOverview(taskId);
      if (data) {
        setTask(data);
        if (data.project?.workspaceId) {
          getLabelsForWorkspace(data.project.workspaceId).then((ls) => {
            setLabels(
              ls.map((l) => ({
                id: l.id,
                name: l.name,
                color: l.color,
                isBuiltin: l.isBuiltin,
              }))
            );
          }).catch(() => setLabels([]));
        }
      }
    });
  }, [taskId, open]);

  const statusCol = task
    ? BOARD_COLUMNS.find((c) => c.id === task.status)
    : null;
  const priorityConfig = task ? PRIORITY_CONFIG[task.priority] : null;
  const lastExecution = task?.executions?.[0] ?? null;

  // Directory to open in file manager / editor: prefer the worktree (where the
  // task actually ran), else the project dir (+ subPath for mono-repos).
  const openDir = (() => {
    if (lastExecution?.worktreePath) return lastExecution.worktreePath;
    const local = task?.project?.localPath;
    if (!local) return null;
    return task?.subPath ? `${local}/${task.subPath}` : local;
  })();

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

  const isAssetPreviewable = (asset: DrawerAsset) =>
    isImageAsset(asset.filename, asset.mimeType) || TEXT_PREVIEW_PATTERN.test(asset.filename);

  const handleAssetPreview = (asset: DrawerAsset) => {
    if (isAssetPreviewable(asset)) {
      setPreviewAsset(asset);
    } else {
      toast.info(t("assets.previewNotSupported"));
    }
  };

  const handleAssetReveal = async (asset: DrawerAsset) => {
    try {
      const res = await fetch("/api/internal/assets/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: asset.path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("git.openInFileManagerFailed"));
      }
    } catch {
      toast.error(t("git.openInFileManagerFailed"));
    }
  };

  const assetPreviewType = previewAsset
    ? isImageAsset(previewAsset.filename, previewAsset.mimeType)
      ? "image"
      : TEXT_PREVIEW_PATTERN.test(previewAsset.filename)
        ? "text"
        : null
    : null;

  const imageAssets = assets
    .filter((a) => isImageAsset(a.filename, a.mimeType))
    .map((a) => ({ id: a.id, url: localPathToApiUrl(a.path), filename: a.filename }));
  const currentImageIndex = previewAsset
    ? imageAssets.findIndex((a) => a.id === previewAsset.id)
    : -1;

  const handleDuplicate = () => {
    if (!task) return;
    setDuplicateOpen(true);
  };

  const handleDuplicateSubmit = async (data: {
    title: string;
    description: string;
    priority: import("@prisma/client").Priority;
    status: import("@prisma/client").TaskStatus;
    labelIds: string[];
    baseBranch?: string;
    subPath?: string;
    autoStart?: boolean;
  }) => {
    if (!task?.project) return;
    try {
      // autoStart from the dialog isn't honored here yet — duplicate flow
      // intentionally keeps the same "create-but-don't-start" semantics it
      // had before #9; revisit if the user asks for it.
      const { autoStart: _autoStart, ...rest } = data;
      void _autoStart;
      await createTask({
        ...rest,
        projectId: task.project.id,
      });
      toast.success(t("taskDrawer.duplicateSuccess"));
      setDuplicateOpen(false);
      onOpenChange(false);
    } catch {
      toast.error(t("taskDrawer.duplicateFailed"));
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
              {task.version && (
                <TaskVersionTag
                  number={task.version.number}
                  name={task.version.name}
                  showName
                />
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
            <div className="p-4 pb-8 space-y-4">
              {/* Description */}
              <section>
                <h4 className="text-xs font-medium text-muted-foreground mb-1">
                  {t("taskDrawer.description")}
                </h4>
                {task.description ? (
                  <CollapsibleDescription key={task.id} text={task.description} />
                ) : (
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {t("taskDrawer.noDescription")}
                  </p>
                )}
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

              {/* Resources (assets) bound to this task */}
              <section>
                <h4 className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  {t("taskDrawer.resources")}
                  <span className="text-foreground">{task._count.assets}</span>
                </h4>
                {assets.length > 0 ? (
                  <div className="space-y-1.5">
                    {assets.map((asset) => {
                      const canPreview = isAssetPreviewable(asset);
                      return (
                        <div
                          key={asset.id}
                          className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                        >
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <button
                            type="button"
                            onClick={() => handleAssetPreview(asset)}
                            disabled={!canPreview}
                            className={`min-w-0 flex-1 truncate text-left text-sm ${canPreview ? "cursor-pointer hover:underline" : "cursor-default"}`}
                            title={canPreview ? t("assets.preview") : asset.filename}
                          >
                            {asset.filename}
                          </button>
                          <span className="shrink-0 text-[10px] text-muted-foreground">{formatSize(asset.size)}</span>
                          <div className="flex items-center gap-0.5">
                            {canPreview && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => handleAssetPreview(asset)}
                                className="shrink-0 text-muted-foreground hover:bg-accent"
                                title={t("assets.preview")}
                              >
                                <Eye className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => handleAssetReveal(asset)}
                              className="shrink-0 text-muted-foreground hover:bg-accent"
                              title={t("assets.revealInFinder")}
                            >
                              <FolderOpen className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("taskDrawer.noResources")}</p>
                )}
              </section>

              {/* Notes bound to this task */}
              <section>
                <h4 className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  {t("taskDrawer.notes")}
                </h4>
                {notes.length > 0 ? (
                  <div className="space-y-1.5">
                    {notes.map((note) => (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => setPreviewNote(note)}
                        className="group/note flex w-full items-start gap-2 rounded-md border border-border p-2 text-left transition-colors hover:bg-accent/40"
                        title={t("taskDrawer.previewNote")}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{note.title}</p>
                          {note.content && (
                            <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                              {note.content}
                            </p>
                          )}
                        </div>
                        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/note:opacity-100" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("taskDrawer.noNotes")}</p>
                )}
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

              {/* Open in file manager / editor — uses the task's worktree dir
                  (or project dir + subPath). Hidden for tasks with no local path,
                  and for archived tasks (hideEnvActions) whose worktree is gone. */}
              {openDir && !hideEnvActions && (
                <section className="flex flex-col">
                  <Button
                    variant="ghost"
                    className="w-full h-8 justify-start gap-2 px-2 text-xs text-muted-foreground"
                    onClick={async () => {
                      try {
                        await openInFileManager(openDir);
                      } catch (err) {
                        console.error("openInFileManager failed:", err);
                        toast.error(t("git.openInFileManagerFailed"));
                      }
                    }}
                  >
                    <FolderSearch className="h-3.5 w-3.5 shrink-0" />
                    {t("git.openInFileManager")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full h-8 justify-start gap-2 px-2 text-xs text-muted-foreground"
                    onClick={async () => {
                      try {
                        await openInEditor(openDir);
                      } catch (err) {
                        console.error("openInEditor failed:", err);
                        toast.error(t("git.openInEditorFailed"));
                      }
                    }}
                  >
                    <Code className="h-3.5 w-3.5 shrink-0" />
                    {t("git.openInEditor")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full h-8 justify-start gap-2 px-2 text-xs text-muted-foreground"
                    onClick={async () => {
                      try {
                        await openInTerminal(openDir);
                      } catch (err) {
                        console.error("openInTerminal failed:", err);
                        toast.error(t("git.openInTerminalFailed"));
                      }
                    }}
                  >
                    <Terminal className="h-3.5 w-3.5 shrink-0" />
                    {t("git.openInTerminal")}
                  </Button>
                </section>
              )}

              {/* Duplicate action — opens create-task dialog with current task's
                  data prefilled. Avoids the worktree-recycle pitfalls of true rerun. */}
              <section>
                <Button
                  variant="default"
                  className="w-full"
                  onClick={handleDuplicate}
                  disabled={!task}
                >
                  <Copy className="h-4 w-4" />
                  {t("taskDrawer.duplicate")}
                </Button>
              </section>
            </div>
          ) : null}
        </ScrollArea>
      </SheetContent>

      {/* Duplicate dialog — only render when task fully loaded */}
      {task?.project && (
        <CreateTaskDialog
          open={duplicateOpen}
          onOpenChange={setDuplicateOpen}
          onSubmit={handleDuplicateSubmit}
          labels={labels}
          projectType={task.project.type}
          projectLocalPath={task.project.localPath}
          prefillFromTask={{
            title: task.title,
            description: task.description,
            priority: task.priority,
            subPath: task.subPath,
            labelIds: task.labels.map((tl) => tl.label.id),
            baseBranch: task.baseBranch,
          }}
        />
      )}

      <NotePreviewDialog
        note={previewNote}
        open={previewNote !== null}
        onOpenChange={(o) => { if (!o) setPreviewNote(null); }}
      />
      <ImageLightbox
        imageUrl={
          assetPreviewType === "image" && currentImageIndex >= 0
            ? imageAssets[currentImageIndex].url
            : null
        }
        filename={
          assetPreviewType === "image" && currentImageIndex >= 0
            ? imageAssets[currentImageIndex].filename
            : ""
        }
        open={assetPreviewType === "image"}
        onOpenChange={(o) => { if (!o) setPreviewAsset(null); }}
        assets={imageAssets.map(({ url, filename }) => ({ url, filename }))}
        currentIndex={currentImageIndex >= 0 ? currentImageIndex : undefined}
        onIndexChange={(nextIndex) => {
          const target = imageAssets[nextIndex];
          if (!target) return;
          const orig = assets.find((a) => a.id === target.id);
          if (orig) setPreviewAsset(orig);
        }}
      />
      <TextPreviewDialog
        url={assetPreviewType === "text" && previewAsset ? localPathToApiUrl(previewAsset.path) : null}
        filename={previewAsset?.filename ?? ""}
        open={assetPreviewType === "text"}
        onOpenChange={(o) => { if (!o) setPreviewAsset(null); }}
      />
    </Sheet>
  );
}
