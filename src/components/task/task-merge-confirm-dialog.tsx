"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GitMerge, Loader2 } from "lucide-react";

interface TaskMergeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskTitle: string;
  baseBranch: string;
  fileCount: number;
  commitCount: number;
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
  onMergeComplete,
}: TaskMergeConfirmDialogProps) {
  const router = useRouter();
  const [isMerging, setIsMerging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConfirmMerge = async () => {
    setIsMerging(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitMessage: commitMessage.trim() }),
      });

      if (res.ok) {
        onOpenChange(false);
        onMergeComplete();
        router.refresh();
        return;
      }

      const data = await res.json().catch(() => ({ error: "Merge failed" }));

      if (res.status === 409) {
        setErrorMessage(
          `Merge conflicts detected: ${Array.isArray(data.conflictFiles) ? data.conflictFiles.join(", ") : "unknown files"}`
        );
      } else {
        setErrorMessage(data.error ?? "Merge failed");
      }
    } catch {
      setErrorMessage("Network error — merge failed");
    } finally {
      setIsMerging(false);
    }
  };

  const [commitMessage, setCommitMessage] = useState(`feat: ${taskTitle}`);

  // Reset message when dialog opens
  useEffect(() => {
    if (open) setCommitMessage(`feat: ${taskTitle}`);
  }, [open, taskTitle]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-emerald-400" />
            Confirm Squash Merge
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-4">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Target branch</span>
              <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-foreground">
                {baseBranch}
              </code>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Changed files</span>
              <span className="text-xs font-medium text-foreground">{fileCount}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Commits to squash</span>
              <span className="text-xs font-medium text-foreground">{commitCount}</span>
            </div>
          </div>

          {/* Editable commit message */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Commit message</label>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder-muted-foreground outline-none resize-y min-h-[60px]"
            />
          </div>

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
            Cancel
          </Button>
          <Button
           
            onClick={handleConfirmMerge}
            disabled={isMerging}
            className="gap-2"
          >
            {isMerging ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Merging...
              </>
            ) : (
              <>
                <GitMerge className="h-4 w-4" />
                Confirm Merge
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
