import "server-only";

import {
  childStopDedupKey,
  enqueueWorkbenchEvent,
  openWorkbenchDrainBoundary,
  restoreWorkbenchDrainBoundary,
} from "./coordinator";
import {
  persistWorkbenchCommand,
  type EnqueueWorkbenchEventInput,
  type WorkbenchEventKind,
  type WorkbenchEventPayload,
  type WorkbenchEventPriority,
} from "./event-contract";

export type {
  EnqueueWorkbenchEventInput as PublishWorkbenchCommandInput,
  WorkbenchEventKind as WorkbenchCommandKind,
  WorkbenchEventPayload as WorkbenchCommandPayload,
  WorkbenchEventPriority as WorkbenchCommandPriority,
};

export function publishWorkbenchCommand(input: EnqueueWorkbenchEventInput) {
  return enqueueWorkbenchEvent(input);
}

export { persistWorkbenchCommand };

export { childStopDedupKey };

export function activateWorkbenchCommandConsumer(
  taskId: string,
  mode: "already_running" | "continued" | "started" | string,
): boolean {
  if (mode === "already_running") return restoreWorkbenchDrainBoundary(taskId);
  openWorkbenchDrainBoundary(taskId);
  return true;
}

export function restoreWorkbenchCommandConsumer(taskId: string): boolean {
  return restoreWorkbenchDrainBoundary(taskId);
}
