type BoundaryState = {
  ready: Set<string>;
  timers: Map<string, { timer: ReturnType<typeof setTimeout>; dueAt: number }>;
};

const globalBoundary = globalThis as typeof globalThis & {
  __workbenchDrainBoundary?: BoundaryState;
};

const state = globalBoundary.__workbenchDrainBoundary ?? {
  ready: new Set<string>(),
  timers: new Map<string, { timer: ReturnType<typeof setTimeout>; dueAt: number }>(),
};
globalBoundary.__workbenchDrainBoundary = state;

export function markWorkbenchDrainBoundary(taskId: string): void {
  state.ready.add(taskId);
}

export function hasWorkbenchDrainBoundary(taskId: string): boolean {
  return state.ready.has(taskId);
}

export function takeWorkbenchDrainBoundary(taskId: string): boolean {
  const ready = state.ready.delete(taskId);
  const scheduled = state.timers.get(taskId);
  if (scheduled) clearTimeout(scheduled.timer);
  state.timers.delete(taskId);
  return ready;
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
