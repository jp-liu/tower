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
  launch: {
    mode: "already_running" | "continued" | "started" | string;
    executionId: string | null;
    startsAtInputBoundary?: boolean;
  },
): boolean {
  if (launch.mode === "already_running") return restoreWorkbenchDrainBoundary(taskId);
  if (launch.startsAtInputBoundary && launch.executionId) {
    openWorkbenchDrainBoundary(taskId, launch.executionId);
    return true;
  }
  // Unknown adapters and launches carrying startup input remain BUSY until the
  // current execution's provider callback (including durable replay) arrives.
  return false;
}

export function restoreWorkbenchCommandConsumer(taskId: string): boolean {
  return restoreWorkbenchDrainBoundary(taskId);
}
