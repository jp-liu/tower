"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, AlertTriangle, GitCompare, GitCommitHorizontal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import type { DiffFile } from "@/lib/diff-parser";

interface TaskDiffViewProps {
  taskId: string;
  files: DiffFile[];
  totalAdded: number;
  totalRemoved: number;
  hasConflicts: boolean;
  conflictFiles: string[];
  onCommit?: (message: string) => Promise<void>;
  hasUncommitted?: boolean;
}

// File expansion auto-loads the patch only when it's manageable; above this
// the row shows a "click to load" placeholder so a task that touches pdfjs /
// lockfiles doesn't fetch (or render) several megabytes on open.
const AUTO_LOAD_LINE_LIMIT = 200;
// Hard cap inside the inline renderer — patches taller than this are tail-
// truncated so the page stays responsive. Users can still open the file in
// the Git tab's Monaco editor for the full picture.
const RENDER_LINE_LIMIT = 500;

interface PatchState {
  kind: "loading" | "ready" | "binary" | "empty" | "error";
  patch?: string;
}

export function TaskDiffView({
  taskId,
  files,
  totalAdded,
  totalRemoved,
  hasConflicts,
  conflictFiles,
  onCommit,
  hasUncommitted,
}: TaskDiffViewProps) {
  const { t } = useI18n();
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [patchByFile, setPatchByFile] = useState<Map<string, PatchState>>(new Map());
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);

  const fetchPatch = (filename: string) => {
    setPatchByFile((prev) => new Map(prev).set(filename, { kind: "loading" }));
    fetch(`/api/tasks/${taskId}/diff-patch?file=${encodeURIComponent(filename)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { kind?: string; patch?: string }) => {
        setPatchByFile((prev) => {
          const next = new Map(prev);
          if (data.kind === "binary") next.set(filename, { kind: "binary" });
          else if (data.kind === "empty") next.set(filename, { kind: "empty" });
          else next.set(filename, { kind: "ready", patch: data.patch ?? "" });
          return next;
        });
      })
      .catch(() => {
        setPatchByFile((prev) => new Map(prev).set(filename, { kind: "error" }));
      });
  };

  const toggleFile = (file: DiffFile) => {
    const wasExpanded = expandedFiles.has(file.filename);
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file.filename)) next.delete(file.filename);
      else next.add(file.filename);
      return next;
    });
    if (wasExpanded || file.isBinary || patchByFile.has(file.filename)) return;
    const totalChanges = file.added + file.removed;
    if (totalChanges <= AUTO_LOAD_LINE_LIMIT) {
      fetchPatch(file.filename);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{files.length} files changed</span>
          <span className="text-green-400 font-mono text-xs">+{totalAdded}</span>
          <span className="text-red-400 font-mono text-xs">-{totalRemoved}</span>
        </div>
        <div className="flex items-center gap-2">
          {hasUncommitted && onCommit && (
            <Button
              variant="outline"
              onClick={() => setShowCommitDialog(true)}
              className="gap-2"
            >
              <GitCommitHorizontal className="h-4 w-4" />
              {t("diff.commit")}
            </Button>
          )}
        </div>
      </div>

      {/* Conflict warning */}
      {hasConflicts && (
        <div className="flex flex-col gap-2 border-b border-border bg-amber-500/5 px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm font-medium">
              Merge blocked: {conflictFiles.length} conflicting file{conflictFiles.length !== 1 ? "s" : ""}
            </span>
          </div>
          <ul className="ml-6 space-y-1">
            {conflictFiles.map((file) => (
              <li key={file} className="text-xs font-mono text-amber-300/80">
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {files.length === 0 ? (
          <EmptyState icon={GitCompare} title={t("diff.noChanges")} className="h-full" />
        ) : (
          <div className="divide-y divide-border">
            {files.map((file) => {
              const isExpanded = expandedFiles.has(file.filename);
              const patchState = patchByFile.get(file.filename);
              const totalChanges = file.added + file.removed;
              const isLargeFold = !patchState && totalChanges > AUTO_LOAD_LINE_LIMIT;
              return (
                <div key={file.filename}>
                  {/* File header row */}
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => toggleFile(file)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors rounded-none h-auto"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate text-sm font-mono text-foreground">
                      {file.filename}
                    </span>
                    {file.isBinary ? (
                      <Badge
                        variant="secondary"
                        className="text-[10px] bg-muted text-muted-foreground border border-border"
                      >
                        {t("diff.binary")}
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-green-400">+{file.added}</span>
                        <span className="text-xs font-mono text-red-400">-{file.removed}</span>
                      </div>
                    )}
                  </Button>

                  {/* Expanded patch content */}
                  {isExpanded && !file.isBinary && (
                    <div className="border-t border-border bg-background">
                      <ExpandedPatch
                        filename={file.filename}
                        patchState={patchState}
                        isLargeFold={isLargeFold}
                        onLoad={() => fetchPatch(file.filename)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Commit dialog */}
      <Dialog open={showCommitDialog} onOpenChange={setShowCommitDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("diff.commitChanges")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={t("diff.commitMessagePlaceholder")}
              rows={5}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none resize-y min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCommitDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={async () => {
                if (!commitMessage.trim() || !onCommit) return;
                setIsCommitting(true);
                try {
                  await onCommit(commitMessage.trim());
                  setCommitMessage("");
                  setShowCommitDialog(false);
                } finally {
                  setIsCommitting(false);
                }
              }}
              disabled={!commitMessage.trim() || isCommitting}
            >
              {isCommitting ? "..." : t("diff.commit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExpandedPatch({
  patchState,
  isLargeFold,
  onLoad,
}: {
  filename: string;
  patchState: PatchState | undefined;
  isLargeFold: boolean;
  onLoad: () => void;
}) {
  const { t } = useI18n();

  if (isLargeFold) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-6">
        <Button variant="link" onClick={onLoad} className="h-auto p-0 text-sm">
          {t("diff.loadDiff")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("diff.foldedLarge")}</span>
      </div>
    );
  }
  if (!patchState || patchState.kind === "loading") {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (patchState.kind === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <span>{t("diff.loadFailed")}</span>
        <Button variant="ghost" onClick={onLoad}>{t("diff.retry")}</Button>
      </div>
    );
  }
  if (patchState.kind === "binary") {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
        {t("diff.binaryNotShown")}
      </div>
    );
  }
  if (patchState.kind === "empty") {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
        {t("diff.noChanges")}
      </div>
    );
  }
  return <PatchHighlight patch={patchState.patch ?? ""} />;
}

// Inline unified-diff renderer — single <pre> with per-line color classes.
// Ported from the pre-virtualization implementation: simple, no deps, fast
// for the line budgets we render at.
function PatchHighlight({ patch }: { patch: string }) {
  const { t } = useI18n();
  const allLines = patch.split("\n");
  const truncated = allLines.length > RENDER_LINE_LIMIT;
  const displayLines = truncated ? allLines.slice(0, RENDER_LINE_LIMIT) : allLines;

  return (
    <>
      <pre className="overflow-x-auto p-0 text-xs font-mono leading-5">
        {displayLines.map((line, idx) => {
          const lineClass =
            line.startsWith("+++") || line.startsWith("---")
              ? "px-4 block text-muted-foreground"
              : line.startsWith("+")
              ? "px-4 block bg-green-500/10 text-green-400"
              : line.startsWith("-")
              ? "px-4 block bg-red-500/10 text-red-400"
              : line.startsWith("@@")
              ? "px-4 block bg-blue-500/10 text-blue-300"
              : "px-4 block text-muted-foreground";
          return (
            <span key={idx} className={lineClass}>
              {line || " "}
            </span>
          );
        })}
      </pre>
      {truncated && (
        <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
          {t("diff.patchTruncated", {
            n: String(RENDER_LINE_LIMIT),
            total: String(allLines.length),
          })}
        </div>
      )}
    </>
  );
}
