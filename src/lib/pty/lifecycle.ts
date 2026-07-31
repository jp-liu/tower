export type PtyLifecycleObserver = {
  inputStarted?: (taskId: string) => void;
  providerTurnCompleted?: (taskId: string) => void | Promise<void>;
};

const lifecycleGlobal = globalThis as typeof globalThis & {
  __towerPtyLifecycleObserver?: PtyLifecycleObserver;
};

export function setPtyLifecycleObserver(observer: PtyLifecycleObserver): void {
  lifecycleGlobal.__towerPtyLifecycleObserver = observer;
}

export function notifyPtyInputStarted(taskId: string): void {
  lifecycleGlobal.__towerPtyLifecycleObserver?.inputStarted?.(taskId);
}

export async function notifyPtyProviderTurnCompleted(taskId: string): Promise<void> {
  await lifecycleGlobal.__towerPtyLifecycleObserver?.providerTurnCompleted?.(taskId);
}

export function resetPtyLifecycleObserverForTests(): void {
  delete lifecycleGlobal.__towerPtyLifecycleObserver;
}
