"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export interface StopPreviewConfirmDialogProps {
  open: boolean;
  otherTabsCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function StopPreviewConfirmDialog({
  open,
  otherTabsCount,
  onConfirm,
  onCancel,
}: StopPreviewConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("preview.stopConfirmTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("preview.stopConfirmBody", { count: String(otherTabsCount) })}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("preview.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("preview.stopConfirmConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
