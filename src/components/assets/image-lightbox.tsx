"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export interface LightboxAsset {
  url: string;
  filename: string;
}

interface ImageLightboxProps {
  imageUrl: string | null;
  filename: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets?: LightboxAsset[];
  currentIndex?: number;
  onIndexChange?: (nextIndex: number) => void;
}

type ZoomMode = "fit" | "actual";

export function ImageLightbox({
  imageUrl,
  filename,
  open,
  onOpenChange,
  assets,
  currentIndex,
  onIndexChange,
}: ImageLightboxProps) {
  const { t } = useI18n();
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const hasNav =
    !!assets && assets.length > 1 && typeof currentIndex === "number" && !!onIndexChange;
  const canPrev = hasNav && (currentIndex as number) > 0;
  const canNext = hasNav && (currentIndex as number) < (assets as LightboxAsset[]).length - 1;

  // Reset zoom + pan whenever the dialog opens or the image (URL) changes
  useEffect(() => {
    setZoomMode("fit");
    setPan({ x: 0, y: 0 });
  }, [open, imageUrl]);

  const goPrev = useCallback(() => {
    if (!hasNav || !canPrev) return;
    onIndexChange!(currentIndex! - 1);
  }, [hasNav, canPrev, onIndexChange, currentIndex]);

  const goNext = useCallback(() => {
    if (!hasNav || !canNext) return;
    onIndexChange!(currentIndex! + 1);
  }, [hasNav, canNext, onIndexChange, currentIndex]);

  // Keyboard navigation: ←/→ when navigation is available and dialog is open
  useEffect(() => {
    if (!open || !hasNav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hasNav, goPrev, goNext]);

  const toggleZoom = useCallback(() => {
    setZoomMode((m) => {
      const next = m === "fit" ? "actual" : "fit";
      if (next === "fit") setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  // Pan handlers — only active in actual mode
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoomMode !== "actual") return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    setIsDragging(true);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({
      x: dragStart.current.panX + dx,
      y: dragStart.current.panY + dy,
    });
  };
  const endDrag = () => {
    if (isDragging) setIsDragging(false);
    dragStart.current = null;
  };

  const cursorClass =
    zoomMode === "actual"
      ? isDragging
        ? "cursor-grabbing"
        : "cursor-grab"
      : "cursor-zoom-in";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden bg-black/90 ring-0"
      >
        {/* Top-right controls */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleZoom}
            className="h-8 w-8 text-white hover:bg-white/20 hover:text-white"
            aria-label={
              zoomMode === "fit"
                ? t("assets.lightbox.zoomActual")
                : t("assets.lightbox.zoomFit")
            }
            title={
              zoomMode === "fit"
                ? t("assets.lightbox.zoomActual")
                : t("assets.lightbox.zoomFit")
            }
          >
            {zoomMode === "fit" ? <ZoomIn className="h-4 w-4" /> : <ZoomOut className="h-4 w-4" />}
          </Button>
          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/20 hover:text-white"
              />
            }
            aria-label={t("assets.lightbox.close")}
          >
            <X className="h-4 w-4" />
          </DialogClose>
        </div>

        {/* Prev/Next chevrons (only when assets list has > 1 image) */}
        {hasNav && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!canPrev}
              onClick={goPrev}
              aria-label={t("assets.lightbox.prev")}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-9 w-9 text-white hover:bg-white/20 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!canNext}
              onClick={goNext}
              aria-label={t("assets.lightbox.next")}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-9 w-9 text-white hover:bg-white/20 hover:text-white disabled:opacity-30"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </>
        )}

        {/* Image stage — centered at all times */}
        <div
          className={`flex items-center justify-center w-[90vw] h-[85vh] overflow-hidden select-none ${cursorClass}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
        >
          {imageUrl &&
            (zoomMode === "fit" ? (
              <img
                src={imageUrl}
                alt={filename}
                onClick={toggleZoom}
                className="max-w-[90vw] max-h-[85vh] object-contain"
                draggable={false}
              />
            ) : (
              <img
                src={imageUrl}
                alt={filename}
                className="max-w-none max-h-none"
                style={{
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
                  willChange: isDragging ? "transform" : "auto",
                }}
                draggable={false}
              />
            ))}
        </div>

        {/* Filename + index indicator */}
        <span className="absolute bottom-2 left-3 text-xs text-white/70 truncate max-w-[60%]">
          {filename}
          {hasNav ? ` (${(currentIndex as number) + 1}/${(assets as LightboxAsset[]).length})` : ""}
        </span>
      </DialogContent>
    </Dialog>
  );
}
