"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import type { ActiveExecutionInfo } from "@/actions/agent-actions";
import {
  getActiveExecutionsAcrossWorkspaces,
  stopPtyExecution,
} from "@/actions/agent-actions";
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
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { MissionCard } from "@/components/missions/mission-card";
import { TaskPickerDialog } from "@/components/missions/task-picker-dialog";
import { toast } from "sonner";

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

  // removingIds: Map<executionId, "stopped" | "completed"> — tracks fading cards with their reason
  const [removingIds, setRemovingIds] = useState<Map<string, "stopped" | "completed">>(
    new Map()
  );
  // Ref mirror to avoid stale closures in polling and startFadeOut callbacks
  const removingIdsRef = useRef(removingIds);
  // Keep ref in sync with state
  useEffect(() => {
    removingIdsRef.current = removingIds;
  }, [removingIds]);

  // Fade timer registry
  const fadeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const preset = GRID_PRESETS.find((p) => p.id === presetId) ?? GRID_PRESETS[2];

  const handlePresetChange = useCallback((newId: string) => {
    setPresetId(newId);
    localStorage.setItem("missions-grid-preset", newId);
  }, []);

  // dnd-kit sensors — same config as kanban-board.tsx
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setCards((prev) => {
      const oldIndex = prev.findIndex((c) => c.executionId === active.id);
      const newIndex = prev.findIndex((c) => c.executionId === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  // startFadeOut — uses ref to avoid stale closure; accepts reason for D-11 badge distinction
  const startFadeOut = useCallback(
    (executionId: string, reason: "stopped" | "completed") => {
      // Use ref to check current removingIds — avoids stale closure
      if (removingIdsRef.current.has(executionId)) return;
      setRemovingIds((prev) => new Map([...prev, [executionId, reason]]));
      const timer = setTimeout(() => {
        setCards((prev) => prev.filter((c) => c.executionId !== executionId));
        setRemovingIds((prev) => {
          const next = new Map(prev);
          next.delete(executionId);
          return next;
        });
        fadeTimers.current.delete(executionId);
      }, 3000);
      fadeTimers.current.set(executionId, timer);
    },
    [] // No removingIds dependency — uses ref instead
  );

  // Polling every 4s (per D-10) — stable deps, uses ref for removingIds (avoids stale closure + interval teardown)
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const fresh = await getActiveExecutionsAcrossWorkspaces();
        const freshIds = new Set(fresh.map((e) => e.executionId));

        setCards((prev) => {
          const currentRemoving = removingIdsRef.current;

          // Cards that disappeared (ended naturally = "completed")
          const gone = prev.filter(
            (c) => !freshIds.has(c.executionId) && !currentRemoving.has(c.executionId)
          );
          gone.forEach((c) => startFadeOut(c.executionId, "completed"));

          // Keep existing ordered cards still running or fading
          const retained = prev.filter(
            (c) => freshIds.has(c.executionId) || currentRemoving.has(c.executionId)
          );
          // Append newly appeared executions
          const prevIds = new Set(prev.map((c) => c.executionId));
          const added = fresh.filter((e) => !prevIds.has(e.executionId));
          return [...retained, ...added];
        });
      } catch {
        // Silent on poll failure — retry next tick (per UI-SPEC error states)
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [startFadeOut]); // startFadeOut is stable (no deps), so interval is NOT torn down on removingIds change

  // Cleanup fade timers on unmount
  useEffect(() => {
    const timers = fadeTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  // handleStop — initiates optimistic fade with "stopped" reason (D-11), then calls stopPtyExecution
  const handleStop = useCallback(
    async (taskId: string) => {
      setCards((prev) => {
        const card = prev.find((c) => c.taskId === taskId);
        if (card) startFadeOut(card.executionId, "stopped");
        return prev;
      });
      try {
        await stopPtyExecution(taskId);
      } catch {
        toast.error(t("missions.error.stopFailed"));
      }
    },
    [startFadeOut, t]
  );

  // handleSessionEnd — terminal exit = natural completion
  const handleSessionEnd = useCallback(
    (_taskId: string, _exitCode: number) => {
      setCards((prev) => {
        const card = prev.find((c) => c.taskId === _taskId);
        if (card) startFadeOut(card.executionId, "completed");
        return prev;
      });
    },
    [startFadeOut]
  );

  // handleLaunched — optimistic: poll will pick up the new card; also trigger immediate poll
  const handleLaunched = useCallback((_taskId: string) => {
    getActiveExecutionsAcrossWorkspaces()
      .then((fresh) => {
        setCards((prev) => {
          const prevIds = new Set(prev.map((c) => c.executionId));
          const added = fresh.filter((e) => !prevIds.has(e.executionId));
          return [...prev, ...added];
        });
      })
      .catch(() => {});
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
        {cards.length === 0 && removingIds.size === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <Rocket className="h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">{t("missions.emptyTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("missions.emptyDesc")}</p>
            <Button onClick={() => setLauncherOpen(true)}>
              {t("missions.launchTask")}
            </Button>
          </div>
        ) : (
          <DndContext
            id="missions-dnd"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={cards.map((c) => c.executionId)}
              strategy={rectSortingStrategy}
            >
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(${preset.cols}, 1fr)`,
                  gridAutoRows: `minmax(${preset.minHeight}, 1fr)`,
                }}
              >
                {cards.map((c) => (
                  <MissionCard
                    key={c.executionId}
                    execution={c}
                    isRemoving={removingIds.has(c.executionId)}
                    removeReason={removingIds.get(c.executionId)}
                    onStop={handleStop}
                    onSessionEnd={handleSessionEnd}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <TaskPickerDialog
        open={launcherOpen}
        onOpenChange={setLauncherOpen}
        onLaunched={handleLaunched}
      />
    </div>
  );
}
