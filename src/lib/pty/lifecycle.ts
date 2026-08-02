export type PtyLifecycleObserver = {
  inputStarted?: (taskId: string) => void;
  providerTurnCompleted?: (taskId: string, turnKey?: string) => void | Promise<void>;
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

export async function notifyPtyProviderTurnCompleted(taskId: string, turnKey?: string): Promise<void> {
  await Promise.all([...observers()].map((observer) => observer.providerTurnCompleted?.(taskId, turnKey)));
}

export function resetPtyLifecycleObserverForTests(): void {
  observers().clear();
}
