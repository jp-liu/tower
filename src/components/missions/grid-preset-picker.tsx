"use client";

import { useState, useRef, useEffect } from "react";
import { GRID_PRESETS } from "./grid-layout-presets";

/** Mini grid icon — renders cols x rows filled cells */
function MiniGrid({ cols, rows, active }: { cols: number; rows: number; active: boolean }) {
  const cells = Array.from({ length: cols * rows });
  return (
    <div
      className={`grid gap-[1px] w-7 h-5 p-[3px] rounded-sm border shrink-0 ${
        active ? "border-primary bg-primary/10" : "border-border bg-muted"
      }`}
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {cells.map((_, i) => (
        <div
          key={i}
          className={`rounded-[1px] min-w-0 min-h-0 ${
            active ? "bg-primary" : "bg-muted-foreground/40"
          }`}
        />
      ))}
    </div>
  );
}

interface GridPresetPickerProps {
  value: string;
  onChange: (id: string) => void;
}

export function GridPresetPicker({ value, onChange }: GridPresetPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = GRID_PRESETS.find((p) => p.id === value) ?? GRID_PRESETS[2];

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-background text-sm hover:bg-accent transition-colors"
      >
        <MiniGrid cols={current.cols} rows={current.rows} active={false} />
        <span>{current.label}</span>
        <span className="text-[10px] text-muted-foreground">▼</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-border bg-popover shadow-xl p-3">
          <h5 className="text-sm font-semibold text-foreground mb-3">Grid Layout Presets</h5>
          <div className="flex flex-col gap-0.5">
            {GRID_PRESETS.map((p) => {
              const isActive = p.id === value;
              return (
                <button
                  key={p.id}
                  onClick={() => { onChange(p.id); setOpen(false); }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? "bg-primary/10"
                      : "hover:bg-accent"
                  }`}
                >
                  <MiniGrid cols={p.cols} rows={p.rows} active={isActive} />
                  <span className={`text-sm font-medium flex-1 text-left ${isActive ? "text-primary" : "text-foreground"}`}>
                    {p.label}
                  </span>
                  <span className={`text-xs ${isActive ? "text-primary/60" : "text-muted-foreground"}`}>
                    {p.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
