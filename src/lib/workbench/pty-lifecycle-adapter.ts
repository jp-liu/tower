import "server-only";

import { logger } from "@/lib/logger";
import { addPtyLifecycleObserver } from "@/lib/pty/lifecycle";
import { closeWorkbenchDrainBoundary } from "./boundary";
import {
  openWorkbenchDrainBoundary,
  recordWorkbenchProviderTurnCompleted,
} from "./coordinator";

const log = logger.create("workbench-pty-lifecycle");

export function registerWorkbenchPtyLifecycle(): void {
  addPtyLifecycleObserver({
    sessionStarted(taskId) {
      closeWorkbenchDrainBoundary(taskId);
    },
    inputStarted(taskId) {
      closeWorkbenchDrainBoundary(taskId);
    },
    async providerTurnCompleted(taskId, _turnKey, executionId) {
      openWorkbenchDrainBoundary(taskId, executionId);
      await recordWorkbenchProviderTurnCompleted(taskId).catch((error) => {
        log.warn("Failed to project provider turn completion", {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  });
}
