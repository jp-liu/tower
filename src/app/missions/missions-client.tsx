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
import { EmptyState } from "@/components/ui/empty-state";
import { Rocket } from "lucide-react";
import { GridPresetPicker } from "@/components/missions/grid-preset-picker";
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
  const [customGrid, setCustomGrid] = useState<{ cols: number; rows: number }>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("missions-grid-custom");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed?.cols === "number" && typeof parsed?.rows === "number") {
            return { cols: Math.max(1, Math.min(10, parsed.cols)), rows: Math.max(1, Math.min(10, parsed.rows)) };
          }
        }
      } catch { /* ignore */ }
    }
    return { cols: 2, rows: 2 };
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
  const gridCols = presetId === "custom" ? customGrid.cols : preset.cols;
  const gridRows = presetId === "custom" ? customGrid.rows : preset.rows;

  // Measure container to compute row height so each "page" of rows fills exactly one viewport
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState("480px");
  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el) return;
    const gap = 16; // gap-4 = 16px
    const padding = 32; // p-4 = 16px * 2
    const compute = () => {
      const available = el.clientHeight - padding;
      const h = (available - gap * (gridRows - 1)) / gridRows;
      setRowHeight(`${Math.max(h, 200)}px`);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gridRows]);

  const handlePresetChange = useCallback((newId: string | null, custom?: { cols: number; rows: number }) => {
    if (!newId) return;
    setPresetId(newId);
    localStorage.setItem("missions-grid-preset", newId);
    if (newId === "custom" && custom) {
      setCustomGrid(custom);
      localStorage.setItem("missions-grid-custom", JSON.stringify(custom));
    }
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
      }, 500);
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
      <div className="h-12 shrink-0 border-b border-border px-4 flex items-center gap-3">
        <h1 className="text-base font-semibold">{t("missions.pageTitle")}</h1>

        {/* Workspace filter — right of title */}
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

        <div className="flex-1" />

        {/* Grid preset picker — visual grid icons */}
        <GridPresetPicker value={presetId} customValue={customGrid} onChange={handlePresetChange} />

        {/* Launch task button — click to toggle popover */}
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

      {/* Grid area */}
      <div ref={gridContainerRef} className="flex-1 overflow-auto min-h-0 p-4">
        {visibleCards.length === 0 && removingIds.size === 0 ? (
          <EmptyState
            icon={Rocket}
            title={t("missions.emptyTitle")}
            description={t("missions.emptyDesc")}
            className="h-full"
            action={
              <Button onClick={() => setLauncherOpen(true)}>
                {t("missions.launchTask")}
              </Button>
            }
          />
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
                  gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                  gridAutoRows: rowHeight,
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
