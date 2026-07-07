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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { commitWorktreeChanges } from "@/actions/task-actions";

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

  useEffect(() => {
    if (open) setMessage("");
  }, [open]);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await commitWorktreeChanges(taskId, message.trim());
      onOpenChange(false);
      onCommitted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("missions.completeCommitTitle")}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t("missions.completeCommitDesc", { count: String(files.length) })}
        </p>

        <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2">
          {files.map((f) => (
            <code key={f} className="block truncate text-xs text-muted-foreground">
              {f}
            </code>
          ))}
        </div>

        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("missions.completeCommitPlaceholder")}
          rows={3}
          autoFocus
        />

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !message.trim()}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("missions.completeCommitSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
