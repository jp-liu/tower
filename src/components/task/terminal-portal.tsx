"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createHtmlPortalNode,
  InPortal,
  OutPortal,
  type HtmlPortalNode,
} from "react-reverse-portal";
import dynamic from "next/dynamic";
import type { TerminalControls } from "@/components/task/task-terminal";

const TaskTerminal = dynamic(
  () => import("@/components/task/task-terminal").then((m) => ({ default: m.TaskTerminal })),
  { ssr: false }
);

/**
 * Reverse portal for terminal components using react-reverse-portal.
 *
 * Terminals persist across navigations (drawer ↔ detail page).
 * The DOM node is "teleported" between views — zero WS reconnect, zero flicker.
 */

interface TerminalInstance {
  portalNode: HtmlPortalNode;
  taskId: string;
  worktreePath: string;
  onSessionEnd: { current: ((exitCode: number) => void) | null };
  /** Imperative-controls callback — Mission Control panes use it for keyboard focus/blur. */
  onReady: { current: ((controls: TerminalControls | null) => void) | null };
  /**
   * Latest controls the (persistent) TaskTerminal handed up. Cached because the
   * terminal fires onReady only once at creation; a re-mounted outlet must be
   * handed the already-live controls instead of waiting for a fire that won't come.
   */
  controls: TerminalControls | null;
  /** How many outlets are currently projecting this node. >0 ⇒ visible ⇒ never evicted. */
  mountCount: number;
}

interface TerminalPortalContextValue {
  /** Get or create a portal node for a task */
  getPortal: (taskId: string, worktreePath: string) => TerminalInstance;
  /** Remove a terminal instance */
  removePortal: (taskId: string) => void;
  /** Register session-end callback for a task */
  setOnSessionEnd: (taskId: string, fn: ((exitCode: number) => void) | null) => void;
  /** Register terminal-ready (imperative controls) callback for a task */
  setOnReady: (taskId: string, fn: ((controls: TerminalControls | null) => void) | null) => void;
}

const TerminalPortalContext = createContext<TerminalPortalContextValue | null>(null);

export function useTerminalPortal() {
  const ctx = useContext(TerminalPortalContext);
  if (!ctx) throw new Error("useTerminalPortal must be used within TerminalPortalProvider");
  return ctx;
}

// Soft cap on IDLE (currently-unprojected) terminal instances kept warm for fast
// re-navigation. Terminals that are actively projected (mountCount > 0) are NEVER
// evicted — Mission Control renders one per running task and evicting a visible
// one would blank its terminal. So this only bounds the off-screen cache: how many
// terminals stay live after you leave their view (e.g. missions panes kept warm
// during a missions → detail → missions detour). 12 comfortably covers a 3×3 grid
// plus a detail visit; beyond that the oldest idle ones replay from the WS buffer
// on return (logged below).
const MAX_PORTAL_INSTANCES = 12;

