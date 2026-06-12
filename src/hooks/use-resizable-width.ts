"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ResizableWidthOptions {
  /** localStorage key used to persist the chosen width across sessions. */
  storageKey: string;
  /** Initial width (px) used on SSR / before any user drag. */
  defaultWidth: number;
  /** Lower clamp (px). */
  minWidth: number;
  /** Upper clamp (px). */
  maxWidth: number;
  /**
   * Which edge the drag handle sits on. A right-docked panel has its handle on
   * the LEFT edge, so dragging the pointer leftward should GROW the panel.
   * Defaults to "left".
   */
  edge?: "left" | "right";
}

/** Clamp a width into [min, max]. Pure — exported for unit testing. */
export function clampWidth(width: number, min: number, max: number): number {
  return Math.min(Math.max(width, min), max);
}

/**
 * Compute the new panel width from the drag-start state and current pointer X,
 * clamped to [min, max]. Pure — exported for unit testing.
 *
 * For a left-edge handle (right-docked panel) moving the pointer left (smaller
 * clientX) increases width, so delta = startX - clientX. A right-edge handle
 * is the mirror image.
 */
export function computeWidth(
  startWidth: number,
  startX: number,
  clientX: number,
  min: number,
  max: number,
  edge: "left" | "right" = "left",
): number {
  const delta = edge === "left" ? startX - clientX : clientX - startX;
  return clampWidth(startWidth + delta, min, max);
}

/**
 * Drag-to-resize state for a docked side panel. Returns the current width, a
 * dragging flag (for handle styling), and a pointer-down handler to attach to
 * the drag handle. The width is persisted to localStorage on drag end and
 * re-hydrated after mount (SSR-safe — starts at defaultWidth on the server).
 */
export function useResizableWidth(options: ResizableWidthOptions) {
  const { storageKey, defaultWidth, minWidth, maxWidth, edge = "left" } = options;
  const [width, setWidth] = useState(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);

  // Re-hydrate persisted width after mount (avoids SSR/client mismatch).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      const parsed = saved == null ? NaN : Number(saved);
      if (Number.isFinite(parsed)) {
        setWidth(clampWidth(parsed, minWidth, maxWidth));
      }
    } catch {
      // localStorage unavailable — keep the default.
    }
  }, [storageKey, minWidth, maxWidth]);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const start = dragStart.current;
      if (!start) return;
      setWidth(computeWidth(start.width, start.x, e.clientX, minWidth, maxWidth, edge));
    },
    [minWidth, maxWidth, edge],
  );

  const onPointerUp = useCallback(() => {
    if (!dragStart.current) return;
    dragStart.current = null;
    setIsDragging(false);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    setWidth((w) => {
      try {
        window.localStorage.setItem(storageKey, String(w));
      } catch {
        // Persist failure is non-fatal.
      }
      return w;
    });
  }, [onPointerMove, storageKey]);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragStart.current = { x: e.clientX, width };
      setIsDragging(true);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [width, onPointerMove, onPointerUp],
  );

  // Drop any stray listeners on unmount (e.g. unmounted mid-drag).
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  return { width, isDragging, startResize };
}
