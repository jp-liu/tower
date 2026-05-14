"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { gitAction } from "@/lib/git-api";

export interface CommitTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worktreePath: string;
  commitHash: string;
  onCreated?: () => void;
}

export function CommitTagDialog({
  open,
  onOpenChange,
  worktreePath,
  commitHash,
  onCreated,
}: CommitTagDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await gitAction(worktreePath, "create-tag", {
        hash: commitHash,
        name: name.trim(),
        message: message.trim() || undefined,
      });
      toast.success(t("git.commitMenuCreateTag"));
      setName("");
      setMessage("");
      onOpenChange(false);
      onCreated?.();
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
          <DialogTitle>{t("git.commitMenuCreateTag")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("git.tagNamePlaceholder")}
            autoFocus
          />
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("git.tagMessagePlaceholder")}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
          >
            {submitting ? "..." : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