export function TerminalPortalProvider({ children }: { children: ReactNode }) {
  const instancesRef = useRef(new Map<string, TerminalInstance>());
  // Track access order for LRU eviction (most recent at end)
  const accessOrderRef = useRef<string[]>([]);
  const [, setTick] = useState(0);

  const getPortal = useCallback((taskId: string, worktreePath: string) => {
    const existing = instancesRef.current.get(taskId);
    if (existing) {
      // Move to end of access order (most recently used)
      accessOrderRef.current = accessOrderRef.current.filter((id) => id !== taskId);
      accessOrderRef.current.push(taskId);
      return existing;
    }

    // Evict the oldest IDLE instances (mountCount === 0) when over capacity.
    // Skip anything currently projected — evicting a visible terminal would blank
    // it. If every instance is visible, the cache simply grows past the soft cap
    // (all of them are genuinely in use), which is correct.
    if (instancesRef.current.size >= MAX_PORTAL_INSTANCES) {
      for (const id of [...accessOrderRef.current]) {
        if (instancesRef.current.size < MAX_PORTAL_INSTANCES) break;
        const inst = instancesRef.current.get(id);
        if (!inst || inst.mountCount > 0) continue;
        instancesRef.current.delete(id);
        accessOrderRef.current = accessOrderRef.current.filter((x) => x !== id);
        console.warn(
          `[terminal-portal] evicted idle terminal ${id} (over ${MAX_PORTAL_INSTANCES} cap) — ` +
            `its history will replay from the WS buffer on next view`
        );
      }
    }

    const portalNode = createHtmlPortalNode({
      attributes: { style: "width:100%;height:100%" },
    });
    const instance: TerminalInstance = {
      portalNode,
      taskId,
      worktreePath,
      onSessionEnd: { current: null },
      onReady: { current: null },
      controls: null,
      mountCount: 0,
    };
    instancesRef.current.set(taskId, instance);
    accessOrderRef.current.push(taskId);
    setTick((t) => t + 1);
    return instance;
  }, []);

  const removePortal = useCallback((taskId: string) => {
    instancesRef.current.delete(taskId);
    accessOrderRef.current = accessOrderRef.current.filter((id) => id !== taskId);
    setTick((t) => t + 1);
  }, []);

  const setOnSessionEnd = useCallback((taskId: string, fn: ((exitCode: number) => void) | null) => {
    const inst = instancesRef.current.get(taskId);
    if (inst) inst.onSessionEnd.current = fn;
  }, []);

  const setOnReady = useCallback((taskId: string, fn: ((controls: TerminalControls | null) => void) | null) => {
    const inst = instancesRef.current.get(taskId);
    if (!inst) return;
    inst.onReady.current = fn;
    // A persistent terminal fires onReady once (at creation). A newly-mounted
    // outlet registering later must be handed the already-live controls now,
    // otherwise it never receives them and its keyboard controls stay dead.
    if (fn && inst.controls) fn(inst.controls);
  }, []);

  // Render all terminal instances via InPortal (they stay alive even when OutPortal unmounts)
  const portals = Array.from(instancesRef.current.values()).map((inst) => (
    <InPortal key={inst.taskId} node={inst.portalNode}>
      <TaskTerminal
        taskId={inst.taskId}
        worktreePath={inst.worktreePath}
        onSessionEnd={(code) => inst.onSessionEnd.current?.(code)}
        onReady={(controls) => {
          // Cache so a re-mounted outlet can be handed live controls (see setOnReady).
          inst.controls = controls;
          inst.onReady.current?.(controls);
        }}
        useCanvasRenderer
      />
    </InPortal>
  ));

  return (
    <TerminalPortalContext.Provider value={{ getPortal, removePortal, setOnSessionEnd, setOnReady }}>
      {children}
      {portals}
    </TerminalPortalContext.Provider>
  );
}

/**
 * Renders a terminal by "projecting" its persistent portal node here.
 * When this unmounts, the terminal stays alive — just detached from the DOM.
 */
export function TerminalOutlet({
  taskId,
  worktreePath,
  onSessionEnd,
  onReady,
}: {
  taskId: string;
  worktreePath: string;
  onSessionEnd?: (exitCode: number) => void;
  /** Imperative-controls callback (Mission Control keyboard focus/blur). */
  onReady?: (controls: TerminalControls | null) => void;
}) {
  const { getPortal, setOnSessionEnd, setOnReady } = useTerminalPortal();
  const [instance, setInstance] = useState<TerminalInstance | null>(null);

  // Latest onReady via ref — callers pass an inline callback that changes every
  // render, so register a STABLE forwarding wrapper once (per taskId) instead of
  // re-registering (and momentarily dropping controls) on every render. Synced in
  // an effect (not during render) since the wrapper only reads it after commit.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  // Create/get portal instance — clear stale instance immediately when taskId changes.
  // Track projection via mountCount so the provider never evicts a visible terminal.
  useEffect(() => {
    const inst = getPortal(taskId, worktreePath);
    inst.mountCount++;
    setInstance(inst);
    return () => {
      inst.mountCount--;
      setInstance(null);
    };
  }, [taskId, worktreePath, getPortal]);

  // Register session-end callback
  useEffect(() => {
    setOnSessionEnd(taskId, onSessionEnd ?? null);
    return () => setOnSessionEnd(taskId, null);
  }, [taskId, onSessionEnd, setOnSessionEnd]);

  // Register terminal-ready (imperative controls) callback via a stable wrapper.
  // On unmount, hand a null through so a consumer that keyed controls by taskId
  // (Mission Control) drops the stale entry.
  useEffect(() => {
    setOnReady(taskId, (controls) => onReadyRef.current?.(controls));
    return () => {
      onReadyRef.current?.(null);
      setOnReady(taskId, null);
    };
  }, [taskId, setOnReady]);

  if (!instance) return null;
  return <OutPortal node={instance.portalNode} />;
}
