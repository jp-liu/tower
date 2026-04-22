"use client";

import { useState, useRef, useEffect } from "react";
import { GRID_PRESETS } from "./grid-layout-presets";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { getConfigValues } from "@/actions/config-actions";

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

export interface CustomGridValue {
  cols: number;
  rows: number;
}

interface GridPresetPickerProps {
  value: string;
  customValue?: CustomGridValue;
  onChange: (id: string, custom?: CustomGridValue) => void;
}

const CUSTOM_ID = "custom";

export function GridPresetPicker({ value, customValue, onChange }: GridPresetPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isCustom = value === CUSTOM_ID;
  const current = isCustom ? null : (GRID_PRESETS.find((p) => p.id === value) ?? GRID_PRESETS[2]);

  // Editable custom cols/rows (local state for inputs)
  const [customCols, setCustomCols] = useState(customValue?.cols ?? 2);
  const [customRows, setCustomRows] = useState(customValue?.rows ?? 2);

  // Config limits from settings
  const [limits, setLimits] = useState({ minCols: 1, maxCols: 5, minRows: 1, maxRows: 5 });
  useEffect(() => {
    getConfigValues([
      "missions.grid.minCols",
      "missions.grid.maxCols",
      "missions.grid.minRows",
      "missions.grid.maxRows",
    ]).then((cfg) => {
      setLimits({
        minCols: (cfg["missions.grid.minCols"] as number) ?? 1,
        maxCols: (cfg["missions.grid.maxCols"] as number) ?? 5,
        minRows: (cfg["missions.grid.minRows"] as number) ?? 1,
        maxRows: (cfg["missions.grid.maxRows"] as number) ?? 5,
      });
    });
  }, []);

  // Sync external customValue into local state
  useEffect(() => {
    if (customValue) {
      setCustomCols(customValue.cols);
      setCustomRows(customValue.rows);
    }
  }, [customValue?.cols, customValue?.rows]);

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

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const handleCustomColsChange = (v: number) => {
    const clamped = clamp(v, limits.minCols, limits.maxCols);
    setCustomCols(clamped);
    onChange(CUSTOM_ID, { cols: clamped, rows: customRows });
  };

  const handleCustomRowsChange = (v: number) => {
    const clamped = clamp(v, limits.minRows, limits.maxRows);
    setCustomRows(clamped);
    onChange(CUSTOM_ID, { cols: customCols, rows: clamped });
  };

  const displayCols = isCustom ? customCols : (current?.cols ?? 2);
  const displayRows = isCustom ? customRows : (current?.rows ?? 2);
  const displayLabel = isCustom ? `${customCols}×${customRows}` : current?.label ?? "";

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <Button
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        className="gap-2"
      >
        <MiniGrid cols={displayCols} rows={displayRows} active={false} />
        <span>{displayLabel}</span>
        <span className="text-[10px] text-muted-foreground">▼</span>
      </Button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-border bg-popover shadow-xl p-3">
          <h5 className="text-sm font-semibold text-foreground mb-3">{t("missions.gridPreset")}</h5>
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

            {/* Custom option */}
            <div className="mt-1 border-t border-border pt-2">
              <button
                onClick={() => {
                  if (!isCustom) {
                    onChange(CUSTOM_ID, { cols: customCols, rows: customRows });
                  }
                }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full ${
                  isCustom ? "bg-primary/10" : "hover:bg-accent"
                }`}
              >
                <MiniGrid cols={customCols} rows={customRows} active={isCustom} />
                <span className={`text-sm font-medium flex-1 text-left ${isCustom ? "text-primary" : "text-foreground"}`}>
                  {t("missions.gridCustom")}
                </span>
                <span className={`text-xs ${isCustom ? "text-primary/60" : "text-muted-foreground"}`}>
                  {customCols}×{customRows}
                </span>
              </button>

              {isCustom && (
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground">{t("missions.gridCols")}</label>
                    <input
                      type="number"
                      min={limits.minCols}
                      max={limits.maxCols}
                      value={customCols}
                      onChange={(e) => handleCustomColsChange(Number(e.target.value))}
                      className="h-7 w-14 rounded-md border border-border bg-background px-2 text-sm text-center"
                    />
                  </div>
                  <span className="text-muted-foreground">×</span>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground">{t("missions.gridRows")}</label>
                    <input
                      type="number"
                      min={limits.minRows}
                      max={limits.maxRows}
                      value={customRows}
                      onChange={(e) => handleCustomRowsChange(Number(e.target.value))}
                      className="h-7 w-14 rounded-md border border-border bg-background px-2 text-sm text-center"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
