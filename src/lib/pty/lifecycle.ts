export type PtyLifecycleObserver = {
  sessionStarted?: (taskId: string, startsAtInputBoundary: boolean) => void;
  inputStarted?: (taskId: string) => void;
  providerTurnCompleted?: (taskId: string, turnKey?: string, executionId?: string) => void | Promise<void>;
};

const lifecycleGlobal = globalThis as typeof globalThis & {
  __towerPtyLifecycleObservers?: Set<PtyLifecycleObserver>;
};

function observers(): Set<PtyLifecycleObserver> {
  lifecycleGlobal.__towerPtyLifecycleObservers ??= new Set();
  return lifecycleGlobal.__towerPtyLifecycleObservers;
}

export function setPtyLifecycleObserver(observer: PtyLifecycleObserver): void {
  observers().clear();
  observers().add(observer);
}

export function addPtyLifecycleObserver(observer: PtyLifecycleObserver): () => void {
  observers().add(observer);
  return () => observers().delete(observer);
}

export function notifyPtyInputStarted(taskId: string): void {
  for (const observer of observers()) observer.inputStarted?.(taskId);
}

export function notifyPtySessionStarted(taskId: string, startsAtInputBoundary: boolean): void {
  for (const observer of observers()) observer.sessionStarted?.(taskId, startsAtInputBoundary);
}

export async function notifyPtyProviderTurnCompleted(
  taskId: string,
  turnKey?: string,
  executionId?: string,
): Promise<void> {
  await Promise.all(
    [...observers()].map((observer) => observer.providerTurnCompleted?.(taskId, turnKey, executionId)),
  );
}

export function resetPtyLifecycleObserverForTests(): void {
  observers().clear();
}
