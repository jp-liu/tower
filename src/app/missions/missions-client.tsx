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
import { mergeMissions } from "@/components/missions/merge-missions";
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
  const [filterWsId, setFilterWsId] = useState<string>("");
  const launchBtnRef = useRef<HTMLButtonElement>(null);

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

  const handlePresetChange = useCallback((newId: string | null) => {
    if (!newId) return;
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

        setCards((prev) => {
          const currentRemoving = removingIdsRef.current;
          const { merged, goneIds } = mergeMissions({
            prev,
            fresh,
            removingIds: new Set(currentRemoving.keys()),
          });
          goneIds.forEach((id) => startFadeOut(id, "completed"));
          return merged;
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

  // handleStop — calls stopPtyExecution first, then fades out on success (avoids ghost removal on failure)
  const handleStop = useCallback(
    async (taskId: string) => {
      try {
        await stopPtyExecution(taskId);
        setCards((prev) => {
          const card = prev.find((c) => c.taskId === taskId);
          if (card) startFadeOut(card.executionId, "stopped");
          return prev;
        });
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

  // Derive deduplicated workspace list from current cards for filter
  const workspaceOptions = Array.from(
    new Map(cards.map((c) => [c.workspaceId, c.workspaceName])).entries()
  ).map(([id, name]) => ({ id, name }));

  // Apply workspace filter
  const visibleCards = filterWsId
    ? cards.filter((c) => c.workspaceId === filterWsId)
    : cards;

  // Running task IDs set (for picker to mark already-monitored tasks)
  const runningTaskIds = new Set(cards.map((c) => c.taskId));

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="h-12 shrink-0 border-b border-border px-4 flex items-center justify-between">
        <h1 className="text-base font-semibold">{t("missions.pageTitle")}</h1>
        <div className="flex items-center gap-2">
          {/* Workspace filter */}
          {workspaceOptions.length > 0 && (
            <Select value={filterWsId} onValueChange={(v) => setFilterWsId(v ?? "")}>
              <SelectTrigger className="w-36 h-8">
                <span className="truncate">
                  {filterWsId
                    ? (workspaceOptions.find((w) => w.id === filterWsId)?.name ?? t("missions.filterAll"))
                    : t("missions.filterAll")}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("missions.filterAll")}</SelectItem>
                {workspaceOptions.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

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

          {/* Launch task button — anchor for popover */}
          <div className="relative">
            <Button
              ref={launchBtnRef}
              onClick={() => setLauncherOpen((v) => !v)}
            >
              {t("missions.launchTask")}
            </Button>
            <TaskPickerDialog
              open={launcherOpen}
              onOpenChange={setLauncherOpen}
              onLaunched={handleLaunched}
              runningTaskIds={runningTaskIds}
              anchorRef={launchBtnRef}
            />
          </div>
        </div>
      </div>

      {/* Grid area */}
      <div className="flex-1 overflow-auto min-h-0 p-4">
        {visibleCards.length === 0 && removingIds.size === 0 ? (
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
              items={visibleCards.map((c) => c.executionId)}
              strategy={rectSortingStrategy}
            >
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(${preset.cols}, 1fr)`,
                  gridAutoRows: `minmax(${preset.minHeight}, 1fr)`,
                }}
              >
                {visibleCards.map((c) => (
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
    </div>
  );
}
