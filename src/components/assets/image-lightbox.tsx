"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ImageLightboxProps {
  imageUrl: string | null;
  filename: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImageLightbox({
  imageUrl,
  filename,
  open,
  onOpenChange,
}: ImageLightboxProps) {
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
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </DialogClose>
        {imageUrl && (
          <>
            {zoomed ? (
              <div className="overflow-auto max-w-[90vw] max-h-[90vh]">
                <img
                  src={imageUrl}
                  alt={filename}
                  onClick={() => setZoomed(false)}
                  className="w-auto h-auto max-w-none cursor-zoom-out"
                />
              </div>
            ) : (
              <img
                src={imageUrl}
                alt={filename}
                onClick={() => setZoomed(true)}
                className="max-w-full max-h-[85vh] object-contain cursor-zoom-in mx-auto"
              />
            )}
          </>
        )}
        <span className="absolute bottom-2 left-3 text-xs text-white/70 truncate max-w-[60%]">
          {filename}
        </span>
      </DialogContent>
    </Dialog>
  );
}
