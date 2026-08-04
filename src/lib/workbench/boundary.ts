type BoundaryState = {
  ready: Map<string, string | null>;
  timers: Map<string, { timer: ReturnType<typeof setTimeout>; dueAt: number }>;
};

const globalBoundary = globalThis as typeof globalThis & {
  __workbenchDrainBoundaryV2?: BoundaryState;
};

const state = globalBoundary.__workbenchDrainBoundaryV2 ?? {
  ready: new Map<string, string | null>(),
  timers: new Map<string, { timer: ReturnType<typeof setTimeout>; dueAt: number }>(),
};
globalBoundary.__workbenchDrainBoundaryV2 = state;

export function markWorkbenchDrainBoundary(taskId: string, executionId: string | null = null): void {
  state.ready.set(taskId, executionId);
}

export function getWorkbenchDrainBoundaryExecutionId(taskId: string): string | null | undefined {
  return state.ready.get(taskId);
}

export function hasWorkbenchDrainBoundary(taskId: string, executionId?: string | null): boolean {
  if (!state.ready.has(taskId)) return false;
  return executionId === undefined || state.ready.get(taskId) === executionId;
}

export function takeWorkbenchDrainBoundary(taskId: string, executionId?: string | null): boolean {
  if (!hasWorkbenchDrainBoundary(taskId, executionId)) return false;
  state.ready.delete(taskId);
  const scheduled = state.timers.get(taskId);
  if (scheduled) clearTimeout(scheduled.timer);
  state.timers.delete(taskId);
  return true;
}

export function closeWorkbenchDrainBoundary(taskId: string): void {
  takeWorkbenchDrainBoundary(taskId);
}

export function scheduleAtWorkbenchDrainBoundary(
  taskId: string,
  delayMs: number,
  callback: () => void,
): boolean {
  if (!state.ready.has(taskId)) return false;
  const current = state.timers.get(taskId);
  const dueAt = Date.now() + delayMs;
  // Never let a later normal event postpone an already-scheduled high-priority wake.
  if (current?.dueAt && current.dueAt <= dueAt) return true;
  if (current) clearTimeout(current.timer);
  const timer = setTimeout(() => {
    state.timers.delete(taskId);
    callback();
  }, delayMs);
  timer.unref?.();
  state.timers.set(taskId, { timer, dueAt });
  return true;
}

export function resetWorkbenchDrainBoundariesForTests(): void {
  for (const scheduled of state.timers.values()) clearTimeout(scheduled.timer);
  state.timers.clear();
  state.ready.clear();
}
