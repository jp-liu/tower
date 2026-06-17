"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import type { ActiveExecutionInfo } from "@/actions/agent-actions";
import {
  paneShortcutLabel,
  paneIndexFromShortcutKey,
} from "@/components/missions/pane-navigation";

interface PaneSelectorDialogProps {
  open: boolean;
  /** Panes in visible (grid) order — index matches the grid position. */
  panes: ActiveExecutionInfo[];
  /** Currently highlighted index (driven by arrow / Tab navigation). */
  selectedIndex: number;
  /** Select a pane by index → focus it and leave nav mode. */
  onSelect: (index: number) => void;
  /** Cancel (Esc / backdrop) → return to the previously focused pane. */
  onClose: () => void;
}

/**
 * Centered pane picker shown in navigation mode. Replaces the per-pane overlay:
 * all panes are tiled in a responsive grid (4 per row on desktop), each showing
 * its quick-select character (1–9, then A–Z) and breadcrumb title. Choose a pane
 * by pressing its character or clicking it; both focus the pane and start typing.
 *
 * Built as a plain portal overlay (not the Base UI Dialog) so it does NOT trap
 * focus or make the background inert — that lets `onSelect` focus a terminal
 * pane immediately on close without the dialog stealing focus back.
 */
export function PaneSelectorDialog({
  open,
  panes,
  selectedIndex,
  onSelect,
  onClose,
}: PaneSelectorDialogProps) {
  const { t } = useI18n();

  // Quick-select characters + Escape. Digits 1–9 are handled by the
  // missions.jump shortcut; here we cover letters (A–Z) and Esc. Capture phase
  // so it pre-empts default typing. Arrow/Tab/Enter stay with the missions
  // shortcuts (they move the highlight / confirm the selection).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) return; // digits → missions.jump
      const idx = paneIndexFromShortcutKey(e.key);
      if (idx === null || idx >= panes.length) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect(idx);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open, panes.length, onSelect, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
        onClick={onClose}
      />

      {/* Panel — mirrors DialogContent styling */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 z-50 w-full max-w-[calc(100%-2rem)] sm:max-w-5xl -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none"
      >
        {/* Header */}
        <div className="flex items-center gap-2 pr-8">
          <span className="font-heading text-base font-medium leading-none">
            {t("missions.selector.title")}
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono font-medium text-muted-foreground">
            {panes.length}
          </span>
          <span className="ml-1 truncate text-xs text-muted-foreground">
            {t("missions.selector.hint")}
          </span>
        </div>

        {/* Close button */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2"
          onClick={onClose}
          aria-label={t("missions.launcher.cancel")}
        >
          <XIcon />
        </Button>

        {/* Pane grid */}
        <ScrollArea className="mt-4 max-h-[60vh]">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pr-3">
            {panes.map((pane, index) => {
              const label = paneShortcutLabel(index);
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={pane.executionId}
                  type="button"
                  onClick={() => onSelect(index)}
                  className={[
                    "flex flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-all",
                    "hover:border-primary/40 hover:bg-accent/50",
                    isSelected
                      ? "border-primary ring-2 ring-inset ring-primary"
                      : "border-border",
                  ].join(" ")}
                >
                  {/* Breadcrumb — truncate long alias, full name on hover */}
                  <span
                    className="block w-full truncate text-[11px] text-muted-foreground"
                    title={`${pane.workspaceName} › ${pane.projectAlias || pane.projectName}`}
                  >
                    {pane.workspaceName} &#x203A;{" "}
                    {pane.projectAlias || pane.projectName}
                  </span>

                  {/* Quick-select character */}
                  <div className="flex items-center justify-center py-2">
                    <span
                      className={[
                        "flex h-12 w-12 items-center justify-center rounded-md border",
                        "text-2xl font-semibold tabular-nums",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/80 text-foreground border-border",
                      ].join(" ")}
                    >
                      {label ?? "·"}
                    </span>
                  </div>

                  {/* Task title */}
                  <span className="line-clamp-2 text-sm font-medium text-foreground">
                    {pane.taskTitle}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>,
    document.body
  );
}
