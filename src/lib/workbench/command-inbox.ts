import "server-only";

import {
  childStopDedupKey,
  enqueueWorkbenchEvent,
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
  // Starting or resuming a CLI is not a provider turn boundary. The process may
  // still be booting or handling its startup prompt, so only the provider
  // callback (including durable completion replay) may open the consumer.
  return false;
}

export function restoreWorkbenchCommandConsumer(taskId: string): boolean {
  return restoreWorkbenchDrainBoundary(taskId);
}
