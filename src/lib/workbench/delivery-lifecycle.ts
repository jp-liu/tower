export type WorkbenchDispatchedCommand = {
  kind: string;
  payload: string;
};

export type WorkbenchDeliveryObserver = {
  batchDispatched?: (input: {
    batchId: string;
    commands: WorkbenchDispatchedCommand[];
  }) => void | Promise<void>;
};

const deliveryGlobal = globalThis as typeof globalThis & {
  __towerWorkbenchDeliveryObserver?: WorkbenchDeliveryObserver;
};

export function setWorkbenchDeliveryObserver(observer: WorkbenchDeliveryObserver): void {
  deliveryGlobal.__towerWorkbenchDeliveryObserver = observer;
}

export async function notifyWorkbenchBatchDispatched(input: {
  batchId: string;
  commands: WorkbenchDispatchedCommand[];
}): Promise<void> {
  await deliveryGlobal.__towerWorkbenchDeliveryObserver?.batchDispatched?.(input);
}

export function resetWorkbenchDeliveryObserverForTests(): void {
  delete deliveryGlobal.__towerWorkbenchDeliveryObserver;
}
