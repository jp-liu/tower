"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { commitWorktreeChanges, discardWorktreeChanges } from "@/actions/task-actions";

/**
 * Parse a `git status --porcelain` line (already trimmed) into its status code
 * and repo-relative path. Renames (`R  old -> new`) resolve to the new path.
 * ponytail: does not unquote core.quotePath-escaped paths (rare); such a file
 * simply can't be individually deselected — good enough for the weak version.
 */
export function parseStatusLine(line: string): { status: string; path: string } {
  const m = line.match(/^(\S{1,2})\s+(.*)$/);
  if (!m) return { status: "", path: line };
  const arrow = m[2].indexOf(" -> ");
  return { status: m[1], path: arrow === -1 ? m[2] : m[2].slice(arrow + 4) };
}

interface MissionCompleteCommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  /** Uncommitted files (from checkWorktreeClean) — shown so the user knows what gets committed. */
  files: string[];
  /** Called after a successful commit — parent then opens the merge confirm dialog. */
  onCommitted: () => void;
}

/**
 * Dirty-worktree branch of the Mission Control "Complete" flow: the task can't
 * be merged with uncommitted changes (they'd be lost on worktree teardown), so
 * this stages + commits everything into the task branch, then hands back to the
 * merge step. Discarding is intentionally NOT offered — only commit or cancel.
 */
export function MissionCompleteCommitDialog({
  open,
  onOpenChange,
  taskId,
  files,
  onCommitted,
}: MissionCompleteCommitDialogProps) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Selected paths to include in the commit — default all checked (keeps prior behavior).
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const parsed = files.map(parseStatusLine);

  useEffect(() => {
    if (open) {
      setMessage("");
      setSelected(new Set(files.map((f) => parseStatusLine(f).path)));
    }
  }, [open, files]);

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const hasSelection = selected.size > 0;

  const handleSubmit = async () => {
    // Commit needs a message; the skip-commit path (nothing checked) doesn't.
    if (hasSelection && !message.trim()) return;
    setSubmitting(true);
    try {
      if (hasSelection) {
        await commitWorktreeChanges(taskId, message.trim(), [...selected]);
      } else {
        // Everything unchecked → discard the dirty files, skip the commit, then
        // let the parent resume completion (worktree is now clean).
        await discardWorktreeChanges(taskId);
      }
      onOpenChange(false);
      onCommitted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const excluded = parsed.length - selected.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("missions.completeCommitTitle")}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t("missions.completeCommitDesc", { count: String(files.length) })}
        </p>

        <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/30 p-1">
          {parsed.map(({ status, path }) => {
            const checked = selected.has(path);
            return (
              <label
                key={path}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(path)} />
                <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">
                  {status}
                </span>
                <code
                  className={`truncate text-xs ${checked ? "text-foreground" : "text-muted-foreground line-through"}`}
                >
                  {path}
                </code>
              </label>
            );
          })}
        </div>

        {excluded > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("missions.completeCommitExcluded", { count: String(excluded) })}
          </p>
        )}

        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("missions.completeCommitPlaceholder")}
          rows={3}
          autoFocus
          disabled={!hasSelection}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || (hasSelection && !message.trim())}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {hasSelection ? t("missions.completeCommitSubmit") : t("missions.completeSkipSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
