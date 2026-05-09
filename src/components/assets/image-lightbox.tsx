"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
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

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;

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
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  const hasNav =
    !!assets && assets.length > 1 && typeof currentIndex === "number" && !!onIndexChange;
  const canPrev = hasNav && (currentIndex as number) > 0;
  const canNext = hasNav && (currentIndex as number) < (assets as LightboxAsset[]).length - 1;

  // Portal needs document — only render after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset scale + pan whenever image changes
  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [imageUrl]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const goPrev = useCallback(() => {
    if (!hasNav || !canPrev) return;
    onIndexChange!(currentIndex! - 1);
  }, [hasNav, canPrev, onIndexChange, currentIndex]);

  const goNext = useCallback(() => {
    if (!hasNav || !canNext) return;
    onIndexChange!(currentIndex! + 1);
  }, [hasNav, canNext, onIndexChange, currentIndex]);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(MAX_SCALE, s * ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => {
      const next = Math.max(MIN_SCALE, s / ZOOM_STEP);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const toggleZoom = useCallback(() => {
    setScale((s) => {
      const next = s === 1 ? 2 : 1;
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "ArrowLeft":
          if (hasNav) {
            e.preventDefault();
            goPrev();
          }
          break;
        case "ArrowRight":
          if (hasNav) {
            e.preventDefault();
            goNext();
          }
          break;
        case "+":
        case "=":
          e.preventDefault();
          zoomIn();
          break;
        case "-":
        case "_":
          e.preventDefault();
          zoomOut();
          break;
        case "0":
          e.preventDefault();
          reset();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hasNav, close, goPrev, goNext, zoomIn, zoomOut, reset]);

  // Wheel zoom (anchored to cursor — feel natural)
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = delta > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setScale((s) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor));
      if (next <= 1) {
        setPan({ x: 0, y: 0 });
      }
      return next;
    });
  };

  // Drag pan (only meaningful when scale > 1)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scale <= 1) return;
    if (e.button !== 0) return; // primary button only
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

  // Click backdrop closes (but not when clicking image / controls)
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) close();
  };

  const cursorClass =
    scale > 1
      ? isDragging
        ? "cursor-grabbing"
        : "cursor-grab"
      : "cursor-zoom-in";

  if (!open || !mounted) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={t("assets.lightbox.zoomFit")}
    >
      {/* Top toolbar */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
        <ToolbarBtn
          onClick={zoomOut}
          title={t("assets.lightbox.zoomOut")}
          aria-label={t("assets.lightbox.zoomOut")}
          disabled={scale <= MIN_SCALE}
        >
          <ZoomOut className="h-4 w-4" />
        </ToolbarBtn>
        <span className="px-2 text-xs text-white/70 tabular-nums select-none min-w-12 text-center">
          {Math.round(scale * 100)}%
        </span>
        <ToolbarBtn
          onClick={zoomIn}
          title={t("assets.lightbox.zoomIn")}
          aria-label={t("assets.lightbox.zoomIn")}
          disabled={scale >= MAX_SCALE}
        >
          <ZoomIn className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={reset}
          title={t("assets.lightbox.reset")}
          aria-label={t("assets.lightbox.reset")}
          disabled={scale === 1 && pan.x === 0 && pan.y === 0}
        >
          <RotateCcw className="h-4 w-4" />
        </ToolbarBtn>
        <div className="mx-1 h-5 w-px bg-white/20" />
        <ToolbarBtn onClick={close} title={t("assets.lightbox.close")} aria-label={t("assets.lightbox.close")}>
          <X className="h-4 w-4" />
        </ToolbarBtn>
      </div>

      {/* Prev / Next chevrons */}
      {hasNav && (
        <>
          <NavBtn
            side="left"
            onClick={goPrev}
            disabled={!canPrev}
            title={t("assets.lightbox.prev")}
            aria-label={t("assets.lightbox.prev")}
          >
            <ChevronLeft className="h-6 w-6" />
          </NavBtn>
          <NavBtn
            side="right"
            onClick={goNext}
            disabled={!canNext}
            title={t("assets.lightbox.next")}
            aria-label={t("assets.lightbox.next")}
          >
            <ChevronRight className="h-6 w-6" />
          </NavBtn>
        </>
      )}

      {/* Image stage — wheel-to-zoom + drag-to-pan */}
      <div
        className={`absolute inset-0 flex items-center justify-center overflow-hidden select-none ${cursorClass}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt={filename}
            onDoubleClick={toggleZoom}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-[92vw] object-contain pointer-events-auto"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
              transformOrigin: "center center",
              transition: isDragging ? "none" : "transform 120ms ease-out",
              willChange: isDragging ? "transform" : "auto",
            }}
            draggable={false}
          />
        )}
      </div>

      {/* Bottom: filename + (i/N) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[80vw] truncate rounded-md bg-black/40 px-3 py-1 text-xs text-white/80 backdrop-blur-sm pointer-events-none">
        {filename}
        {hasNav ? ` · ${(currentIndex as number) + 1} / ${(assets as LightboxAsset[]).length}` : ""}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

// ---------------------------------------------------------------------------
// Internal button components — kept inside the file to avoid a tiny side-export.
// ---------------------------------------------------------------------------

function ToolbarBtn({
  children,
  onClick,
  title,
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
} & React.AriaAttributes) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      title={title}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/80 hover:bg-white/15 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white/80 transition-colors"
      {...rest}
    >
      {children}
    </button>
  );
}

function NavBtn({
  side,
  children,
  onClick,
  title,
  disabled,
  ...rest
}: {
  side: "left" | "right";
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
} & React.AriaAttributes) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      title={title}
      disabled={disabled}
      className={`absolute ${side === "left" ? "left-3" : "right-3"} top-1/2 z-10 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white/90 hover:bg-black/60 hover:text-white disabled:opacity-20 disabled:hover:bg-black/30 disabled:cursor-not-allowed backdrop-blur-sm transition-colors`}
      {...rest}
    >
      {children}
    </button>
  );
}
