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
}

interface TerminalPortalContextValue {
  /** Get or create a portal node for a task */
  getPortal: (taskId: string, worktreePath: string) => TerminalInstance;
  /** Remove a terminal instance */
  removePortal: (taskId: string) => void;
  /** Register session-end callback for a task */
  setOnSessionEnd: (taskId: string, fn: ((exitCode: number) => void) | null) => void;
}

const TerminalPortalContext = createContext<TerminalPortalContextValue | null>(null);

export function useTerminalPortal() {
  const ctx = useContext(TerminalPortalContext);
  if (!ctx) throw new Error("useTerminalPortal must be used within TerminalPortalProvider");
  return ctx;
}

export function TerminalPortalProvider({ children }: { children: ReactNode }) {
  const instancesRef = useRef(new Map<string, TerminalInstance>());
  const [, setTick] = useState(0);

  const getPortal = useCallback((taskId: string, worktreePath: string) => {
    const existing = instancesRef.current.get(taskId);
    if (existing) return existing;

    const portalNode = createHtmlPortalNode({
      attributes: { style: "width:100%;height:100%" },
    });
    const instance: TerminalInstance = {
      portalNode,
      taskId,
      worktreePath,
      onSessionEnd: { current: null },
    };
    instancesRef.current.set(taskId, instance);
    setTick((t) => t + 1);
    return instance;
  }, []);

  const removePortal = useCallback((taskId: string) => {
    instancesRef.current.delete(taskId);
    setTick((t) => t + 1);
  }, []);

  const setOnSessionEnd = useCallback((taskId: string, fn: ((exitCode: number) => void) | null) => {
    const inst = instancesRef.current.get(taskId);
    if (inst) inst.onSessionEnd.current = fn;
  }, []);

  // Render all terminal instances via InPortal (they stay alive even when OutPortal unmounts)
  const portals = Array.from(instancesRef.current.values()).map((inst) => (
    <InPortal key={inst.taskId} node={inst.portalNode}>
      <TaskTerminal
        taskId={inst.taskId}
        worktreePath={inst.worktreePath}
        onSessionEnd={(code) => inst.onSessionEnd.current?.(code)}
        useCanvasRenderer
      />
    </InPortal>
  ));

  return (
    <TerminalPortalContext.Provider value={{ getPortal, removePortal, setOnSessionEnd }}>
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
}: {
  taskId: string;
  worktreePath: string;
  onSessionEnd?: (exitCode: number) => void;
}) {
  const { getPortal, setOnSessionEnd } = useTerminalPortal();
  const [instance, setInstance] = useState<TerminalInstance | null>(null);

  // Create/get portal instance — clear stale instance immediately when taskId changes
  useEffect(() => {
    setInstance(getPortal(taskId, worktreePath));
    return () => setInstance(null);
  }, [taskId, worktreePath, getPortal]);

  // Register session-end callback
  useEffect(() => {
    setOnSessionEnd(taskId, onSessionEnd ?? null);
    return () => setOnSessionEnd(taskId, null);
  }, [taskId, onSessionEnd, setOnSessionEnd]);

  if (!instance) return null;
  return <OutPortal node={instance.portalNode} />;
}
