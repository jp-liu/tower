"use client";

import { useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import type { ActiveExecutionInfo } from "@/actions/agent-actions";
import {
  GRID_PRESETS,
  DEFAULT_PRESET_ID,
} from "@/components/missions/grid-layout-presets";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Rocket } from "lucide-react";

export function MissionsClient({
  initialExecutions,
}: {
  initialExecutions: ActiveExecutionInfo[];
}) {
  const { t } = useI18n();
  const [cards, setCards] = useState<ActiveExecutionInfo[]>(initialExecutions);
  const [presetId, setPresetId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("missions-grid-preset") ?? DEFAULT_PRESET_ID;
    }
    return DEFAULT_PRESET_ID;
  });
  const [launcherOpen, setLauncherOpen] = useState(false);

  const preset = GRID_PRESETS.find((p) => p.id === presetId) ?? GRID_PRESETS[2];

  const handlePresetChange = useCallback((newId: string) => {
    setPresetId(newId);
    localStorage.setItem("missions-grid-preset", newId);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      {/* Toolbar */}
      <div className="h-12 shrink-0 border-b border-border px-4 flex items-center justify-between">
        <h1 className="text-base font-semibold">{t("missions.pageTitle")}</h1>
        <div className="flex items-center gap-2">
          {/* Grid preset selector */}
          <Select value={presetId} onValueChange={handlePresetChange}>
            <SelectTrigger className="w-32 h-8">
              <span className="truncate">{preset.label}</span>
            </SelectTrigger>
            <SelectContent>
              {GRID_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Launch task button */}
          <Button onClick={() => setLauncherOpen(true)}>
            {t("missions.launchTask")}
          </Button>
        </div>
      </div>

      {/* Grid area */}
      <div className="flex-1 overflow-auto p-4">
        {cards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <Rocket className="h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">{t("missions.emptyTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("missions.emptyDesc")}</p>
            <Button onClick={() => setLauncherOpen(true)}>
              {t("missions.launchTask")}
            </Button>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${preset.cols}, 1fr)`,
              gridAutoRows: `minmax(${preset.minHeight}, 1fr)`,
            }}
          >
            {cards.map((card) => (
              <div
                key={card.executionId}
                className="border border-border rounded-lg p-3 overflow-hidden"
              >
                <span className="text-sm font-medium truncate block">
                  {card.taskTitle}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
