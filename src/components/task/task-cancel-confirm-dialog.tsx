"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface TaskCancelConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  uncommittedFiles: string[];
  commitLog: string[];
  onConfirm: () => void;
}

export function TaskCancelConfirmDialog({
  open,
  onOpenChange,
  taskTitle,
  uncommittedFiles,
  commitLog,
  onConfirm,
}: TaskCancelConfirmDialogProps) {
  const { t } = useI18n();
  const fileCount = uncommittedFiles.length;
  const commitCount = commitLog.length;
  const isClean = fileCount === 0 && commitCount === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            {t("taskCancel.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 space-y-1.5">
            <p className="text-xs text-foreground">
              {t("taskCancel.intro", { title: taskTitle })}
            </p>
            <p className="text-xs text-amber-300">
              {t("taskCancel.irreversible")}
            </p>
          </div>

          {isClean ? (
            <p className="text-xs text-muted-foreground">
              {t("taskCancel.cleanNotice")}
            </p>
          ) : (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {t("taskCancel.uncommittedFiles")}
                </span>
                <span className="text-xs font-medium text-foreground">{fileCount}</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {t("taskCancel.unmergedCommits")}
                </span>
                <span className="text-xs font-medium text-foreground">{commitCount}</span>
              </div>
            </div>
          )}

          {fileCount > 0 && (
            <div>
              <span className="text-xs text-muted-foreground mb-1 block">
                {t("taskCancel.filesList")}
              </span>
              <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1 max-h-32 overflow-y-auto">
                {uncommittedFiles.map((line, i) => (
                  <div key={i} className="text-xs font-mono text-foreground/80">{line}</div>
                ))}
              </div>
            </div>
          )}

          {commitCount > 0 && (
            <div>
              <span className="text-xs text-muted-foreground mb-1 block">
                {t("taskCancel.commitsList")}
              </span>
              <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1 max-h-32 overflow-y-auto">
                {commitLog.map((line, i) => (
                  <div key={i} className="text-xs font-mono text-foreground/80">{line}</div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                {t("taskCancel.reflogHint")}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("taskCancel.keep")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            {t("taskCancel.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
