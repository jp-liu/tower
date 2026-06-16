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
import { Rocket, Keyboard } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { GridPresetPicker } from "@/components/missions/grid-preset-picker";
import { PaneSelectorDialog } from "@/components/missions/pane-selector-dialog";
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
import { useActionShortcut } from "@/lib/shortcuts";
import {
  wrapIndex,
  moveSelection as moveSelectionIndex,
  type MoveDirection,
} from "@/components/missions/pane-navigation";
import type { TerminalControls } from "@/components/task/task-terminal";
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

  // --- Keyboard pane navigation state ---
  // Start in "input" mode: panes auto-focus their terminal on mount, so opening
  // Missions should land directly in a focused terminal — NOT flash the nav
  // overlay (white border + number) before the terminal grabs focus. The user
  // enters nav mode explicitly via the "exit to nav" shortcut (Ctrl+;).
  const [mode, setMode] = useState<"nav" | "input">("input");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Imperative terminal controls keyed by taskId; updated as panes mount/unmount.
  const controlsRef = useRef<Map<string, TerminalControls>>(new Map());
  // orderedControls + length, rebuilt every render from visibleCards order.
  // Held in refs so the (stable) shortcut/focusin handlers always read current values.
  const orderedControlsRef = useRef<TerminalControls[]>([]);
  const gridColsRef = useRef(2);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const onRegisterControls = useCallback(
    (taskId: string, controls: TerminalControls | null) => {
      if (controls) {
        controlsRef.current.set(taskId, controls);
      } else {
        controlsRef.current.delete(taskId);
      }
    },
    []
  );

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

  // --- Pane navigation actions (stable; read live state via refs) ---

  // Focus pane i → enter input mode + mark it selected. No-op if out of range.
  // Also scrolls the pane into view (no animation) so off-screen panes become
  // visible when selected from the picker / jump keys.
  const focusPane = useCallback((i: number) => {
    const controls = orderedControlsRef.current;
    if (i < 0 || i >= controls.length) return;
    controls[i]?.focus();
    setSelectedIndex(i);
    setMode("input");
    gridContainerRef.current
      ?.querySelector<HTMLElement>(`[data-pane-index="${i}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, []);

  // Blur current pane → back to navigation mode (overlay reappears).
  const exitToNav = useCallback(() => {
    orderedControlsRef.current[selectedIndexRef.current]?.blur();
    setMode("nav");
  }, []);

  const focusSelected = useCallback(() => {
    focusPane(selectedIndexRef.current);
  }, [focusPane]);

  // Toggle button: input → open the pane picker (nav); nav → focus current pane.
  const toggleMode = useCallback(() => {
    if (mode === "input") exitToNav();
    else focusSelected();
  }, [mode, exitToNav, focusSelected]);

  // Cycle focus to next/prev pane (wrap), staying in input mode.
  const nextPane = useCallback(() => {
    const len = orderedControlsRef.current.length;
    if (len === 0) return;
    focusPane(wrapIndex(selectedIndexRef.current, len, 1));
  }, [focusPane]);

  const prevPane = useCallback(() => {
    const len = orderedControlsRef.current.length;
    if (len === 0) return;
    focusPane(wrapIndex(selectedIndexRef.current, len, -1));
  }, [focusPane]);

  // Move highlight only (no focus); ensure overlay is visible.
  const moveHighlight = useCallback((dir: MoveDirection) => {
    const len = orderedControlsRef.current.length;
    if (len === 0) return;
    setMode("nav");
    setSelectedIndex((cur) =>
      moveSelectionIndex(cur, gridColsRef.current, len, dir)
    );
  }, []);

  // Cycle selection only (wrap), staying in nav mode.
  const cycleSelection = useCallback((dir: 1 | -1) => {
    const len = orderedControlsRef.current.length;
    if (len === 0) return;
    setMode("nav");
    setSelectedIndex((cur) => wrapIndex(cur, len, dir));
  }, []);

  // --- Shortcut registrations (scope "missions"; mounted only on /missions) ---

  // 1–9 jump → focus pane (digit read from event.key).
  useActionShortcut("missions.jump", (e) => {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1) focusPane(n - 1);
  });

  // Arrows → move highlight (nav).
  useActionShortcut("missions.moveSelection", (e) => {
    const dir =
      e.key === "ArrowUp" ? "up"
        : e.key === "ArrowDown" ? "down"
          : e.key === "ArrowLeft" ? "left"
            : "right";
    moveHighlight(dir);
  });

  // Tab / Shift+Tab → cycle selection (nav, wrap).
  useActionShortcut("missions.cycle", () => cycleSelection(1));
  useActionShortcut("missions.cycleBack", () => cycleSelection(-1));

  // Enter → focus selected pane.
  useActionShortcut("missions.focus", () => focusSelected());

  // $mod+] / $mod+ArrowRight → next pane; $mod+[ / $mod+ArrowLeft → prev pane.
  useActionShortcut("missions.next", () => nextPane());
  useActionShortcut("missions.prev", () => prevPane());

  // Control+; → back to navigation mode.
  useActionShortcut("missions.exit", () => exitToNav());

  // Mouse → input mode: detect focus entering a pane via focusin on the grid.
  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el) return;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      const card = target?.closest<HTMLElement>("[data-pane-index]");
      if (!card) return;
      const i = Number(card.dataset.paneIndex);
      if (!Number.isInteger(i)) return;
      setSelectedIndex(i);
      setMode("input");
    };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  }, []);

  // Derive deduplicated workspace list from current cards for filter
  const workspaceOptions = Array.from(
    new Map(cards.map((c) => [c.workspaceId, c.workspaceName])).entries()
  ).map(([id, name]) => ({ id, name }));

  // Apply workspace filter
  const visibleCards = filterWsId
    ? cards.filter((c) => c.workspaceId === filterWsId)
    : cards;

  // Keep refs used by stable handlers in sync with current render.
  orderedControlsRef.current = visibleCards
    .map((c) => controlsRef.current.get(c.taskId))
    .filter((c): c is TerminalControls => Boolean(c));
  gridColsRef.current = gridCols;

  // Clamp selectedIndex whenever the visible set shrinks so it stays in range.
  useEffect(() => {
    setSelectedIndex((cur) => {
      const len = visibleCards.length;
      if (len === 0) return 0;
      return Math.min(cur, len - 1);
    });
  }, [visibleCards.length]);

  // Running task IDs set (for picker to mark already-monitored tasks)
  const runningTaskIds = new Set(cards.map((c) => c.taskId));

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="header-sm shrink-0 px-4 flex items-center gap-3">
        <h1 className="text-base font-semibold">{t("missions.pageTitle")}</h1>

        {/* Mode toggle — click to open the pane picker (nav) / return to typing */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                className={`h-7 gap-1.5 px-2 shrink-0 text-xs font-medium text-muted-foreground ${
                  mode === "nav" ? "bg-accent text-foreground" : ""
                }`}
                onClick={toggleMode}
                disabled={visibleCards.length === 0}
              />
            }
          >
            <Keyboard className="h-3.5 w-3.5" />
            {mode === "input" ? t("missions.mode.input") : t("missions.mode.nav")}
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {t("missions.mode.toggleHint")}
          </TooltipContent>
        </Tooltip>

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
                {visibleCards.map((c, i) => (
                  <MissionCard
                    key={c.executionId}
                    execution={c}
                    isRemoving={removingIds.has(c.executionId)}
                    removeReason={removingIds.get(c.executionId)}
                    onStop={handleStop}
                    onSessionEnd={handleSessionEnd}
                    index={i}
                    onRegisterControls={onRegisterControls}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Navigation mode — centered pane picker (replaces per-pane overlay) */}
      <PaneSelectorDialog
        open={mode === "nav"}
        panes={visibleCards}
        selectedIndex={selectedIndex}
        onSelect={focusPane}
        onClose={focusSelected}
      />
    </div>
  );
}
