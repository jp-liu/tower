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
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { gitAction } from "@/lib/git-api";

export interface CommitMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worktreePath: string;
  initialMessage: string;
  onSubmitted?: () => void;
}

export function CommitMessageDialog({
  open,
  onOpenChange,
  worktreePath,
  initialMessage,
  onSubmitted,
}: CommitMessageDialogProps) {
  const { t } = useI18n();
  const [message, setMessage] = useState(initialMessage);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setMessage(initialMessage);
  }, [open, initialMessage]);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await gitAction(worktreePath, "amend-message", {
        message: message.trim(),
      });
      toast.success(t("git.commitMenuAmend"));
      onOpenChange(false);
      onSubmitted?.();
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
          <DialogTitle>{t("git.amendMessageDialogTitle")}</DialogTitle>
        </DialogHeader>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !message.trim()}
          >
            {submitting ? "..." : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
