"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { GitMerge, Loader2 } from "lucide-react";

interface TaskMergeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskTitle: string;
  baseBranch: string;
  fileCount: number;
  commitCount: number;
  commitLog?: string[];
  onMergeComplete: () => void;
}

export function TaskMergeConfirmDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
  baseBranch,
  fileCount,
  commitCount,
  commitLog = [],
  onMergeComplete,
}: TaskMergeConfirmDialogProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [isMerging, setIsMerging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConfirmMerge = async () => {
    setIsMerging(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        const ok = await res.json().catch(() => ({}));
        // Merge succeeded but left the user something to fix by hand (e.g. an
        // autostash that could not be restored). It must not auto-dismiss —
        // the message carries the recovery steps.
        if (ok.warning) {
          toast.warning(t(ok.warning.key, ok.warning.vars), {
            duration: Infinity,
            closeButton: true,
          });
        }
        onOpenChange(false);
        onMergeComplete();
        router.refresh();
        return;
      }

      const data = await res.json().catch(() => ({}));
      const fileList = (files: unknown) =>
        Array.isArray(files) && files.length ? files.join(", ") : t("merge.unknownFiles");

      if (res.status === 409) {
        setErrorMessage(t("merge.conflictFilesError", { files: fileList(data.conflictFiles) }));
      } else if (res.status === 400 && Array.isArray(data.files)) {
        // WorktreeDirtyError — the only 400 carrying a file list. The route's
        // other 400s (bad id, no base branch, …) fall through to data.error.
        setErrorMessage(t("merge.dirtyError", { files: fileList(data.files) }));
      } else if (data.i18nKey) {
        // Structured error from the server (main repo not ready) — render it in
        // the user's locale rather than showing the English data.error.
        setErrorMessage(t(data.i18nKey, data.i18nVars));
      } else {
        setErrorMessage(data.error ?? t("merge.failed"));
      }
    } catch {
      setErrorMessage(t("merge.networkError"));
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-emerald-400" />
            {t("merge.confirmTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-4">
              <span className="text-xs text-muted-foreground whitespace-nowrap">{t("merge.targetBranch")}</span>
              <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-foreground">
                {baseBranch}
              </code>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-xs text-muted-foreground whitespace-nowrap">{t("merge.changedFiles")}</span>
              <span className="text-xs font-medium text-foreground">{fileCount}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-xs text-muted-foreground whitespace-nowrap">{t("merge.commitsToSquash")}</span>
              <span className="text-xs font-medium text-foreground">{commitCount}</span>
            </div>
          </div>

          {commitLog.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground mb-1 block">{t("merge.commitList")}</span>
              <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1 max-h-32 overflow-y-auto">
                {commitLog.map((line, i) => (
                  <div key={i} className="text-xs font-mono text-foreground/80">{line}</div>
                ))}
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
              <p className="text-xs text-red-400">{errorMessage}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
           
            onClick={() => onOpenChange(false)}
            disabled={isMerging}
          >
            {t("merge.cancel")}
          </Button>
          <Button
           
            onClick={handleConfirmMerge}
            disabled={isMerging}
            className="gap-2"
          >
            {isMerging ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("merge.merging")}
              </>
            ) : (
              <>
                <GitMerge className="h-4 w-4" />
                {t("merge.confirm")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
