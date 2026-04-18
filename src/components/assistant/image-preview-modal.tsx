"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface ImagePreviewModalProps {
  imageUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImagePreviewModal({
  imageUrl,
  open,
  onOpenChange,
}: ImagePreviewModalProps) {
  const { t } = useI18n();
  const [zoomed, setZoomed] = useState(false);

  // Reset zoom when dialog opens/closes
  useEffect(() => {
    setZoomed(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden bg-black/90 ring-0"
      >
        <DialogClose
          render={
            <Button
              variant="ghost"
              className="absolute top-2 right-2 z-10 h-8 w-8 p-0 text-white hover:bg-white/20 hover:text-white"
            />
          }
          aria-label={t("assistant.closePreview")}
        >
          <X className="h-4 w-4" />
        </DialogClose>
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            onClick={() => setZoomed((z) => !z)}
            className={
              zoomed
                ? "w-auto h-auto max-w-none cursor-zoom-out"
                : "max-w-full max-h-[85vh] object-contain cursor-zoom-in mx-auto"
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
